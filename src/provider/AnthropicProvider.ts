import Anthropic from '@anthropic-ai/sdk';
import {
    Provider,
    Message,
    ToolDefinition,
    ProviderConfig,
    StreamEvent,
    ModelInfo,
    ModelCapabilities
} from './types';

const ANTHROPIC_MODELS: ModelInfo[] = [
    {
        id: 'claude-sonnet-4-20250514',
        displayName: 'Claude Sonnet 4',
        provider: 'anthropic',
        capabilities: {
            maxContextTokens: 200000,
            supportsToolUse: true,
            supportsStreaming: true,
            supportsEffortLevels: false,
            supportsPromptCaching: true
        }
    },
    {
        id: 'claude-opus-4-20250514',
        displayName: 'Claude Opus 4',
        provider: 'anthropic',
        capabilities: {
            maxContextTokens: 200000,
            supportsToolUse: true,
            supportsStreaming: true,
            supportsEffortLevels: true,
            supportedEffortLevels: ['low', 'medium', 'high'],
            supportsPromptCaching: true
        }
    },
    {
        id: 'claude-3-5-haiku-20241022',
        displayName: 'Claude 3.5 Haiku',
        provider: 'anthropic',
        capabilities: {
            maxContextTokens: 200000,
            supportsToolUse: true,
            supportsStreaming: true,
            supportsEffortLevels: false,
            supportsPromptCaching: true
        }
    }
];

export class AnthropicProvider implements Provider {
    readonly name = 'anthropic';

    async sendMessage(
        messages: Message[],
        tools: ToolDefinition[],
        config: ProviderConfig,
        onEvent: (event: StreamEvent) => void
    ): Promise<void> {
        const client = new Anthropic({ apiKey: config.apiKey });

        const modelInfo = this.getModelInfo(config.model);
        const maxTokens = config.maxTokens || 8192;

        // Convert messages to Anthropic format
        const anthropicMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.content
        }));

        // Build request parameters
        const params: Anthropic.MessageCreateParams = {
            model: config.model,
            max_tokens: maxTokens,
            messages: anthropicMessages as Anthropic.MessageParam[],
            stream: true
        };

        // Add tools if provided
        if (tools.length > 0) {
            params.tools = tools as Anthropic.Tool[];
        }

        // Add extended thinking for models that support it
        if (modelInfo?.capabilities.supportsEffortLevels && config.effortLevel) {
            const budgetTokens = this.getThinkingBudget(config.effortLevel);
            if (budgetTokens > 0) {
                (params as unknown as Record<string, unknown>).thinking = {
                    type: 'enabled',
                    budget_tokens: budgetTokens
                };
                // Extended thinking requires higher max_tokens
                params.max_tokens = Math.max(maxTokens, budgetTokens + 4096);
            }
        }

        try {
            const stream = await client.messages.stream(params);

            let currentToolUse: { id: string; name: string; inputJson: string } | null = null;

            for await (const event of stream) {
                if (event.type === 'message_start') {
                    onEvent({ type: 'message_start' });
                } else if (event.type === 'content_block_start') {
                    const block = event.content_block;
                    if (block.type === 'tool_use') {
                        currentToolUse = {
                            id: block.id,
                            name: block.name,
                            inputJson: ''
                        };
                        onEvent({
                            type: 'tool_use_start',
                            toolUse: { id: block.id, name: block.name }
                        });
                    }
                } else if (event.type === 'content_block_delta') {
                    const delta = event.delta;
                    if (delta.type === 'text_delta') {
                        onEvent({ type: 'text', text: delta.text });
                    } else if (delta.type === 'input_json_delta' && currentToolUse) {
                        currentToolUse.inputJson += delta.partial_json;
                        onEvent({
                            type: 'tool_use_input',
                            toolUse: {
                                id: currentToolUse.id,
                                name: currentToolUse.name
                            }
                        });
                    }
                } else if (event.type === 'content_block_stop') {
                    if (currentToolUse) {
                        let input: Record<string, unknown> = {};
                        try {
                            input = JSON.parse(currentToolUse.inputJson || '{}');
                        } catch {
                            // Invalid JSON, use empty object
                        }
                        onEvent({
                            type: 'tool_use_end',
                            toolUse: {
                                id: currentToolUse.id,
                                name: currentToolUse.name,
                                input
                            }
                        });
                        currentToolUse = null;
                    }
                } else if (event.type === 'message_stop') {
                    onEvent({ type: 'message_end' });
                } else if (event.type === 'message_delta') {
                    onEvent({
                        type: 'message_end',
                        stopReason: event.delta.stop_reason
                    });
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            onEvent({ type: 'error', error: message });
            throw error;
        }
    }

    listModels(): ModelInfo[] {
        return ANTHROPIC_MODELS;
    }

    getModelInfo(modelId: string): ModelInfo | undefined {
        return ANTHROPIC_MODELS.find(m => m.id === modelId);
    }

    private getThinkingBudget(level: string): number {
        switch (level) {
            case 'low':
                return 1024;
            case 'medium':
                return 4096;
            case 'high':
                return 16384;
            default:
                return 0;
        }
    }
}
