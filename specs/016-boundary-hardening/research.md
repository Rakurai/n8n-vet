# Research: 016-boundary-hardening

**Date**: 2026-04-20  
**Spec**: [spec.md](./spec.md)

## R1: MCP Bootstrap Policy Choice

**Decision**: Explicit degraded mode with surfaced capability state.

**Rationale**: `serve.ts` is a stdio-based MCP server entry point invoked by the Claude Code plugin system. Failing startup would prevent the agent from using _any_ n8n-proctor tools (including `validate`, `trust_status`, `explain` — all static-only tools). The existing design already supports static-only mode as a first-class capability level. The problem is not that degraded mode exists — it's that it's silent and implicit.

The fix is:
1. `connectToN8n()` stops silently catching errors. It throws a typed `ExecutionInfrastructureError` with reason `'unreachable'` on connection failure.
2. Top-level bootstrap catches the error and logs a diagnostic message to stderr (permitted — this is a CLI/MCP entry point, not library code).
3. `callTool` remains `undefined` when the connection fails, and `createServer()` already receives `callTool?: McpToolCaller` as optional.
4. The `detectCapabilities` dep already returns `'static-only'` when no `callTool` is provided. Agents can discover this via the `explain` tool (which reports `capabilities.mcpTools: false`) before attempting `test`.

**Alternatives considered**:
- **Fail-fast (abort startup)**: Would block agents from all tools including pure-static ones. Unacceptable for a plugin that may be configured once and left running.
- **Log-only (current behavior)**: Silent. Agent discovers the problem only on first `test` call. This is what we're fixing.

## R2: Error Sanitization Strategy

**Decision**: Structured extraction — replace raw upstream text with a normalized summary preserving error type and actionable first-line context.

**Rationale**: `connectToN8n()` currently throws `Error` with messages like `MCP tool '${toolName}' error: ${text}` where `text` is the raw upstream response (line 48 of `serve.ts`). This text can be arbitrarily long and contain n8n internals. `mapToMcpError()` in `errors.ts` passes `error.message` through to the envelope unchanged.

The sanitization approach:
1. In `connectToN8n()`, the `callTool` wrapper already constructs error messages with `MCP tool '${toolName}' error: ${text}`. Change this to truncate `text` to a maximum of 200 characters and strip control characters.
2. In `mapToMcpError()`, add a `sanitizeMessage()` helper that enforces a hard cap of 500 characters on all `message` fields in the returned `McpError`. This is the single enforcement point — all error paths flow through `mapToMcpError`.
3. The `sanitizeMessage` function: truncate to 500 chars, append `' [truncated]'` when truncation occurs. No regex stripping — just length bounding and control-character removal. This preserves the most context possible within bounds.

**Alternatives considered**:
- **Generic replacement**: Replace all upstream errors with a generic "Upstream execution failed" message. Too opaque — agents can't distinguish between authentication errors, timeout errors, and workflow errors.
- **Regex-based stripping**: Strip known n8n internal patterns (stack traces, file paths). Brittle — patterns change across n8n versions. Length bounding achieves the same privacy goal without pattern maintenance.
- **Per-error-type customization**: Different sanitization rules per error type. Over-engineering for the current problem. A uniform length bound is sufficient.

## R3: Test TypeScript Configuration

**Decision**: Dedicated `tsconfig.check.json` that extends the base config and adds `test/` to `include`.

**Rationale**: The production `tsconfig.json` has `rootDir: "src"` and `outDir: "dist"`. Adding `test/` to `include` would break the build output structure (tests would be compiled into `dist/`). A dedicated typecheck-only config avoids this. The existing `typecheck` script (`tsc --noEmit`) just needs to point to the new config: `tsc --noEmit -p tsconfig.check.json`.

The check config:
- Extends `tsconfig.json`
- Overrides `include` to `["src", "test"]`
- Sets `rootDir: "."` (needed since both `src/` and `test/` are under project root)
- Does NOT set `outDir` (irrelevant for `--noEmit`)
- Does not change any compiler strictness settings — tests should be equally strict

**Alternatives considered**:
- **Widen existing tsconfig**: Would change production build output (tests in dist/). Not acceptable.
- **Vitest typecheck only**: Vitest has `typecheck.enabled: true` but it only covers `.test-d.ts` files by current config. Could expand it, but vitest typecheck is slower than raw `tsc --noEmit` and adds complexity. The simpler path is a dedicated tsconfig.

## R4: Test Patterns for New Unit Tests

**Decision**: Follow existing patterns from `test/mcp/server.test.ts` and `test/cli/commands.test.ts`.

**Rationale**: The existing test files establish clear patterns:
- **Fixture builders** (`makeNode`, `makeGraph`, `emptyTrustState`, `proceedDecision`, `passSummary`) create minimal typed fixtures.
- **Mock deps** (`createMockDeps`) provides a full `OrchestratorDeps` with `vi.fn()` mocks and override support.
- **Direct handler invocation** (MCP tests use `getToolHandler()` to bypass MCP transport and call handlers directly).
- **Envelope parsing** (`parseEnvelope<T>()` helper).

New test files should reuse these patterns. Notable fixture duplication between `server.test.ts` and `commands.test.ts` (identical `makeNode`, `makeGraph`, `emptyTrustState`, `proceedDecision`, `passSummary`, `createMockDeps`) should be extracted to a shared test helper if FR-011 allows it — the duplication exists today and the new tests will need the same builders.

### New test file inventory

| File | Tests | Mocking approach |
|------|-------|------------------|
| `test/execution/lock.test.ts` | acquire, release, contention, stale recovery, withExecutionLock | Uses `setLockExpiry()` and `resetLockState()` — already exported for test isolation. No dep mocking needed. |
| `test/cli/commands.test.ts` (extend) | `runTest()` success/failure envelopes | Same `createMockDeps` pattern. Mock `interpret` via subsystem deps. |
| `test/mcp/server.test.ts` (extend) | `test` tool handler plumbing | Same `getToolHandler` pattern. Verify `callTool` is passed through, `interpret` is called with `tool: 'test'`. |
| `test/mcp/serve.test.ts` (new) | Bootstrap success, failure (typed error + stderr), no-config | Mock `connectToN8n` or mock the MCP SDK transport. Bootstrap is top-level module code — may need to restructure as a callable function for testability. |

### Bootstrap testability concern

`serve.ts` currently runs bootstrap logic at module top level (lines 62–75). This cannot be tested without importing the module, which would attempt a real MCP connection. The bootstrap must be extracted into a testable function (e.g., `bootstrap()`) that accepts dependencies (env vars, `connectToN8n`). This is a small refactor within scope — it directly supports FR-009.
