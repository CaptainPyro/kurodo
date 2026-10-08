import * as vscode from 'vscode';
import { SessionManager } from '../session/SessionManager';
import { AgentRuntime, AgentEvent } from '../agent/AgentRuntime';
import { ToolExecution } from '../tools/types';
import { AnthropicProvider } from '../provider/AnthropicProvider';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private agentRuntime: AgentRuntime;
    private provider = new AnthropicProvider();
    private pendingApprovals: Map<string, {
        resolve: (approved: boolean) => void;
    }> = new Map();

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly sessionManager: SessionManager
    ) {
        this.agentRuntime = new AgentRuntime(sessionManager);
        this.setupAgentListeners();
    }

    private setupAgentListeners(): void {
        this.agentRuntime.onEvent((event: AgentEvent) => {
            this.sendToWebview({
                type: 'agent_event',
                event
            });
        });
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });

        // Send initial state
        this.sendInitialState();
    }

    refresh(): void {
        if (this.view) {
            this.sendInitialState();
        }
    }

    private async handleMessage(message: Record<string, unknown>): Promise<void> {
        switch (message.type) {
            case 'send_message':
                await this.handleSendMessage(message.content as string);
                break;

            case 'approve_tool':
                this.handleToolApproval(message.callId as string, true);
                break;

            case 'deny_tool':
                this.handleToolApproval(message.callId as string, false);
                break;

            case 'update_model':
                await this.sessionManager.updateModel(message.model as string);
                break;

            case 'update_effort':
                await this.sessionManager.updateEffortLevel(message.level as 'low' | 'medium' | 'high');
                break;

            case 'toggle_auto_mode':
                await this.sessionManager.updateAutoMode(message.enabled as boolean);
                break;

            case 'new_session':
                this.sessionManager.createSession();
                this.sendInitialState();
                break;

            case 'get_api_key_status':
                const hasKey = await this.sessionManager.getSecretStore().hasApiKey();
                this.sendToWebview({ type: 'api_key_status', hasKey });
                break;

            case 'set_api_key':
                await this.sessionManager.getSecretStore().promptForApiKey();
                const newHasKey = await this.sessionManager.getSecretStore().hasApiKey();
                this.sendToWebview({ type: 'api_key_status', hasKey: newHasKey });
                break;

            case 'abort':
                this.agentRuntime.abort();
                break;
        }
    }

    private async handleSendMessage(content: string): Promise<void> {
        try {
            await this.agentRuntime.sendMessage(content, async (execution: ToolExecution) => {
                return this.requestToolApproval(execution);
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.sendToWebview({
                type: 'error',
                error: errorMessage
            });
        }
    }

    private async requestToolApproval(execution: ToolExecution): Promise<boolean> {
        return new Promise((resolve) => {
            this.pendingApprovals.set(execution.call.id, { resolve });
            this.sendToWebview({
                type: 'tool_approval_needed',
                execution
            });
        });
    }

    private handleToolApproval(callId: string, approved: boolean): void {
        const pending = this.pendingApprovals.get(callId);
        if (pending) {
            pending.resolve(approved);
            this.pendingApprovals.delete(callId);
        }
    }

    private sendInitialState(): void {
        const session = this.sessionManager.getCurrentSession();
        const models = this.provider.listModels();
        const currentModel = this.provider.getModelInfo(session.model);

        this.sendToWebview({
            type: 'initial_state',
            session: {
                id: session.id,
                messages: session.messages,
                model: session.model,
                effortLevel: session.effortLevel,
                autoMode: session.autoMode
            },
            models: models.map(m => ({
                id: m.id,
                displayName: m.displayName,
                capabilities: m.capabilities
            })),
            currentModelCapabilities: currentModel?.capabilities
        });
    }

    private sendToWebview(message: Record<string, unknown>): void {
        if (this.view) {
            this.view.webview.postMessage(message);
        }
    }

    private getHtmlContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>Kurodo</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .header {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
        }

        .header select, .header button {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            font-size: 12px;
        }

        .header button {
            cursor: pointer;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .header button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .header .auto-mode {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 12px;
        }

        .header .auto-mode input {
            margin: 0;
        }

        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }

        .message {
            margin-bottom: 16px;
            padding: 10px 12px;
            border-radius: 6px;
            max-width: 95%;
        }

        .message.user {
            background: var(--vscode-input-background);
            margin-left: auto;
        }

        .message.assistant {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
        }

        .message-role {
            font-size: 11px;
            font-weight: 600;
            margin-bottom: 4px;
            opacity: 0.8;
            text-transform: uppercase;
        }

        .message-content {
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.5;
        }

        .tool-call {
            margin: 8px 0;
            padding: 8px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            border-radius: 3px;
            font-size: 12px;
        }

        .tool-call-header {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 4px;
        }

        .tool-call-input {
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            opacity: 0.8;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .tool-result {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .tool-result.error {
            color: var(--vscode-errorForeground);
        }

        .approval-buttons {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }

        .approval-buttons button {
            padding: 4px 12px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }

        .approval-buttons .approve {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .approval-buttons .deny {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .input-area {
            padding: 12px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .input-container {
            display: flex;
            gap: 8px;
        }

        .input-container textarea {
            flex: 1;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            resize: none;
            font-family: inherit;
            font-size: inherit;
            min-height: 60px;
            max-height: 200px;
        }

        .input-container textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .input-container button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
        }

        .input-container button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .input-container button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .status {
            font-size: 11px;
            padding: 4px 0;
            opacity: 0.7;
        }

        .api-key-notice {
            padding: 12px;
            background: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            margin: 12px;
            border-radius: 4px;
            text-align: center;
        }

        .api-key-notice button {
            margin-top: 8px;
            padding: 6px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }

        .streaming-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: var(--vscode-textLink-foreground);
            border-radius: 50%;
            animation: pulse 1s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }

        pre, code {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
        }

        pre {
            padding: 8px;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <div class="header">
        <select id="model-select" title="Model">
            <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
        </select>
        <select id="effort-select" title="Effort Level">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
        </select>
        <label class="auto-mode">
            <input type="checkbox" id="auto-mode-toggle">
            Auto Mode
        </label>
        <button id="new-session-btn" title="New Session">New</button>
    </div>

    <div id="api-key-notice" class="api-key-notice" style="display: none;">
        <div>API key required to start</div>
        <button id="set-api-key-btn">Set API Key</button>
    </div>

    <div class="messages" id="messages"></div>

    <div class="input-area">
        <div id="status" class="status"></div>
        <div class="input-container">
            <textarea id="input" placeholder="Ask Kurodo to help with your code..." rows="2"></textarea>
            <button id="send-btn">Send</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // State
        let state = {
            messages: [],
            model: 'claude-sonnet-4-20250514',
            effortLevel: 'medium',
            autoMode: false,
            models: [],
            isProcessing: false,
            hasApiKey: false,
            currentModelCapabilities: null,
            pendingApprovals: new Map(),
            streamingText: ''
        };

        // Elements
        const messagesEl = document.getElementById('messages');
        const inputEl = document.getElementById('input');
        const sendBtn = document.getElementById('send-btn');
        const modelSelect = document.getElementById('model-select');
        const effortSelect = document.getElementById('effort-select');
        const autoModeToggle = document.getElementById('auto-mode-toggle');
        const newSessionBtn = document.getElementById('new-session-btn');
        const statusEl = document.getElementById('status');
        const apiKeyNotice = document.getElementById('api-key-notice');
        const setApiKeyBtn = document.getElementById('set-api-key-btn');

        // Initialize
        vscode.postMessage({ type: 'get_api_key_status' });

        // Event listeners
        sendBtn.addEventListener('click', sendMessage);
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        modelSelect.addEventListener('change', () => {
            vscode.postMessage({ type: 'update_model', model: modelSelect.value });
            updateEffortOptions();
        });

        effortSelect.addEventListener('change', () => {
            vscode.postMessage({ type: 'update_effort', level: effortSelect.value });
        });

        autoModeToggle.addEventListener('change', () => {
            vscode.postMessage({ type: 'toggle_auto_mode', enabled: autoModeToggle.checked });
        });

        newSessionBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'new_session' });
        });

        setApiKeyBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'set_api_key' });
        });

        // Functions
        function sendMessage() {
            const content = inputEl.value.trim();
            if (!content || state.isProcessing) return;

            inputEl.value = '';
            state.isProcessing = true;
            updateUI();

            vscode.postMessage({ type: 'send_message', content });
        }

        function renderMessages() {
            messagesEl.innerHTML = '';

            for (const msg of state.messages) {
                const msgEl = document.createElement('div');
                msgEl.className = 'message ' + msg.role;

                const roleEl = document.createElement('div');
                roleEl.className = 'message-role';
                roleEl.textContent = msg.role === 'user' ? 'You' : 'Kurodo';
                msgEl.appendChild(roleEl);

                const contentEl = document.createElement('div');
                contentEl.className = 'message-content';

                if (typeof msg.content === 'string') {
                    contentEl.textContent = msg.content;
                } else if (Array.isArray(msg.content)) {
                    for (const block of msg.content) {
                        if (block.type === 'text') {
                            const textSpan = document.createElement('span');
                            textSpan.textContent = block.text || '';
                            contentEl.appendChild(textSpan);
                        } else if (block.type === 'tool_use') {
                            const toolEl = document.createElement('div');
                            toolEl.className = 'tool-call';
                            toolEl.innerHTML = \`
                                <div class="tool-call-header">\${escapeHtml(block.name)}</div>
                                <div class="tool-call-input">\${escapeHtml(JSON.stringify(block.input, null, 2).slice(0, 200))}</div>
                            \`;
                            contentEl.appendChild(toolEl);
                        } else if (block.type === 'tool_result') {
                            const resultEl = document.createElement('div');
                            resultEl.className = 'tool-result' + (block.is_error ? ' error' : '');
                            resultEl.textContent = typeof block.content === 'string'
                                ? block.content.slice(0, 500)
                                : JSON.stringify(block.content).slice(0, 500);
                            contentEl.appendChild(resultEl);
                        }
                    }
                }

                msgEl.appendChild(contentEl);
                messagesEl.appendChild(msgEl);
            }

            // Add streaming text if any
            if (state.streamingText) {
                const streamingEl = document.createElement('div');
                streamingEl.className = 'message assistant';
                streamingEl.innerHTML = \`
                    <div class="message-role">Kurodo <span class="streaming-indicator"></span></div>
                    <div class="message-content">\${escapeHtml(state.streamingText)}</div>
                \`;
                messagesEl.appendChild(streamingEl);
            }

            // Render pending approvals
            for (const [callId, execution] of state.pendingApprovals) {
                const approvalEl = document.createElement('div');
                approvalEl.className = 'tool-call';
                approvalEl.innerHTML = \`
                    <div class="tool-call-header">Approve: \${escapeHtml(execution.call.name)}</div>
                    <div class="tool-call-input">\${escapeHtml(JSON.stringify(execution.call.input, null, 2))}</div>
                    <div class="approval-buttons">
                        <button class="approve" onclick="approveTool('\${callId}')">Allow</button>
                        <button class="deny" onclick="denyTool('\${callId}')">Deny</button>
                    </div>
                \`;
                messagesEl.appendChild(approvalEl);
            }

            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        function updateUI() {
            sendBtn.disabled = state.isProcessing;
            sendBtn.textContent = state.isProcessing ? 'Stop' : 'Send';

            if (state.isProcessing) {
                sendBtn.onclick = () => vscode.postMessage({ type: 'abort' });
            } else {
                sendBtn.onclick = sendMessage;
            }

            statusEl.textContent = state.isProcessing ? 'Processing...' : '';

            apiKeyNotice.style.display = state.hasApiKey ? 'none' : 'block';
        }

        function updateModelSelect() {
            modelSelect.innerHTML = '';
            for (const model of state.models) {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.displayName;
                option.selected = model.id === state.model;
                modelSelect.appendChild(option);
            }
            updateEffortOptions();
        }

        function updateEffortOptions() {
            const selectedModel = state.models.find(m => m.id === modelSelect.value);
            const supportsEffort = selectedModel?.capabilities?.supportsEffortLevels;

            effortSelect.disabled = !supportsEffort;
            if (!supportsEffort) {
                effortSelect.value = 'medium';
            }
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        window.approveTool = function(callId) {
            state.pendingApprovals.delete(callId);
            vscode.postMessage({ type: 'approve_tool', callId });
            renderMessages();
        };

        window.denyTool = function(callId) {
            state.pendingApprovals.delete(callId);
            vscode.postMessage({ type: 'deny_tool', callId });
            renderMessages();
        };

        // Message handler
        window.addEventListener('message', (event) => {
            const message = event.data;

            switch (message.type) {
                case 'initial_state':
                    state.messages = message.session.messages || [];
                    state.model = message.session.model;
                    state.effortLevel = message.session.effortLevel;
                    state.autoMode = message.session.autoMode;
                    state.models = message.models || [];
                    state.currentModelCapabilities = message.currentModelCapabilities;

                    modelSelect.value = state.model;
                    effortSelect.value = state.effortLevel;
                    autoModeToggle.checked = state.autoMode;

                    updateModelSelect();
                    renderMessages();
                    updateUI();
                    break;

                case 'api_key_status':
                    state.hasApiKey = message.hasKey;
                    updateUI();
                    break;

                case 'agent_event':
                    handleAgentEvent(message.event);
                    break;

                case 'tool_approval_needed':
                    state.pendingApprovals.set(message.execution.call.id, message.execution);
                    renderMessages();
                    break;

                case 'error':
                    state.isProcessing = false;
                    statusEl.textContent = 'Error: ' + message.error;
                    updateUI();
                    break;
            }
        });

        function handleAgentEvent(event) {
            switch (event.type) {
                case 'state_change':
                    state.isProcessing = event.state === 'processing' || event.state === 'tool_pending';
                    updateUI();
                    break;

                case 'text':
                    state.streamingText += event.text;
                    renderMessages();
                    break;

                case 'tool_start':
                    // Tool starting
                    break;

                case 'tool_end':
                    // Tool finished
                    break;

                case 'complete':
                    state.isProcessing = false;
                    state.streamingText = '';
                    // Refresh messages from session
                    vscode.postMessage({ type: 'get_state' });
                    updateUI();
                    break;

                case 'error':
                    state.isProcessing = false;
                    state.streamingText = '';
                    statusEl.textContent = 'Error: ' + event.error;
                    updateUI();
                    break;
            }
        }
    </script>
</body>
</html>`;
    }
}
