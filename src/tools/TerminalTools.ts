import * as vscode from 'vscode';
import * as cp from 'child_process';
import { Tool, ToolResult, ToolContext, RiskLevel } from './types';

// Commands that are considered dangerous and require explicit approval
const DANGEROUS_COMMANDS = [
    'rm -rf',
    'rm -r',
    'rmdir',
    'del /s',
    'format',
    'mkfs',
    'dd',
    'chmod 777',
    'curl | sh',
    'curl | bash',
    'wget | sh',
    'wget | bash',
    '> /dev/sda',
    'git push --force',
    'git push -f',
    'git reset --hard',
    'drop database',
    'drop table',
    'truncate',
    'shutdown',
    'reboot',
    'kill -9',
    'pkill',
    'killall'
];

// Commands that are safe for reading/inspection
const SAFE_COMMANDS = [
    'ls', 'dir', 'pwd', 'cd', 'cat', 'head', 'tail', 'less', 'more',
    'grep', 'find', 'which', 'whereis', 'file', 'stat', 'wc',
    'git status', 'git log', 'git diff', 'git branch', 'git show',
    'node --version', 'npm --version', 'npm list', 'npm ls',
    'python --version', 'pip list',
    'echo', 'env', 'printenv', 'whoami', 'hostname', 'date',
    'df', 'du', 'free', 'top', 'ps'
];

export class RunCommandTool implements Tool {
    name = 'run_command';
    description = 'Execute a shell command in the workspace directory';
    riskLevel: RiskLevel = 'medium'; // Default, gets adjusted based on command

    inputSchema = {
        type: 'object' as const,
        properties: {
            command: {
                type: 'string',
                description: 'The shell command to execute'
            },
            cwd: {
                type: 'string',
                description: 'Working directory for the command (default: workspace root)'
            },
            timeout: {
                type: 'number',
                description: 'Timeout in milliseconds (default: 30000)'
            }
        },
        required: ['command']
    };

    getCommandRiskLevel(command: string): RiskLevel {
        const lowerCommand = command.toLowerCase();

        // Check for dangerous commands
        for (const dangerous of DANGEROUS_COMMANDS) {
            if (lowerCommand.includes(dangerous.toLowerCase())) {
                return 'high';
            }
        }

        // Check for safe commands
        for (const safe of SAFE_COMMANDS) {
            if (lowerCommand.startsWith(safe.toLowerCase())) {
                return 'low';
            }
        }

        return 'medium';
    }

    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const command = input.command as string;
        const cwd = (input.cwd as string) || context.workspaceRoot;
        const timeout = (input.timeout as number) || 30000;

        return new Promise((resolve) => {
            const options: cp.ExecOptions = {
                cwd,
                timeout,
                maxBuffer: 10 * 1024 * 1024, // 10MB
                env: { ...process.env, FORCE_COLOR: '0' }
            };

            cp.exec(command, options, (error, stdout, stderr) => {
                const stdoutStr = stdout?.toString() || '';
                const stderrStr = stderr?.toString() || '';

                if (error) {
                    // Check if it was a timeout
                    if (error.killed) {
                        resolve({
                            success: false,
                            output: stdoutStr,
                            error: `Command timed out after ${timeout}ms`
                        });
                        return;
                    }

                    resolve({
                        success: false,
                        output: stdoutStr,
                        error: stderrStr || error.message
                    });
                    return;
                }

                const output = stdoutStr + (stderrStr ? `\n${stderrStr}` : '');
                resolve({
                    success: true,
                    output: output.trim()
                });
            });
        });
    }
}

export class GitStatusTool implements Tool {
    name = 'git_status';
    description = 'Get the current git status of the workspace';
    riskLevel: RiskLevel = 'low';

    inputSchema = {
        type: 'object' as const,
        properties: {},
        required: []
    };

    async execute(_input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        return new Promise((resolve) => {
            cp.exec('git status --porcelain', { cwd: context.workspaceRoot }, (error, stdout, stderr) => {
                const stdoutStr = stdout?.toString() || '';
                const stderrStr = stderr?.toString() || '';

                if (error) {
                    resolve({
                        success: false,
                        output: '',
                        error: stderrStr || error.message
                    });
                    return;
                }

                if (!stdoutStr.trim()) {
                    resolve({
                        success: true,
                        output: 'Working tree clean - no changes'
                    });
                    return;
                }

                resolve({
                    success: true,
                    output: stdoutStr.trim()
                });
            });
        });
    }
}

export class GitCommitTool implements Tool {
    name = 'git_commit';
    description = 'Stage files and create a git commit';
    riskLevel: RiskLevel = 'medium';

    inputSchema = {
        type: 'object' as const,
        properties: {
            message: {
                type: 'string',
                description: 'The commit message'
            },
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files to stage (default: all changes)'
            }
        },
        required: ['message']
    };

    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const message = input.message as string;
        const files = input.files as string[] | undefined;

        return new Promise((resolve) => {
            const stageCmd = files && files.length > 0
                ? `git add ${files.map(f => `"${f}"`).join(' ')}`
                : 'git add -A';

            const commitCmd = `git commit -m "${message.replace(/"/g, '\\"')}"`;

            cp.exec(`${stageCmd} && ${commitCmd}`, { cwd: context.workspaceRoot }, (error, stdout, stderr) => {
                const stdoutStr = stdout?.toString() || '';
                const stderrStr = stderr?.toString() || '';

                if (error) {
                    resolve({
                        success: false,
                        output: stdoutStr,
                        error: stderrStr || error.message
                    });
                    return;
                }

                resolve({
                    success: true,
                    output: stdoutStr.trim()
                });
            });
        });
    }
}
