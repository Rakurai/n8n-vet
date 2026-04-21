# Feature Specification: Boundary Hardening and Safety Nets

**Feature Branch**: `016-boundary-hardening`  
**Created**: 2026-04-20  
**Status**: Draft  
**Input**: User description: "Remediation PRD A — harden MCP bootstrap and error boundaries, add execution-path test coverage, bring tests under typechecking"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deterministic MCP Bootstrap Behavior (Priority: P1)

An agent connects to n8n-proctor's MCP server when the n8n MCP endpoint is configured but unreachable. Today, the server silently starts in static-only mode with no indication to the agent that execution capabilities are unavailable. The agent discovers this only when a `test` call fails unexpectedly, wasting a round-trip and producing confusing diagnostics.

After this change, the MCP server either fails startup with a clear error (if configured MCP is required) or starts in an explicit degraded mode where the capability state is surfaced to the agent before it attempts execution calls.

**Why this priority**: This is the most user-facing problem. Agents currently receive no signal that execution is unavailable until they hit a wall. Every other improvement is lower value if the bootstrap path silently misleads callers.

**Independent Test**: Can be tested by starting the MCP server with a configured but unreachable n8n endpoint and verifying that the startup outcome is deterministic and the capability state is explicit.

**Acceptance Scenarios**:

1. **Given** a configured MCP endpoint that is unreachable, **When** the MCP server starts, **Then** startup succeeds in explicit degraded mode with capability state reflecting `'static-only'` and a surfaced diagnostic (stderr) indicating the connection failure and degraded state.
2. **Given** a configured MCP endpoint that is reachable, **When** the MCP server starts, **Then** startup succeeds and capability state is `'mcp'`.
3. **Given** no MCP endpoint configured, **When** the MCP server starts, **Then** startup succeeds in static-only mode without producing any error or warning (no MCP expected, no degradation).

---

### User Story 2 - Sanitized Error Envelopes (Priority: P1)

An agent receives an error envelope from n8n-proctor's MCP or CLI surface after a failed execution. Today, the envelope may contain raw upstream MCP tool payload text — verbose, unstructured, potentially leaking n8n internals. The agent cannot reliably parse these messages or present them usefully.

After this change, all public error envelopes contain bounded, normalized error messages that preserve actionability without echoing raw upstream internals.

**Why this priority**: Error envelopes are the primary failure communication channel. Raw upstream text in these envelopes breaks the agent-oriented design principle and can confuse downstream tooling. Tied with P1 because hardened bootstrap without sanitized errors still leaks internals through the other path.

**Independent Test**: Can be tested by triggering MCP tool errors with known upstream payload content and verifying the public envelope message is bounded, normalized, and does not contain raw upstream text.

**Acceptance Scenarios**:

1. **Given** a remote MCP tool call that returns an error with verbose payload text, **When** the error is mapped to a public envelope, **Then** the envelope message is bounded in length, does not contain the raw upstream payload verbatim, and preserves enough information for the agent to understand what failed.
2. **Given** a remote MCP tool call that returns an error with sensitive internal details, **When** the error is mapped to a public envelope, **Then** the internal details are stripped or normalized.
3. **Given** a domain error (not from upstream MCP), **When** the error is mapped to a public envelope, **Then** the existing typed error mapping continues to work correctly (no regression).

---

### User Story 3 - Execution-Path Test Coverage (Priority: P2)

A developer modifies lock acquisition logic, the MCP `test` tool handler, the CLI `runTest()` command, or the MCP bootstrap sequence. Today, these changes have no direct test coverage — regressions are caught only by integration tests against a live n8n instance (slow, environment-dependent) or not at all.

After this change, each of these execution-facing entrypoints has direct unit tests that catch regressions in the standard `npm test` run.

**Why this priority**: These are the highest-consequence public edges in the codebase. Without direct tests, later structural refactors (PRDs B and C) are unsafe. This is a prerequisite for future work, but lower than P1 because it doesn't directly affect agent-facing behavior today.

**Independent Test**: Can be tested by running `npm test` and verifying new test files exercise lock lifecycle, CLI `runTest()` envelopes, MCP `test` tool handler plumbing, and bootstrap behavior.

**Acceptance Scenarios**:

1. **Given** the execution lock module, **When** direct tests run, **Then** lock acquisition, release, contention (second concurrent call throws), and stale-lock recovery are all verified.
2. **Given** the CLI `runTest()` function, **When** direct tests run, **Then** success envelopes and failure envelopes (error mapping) are verified.
3. **Given** the MCP `test` tool handler, **When** direct tests run, **Then** request plumbing to the orchestrator and result mapping back to MCP envelopes are verified.
4. **Given** the `serve.ts` bootstrap path, **When** direct tests run, **Then** successful connection, failed connection, and no-config startup behaviors are verified.

---

### User Story 4 - Tests Under TypeScript Typechecking (Priority: P2)

