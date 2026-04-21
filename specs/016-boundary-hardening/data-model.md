# Data Model: 016-boundary-hardening

**Date**: 2026-04-20  
**Spec**: [spec.md](./spec.md)

This feature does not introduce new persistent data entities. It modifies the behavior of three existing runtime concepts. Documented here for implementation reference.

## Capability State

**Existing type**: `'mcp' | 'static-only'` (from `detectCapabilities` in deps)

**Current behavior**: Determined lazily when `detectCapabilities` is called during orchestration. Depends on whether `callTool` was provided to `createServer`.

**Changed behavior**: Capability state is now deterministic at bootstrap time. When `connectToN8n()` fails, the bootstrap code logs a diagnostic to stderr before proceeding. The `callTool` parameter to `createServer()` remains `undefined`, causing `detectCapabilities` to return `'static-only'` — same mechanism, but now the failure is visible.

**State transitions**:
```
bootstrap start
  ├── MCP configured + reachable   → callTool = McpToolCaller → capabilities = 'mcp'
  ├── MCP configured + unreachable → callTool = undefined (logged) → capabilities = 'static-only'
  └── MCP not configured           → callTool = undefined (no log) → capabilities = 'static-only'
```

No new fields, types, or persistence.

## Error Envelope

**Existing type**: `McpError` in `src/errors.ts`
```typescript
interface McpError {
  type: McpErrorType;
  message: string;
}
```

**Current behavior**: `mapToMcpError()` passes `error.message` through to `McpError.message` unchanged.

**Changed behavior**: `mapToMcpError()` applies `sanitizeMessage()` to all message values before returning:
- Strips control characters (characters < 0x20 except \n and \t)
- Truncates to 500 characters
- Appends ` [truncated]` when truncation occurs

Additionally, the `callTool` wrapper in `connectToN8n()` truncates upstream text to 200 characters before constructing the error message, so the raw upstream payload is bounded before it even reaches `mapToMcpError()`.

**Validation rules**:
- `message.length <= 512` (500 + length of ` [truncated]` suffix)
- No control characters except `\n` and `\t`

No new fields or types. The `McpError` interface is unchanged.

## Execution Lock

**Existing type**: Module-level `LockState` in `src/execution/lock.ts`
```typescript
interface LockState {
  inFlight: boolean;
  acquiredAt: number;
}
```

**Current behavior**: Fully implemented — acquire, release, contention, stale recovery, `withExecutionLock` wrapper. Exports `setLockExpiry()` and `resetLockState()` for test isolation.

**Changed behavior**: None. The lock module is unchanged by this feature. Tests are added for the existing implementation.

**Lifecycle states** (for test design reference):
```
idle (inFlight: false)
  → acquire → held (inFlight: true, acquiredAt: now)
    → release → idle
    → acquire again → throws ExecutionPreconditionError('execution-in-flight')
    → time > expiry → stale → acquire succeeds (auto-release + re-acquire)
```
