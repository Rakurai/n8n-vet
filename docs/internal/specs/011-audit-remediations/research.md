# Research: Audit Findings Remediation

**Date**: 2026-04-19  
**Branch**: `011-audit-remediations`

## R1: n8n REST API Contract (S0-2)

### Decision
The REST API contract in `rest-client.ts` has confirmed mismatches that must be corrected.

### Findings

**POST /workflows/:id/run** (trigger execution):
- n8n source: `workflows.controller.ts:550` → `return result` where result is `{ executionId: string } | { waitingForWebhook: boolean }` from `workflow-execution.service.ts:109`
- n8n-vet assumes: `{ data: { executionId: string } }` (extra `data` wrapper in `TriggerExecutionResponseSchema`)
- **Status: MISMATCH CONFIRMED** — Endpoint is on `/rest/` internal API, not `/api/v1/`. Returns flat `{ executionId }` without `data` wrapper.
- **⚠️ REVISED (session 2026-04-19)**: This endpoint is **internal/editor-only** — it uses session/cookie authentication, NOT API key auth. It is not accessible via the public REST API. **Ruled out for n8n-vet use.** All execution triggering moves to MCP `test_workflow` tool exclusively. See spec.md FR-001a, FR-009 revisions.

**GET /executions/:id** (execution data retrieval):
- **VERIFIED LIVE** against `localhost:5678` (public API `/api/v1/executions/:id?includeData=true`)
- Response is **flat** — no outer `data` wrapper
- Top-level keys: `id`, `finished`, `mode`, `status`, `startedAt`, `stoppedAt`, `data`, `workflowData`, `workflowId`, `createdAt`, `deletedAt`, `waitTill`, etc.
- `data` field contains: `{ resultData, executionData, startData, resumeToken, version }`
- `resultData` contains: `{ runData, lastNodeExecuted, pinData }`
- Node run entries: `{ data, executionIndex, executionStatus, executionTime, hints, source, startTime }`
- n8n-vet assumes: `{ data: { id, finished, ..., data: { resultData: { runData } } } }` (extra outer `data` wrapper)
- **Status: MISMATCH CONFIRMED** — Remove the outer `data` wrapper from both `ExecutionStatusResponseSchema` and `ExecutionDataResponseSchema`.

**Request body for executeBounded**:
- Sends `{ destinationNode: { nodeName, mode }, pinData }` at top level
- n8n source confirms `IDestinationNode` accepts `{ nodeName, mode }` and `pinData` is a sibling
- **Status: CORRECT** — No mismatch.
- **⚠️ DEFERRED (session 2026-04-19)**: `executeBounded()` relies on `POST /workflows/:id/run` (internal API). Since that endpoint is ruled out, `executeBounded()`, `destinationNode`, and REST-based execution triggering are all **deferred to phase-12**. The function and its schemas remain in the codebase but are not wired as active execution paths. MCP `test_workflow` with pin data placement is the sole execution path for v0.1.0.

### Action Required
Remove `data` wrapper from `ExecutionStatusResponseSchema` and `ExecutionDataResponseSchema` (GET endpoints — public API, still used for read-only data retrieval). `TriggerExecutionResponseSchema` fix is **deferred** — the endpoint it maps to is internal-only and not used for execution triggering.

---

## R2: n8n MCP Tool Interface (FR-009)

### Decision
Wire MCP smoke test path. One schema mismatch found in `get_execution` response.

### Findings

**test_workflow** (`packages/cli/src/modules/mcp/tools/test-workflow.tool.ts`):
- Input: `{ workflowId: string, pinData: Record<string, Array<Record<string, unknown>>>, triggerNodeName?: string }`
- Output: `{ executionId: string | null, status: 'success' | 'error' | 'running' | ... , error?: string }`
- n8n-vet's `TestWorkflowResponseSchema` and `executeSmoke()` parameters: **MATCH**

**get_execution** (`packages/cli/src/modules/mcp/tools/get-execution.tool.ts`):
- Input: `{ workflowId, executionId, includeData?, nodeNames?, truncateData? }` — **MATCH**
- Output: `{ execution: { id, workflowId, mode, status, ... } | null, data?: IRunExecutionData, error?: string }`
- n8n-vet's `GetExecutionResponseSchema` nests `data` inside `execution` object — **MISMATCH**
- Actual: `execution` and `data` are **top-level siblings** (lines 141-144 of get-execution.tool.ts)
- Impact: `parsed.execution.data` is always undefined → `includeData: true` silently returns no data

**prepare_test_pin_data** (`packages/cli/src/modules/mcp/tools/prepare-workflow-pin-data.tool.ts`):
- Input: `{ workflowId: string }` — **MATCH**
- Output: `{ nodeSchemasToGenerate, nodesWithoutSchema, nodesSkipped, coverage }` — **MATCH**

### Alternatives Considered
N/A — tool signatures are fixed by n8n.

---

## R3: @n8n-as-code/transformer Dependency (FR-014)

### Decision
Replace `file:` protocol with npm registry reference.

### Rationale
- Package is confirmed published on npm: `@n8n-as-code/transformer@1.2.0`
- Has `publishConfig: { access: "public" }` and clean semver tags
- Git remote: `https://github.com/EtienneLescot/n8n-as-code.git`

### Change
```json
// Before
"@n8n-as-code/transformer": "file:../n8n-as-code/packages/transformer"

// After
"@n8n-as-code/transformer": "^1.1.0"
```

Also update `@n8n-as-code/skills` in `optionalDependencies` with the same pattern if published.

### Alternatives Considered
- Git URL with `#path:` fragment — fragile for monorepo, requires build tooling present
- Workspace protocol — n8n-check is not a monorepo, doesn't apply

---

## R4: Execution Backend Architecture Revision

### Decision
MCP `test_workflow` is the **sole execution triggering path** for v0.1.0. REST public API is retained only for read-only operations (execution data retrieval via `GET /executions/:id`, health probing).

### Rationale
- `POST /workflows/:id/run` is an internal/editor-only endpoint on the `/rest/` prefix, requiring session/cookie auth — not accessible via API key
- n8nac provides webhook execution (`POST /webhook-test/:path`) but only for HTTP-triggered workflows and doesn't support pin data — not suitable for general execution
- MCP `test_workflow` supports pin data natively, enabling scope control by pinning trusted boundaries (pinned nodes don't re-execute, so the "slice" is the unpinned region)
- True bounded execution (`destinationNode` parameter) requires the internal API — deferred to phase-12 for future investigation (possible n8n feature request or internal API usage)

### Architectural Impact
1. **`executeBounded()`** — function and schemas remain in codebase. 011 wires MCP as the sole active execution path; **phase-12** (`docs/prd/phase-12-execution-backend-revision.md`) owns stripping the dead code.
2. **`destinationNode` request field** — remains in `ValidationRequest` type. Orchestrator does not dispatch to REST execution when set. Phase-12 removes the field.
3. **`findFurthestDownstream()`** — only used by the REST fallback path. Phase-12 removes it.
4. **Capability detection** — MCP tool availability is the primary gate for execution. REST reachability is checked only for data retrieval (execution results via public API).
5. **Pin data as scope control** — pin data at trusted boundaries achieves equivalent scope control to `destinationNode`. Pinned nodes produce their pin data output without executing, so only unpinned nodes in the target slice actually run.

### Alternatives Considered
- Use internal API with session auth harvested from n8n editor — fragile, undocumented, breaks across n8n versions
- Use n8nac webhook triggering — only works for HTTP-triggered workflows, no pin data support
- Harvest trust evidence from nodes outside target slice — deferred to v0.2.0
