import * as vscode from 'vscode';
import { AnthropicProvider } from '../provider/AnthropicProvider';
import { Message, ContentBlock, StreamEvent, ToolDefinition } from '../provider/types';
import { ToolExecutor } from '../tools/ToolExecutor';
import { PermissionEngine } from '../permission/PermissionEngine';
import { SessionManager, SessionState } from '../session/SessionManager';
import { ToolCall, ToolContext, ToolExecution } from '../tools/types';

export type AgentState = 'idle' | 'waiting_input' | 'processing' | 'tool_pending' | 'error';

export interface AgentEvent {
    type: 'state_change' | 'text' | 'tool_start' | 'tool_end' | 'error' | 'complete';
    state?: AgentState;
    text?: string;
    toolExecution?: ToolExecution;
    error?: string;
}

export class AgentRuntime {
    private state: AgentState = 'idle';
    private provider = new AnthropicProvider();
    private toolExecutor = new ToolExecutor();
    private permissionEngine = new PermissionEngine();
    private eventListeners: ((event: AgentEvent) => void)[] = [];
    private abortController: AbortController | null = null;

    constructor(private sessionManager: SessionManager) {}

    getState(): AgentState {
        return this.state;
    }

    onEvent(listener: (event: AgentEvent) => void): () => void {
        this.eventListeners.push(listener);
        return () => {
            const index = this.eventListeners.indexOf(listener);
            if (index >= 0) {
                this.eventListeners.splice(index, 1);
            }
        };
    }

    private emit(event: AgentEvent): void {
        for (const listener of this.eventListeners) {
            listener(event);
        }
    }

    private setState(state: AgentState): void {
        this.state = state;
        this.emit({ type: 'state_change', state });
    }

    async sendMessage(
        content: string,
        onApprovalNeeded?: (execution: ToolExecution) => Promise<boolean>
    ): Promise<void> {
        if (this.state === 'processing' || this.state === 'tool_pending') {
            throw new Error('Agent is busy');
        }

        const session = this.sessionManager.getCurrentSession();
        const apiKey = await this.sessionManager.getSecretStore().getApiKey();

        if (!apiKey) {
            const newKey = await this.sessionManager.getSecretStore().promptForApiKey();
            if (!newKey) {
                this.emit({ type: 'error', error: 'API key is required' });
                return;
            }
        }

        const finalApiKey = await this.sessionManager.getSecretStore().getApiKey();
        if (!finalApiKey) {
            this.emit({ type: 'error', error: 'API key is required' });
            return;
        }

        // Add user message
        await this.sessionManager.addMessage({ role: 'user', content });

        this.abortController = new AbortController();
        await this.runAgentLoop(session, finalApiKey, onApprovalNeeded);
    }

    private async runAgentLoop(
        session: SessionState,
        apiKey: string,
        onApprovalNeeded?: (execution: ToolExecution) => Promise<boolean>
    ): Promise<void> {
        const maxIterations = 50; // Prevent infinite loops
        let iteration = 0;

        while (iteration < maxIterations) {
            iteration++;
            this.setState('processing');

            const messages = session.messages;
            const tools = this.toolExecutor.getToolDefinitions();

            let responseText = '';
            const toolCalls: ToolCall[] = [];
            let currentToolCall: { id: string; name: string; inputJson: string } | null = null;

            try {
                await this.provider.sendMessage(
                    messages,
                    tools,
                    {
                        apiKey,
                        model: session.model,
                        effortLevel: session.effortLevel,
                        maxTokens: 8192
                    },
                    (event: StreamEvent) => {
                        switch (event.type) {
                            case 'text':
                                if (event.text) {
                                    responseText += event.text;
                                    this.emit({ type: 'text', text: event.text });
                                }
                                break;

                            case 'tool_use_start':
                                if (event.toolUse) {
                                    currentToolCall = {
                                        id: event.toolUse.id,
                                        name: event.toolUse.name,
                                        inputJson: ''
                                    };
                                }
                                break;

                            case 'tool_use_input':
                                // Input is being streamed, will be parsed at end
                                break;

                            case 'tool_use_end':
                                if (event.toolUse) {
                                    toolCalls.push({
                                        id: event.toolUse.id,
                                        name: event.toolUse.name,
                                        input: event.toolUse.input || {}
                                    });
                                    this.emit({
                                        type: 'tool_start',
                                        toolExecution: {
                                            call: {
                                                id: event.toolUse.id,
                                                name: event.toolUse.name,
                                                input: event.toolUse.input || {}
                                            },
                                            status: 'pending'
                                        }
                                    });
                                }
                                currentToolCall = null;
                                break;

                            case 'error':
                                this.emit({ type: 'error', error: event.error });
                                break;
                        }
                    }
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                this.emit({ type: 'error', error: message });
                this.setState('error');
                return;
            }

            // Build assistant message content
            const assistantContent: ContentBlock[] = [];
            if (responseText) {
                assistantContent.push({ type: 'text', text: responseText });
            }
            for (const call of toolCalls) {
                assistantContent.push({
                    type: 'tool_use',
                    id: call.id,
                    name: call.name,
                    input: call.input
                });
            }

            // Add assistant message
            await this.sessionManager.addMessage({
                role: 'assistant',
                content: assistantContent.length === 1 && assistantContent[0].type === 'text'
                    ? assistantContent[0].text!
                    : assistantContent
            });

            // If no tool calls, we're done
            if (toolCalls.length === 0) {
                this.setState('idle');
                this.emit({ type: 'complete' });
                return;
            }

            // Execute tool calls
            const toolResults: ContentBlock[] = [];
            const context = this.getToolContext(session);

            for (const call of toolCalls) {
                const execution = await this.executeToolWithPermission(
                    call,
                    context,
                    onApprovalNeeded
                );

                this.emit({ type: 'tool_end', toolExecution: execution });

                if (execution.status === 'denied') {
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: call.id,
                        content: 'Tool execution was denied by the user',
                        is_error: true
                    });
                } else if (execution.status === 'error') {
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: call.id,
                        content: execution.error || 'Unknown error',
                        is_error: true
                    });
                } else if (execution.result) {
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: call.id,
                        content: execution.result.success
                            ? execution.result.output
                            : (execution.result.error || 'Unknown error'),
                        is_error: !execution.result.success
                    });
                }
            }

            // Add tool results as user message
            await this.sessionManager.addMessage({
                role: 'user',
                content: toolResults
            });

            // Continue the loop to let the model respond to tool results
        }

        this.emit({ type: 'error', error: 'Maximum iterations reached' });
        this.setState('error');
    }

    private async executeToolWithPermission(
        call: ToolCall,
        context: ToolContext,
        onApprovalNeeded?: (execution: ToolExecution) => Promise<boolean>
    ): Promise<ToolExecution> {
        const riskLevel = this.toolExecutor.getToolRiskLevel(call.name, call.input);
        const decision = this.permissionEngine.evaluate(call, riskLevel, context.autoMode);

        if (!decision.allowed) {
            return {
                call,
                status: 'denied',
                error: decision.reason || 'Not allowed by policy'
            };
        }

        if (decision.requiresConfirmation && onApprovalNeeded) {
            this.setState('tool_pending');
            const execution: ToolExecution = { call, status: 'pending' };
            const approved = await onApprovalNeeded(execution);

            if (!approved) {
                return { call, status: 'denied' };
            }
        }

        return this.toolExecutor.executeToolCall(call, context);
    }

    private getToolContext(session: SessionState): ToolContext {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        return {
            workspaceRoot: workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
            autoMode: session.autoMode
        };
    }

    abort(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.setState('idle');
    }
}