A developer writes a test that passes at runtime but contains a type error (wrong argument type, stale import after a refactor). Today, `npm run typecheck` does not catch this because the test directory is excluded from `tsconfig.json`. Type errors in tests are discovered only at runtime, often as confusing failures rather than clear compiler messages.

After this change, tests are included in the project's TypeScript typechecking workflow so type errors in test code are caught at compile time.

**Why this priority**: Tied with P2 because it provides the same safety-net value as Story 3 — catching errors earlier — but through the type system rather than test assertions. Together they form the prerequisite safety net for future structural work.

**Independent Test**: Can be tested by running `npm run typecheck` and verifying it covers test files (a type error introduced in a test file should cause the typecheck to fail).

**Acceptance Scenarios**:

1. **Given** a test file with a type error, **When** `npm run typecheck` runs, **Then** the type error is reported.
2. **Given** all test files are type-correct, **When** `npm run typecheck` runs, **Then** the check passes without errors.
3. **Given** the existing production typecheck, **When** a dedicated test tsconfig is added, **Then** it does not change the compilation output for production code.

---

### Edge Cases

- What happens when the MCP connection times out mid-startup (neither immediate success nor immediate failure)?
- What happens when the lock file is left behind by a crashed process (stale lock state)?
- What happens when `mapToMcpError` receives an error type it doesn't recognize (the catch-all `internal_error` path)?
- What happens when a test tsconfig includes files that import production code with different compiler settings?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: MCP server MUST implement exactly one explicit bootstrap policy for the case where remote MCP configuration exists but the connection cannot be established. Silent downgrade without surfaced state change is not acceptable.
- **FR-002**: MCP server MUST surface capability state (`'mcp'` or `'static-only'`) through its existing capability detection mechanism when starting in degraded mode, and the degraded state MUST be discoverable by callers before they attempt execution.
- **FR-003**: Error mapping MUST bound the size of messages included in public MCP and CLI error envelopes.
- **FR-004**: Error mapping MUST remove or normalize raw upstream MCP tool payload text before including it in public envelopes.
- **FR-005**: Error mapping MUST preserve enough information in sanitized messages for agents to determine what failed and what action to take.
- **FR-006**: Direct unit tests MUST cover lock acquisition, release, contention, and stale-state handling.
- **FR-007**: Direct unit tests MUST cover CLI `runTest()` success and failure envelopes.
- **FR-008**: Direct unit tests MUST cover MCP `test` tool handler request plumbing and result mapping.
- **FR-009**: Direct unit tests MUST cover MCP bootstrap behavior for successful connection, failed connection, and no-config startup.
- **FR-010**: Tests MUST be included in TypeScript typechecking via the standard `npm run typecheck` command.
- **FR-011**: Shared test fixture extraction is permitted only where it reduces duplication introduced by the new tests. Broad fixture refactoring is out of scope.

### Key Entities

- **Capability State**: The runtime state indicating whether the MCP server has execution capability (`'mcp'`) or is limited to static analysis (`'static-only'`). Must be deterministic at startup, not discovered lazily.
- **Error Envelope**: The structured error response sent to agents through MCP or CLI surfaces. Contains error type, message, and optional metadata. Must not contain raw upstream internals.
- **Execution Lock**: A session-scoped mechanism preventing concurrent executions. Has acquire, release, contention, and stale-recovery lifecycle states.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: MCP bootstrap behavior is deterministic — starting 10 times with an unreachable configured endpoint produces the same outcome 10 times (no race conditions or intermittent silent degradation).
- **SC-002**: No public error envelope returned by the MCP or CLI surface contains more than 512 characters of message text, inclusive of any truncation suffix (500 characters of content plus a ` [truncated]` marker when truncation occurs).
- **SC-003**: No public error envelope contains verbatim upstream MCP tool response text when the upstream response exceeds 200 characters.
- **SC-004**: All four execution-facing entrypoints (lock, CLI `runTest()`, MCP `test` handler, bootstrap) have direct unit tests covering both success and failure paths.
- **SC-005**: `npm run typecheck` covers both production code and test code — a deliberate type error in a test file causes the typecheck to fail.
- **SC-006**: All existing tests continue to pass (`npm test` green) after the changes.
- **SC-007**: All existing integration scenarios continue to pass (`npm run test:integration` green) after the changes.

## Assumptions

- The bootstrap policy is explicit degraded mode (not fail-fast). Failing startup would block agents from all tools including static-only ones; degraded mode with a surfaced diagnostic preserves static tool access while making the reduced capability state discoverable. See research.md R1 for the full decision rationale.
- Error message size bounds: 500 characters of content (512 total with ` [truncated]` suffix) for envelopes, 200-character threshold for upstream text truncation. These match the contract in contracts/error-envelope.md.
- The test tsconfig approach (widening existing config vs adding a dedicated config) will be decided during implementation planning. Both are acceptable per the PRD.
- The stale lock recovery timeout (currently 5 minutes in the implementation) is an existing design decision and does not need to be changed by this spec.
