export interface Message {
    role: 'user' | 'assistant';
    content: string | ContentBlock[];
}

export interface ContentBlock {
    type: 'text' | 'tool_use' | 'tool_result';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    content?: string | ContentBlock[];
    is_error?: boolean;
}

export interface ToolDefinition {
    name: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

export interface StreamEvent {
    type: 'text' | 'tool_use_start' | 'tool_use_input' | 'tool_use_end' | 'message_start' | 'message_end' | 'error';
    text?: string;
    toolUse?: {
        id: string;
        name: string;
        input?: Record<string, unknown>;
    };
    error?: string;
    stopReason?: string | null;
}

export type EffortLevel = 'low' | 'medium' | 'high';

export interface ModelCapabilities {
    maxContextTokens: number;
    supportsToolUse: boolean;
    supportsStreaming: boolean;
    supportsEffortLevels: boolean;
    supportedEffortLevels?: EffortLevel[];
    supportsPromptCaching: boolean;
}

export interface ModelInfo {
    id: string;
    displayName: string;
    provider: string;
    capabilities: ModelCapabilities;
}

export interface ProviderConfig {
    apiKey: string;
    model: string;
    effortLevel?: EffortLevel;
    maxTokens?: number;
}

export interface Provider {
    readonly name: string;

    sendMessage(
        messages: Message[],
        tools: ToolDefinition[],
        config: ProviderConfig,
        onEvent: (event: StreamEvent) => void
    ): Promise<void>;

    listModels(): ModelInfo[];
    getModelInfo(modelId: string): ModelInfo | undefined;
}
