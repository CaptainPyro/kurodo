import * as vscode from 'vscode';
import { ChatViewProvider } from './ui/ChatViewProvider';
import { SessionManager } from './session/SessionManager';
import { SecretStore } from './util/secrets';

let sessionManager: SessionManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Kurodo is activating...');

    // Initialize secret storage
    const secretStore = new SecretStore(context.secrets);

    // Initialize session manager
    sessionManager = new SessionManager(context, secretStore);

    // Register the chat webview provider
    const chatViewProvider = new ChatViewProvider(context.extensionUri, sessionManager);

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

    console.log('Kurodo activated successfully');
}

export function deactivate(): void {
    console.log('Kurodo deactivated');
}
