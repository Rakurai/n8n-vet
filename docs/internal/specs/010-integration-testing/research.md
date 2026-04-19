# Research: Integration Testing Suite

**Feature**: 010-integration-testing
**Date**: 2026-04-19

## R1: Library API Entry Points for Integration Tests

**Decision**: Integration tests call the n8n-vet library API directly via three entry points exported from `src/index.ts`:
- `interpret(request, deps)` — main validation pipeline, returns `DiagnosticSummary`
- `buildTrustStatusReport(workflowPath, deps)` — trust state inspection
- `buildGuardrailExplanation(workflowPath, target, layer, deps)` — dry-run guardrail evaluation

**Rationale**: Library API gives precise programmatic assertions. CLI output parsing would be fragile and less typesafe. The PRD explicitly specifies "Library API, not CLI" (Decision #4).

**Alternatives considered**: CLI invocation with `--json` output parsing (rejected: fragile, slower, less precise assertions).

## R2: Trust State Isolation Strategy

**Decision**: Use the `dataDir` parameter on `loadTrustState`, `persistTrustState`, `loadSnapshot`, and `saveSnapshot` to redirect all state to a temp directory per test run. Create a wrapper around `buildDeps()` that overrides these four functions with `dataDir`-bound versions.

**Rationale**: Both `trust/persistence.ts` and `orchestrator/snapshots.ts` accept an optional `dataDir` parameter. The resolution chain is: `dataDir` arg > `N8N_VET_DATA_DIR` env var > `.n8n-vet` default. Passing `dataDir` is the cleanest approach — no env var mutation needed, no global state pollution.

**Alternatives considered**:
- `N8N_VET_DATA_DIR` env var (rejected: global state, harder to clean up, risk of leaking between scenarios)
- Mocking persistence functions entirely (rejected: defeats the purpose of integration testing persistence)

## R3: MCP Server Spawning for Scenario 07

**Decision**: Spawn the MCP server as a child process via `node dist/mcp/serve.js` (stdio transport). Use `@modelcontextprotocol/sdk` Client class to connect and send tool calls.

**Rationale**: `src/mcp/serve.ts` creates a server with `StdioServerTransport`. The compiled output at `dist/mcp/serve.js` is the natural entry point. Using `node` directly (not `tsx`) avoids adding a dev dependency and matches production behavior. The MCP SDK Client provides typed tool call methods.

**Alternatives considered**: Importing server in-process (rejected: doesn't test the real stdio transport path that agents use).

## R4: Test Runner Design

**Decision**: Custom sequential runner using plain TypeScript functions executed via `tsx`. Each scenario is a function `(ctx: IntegrationContext) => Promise<void>` that throws on failure. The runner handles setup, fixture push, sequential scenario execution, and cleanup.

**Rationale**: Integration tests have live dependencies, real latency (execution polling), and side effects (workflows pushed to n8n). They don't belong in the vitest unit test runner. A simple sequential script is appropriate per the PRD (Decision #3). `tsx` is needed to run TypeScript directly without a build step for the test scripts themselves.

**Alternatives considered**: Vitest with `test.sequential` (rejected: wrong tool for live-dependency tests; timeout/teardown semantics are designed for unit tests, not multi-step integration scenarios).

## R5: Fixture Push and OCC Conflict Handling

**Decision**: Wrap n8nac push in a utility that catches OCC conflicts and retries once with `--mode keep-current`. If the retry also fails, throw (real error, not OCC). Verify push success by checking that the local file matches the remote.

**Rationale**: OCC conflicts occur on nearly every second push after any GUI interaction (documented in `testing_experiences.md`). The retry pattern is well-established. n8nac's `resolve` command with `--mode keep-current` resolves in favor of the local file, which is always correct for test fixtures.

**Alternatives considered**: Pre-emptive `n8nac fetch` before push (rejected: adds latency, doesn't eliminate all OCC cases).

## R6: tsx Dependency

**Decision**: Add `tsx` as a dev dependency. It is not currently in `package.json`.

**Rationale**: The integration tests are TypeScript files that need to run directly without compiling to `dist/`. `tsx` provides fast TypeScript execution with native ESM support. It's a dev-only dependency with minimal footprint.

**Alternatives considered**: Compiling test files with `tsc` (rejected: adds build step for test-only code, complicates iterative debugging).

## R7: Scenario Independence

**Decision**: Each scenario manages its own trust state lifecycle within the shared IntegrationContext. All fixtures are pushed once at the start of the test run (shared setup). Scenarios that need prior state (e.g., trust lifecycle, guardrail rerun) build that state within the scenario itself — validate first, then test the second operation.

**Rationale**: FR-009 requires independent scenarios. Trust state is isolated per run (fresh temp dir). Since each scenario can build its own trust by validating within the scenario, no cross-scenario dependencies exist. The shared fixture push is a performance optimization (push once, not per-scenario), but pushing the same fixture twice is idempotent.

**Alternatives considered**: Per-scenario fixture push (rejected: slower, no benefit since push is idempotent and fixtures are shared).
