import * as vscode from 'vscode';
import { Tool, ToolCall, ToolResult, ToolContext, ToolExecution, RiskLevel } from './types';
import { ToolDefinition } from '../provider/types';
import { ReadFileTool, WriteFileTool, EditFileTool, ListFilesTool, DeleteFileTool } from './FileTools';
import { SearchFilesTool } from './SearchTools';
import { RunCommandTool, GitStatusTool, GitCommitTool } from './TerminalTools';

export class ToolExecutor {
    private tools: Map<string, Tool> = new Map();
    private pendingApprovals: Map<string, {
        resolve: (approved: boolean) => void;
        execution: ToolExecution;
    }> = new Map();

    constructor() {
        this.registerDefaultTools();
    }

    private registerDefaultTools(): void {
        const defaultTools: Tool[] = [
            new ReadFileTool(),
            new WriteFileTool(),
            new EditFileTool(),
            new ListFilesTool(),
            new DeleteFileTool(),
            new SearchFilesTool(),
            new RunCommandTool(),
            new GitStatusTool(),
            new GitCommitTool()
        ];

        for (const tool of defaultTools) {
            this.tools.set(tool.name, tool);
        }
    }

    registerTool(tool: Tool): void {
        this.tools.set(tool.name, tool);
    }

    registerTools(tools: Tool[]): void {
        for (const tool of tools) {
            this.tools.set(tool.name, tool);
        }
    }

    unregisterTool(name: string): void {
        this.tools.delete(name);
    }

    unregisterToolsWithPrefix(prefix: string): void {
        for (const name of this.tools.keys()) {
            if (name.startsWith(prefix)) {
                this.tools.delete(name);
            }
        }
    }

    getTool(name: string): Tool | undefined {
        return this.tools.get(name);
    }

    getToolDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema
        }));
    }

    getToolRiskLevel(name: string, input?: Record<string, unknown>): RiskLevel {
        const tool = this.tools.get(name);
        if (!tool) return 'high';

        // Special handling for run_command which has dynamic risk
        if (name === 'run_command' && input?.command) {
            const cmdTool = tool as RunCommandTool;
            return cmdTool.getCommandRiskLevel(input.command as string);
        }

        return tool.riskLevel;
    }

    async executeToolCall(
        call: ToolCall,
        context: ToolContext,
        onApprovalNeeded?: (execution: ToolExecution) => Promise<boolean>
    ): Promise<ToolExecution> {
        const execution: ToolExecution = {
            call,
            status: 'pending'
        };

        const tool = this.tools.get(call.name);
        if (!tool) {
            execution.status = 'error';
            execution.error = `Unknown tool: ${call.name}`;
            return execution;
        }

        const riskLevel = this.getToolRiskLevel(call.name, call.input);

        // Check if approval is needed
        const needsApproval = this.needsApproval(riskLevel, context.autoMode);

        if (needsApproval && onApprovalNeeded) {
            const approved = await onApprovalNeeded(execution);
            if (!approved) {
                execution.status = 'denied';
                return execution;
            }
        }

        execution.status = 'running';

        try {
            const result = await tool.execute(call.input, context);
            execution.result = result;
            execution.status = 'completed';
        } catch (error) {
            execution.status = 'error';
            execution.error = error instanceof Error ? error.message : 'Unknown error';
        }

        return execution;
    }

    private needsApproval(riskLevel: RiskLevel, autoMode: boolean): boolean {
        // High risk always needs approval
        if (riskLevel === 'high') {
            return true;
        }

        // In auto mode, low and medium don't need approval
        if (autoMode) {
            return false;
        }

        // Without auto mode, medium needs approval
        return riskLevel === 'medium';
    }

    approveExecution(callId: string, approved: boolean): void {
        const pending = this.pendingApprovals.get(callId);
        if (pending) {
            pending.resolve(approved);
            this.pendingApprovals.delete(callId);
        }
    }

    listTools(): Tool[] {
        return Array.from(this.tools.values());
    }
}
