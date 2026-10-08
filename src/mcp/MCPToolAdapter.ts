import { MCPClient, MCPTool } from './MCPClient';
import { Tool, ToolResult, ToolContext, RiskLevel } from '../tools/types';

export class MCPToolAdapter implements Tool {
    readonly name: string;
    readonly description: string;
    readonly riskLevel: RiskLevel = 'medium'; // MCP tools default to medium risk
    readonly inputSchema: Tool['inputSchema'];

    constructor(
        private client: MCPClient,
        private mcpTool: MCPTool
    ) {
        // Prefix tool name with server name to avoid collisions
        this.name = `mcp_${client.getServerName()}_${mcpTool.name}`;
        this.description = `[MCP: ${client.getServerName()}] ${mcpTool.description}`;
        this.inputSchema = mcpTool.inputSchema;
    }

    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        try {
            const result = await this.client.callTool(this.mcpTool.name, input);

            // Convert MCP result to tool result
            const textContent = result.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');

            if (result.isError) {
                return {
                    success: false,
                    output: '',
                    error: textContent || 'MCP tool execution failed'
                };
            }

            return {
                success: true,
                output: textContent || 'Tool executed successfully'
            };
        } catch (error) {
            return {
                success: false,
                output: '',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    getOriginalName(): string {
        return this.mcpTool.name;
    }
}
