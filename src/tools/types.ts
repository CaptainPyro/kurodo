import { ToolDefinition } from '../provider/types';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ToolResult {
    success: boolean;
    output: string;
    error?: string;
}

export interface ToolContext {
    workspaceRoot: string;
    autoMode: boolean;
}

export interface Tool {
    name: string;
    description: string;
    riskLevel: RiskLevel;
    inputSchema: ToolDefinition['input_schema'];

    execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface ToolCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface ToolExecution {
    call: ToolCall;
    result?: ToolResult;
    status: 'pending' | 'approved' | 'denied' | 'running' | 'completed' | 'error';
    error?: string;
}
