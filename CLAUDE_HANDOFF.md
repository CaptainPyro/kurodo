# Kurodo - Session Handoff

## Current State

**Version:** 0.1.0 (Release Candidate)
**Status:** Functional, tested, ready for use
**Last Commit:** 9c20bdb (Code quality improvements and ESLint configuration)

## Architecture

```
src/
├── extension.ts          # Entry point, initializes managers
├── agent/AgentRuntime.ts # Conversation loop, tool execution
├── provider/AnthropicProvider.ts  # Anthropic API, streaming
├── tools/                # FileTools, TerminalTools, SearchTools
├── permission/PermissionEngine.ts # Risk evaluation, Auto Mode
├── session/SessionManager.ts      # Persistence
├── mcp/                  # MCP server integration
├── ui/ChatViewProvider.ts         # Webview chat interface
└── util/secrets.ts       # API key storage
```

## Recently Completed

1. **Security Hardening** (c3c56ad)
   - Path traversal protection in all file tools
   - Regex-based dangerous command detection
   - Workspace boundary enforcement
   - Security test suite (28 tests, all passing)

2. **Documentation** (e97b42f)
   - README updated with security info

3. **Code Quality** (9c20bdb)
   - ESLint configuration added
   - Lint errors fixed

## Current Work

None. Session wrapped up with dossier creation.

## Known Issues

1. **VSIX Packaging** requires Node.js 20+ (undici dependency)
   - Development works on Node 18
   - This is documented, not a bug

2. **npm audit** shows 16 vulnerabilities
   - All in dev dependencies
   - Not affecting production code

## Important Decisions

- **TRUE Auto Mode**: Risk-based (low/medium auto, high requires approval)
- **Path Security**: Uses path.resolve() + path.relative(), not string matching
- **Command Detection**: Regex patterns with word boundaries
- **Defense-in-Depth**: Validation in both tools and permission engine

## Security / Permission Rules

**Risk Levels:**
- Low: read_file, list_files, search_files, git_status, safe commands
- Medium: write_file, edit_file, git_commit, unknown commands
- High: delete_file, rm -rf, git push --force, etc.

**Auto Mode Behavior:**
- ON: Low + Medium auto-approved, High requires confirmation
- OFF: Low auto-approved, Medium + High require confirmation

## Testing Status

```
npx ts-node src/test/security.test.ts
```

28 tests, all passing:
- Path validation (7 tests)
- Dangerous command detection (21 tests)

## Git State

```
Branch: main
Remote: origin/main (up to date)
Status: Clean
```

**Key Commits:**
- 9c20bdb - ESLint config, lint fixes
- e97b42f - README security docs
- c3c56ad - Security hardening
- a53e069 - Initial implementation

## Relevant Files

**To understand the project:**
- README.md
- KURODO_DOSSIER.txt (exhaustive)

**Core implementation:**
- src/agent/AgentRuntime.ts
- src/provider/AnthropicProvider.ts
- src/tools/ToolExecutor.ts
- src/permission/PermissionEngine.ts

**Security-critical:**
- src/tools/FileTools.ts (validatePath)
- src/tools/TerminalTools.ts (DANGEROUS_PATTERNS)
- src/permission/PermissionEngine.ts

## Next Steps

The extension is ready for:

1. **Testing** - Press F5 in VS Code
2. **Packaging** - `npm run package` (requires Node 20+)
3. **New features** - As directed by user

## Session Instructions

1. Read this file first
2. Check git status
3. If stale, read KURODO_DOSSIER.txt for full context
4. Do NOT start new work without user direction
5. Update dossiers after meaningful changes

---

## NEXT SESSION - START HERE

**Kurodo v0.1 is complete.**

The extension provides Claude Code-like agentic coding in VS Code with:
- Chat interface with streaming
- File/terminal/search tools
- TRUE Auto Mode (risk-based)
- MCP support
- Session persistence

**Verified:**
- TypeScript compiles cleanly
- Lint passes (warnings only)
- 28 security tests pass
- Git is clean and pushed

**What to check first:**
1. `git status` - Should be clean
2. `git log --oneline -5` - Latest should be 9c20bdb or dossier commit

**Highest priority remaining:**
- None for v0.1
- Future: Prompt caching, remote control, more tests

**Blockers:** None

**Most relevant files:** Listed above in "Relevant Files"

**Current baseline:** Commit 9c20bdb (or subsequent dossier commit)

---

*Last Updated: 2026-10-08*
