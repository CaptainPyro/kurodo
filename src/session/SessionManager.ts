import * as vscode from 'vscode';
import { SecretStore } from '../util/secrets';
import { Message, EffortLevel } from '../provider/types';

export interface SessionState {
    id: string;
    createdAt: number;
    updatedAt: number;
    messages: Message[];
    model: string;
    effortLevel: EffortLevel;
    autoMode: boolean;
}

export interface SessionMetadata {
    id: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    title: string;
}

const SESSION_KEY_PREFIX = 'kurodo.session.';
const SESSIONS_INDEX_KEY = 'kurodo.sessions.index';
const CURRENT_SESSION_KEY = 'kurodo.currentSessionId';

export class SessionManager {
    private currentSession: SessionState | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly secretStore: SecretStore
    ) {
        this.loadCurrentSession();
    }

    private get storage(): vscode.Memento {
        return this.context.globalState;
    }

    private async loadCurrentSession(): Promise<void> {
        const currentId = this.storage.get<string>(CURRENT_SESSION_KEY);
        if (currentId) {
            this.currentSession = await this.loadSession(currentId);
        }
        if (!this.currentSession) {
            this.createSession();
        }
    }

    createSession(): SessionState {
        const config = vscode.workspace.getConfiguration('kurodo');

        this.currentSession = {
            id: this.generateId(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
            model: config.get('defaultModel', 'claude-sonnet-4-20250514'),
            effortLevel: config.get('effortLevel', 'medium') as EffortLevel,
            autoMode: config.get('autoMode', false)
        };

        this.saveCurrentSession();
        return this.currentSession;
    }

    getCurrentSession(): SessionState {
        if (!this.currentSession) {
            this.createSession();
        }
        return this.currentSession!;
    }

    async addMessage(message: Message): Promise<void> {
        if (!this.currentSession) {
            this.createSession();
        }

        this.currentSession!.messages.push(message);
        this.currentSession!.updatedAt = Date.now();
        await this.saveCurrentSession();
    }

    async updateModel(model: string): Promise<void> {
        if (this.currentSession) {
            this.currentSession.model = model;
            await this.saveCurrentSession();
        }
    }

    async updateEffortLevel(level: EffortLevel): Promise<void> {
        if (this.currentSession) {
            this.currentSession.effortLevel = level;
            await this.saveCurrentSession();
        }
    }

    async updateAutoMode(enabled: boolean): Promise<void> {
        if (this.currentSession) {
            this.currentSession.autoMode = enabled;
            await this.saveCurrentSession();
        }
    }

    clearCurrentSession(): void {
        if (this.currentSession) {
            this.currentSession.messages = [];
            this.currentSession.updatedAt = Date.now();
            this.saveCurrentSession();
        }
    }

    async listSessions(): Promise<SessionMetadata[]> {
        const index = this.storage.get<string[]>(SESSIONS_INDEX_KEY, []);
        const sessions: SessionMetadata[] = [];

        for (const id of index) {
            const session = await this.loadSession(id);
            if (session) {
                sessions.push({
                    id: session.id,
                    createdAt: session.createdAt,
                    updatedAt: session.updatedAt,
                    messageCount: session.messages.length,
                    title: this.generateTitle(session)
                });
            }
        }

        return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async switchToSession(id: string): Promise<boolean> {
        const session = await this.loadSession(id);
        if (session) {
            this.currentSession = session;
            await this.storage.update(CURRENT_SESSION_KEY, id);
            return true;
        }
        return false;
    }

    async deleteSession(id: string): Promise<void> {
        await this.storage.update(SESSION_KEY_PREFIX + id, undefined);

        const index = this.storage.get<string[]>(SESSIONS_INDEX_KEY, []);
        const newIndex = index.filter(i => i !== id);
        await this.storage.update(SESSIONS_INDEX_KEY, newIndex);

        if (this.currentSession?.id === id) {
            if (newIndex.length > 0) {
                await this.switchToSession(newIndex[0]);
            } else {
                this.createSession();
            }
        }
    }

    getSecretStore(): SecretStore {
        return this.secretStore;
    }

    private async loadSession(id: string): Promise<SessionState | null> {
        return this.storage.get<SessionState>(SESSION_KEY_PREFIX + id) || null;
    }

    private async saveCurrentSession(): Promise<void> {
        if (!this.currentSession) return;

        const id = this.currentSession.id;
        await this.storage.update(SESSION_KEY_PREFIX + id, this.currentSession);
        await this.storage.update(CURRENT_SESSION_KEY, id);

        // Update index
        const index = this.storage.get<string[]>(SESSIONS_INDEX_KEY, []);
        if (!index.includes(id)) {
            index.push(id);
            await this.storage.update(SESSIONS_INDEX_KEY, index);
        }
    }

    private generateId(): string {
        return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    private generateTitle(session: SessionState): string {
        if (session.messages.length === 0) {
            return 'New Session';
        }

        const firstUserMessage = session.messages.find(m => m.role === 'user');
        if (firstUserMessage) {
            const content = typeof firstUserMessage.content === 'string'
                ? firstUserMessage.content
                : firstUserMessage.content
                    .filter(b => b.type === 'text')
                    .map(b => b.text)
                    .join(' ');

            return content.slice(0, 50) + (content.length > 50 ? '...' : '');
        }

        return 'Session';
    }
}
