# Kurodo

A lightweight VS Code extension providing Claude Code-like agentic coding experience.

## Features

- **Chat Interface**: Streaming conversations with Claude models
- **TRUE Auto Mode**: Intelligent permission-based auto-approval for low-risk operations
- **File Operations**: Read, write, edit, list, delete files
- **Terminal Commands**: Execute shell commands with risk classification
- **Git Integration**: Status checks and commits
- **Session Persistence**: Save and resume conversations
- **Model Selection**: Support for Claude Sonnet 4, Opus 4, and Haiku 3.5
- **Effort Levels**: Configurable reasoning depth for supported models
- **MCP Support**: Connect to Model Context Protocol servers

## Requirements

- VS Code 1.85.0 or later
- Node.js 20.18.1 or later (for packaging VSIX)
- Anthropic API key

## Installation

### From Source (Development)

1. Clone the repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 in VS Code to launch Extension Development Host

### From VSIX

Requires Node.js 20+ to package:

```bash
npm run package
```

Then install the generated `.vsix` file in VS Code.

## Configuration

Set your API key when prompted, or configure in settings:

- `kurodo.defaultModel`: Default Claude model
- `kurodo.autoMode`: Enable auto mode for low-risk operations
- `kurodo.effortLevel`: Reasoning depth (low/medium/high)
- `kurodo.mcpServers`: MCP server configurations

### MCP Server Configuration Example

```json
{
  "kurodo.mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
    }
  }
}
```

## Auto Mode Risk Classification

- **Low Risk** (auto-approved): Read files, list files, search, git status
- **Medium Risk** (auto-approved in Auto Mode): Write files, edit files, commits
- **High Risk** (always requires approval): Delete files, destructive commands, force push

### Dangerous Command Detection

The following command patterns are blocked or require explicit approval:
- Recursive deletion (`rm -rf`, `rm -r`)
- Git destructive operations (`git push --force`, `git reset --hard`, `git clean -f`)
- Database destruction (`DROP TABLE`, `TRUNCATE`)
- Remote code execution (`curl | bash`, `wget | sh`)
- Disk operations (`dd if=`, writing to /dev/*)
- Privileged deletion (`sudo rm`)

## Security

Kurodo implements multiple layers of security:

1. **Path Traversal Protection**: All file operations validate paths to prevent access outside the workspace
2. **Command Risk Classification**: Shell commands are analyzed using regex patterns to detect dangerous operations
3. **Workspace Boundary Enforcement**: Defense-in-depth validation in both tools and permission engine
4. **Secure API Key Storage**: Uses VS Code's SecretStorage API

## Development

```bash
npm install
npm run compile
npm run watch  # for continuous compilation
```

## Testing

Run security tests:

```bash
npx ts-node src/test/security.test.ts
```

The test suite verifies:
- Path traversal protection
- Dangerous command pattern detection
- Safe command recognition

## Architecture

```
src/
├── extension.ts          # VS Code extension entry
├── agent/               # Agent runtime and state
├── provider/            # AI provider abstraction
├── tools/               # Tool implementations
├── permission/          # Permission engine
├── session/             # Session management
├── mcp/                 # MCP integration
├── ui/                  # Webview components
├── util/                # Utilities
└── test/                # Test suite
```

## License

MIT
