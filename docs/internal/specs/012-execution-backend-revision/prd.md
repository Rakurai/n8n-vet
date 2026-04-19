# Phase 12 — Execution Backend Revision

## Problem

The execution subsystem was designed around two backends:

1. **REST API** `POST /workflows/:id/run` with `destinationNode` — for bounded slice execution
2. **MCP** `test_workflow` — for whole-workflow smoke tests

Research during the audit remediation phase (011) uncovered that `POST /workflows/:id/run` is **not a public API endpoint**. It exists in the n8n source code (`workflows.controller.ts:513`) but is an internal/editor-only route that requires session/cookie authentication. It is absent from the n8n OpenAPI spec (`docs/api/v1/openapi.yml`). Calling it with an API key returns 401.

This means:
- `executeBounded()` in `rest-client.ts` cannot work as written
- The `destinationNode` field on `ValidationRequest` has no viable backend
- The `--destination` CLI flag is non-functional
- The `rest-only` capability level is misleading (REST can read but not trigger execution)
- The capability detection logic over-privileges REST availability

The n8n execution surfaces actually available externally are:
- **n8n MCP `test_workflow`**: whole-workflow with pin data, synchronous, no `destinationNode`
- **n8n MCP `execute_workflow`**: whole-workflow with trigger inputs, async, no `destinationNode`
- **Webhook endpoints** (`/webhook-test/:path`): HTTP-triggered workflows only, no pin data
- **REST public API**: read-only (get/retry/stop executions), no triggering

## Solution

### v0.1.0 — MCP-only execution (this phase)

Remove REST-based execution triggering. Make MCP `test_workflow` the sole execution backend. Pin data placement at trusted boundaries controls effective scope — pinned nodes don't execute, so the "slice" is the unpinned region between pin boundaries and workflow end.

The concept of "bounded execution" is replaced by "scoped pin data" for v0.1.0. The orchestrator no longer needs separate bounded vs. smoke paths — there is one execution path with different pin data strategies.

### Deferred — Bounded execution investigation

True bounded execution (`destinationNode`) is desirable but not available from any public surface. Options for future investigation:

1. **n8n feature request**: Ask the n8n team to expose `destinationNode` support on MCP `test_workflow` or a new MCP tool. This is the cleanest path.
2. **Internal API with session auth**: Technically possible but fragile — requires obtaining a session cookie, which is undocumented and could change between n8n versions.
3. **n8n package API**: Import `@n8n/core` and call `WorkflowExecute.runPartialWorkflow2()` directly. Requires setting up n8n's DI container — heavy and brittle.

None of these are suitable for v0.1.0. Revisit when n8n exposes bounded execution on a public surface.

### v0.2.0 — Opportunistic trust harvesting

When MCP `test_workflow` executes the whole workflow, nodes outside the target slice may also execute successfully. This execution data is legitimate trust evidence. In v0.2.0:

- After execution, call `get_execution` for all non-pinned nodes (not just slice nodes)
- For nodes outside the target slice that show `executionStatus: 'success'`, record trust evidence
- This turns "can't do bounded execution" into an advantage: every execution produces more trust coverage than requested

This depends on solving bounded execution or confirming that whole-workflow execution is the permanent model.

## Code changes (v0.1.0)

### Remove

| File | What to remove |
|------|----------------|
| `src/execution/rest-client.ts` | `executeBounded()` function |
| `src/deps.ts` | `executeBounded` import and property |
| `src/index.ts` | `executeBounded` export |
| `src/orchestrator/types.ts` | `executeBounded` from `OrchestratorDeps`; `destinationNode` and `destinationMode` from `ValidationRequest` |
| `src/orchestrator/interpret.ts` | All `executeBounded` call sites and the `destinationNode` branching logic |
| `src/mcp/server.ts` | `destinationNode` from MCP input schema |
| `src/cli/index.ts` | `--destination` CLI flag |
| `test/execution/rest-client.test.ts` | `executeBounded` test cases |
| `test/orchestrator/interpret.test.ts` | `executeBounded` mocks, `destinationNode` test inputs |
| `test/mcp/server.test.ts` | `destinationNode` from test inputs, `executeBounded` mocks |

### Modify

| File | What to change |
|------|----------------|
| `src/execution/rest-client.ts` | Keep `resolveCredentials()`, `getExecutionStatus()`, `getExecutionData()` (public API works for reads). Remove execution-triggering Zod schemas (`TriggerExecutionResponseSchema`). |
| `src/execution/capabilities.ts` | `CapabilityLevel` becomes `'mcp'` or `'static-only'` (remove `'full'` and `'rest-only'`). MCP availability is the execution gate. REST availability means "can retrieve execution data" only. |
| `src/execution/types.ts` | Simplify `DetectedCapabilities` — `restAvailable` becomes `restReadable` (health/data retrieval). Remove or repurpose. |
| `src/orchestrator/interpret.ts` | Single execution path: if MCP available + execution requested → `executeSmoke` with pin data. No bounded/smoke branching. |
| `src/types/diagnostic.ts` | `AvailableCapabilities.restApi` → rename or repurpose. `ExecutionMeta.partial` field removed. |
| `src/surface.ts` | Update capability mapping. |
| `src/execution/lock.ts` | Update comment (no longer references REST execution). |
| `src/execution/poll.ts` | Simplify — MCP `test_workflow` is synchronous so polling is only needed for `execute_workflow` (async path, lower priority). |

### Keep unchanged

| File | Why |
|------|-----|
| `src/execution/mcp-client.ts` | Already correct — `executeSmoke`, `getExecution`, `preparePinData` are the primary execution surface |
| `src/execution/pin-data.ts` | Pin data construction is backend-agnostic |
| `src/execution/results.ts` | Execution data extraction is backend-agnostic |

## Doc changes (v0.1.0)

| File | What to change |
|------|----------------|
| `docs/reference/execution.md` | Rewrite §3 "Bounded execution via REST API" → note deferral, remove API details. Promote §4 "Whole-workflow execution via MCP" to §3 as primary execution mode. Add "Scoped pin data" concept replacing bounded execution. |
| `docs/STRATEGY.md` | Add note under principle 5 that bounded execution is deferred; pin data placement is the v0.1.0 mechanism for scoping execution work. |
| `docs/research/execution_feasibility.md` | Add errata section: `POST /workflows/:id/run` is internal API, not public. REST public API covers reads only. |
| `docs/RELEASE-PLAN.md` | Add "bounded execution" to "NOT in v0.1.0" section. Add "opportunistic trust harvesting" to deferred items. |
| `CLAUDE.md` | Update "Execution backend" — MCP is primary for triggering, REST is read-only. |

## Dependencies

- **Depends on 011 audit remediations**: FR-009 (MCP wiring) must be completed first — that wires `executeSmoke` end-to-end, which this phase then promotes to the only execution path.
- **Blocked by**: Nothing. Can proceed as soon as 011 finishes or in parallel on a separate branch if 011's FR-009 is done.
- **Blocks**: v0.2.0 opportunistic trust harvesting (needs the simplified single-backend model in place first).

## Success criteria

- `executeBounded` does not exist in the codebase
- `destinationNode` does not appear in any request type, MCP schema, or CLI flag
- All execution-backed validation uses MCP `test_workflow` exclusively
- Capability detection correctly reflects MCP-only execution model
- All tests pass with updated mocks (no REST execution mocks)
- `npm run typecheck` clean, `npm test` green, `npm run lint` clean
