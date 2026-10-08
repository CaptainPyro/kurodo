import * as cp from 'child_process';
import { Tool, ToolResult, ToolContext, RiskLevel } from './types';

// Patterns that indicate dangerous commands requiring explicit approval
const DANGEROUS_PATTERNS: RegExp[] = [
    // Destructive file operations
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|.*--recursive)/i,  // rm with recursive flag
    /\brm\s+-[a-zA-Z]*f/i,  // rm with force flag
    /\brmdir\b/i,
    /\bdel\s+\/s/i,
    /\bformat\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    />\s*\/dev\/(sd|hd|nvme)/i,  // Writing to disk devices

    // Dangerous permission changes
    /\bchmod\s+(-[a-zA-Z]*\s+)?(777|a\+rwx)/i,
    /\bchown\s+-R\s+root/i,

    // Remote code execution
    /\bcurl\b.*\|\s*(ba)?sh/i,
    /\bwget\b.*\|\s*(ba)?sh/i,
    /\beval\s*\(/i,
    /\beval\s+["'`$]/i,

    // Git destructive operations
    /\bgit\s+push\s+(-[a-zA-Z]*f|--force)/i,
    /\bgit\s+reset\s+--hard/i,
    /\bgit\s+clean\s+-[a-zA-Z]*f/i,
    /\bgit\s+checkout\s+--force/i,
    /\bgit\s+rebase\s+-i?\s*(--root|HEAD~[0-9]+)/i,

    // Database destructive operations
    /\bdrop\s+(database|table|schema|index)/i,
    /\btruncate\s+table/i,
    /\bdelete\s+from\s+\w+\s*(;|$|\s+where\s+1\s*=\s*1)/i,  // DELETE without WHERE or WHERE 1=1

    // System operations
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\binit\s+[0-6]/i,
    /\bsystemctl\s+(stop|disable|mask)\s+/i,

    // Process killing (broad)
    /\bkill\s+-9\s+-1/i,  // Kill all processes
    /\bkillall\b/i,
    /\bpkill\s+-9/i,

    // Fork bombs and dangerous shell constructs
    /:\(\)\s*{\s*:\|:&\s*}\s*;/,  // Fork bomb
    /\bsudo\s+rm\b/i,
    /\bsudo\s+dd\b/i,

    // Environment manipulation
    /\bexport\s+(PATH|LD_PRELOAD|LD_LIBRARY_PATH)\s*=/i,
    /\bunset\s+(PATH|HOME|USER)/i,

    // Credential/secret access patterns
    /\bcat\s+.*\.(env|pem|key|crt|p12|jks)/i,
    /\bcat\s+.*\/\.(ssh|gnupg)\//i,
    /\bcat\s+.*\/etc\/(passwd|shadow|sudoers)/i
];

// Patterns that are safe for reading/inspection
const SAFE_PATTERNS: RegExp[] = [
    // File listing and inspection
    /^ls(\s|$)/i,
    /^dir(\s|$)/i,
    /^pwd(\s|$)/i,
    /^cat\s+[^|;&]+$/i,  // cat without pipes or command chaining (and not matching dangerous patterns)
    /^head(\s|$)/i,
    /^tail(\s|$)/i,
    /^less(\s|$)/i,
    /^more(\s|$)/i,
    /^file(\s|$)/i,
    /^stat(\s|$)/i,
    /^wc(\s|$)/i,

    // Search tools
    /^grep(\s|$)/i,
    /^rg(\s|$)/i,
    /^find\s+[^-].*-name/i,  // find with -name (search, not exec)
    /^which(\s|$)/i,
    /^whereis(\s|$)/i,

    // Git read operations
    /^git\s+(status|log|diff|branch|show|remote|tag|describe|rev-parse)(\s|$)/i,

    // Version checks
    /^(node|npm|npx|python|python3|pip|pip3|ruby|go|cargo|rustc)\s+(--version|-v|-V)(\s|$)/i,
    /^npm\s+(list|ls|outdated|view|info)(\s|$)/i,
    /^pip\s+(list|show|freeze)(\s|$)/i,

    // Environment inspection
    /^echo(\s|$)/i,
    /^env(\s|$)/i,
    /^printenv(\s|$)/i,
    /^whoami(\s|$)/i,
    /^hostname(\s|$)/i,
    /^date(\s|$)/i,
    /^uptime(\s|$)/i,

    // System info (read-only)
    /^df(\s|$)/i,
    /^du(\s|$)/i,
    /^free(\s|$)/i,
    /^ps(\s|$)/i,
    /^uname(\s|$)/i,

    // Development tools (read operations)
    /^npm\s+run\s+(test|lint|check|build|compile|start|dev)(\s|$)/i,
    /^npx\s+tsc(\s|$)/i,
    /^npx\s+eslint(\s|$)/i,
    /^npx\s+prettier\s+--check/i,
    /^npm\s+test(\s|$)/i,
    /^npm\s+ci(\s|$)/i,
    /^npm\s+install(\s|$)/i,

    // Make/build
    /^make(\s|$)/i,
    /^cmake(\s|$)/i,
    /^cargo\s+(build|test|check|clippy)(\s|$)/i,
    /^go\s+(build|test|vet|fmt)(\s|$)/i,

    // Directory navigation (if needed)
    /^cd(\s|$)/i,
    /^mkdir(\s|$)/i,
    /^touch(\s|$)/i
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
        // Normalize the command (trim and collapse whitespace)
        const normalizedCommand = command.trim().replace(/\s+/g, ' ');

        // Check for dangerous patterns FIRST (highest priority)
        for (const pattern of DANGEROUS_PATTERNS) {
            if (pattern.test(normalizedCommand)) {
                return 'high';
            }
        }

        // Check for command chaining that might hide dangerous commands
        if (/[;&|]/.test(normalizedCommand)) {
            // Split by common command separators and check each part
            const parts = normalizedCommand.split(/[;&|]+/).map(p => p.trim());
            for (const part of parts) {
                for (const pattern of DANGEROUS_PATTERNS) {
                    if (pattern.test(part)) {
                        return 'high';
                    }
                }
            }
            // Command chaining defaults to medium even if not dangerous
            return 'medium';
        }

        // Check for safe patterns
        for (const pattern of SAFE_PATTERNS) {
            if (pattern.test(normalizedCommand)) {
                return 'low';
            }
        }

        // Default to medium for unknown commands
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
