import * as vscode from 'vscode';
import * as path from 'path';
import { RiskLevel, ToolCall } from '../tools/types';

export interface PermissionDecision {
    allowed: boolean;
    reason?: string;
    requiresConfirmation: boolean;
}

export interface PermissionPolicy {
    name: string;
    description: string;
    evaluate(call: ToolCall, riskLevel: RiskLevel, autoMode: boolean): PermissionDecision;
}

// High-risk patterns that should always require confirmation
const ALWAYS_CONFIRM_PATTERNS = [
    // Destructive file operations
    /^delete_file$/,
    // Dangerous command patterns (defense in depth, also checked in TerminalTools)
    /\brm\s+(-[a-zA-Z]*r|--recursive)/i,
    /\bgit\s+push\s+(-[a-zA-Z]*f|--force)/i,
    /\bgit\s+reset\s+--hard/i,
    /\bgit\s+clean\s+-[a-zA-Z]*f/i,
    /\bdrop\s+(database|table)/i,
    /\btruncate\s+table/i,
    /\bformat\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i
];

// Patterns that are safe even without auto mode
const ALWAYS_ALLOW_PATTERNS = [
    /^read_file$/,
    /^list_files$/,
    /^search_files$/,
    /^git_status$/
];

/**
 * Check if a path is within the workspace (defense in depth).
 * Primary validation is in FileTools, this is a secondary check.
 */
function isPathWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
    if (!filePath || !workspaceRoot) return true;

    const normalizedRoot = path.resolve(workspaceRoot);
    let fullPath: string;

    if (path.isAbsolute(filePath)) {
        fullPath = path.resolve(filePath);
    } else {
        fullPath = path.resolve(normalizedRoot, filePath);
    }

    const relativePath = path.relative(normalizedRoot, fullPath);
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

export class PermissionEngine {
    private policies: PermissionPolicy[] = [];

    constructor() {
        this.registerDefaultPolicies();
    }

    private registerDefaultPolicies(): void {
        // Risk-based policy
        this.policies.push({
            name: 'risk-based',
            description: 'Evaluate based on tool risk level',
            evaluate: (call, riskLevel, autoMode) => {
                // Check if tool is in always-allow list
                for (const pattern of ALWAYS_ALLOW_PATTERNS) {
                    if (pattern.test(call.name)) {
                        return { allowed: true, requiresConfirmation: false };
                    }
                }

                // Check if tool or command matches always-confirm patterns
                const commandStr = call.input.command as string | undefined;
                for (const pattern of ALWAYS_CONFIRM_PATTERNS) {
                    if (pattern.test(call.name) || (commandStr && pattern.test(commandStr))) {
                        return {
                            allowed: true,
                            requiresConfirmation: true,
                            reason: 'High-risk operation requires confirmation'
                        };
                    }
                }

                // High risk always needs confirmation
                if (riskLevel === 'high') {
                    return {
                        allowed: true,
                        requiresConfirmation: true,
                        reason: 'High-risk operation'
                    };
                }

                // In auto mode, allow low and medium without confirmation
                if (autoMode) {
                    return { allowed: true, requiresConfirmation: false };
                }

                // Without auto mode, medium needs confirmation
                if (riskLevel === 'medium') {
                    return {
                        allowed: true,
                        requiresConfirmation: true,
                        reason: 'Modification operation'
                    };
                }

                // Low risk is allowed
                return { allowed: true, requiresConfirmation: false };
            }
        });

        // Workspace boundary policy (defense in depth)
        this.policies.push({
            name: 'workspace-boundary',
            description: 'Prevent operations outside workspace',
            evaluate: (call, _riskLevel, _autoMode) => {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    return { allowed: true, requiresConfirmation: false };
                }

                const filePath = call.input.path as string | undefined;
                if (!filePath) {
                    return { allowed: true, requiresConfirmation: false };
                }

                const workspaceRoot = workspaceFolders[0].uri.fsPath;

                // Check if path is within workspace bounds
                if (!isPathWithinWorkspace(filePath, workspaceRoot)) {
                    return {
                        allowed: false,
                        requiresConfirmation: true,
                        reason: `Path "${filePath}" is outside the workspace. Access denied.`
                    };
                }

                return { allowed: true, requiresConfirmation: false };
            }
        });
    }

    evaluate(call: ToolCall, riskLevel: RiskLevel, autoMode: boolean): PermissionDecision {
        let finalDecision: PermissionDecision = {
            allowed: true,
            requiresConfirmation: false
        };

        for (const policy of this.policies) {
            const decision = policy.evaluate(call, riskLevel, autoMode);

            // If any policy denies, deny
            if (!decision.allowed) {
                return decision;
            }

            // If any policy requires confirmation, require it
            if (decision.requiresConfirmation) {
                finalDecision = {
                    allowed: true,
                    requiresConfirmation: true,
                    reason: decision.reason || finalDecision.reason
                };
            }
        }

        return finalDecision;
    }

    addPolicy(policy: PermissionPolicy): void {
        this.policies.push(policy);
    }

    getPolicies(): PermissionPolicy[] {
        return [...this.policies];
    }
}
