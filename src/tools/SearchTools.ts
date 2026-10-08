import * as vscode from 'vscode';
import { Tool, ToolResult, ToolContext, RiskLevel } from './types';

export class SearchFilesTool implements Tool {
    name = 'search_files';
    description = 'Search for text content across files in the workspace';
    riskLevel: RiskLevel = 'low';

    inputSchema = {
        type: 'object' as const,
        properties: {
            query: {
                type: 'string',
                description: 'The text or regex pattern to search for'
            },
            include: {
                type: 'string',
                description: 'Glob pattern to include files (e.g., "**/*.ts")'
            },
            exclude: {
                type: 'string',
                description: 'Glob pattern to exclude files'
            },
            maxResults: {
                type: 'number',
                description: 'Maximum number of results (default: 50)'
            },
            isRegex: {
                type: 'boolean',
                description: 'Whether the query is a regex pattern (default: false)'
            }
        },
        required: ['query']
    };

    async execute(input: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
        const query = input.query as string;
        const include = input.include as string | undefined;
        const exclude = input.exclude as string | undefined;
        const maxResults = (input.maxResults as number) || 50;
        const isRegex = (input.isRegex as boolean) || false;

        try {
            // Use VS Code's built-in search
            const results: string[] = [];

            // Get files to search
            const files = await vscode.workspace.findFiles(
                include || '**/*',
                exclude || '**/node_modules/**',
                1000
            );

            const pattern = isRegex ? new RegExp(query, 'gi') : null;

            for (const file of files) {
                if (results.length >= maxResults) break;

                try {
                    const content = await vscode.workspace.fs.readFile(file);
                    const text = new TextDecoder().decode(content);
                    const lines = text.split('\n');

                    for (let i = 0; i < lines.length; i++) {
                        if (results.length >= maxResults) break;

                        const line = lines[i];
                        const matches = isRegex
                            ? pattern?.test(line)
                            : line.toLowerCase().includes(query.toLowerCase());

                        if (matches) {
                            const relativePath = vscode.workspace.asRelativePath(file);
                            results.push(`${relativePath}:${i + 1}: ${line.trim()}`);
                        }
                    }
                } catch {
                    // Skip files that can't be read
                }
            }

            return {
                success: true,
                output: results.length > 0
                    ? results.join('\n')
                    : 'No matches found'
            };
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
}
