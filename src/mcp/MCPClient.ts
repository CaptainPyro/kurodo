import * as cp from 'child_process';
import { MCPServerConfig } from './MCPConfig';

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

export interface MCPCallToolResult {
    content: Array<{
        type: 'text' | 'image' | 'resource';
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
    isError?: boolean;
}

type MessageHandler = (message: unknown) => void;

export class MCPClient {
    private process: cp.ChildProcess | null = null;
    private messageBuffer = '';
    private messageId = 0;
    private pendingRequests = new Map<number, {
        resolve: (result: unknown) => void;
        reject: (error: Error) => void;
    }>();
    private messageHandlers: MessageHandler[] = [];
    private tools: MCPTool[] = [];
    private connected = false;

    constructor(
        private serverName: string,
        private config: MCPServerConfig
    ) {}

    async connect(): Promise<void> {
        if (this.connected) return;

        return new Promise((resolve, reject) => {
            const env = {
                ...process.env,
                ...this.config.env
            };

            this.process = cp.spawn(this.config.command, this.config.args || [], {
                cwd: this.config.cwd,
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.process.stdout?.on('data', (data: Buffer) => {
                this.handleData(data.toString());
            });

            this.process.stderr?.on('data', (data: Buffer) => {
                console.error(`MCP ${this.serverName} stderr:`, data.toString());
            });

            this.process.on('error', (err) => {
                console.error(`MCP ${this.serverName} error:`, err);
                reject(err);
            });

            this.process.on('close', (code) => {
                console.log(`MCP ${this.serverName} closed with code ${code}`);
                this.connected = false;
                this.tools = [];
            });

            // Initialize the connection
            this.initialize()
                .then(() => {
                    this.connected = true;
                    resolve();
                })
                .catch(reject);
        });
    }

    private handleData(data: string): void {
        this.messageBuffer += data;

        // Process complete JSON-RPC messages (newline-delimited)
        const lines = this.messageBuffer.split('\n');
        this.messageBuffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const message = JSON.parse(line);
                    this.handleMessage(message);
                } catch (e) {
                    console.error('Failed to parse MCP message:', line);
                }
            }
        }
    }

    private handleMessage(message: Record<string, unknown>): void {
        // Handle response to a request
        if ('id' in message && message.id !== undefined) {
            const pending = this.pendingRequests.get(message.id as number);
            if (pending) {
                this.pendingRequests.delete(message.id as number);
                if ('error' in message) {
                    pending.reject(new Error((message.error as Record<string, string>)?.message || 'Unknown error'));
                } else {
                    pending.resolve(message.result);
                }
            }
        }

        // Notify handlers
        for (const handler of this.messageHandlers) {
            handler(message);
        }
    }

    private send(message: Record<string, unknown>): void {
        if (!this.process?.stdin) {
            throw new Error('MCP process not connected');
        }
        this.process.stdin.write(JSON.stringify(message) + '\n');
    }

    private request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
        return new Promise((resolve, reject) => {
            const id = ++this.messageId;
            this.pendingRequests.set(id, {
                resolve: resolve as (result: unknown) => void,
                reject
            });

            this.send({
                jsonrpc: '2.0',
                id,
                method,
                params: params || {}
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }

    private async initialize(): Promise<void> {
        // Send initialize request
        await this.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {
                tools: {}
            },
            clientInfo: {
                name: 'kurodo',
                version: '0.1.0'
            }
        });

        // Send initialized notification
        this.send({
            jsonrpc: '2.0',
            method: 'notifications/initialized'
        });

        // List available tools
        await this.refreshTools();
    }

    async refreshTools(): Promise<void> {
        const result = await this.request<{ tools: MCPTool[] }>('tools/list');
        this.tools = result.tools || [];
    }

    getTools(): MCPTool[] {
        return this.tools;
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallToolResult> {
        const result = await this.request<MCPCallToolResult>('tools/call', {
            name,
            arguments: args
        });
        return result;
    }

    isConnected(): boolean {
        return this.connected;
    }

    disconnect(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.connected = false;
        this.tools = [];
        this.pendingRequests.clear();
    }

    getServerName(): string {
        return this.serverName;
    }
}
