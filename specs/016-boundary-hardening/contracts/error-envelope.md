# Contract: Error Envelope Sanitization

**Applies to**: `mapToMcpError()` in `src/errors.ts`, `callTool` wrapper in `src/mcp/serve.ts`

## Current Contract

`mapToMcpError(error: unknown): McpError` maps domain errors to typed envelopes. The `message` field contains the raw `error.message` string with no transformation.

## Updated Contract

### `mapToMcpError(error: unknown): McpError`

All returned `McpError.message` values are sanitized before return:

1. Control characters (codepoints < 0x20) are stripped, except `\n` (0x0A) and `\t` (0x09).
2. If the resulting string exceeds 500 characters, it is truncated to 500 characters and ` [truncated]` is appended.
3. The error `type` mapping is unchanged — same `instanceof` chain, same type assignments.

### `callTool` wrapper in `connectToN8n()`

The error path in the `callTool` closure (line 48 of `serve.ts`) currently constructs:
```
`MCP tool '${toolName}' error: ${text}`
```
where `text` is the raw upstream response.

Updated behavior:
- `text` is truncated to 200 characters before inclusion in the error message.
- If truncation occurs, ` [truncated]` is appended to `text`.
- The error is still thrown as `Error` — `mapToMcpError` classifies it as `internal_error`.

### Invariants

- `McpError.message.length <= 512` for any error path
- No `McpError.message` contains verbatim upstream MCP response text exceeding 200 characters
- Error `type` classification is unchanged for all existing domain error classes
- All existing `mapToMcpError` unit tests continue to pass
