import * as vscode from 'vscode';

const API_KEY_KEY = 'kurodo.anthropicApiKey';

export class SecretStore {
    constructor(private readonly secrets: vscode.SecretStorage) {}

    async getApiKey(): Promise<string | undefined> {
        return this.secrets.get(API_KEY_KEY);
    }

    async setApiKey(key: string): Promise<void> {
        await this.secrets.store(API_KEY_KEY, key);
    }

    async deleteApiKey(): Promise<void> {
        await this.secrets.delete(API_KEY_KEY);
    }

    async hasApiKey(): Promise<boolean> {
        const key = await this.getApiKey();
        return key !== undefined && key.length > 0;
    }

    async promptForApiKey(): Promise<string | undefined> {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Anthropic API key',
            password: true,
            placeHolder: 'sk-ant-...',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'API key is required';
                }
                if (!value.startsWith('sk-ant-')) {
                    return 'API key should start with sk-ant-';
                }
                return null;
            }
        });

        if (key) {
            await this.setApiKey(key);
        }

        return key;
    }
}
