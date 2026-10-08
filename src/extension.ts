import * as vscode from 'vscode';
import { ChatViewProvider } from './ui/ChatViewProvider';
import { SessionManager } from './session/SessionManager';
import { SecretStore } from './util/secrets';
import { MCPManager } from './mcp/MCPManager';

let sessionManager: SessionManager;
let mcpManager: MCPManager;

// Startup timing (minimal - logs total activation time only)
let activationStart: number;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    activationStart = Date.now();
    console.log('Kurodo is activating...');

    // Initialize secret storage
    const secretStore = new SecretStore(context.secrets);

    // Initialize session manager (async session loading starts but doesn't block)
    sessionManager = new SessionManager(context, secretStore);

    // Initialize MCP manager
    mcpManager = new MCPManager();

    // Register the chat webview provider
    // NOTE: ChatViewProvider constructor is now lightweight - heavy initialization
    // (AgentRuntime, tools, etc.) is deferred until webview is shown
    console.log('[Kurodo] Creating ChatViewProvider...');
    const chatViewProvider = new ChatViewProvider(context.extensionUri, sessionManager, mcpManager);
    console.log('[Kurodo] ChatViewProvider created');

    console.log('[Kurodo] Registering WebviewViewProvider for kurodo.chatView...');
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'kurodo.chatView',
            chatViewProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );
    console.log('[Kurodo] WebviewViewProvider registered');

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('kurodo.start', () => {
            vscode.commands.executeCommand('kurodo.chatView.focus');
        }),

        vscode.commands.registerCommand('kurodo.newSession', () => {
            sessionManager.createSession();
            chatViewProvider.refresh();
        }),

        vscode.commands.registerCommand('kurodo.clearSession', () => {
            sessionManager.clearCurrentSession();
            chatViewProvider.refresh();
        })
    );

    // Initialize MCP servers (async, don't block activation)
    mcpManager.initialize().then(() => {
        console.log('MCP servers initialized:', mcpManager.getConnectedServers());
    }).catch((error) => {
        console.error('Failed to initialize MCP servers:', error);
    });

    // Listen for configuration changes to reload MCP servers
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('kurodo.mcpServers')) {
                console.log('MCP configuration changed, reinitializing...');
                mcpManager.disconnectAll();
                await mcpManager.initialize();
            }
        })
    );

    console.log(`Kurodo activated in ${Date.now() - activationStart}ms`);
}

export function deactivate(): void {
    // Clean up MCP connections
    if (mcpManager) {
        mcpManager.disconnectAll();
    }
    console.log('Kurodo deactivated');
}
