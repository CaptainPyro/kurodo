import * as vscode from 'vscode';

export interface MCPServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}

export interface MCPServersConfig {
    [serverName: string]: MCPServerConfig;
}

export function getMCPServersConfig(): MCPServersConfig {
    const config = vscode.workspace.getConfiguration('kurodo');
    return config.get<MCPServersConfig>('mcpServers', {});
}

export function getServerNames(): string[] {
    const servers = getMCPServersConfig();
    return Object.keys(servers);
}

export function getServerConfig(name: string): MCPServerConfig | undefined {
    const servers = getMCPServersConfig();
    return servers[name];
}
