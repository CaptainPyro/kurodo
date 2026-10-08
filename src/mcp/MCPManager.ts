import { MCPClient } from './MCPClient';
import { MCPToolAdapter } from './MCPToolAdapter';
import { getMCPServersConfig, MCPServerConfig } from './MCPConfig';
import { Tool } from '../tools/types';

export class MCPManager {
    private clients: Map<string, MCPClient> = new Map();
    private tools: MCPToolAdapter[] = [];

    async initialize(): Promise<void> {
        const servers = getMCPServersConfig();

        for (const [name, config] of Object.entries(servers)) {
            try {
                await this.connectServer(name, config);
            } catch (error) {
                console.error(`Failed to connect to MCP server ${name}:`, error);
            }
        }
    }

    async connectServer(name: string, config: MCPServerConfig): Promise<void> {
        // Disconnect existing client if any
        const existing = this.clients.get(name);
        if (existing) {
            existing.disconnect();
            this.clients.delete(name);
        }

        const client = new MCPClient(name, config);
        await client.connect();
        this.clients.set(name, client);

        // Create tool adapters for this server's tools
        this.refreshToolsFromClient(client);
    }

    private refreshToolsFromClient(client: MCPClient): void {
        // Remove existing tools from this client
        this.tools = this.tools.filter(t => !t.name.startsWith(`mcp_${client.getServerName()}_`));

        // Add new tools
        for (const mcpTool of client.getTools()) {
            this.tools.push(new MCPToolAdapter(client, mcpTool));
        }
    }

    async refreshAllTools(): Promise<void> {
        for (const client of this.clients.values()) {
            if (client.isConnected()) {
                await client.refreshTools();
                this.refreshToolsFromClient(client);
            }
        }
    }

    getTools(): Tool[] {
        return this.tools;
    }

    getConnectedServers(): string[] {
        return Array.from(this.clients.entries())
            .filter(([_, client]) => client.isConnected())
            .map(([name, _]) => name);
    }

    disconnectServer(name: string): void {
        const client = this.clients.get(name);
        if (client) {
            client.disconnect();
            this.clients.delete(name);
            // Remove tools from this server
            this.tools = this.tools.filter(t => !t.name.startsWith(`mcp_${name}_`));
        }
    }

    disconnectAll(): void {
        for (const client of this.clients.values()) {
            client.disconnect();
        }
        this.clients.clear();
        this.tools = [];
    }

    isServerConnected(name: string): boolean {
        return this.clients.get(name)?.isConnected() || false;
    }
}
