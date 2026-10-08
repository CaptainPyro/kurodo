import * as vscode from 'vscode';
import * as path from 'path';
import { Tool, ToolResult, ToolContext, RiskLevel } from './types';

export class ReadFileTool implements Tool {
    name = 'read_file';
    description = 'Read the contents of a file at the specified path';
    riskLevel: RiskLevel = 'low';

    inputSchema = {
        type: 'object' as const,
        properties: {
            path: {
                type: 'string',
                description: 'The path to the file to read (relative to workspace root)'
            }
        },
        required: ['path']
    };

    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const filePath = input.path as string;
        const fullPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(context.workspaceRoot, filePath);

        try {
            const uri = vscode.Uri.file(fullPath);
            const content = await vscode.workspace.fs.readFile(uri);
            const text = new TextDecoder().decode(content);

            return {
                success: true,
                output: text
            };
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
}

export class WriteFileTool implements Tool {
    name = 'write_file';
    description = 'Write content to a file, creating it if it does not exist';
    riskLevel: RiskLevel = 'medium';

    inputSchema = {
        type: 'object' as const,
        properties: {
            path: {
                type: 'string',
                description: 'The path to the file to write (relative to workspace root)'
            },
            content: {
                type: 'string',
                description: 'The content to write to the file'
            }
        },
        required: ['path', 'content']
    };

    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const filePath = input.path as string;
        const content = input.content as string;
        const fullPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(context.workspaceRoot, filePath);

        try {
            const uri = vscode.Uri.file(fullPath);
            const data = new TextEncoder().encode(content);
            await vscode.workspace.fs.writeFile(uri, data);

            return {
                success: true,
                output: `Successfully wrote ${data.length} bytes to ${filePath}`
            };
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
}

export class EditFileTool implements Tool {
    name = 'edit_file';
    description = 'Make targeted edits to a file by replacing specific text';
    riskLevel: RiskLevel = 'medium';

    inputSchema = {
        type: 'object' as const,
        properties: {
            path: {
                type: 'string',
                description: 'The path to the file to edit (relative to workspace root)'
            },
            old_text: {
                type: 'string',
                description: 'The exact text to find and replace'
            },
            new_text: {
                type: 'string',
                description: 'The text to replace it with'
            }
        },
        required: ['path', 'old_text', 'new_text']
    };

    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const filePath = input.path as string;
        const oldText = input.old_text as string;
        const newText = input.new_text as string;
        const fullPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(context.workspaceRoot, filePath);

        try {
            const uri = vscode.Uri.file(fullPath);
            const contentBytes = await vscode.workspace.fs.readFile(uri);
            const content = new TextDecoder().decode(contentBytes);

            if (!content.includes(oldText)) {
                return {
                    success: false,
                    output: '',
                    error: 'The specified text was not found in the file'
                };
            }

            const newContent = content.replace(oldText, newText);
            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(newContent));

            return {
                success: true,
                output: `Successfully edited ${filePath}`
            };
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Failed to edit file: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
}

export class ListFilesTool implements Tool {
    name = 'list_files';
    description = 'List files in the workspace matching a glob pattern';
    riskLevel: RiskLevel = 'low';

    inputSchema = {
        type: 'object' as const,
        properties: {
            pattern: {
                type: 'string',
                description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*")'
            },
            maxResults: {
                type: 'number',
                description: 'Maximum number of results to return (default: 100)'
            }
        },
        required: ['pattern']
    };

    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const pattern = input.pattern as string;
        const maxResults = (input.maxResults as number) || 100;

        try {
            const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', maxResults);
            const relativePaths = files.map(f => vscode.workspace.asRelativePath(f));

            return {
                success: true,
                output: relativePaths.length > 0
                    ? relativePaths.join('\n')
                    : 'No files found matching the pattern'
            };
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
}

export class DeleteFileTool implements Tool {
    name = 'delete_file';
    description = 'Delete a file from the workspace';
    riskLevel: RiskLevel = 'high';

    inputSchema = {
        type: 'object' as const,
        properties: {
            path: {
                type: 'string',
                description: 'The path to the file to delete (relative to workspace root)'
            }
        },
        required: ['path']
    };

    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
        const filePath = input.path as string;
        const fullPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(context.workspaceRoot, filePath);

        try {
            const uri = vscode.Uri.file(fullPath);
            await vscode.workspace.fs.delete(uri);

            return {
                success: true,
                output: `Successfully deleted ${filePath}`
            };
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
}
