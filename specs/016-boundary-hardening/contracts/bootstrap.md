# Contract: MCP Bootstrap Behavior

**Applies to**: `src/mcp/serve.ts`

## Current Contract

`serve.ts` is the MCP server entry point. When `N8N_HOST` and `N8N_MCP_TOKEN` are set, it attempts to connect to n8n's MCP server via `connectToN8n()`. On connection failure, it silently returns `undefined` and starts the server without execution capability. No diagnostic output is produced.

## Updated Contract

### Bootstrap Behavior

The bootstrap sequence has three distinct states:

| Condition | Behavior | Stderr output | `callTool` |
|-----------|----------|---------------|------------|
| `N8N_HOST` and `N8N_MCP_TOKEN` set, connection succeeds | Normal startup | None | `McpToolCaller` |
| `N8N_HOST` and `N8N_MCP_TOKEN` set, connection fails | Degraded startup | Single diagnostic line: `"[n8n-proctor] MCP connection failed: <reason>. Starting in static-only mode."` | `undefined` |
| `N8N_HOST` or `N8N_MCP_TOKEN` not set | Static-only startup | None | `undefined` |

### `connectToN8n(url, token): Promise<McpToolCaller>`

Updated signature — no longer returns `McpToolCaller | undefined`. On success, returns `McpToolCaller`. On failure, throws `ExecutionInfrastructureError` with reason `'unreachable'`.

The caller (bootstrap code) catches the error, logs the diagnostic, and proceeds with `callTool = undefined`.

### Testability

Bootstrap logic is extracted into a callable `bootstrap()` function (or equivalent) that accepts dependencies:
- Environment variables (or a config object)
- The `connectToN8n` function (injectable for mocking)

This allows `test/mcp/serve.test.ts` to test all three bootstrap states without requiring a real MCP connection.

### Invariants

- The server always starts (never aborts) — agents can always use static-only tools
- When MCP connection fails, stderr receives exactly one diagnostic line
- The capability state (`'mcp'` vs `'static-only'`) is determined at bootstrap, not lazily
- No silent degradation — degraded mode always produces a stderr diagnostic
