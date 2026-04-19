# Phase 5 — Execution

## Goal

Implement execution-backed validation: construct pin data from available sources, push bounded or whole-workflow executions to a live n8n instance, poll for results, and extract per-node execution data for downstream diagnostics. This phase provides the `executeBounded`, `executeSmoke`, `getExecutionResult`, and `constructPinData` functions defined in the cross-subsystem contracts.

## Context Files

| File | Role |
|------|------|
| `docs/reference/INDEX.md` | Shared types: `NodeIdentity`, `WorkflowGraph`, `SliceDefinition`, `DiagnosticSummary`, `AvailableCapabilities`, `ValidationMeta` |
| `docs/CODING.md` | TypeScript rules — fail-fast, contract-driven, no fallbacks, no phantom implementations |
| `docs/CONCEPTS.md` | Shared vocabulary — workflow slice, workflow path, trusted boundary, mocked node, compile+test step |

## Scope

**In scope:**
- Pin data construction with 4-tier sourcing priority
- Bounded execution via REST API `POST /workflows/:id/run` with `destinationNode`
- Whole-workflow execution via MCP `test_workflow`
- Execution result polling with exponential backoff
- Per-node result extraction from `IRunExecutionData` into `ExecutionData`
- Capability detection (n8n reachable, REST authenticated, MCP available, workflow exists)
- Authentication resolution from n8nac config cascade
- Pin data source traceability in diagnostic output

**Out of scope:**
- How request interpretation decides bounded vs whole-workflow (Phase 7)
- How diagnostics classifies execution errors (Phase 6)
- How trust state is built or invalidated (Phase 3) — trusted boundaries are provided as input
- Auto-push of workflows to n8n — report stale/missing as precondition failure
- Sub-workflow internal inspection — opaque from parent execution perspective

## Inputs and Outputs

### `constructPinData`

**Input:**
- `graph: WorkflowGraph` — the parsed workflow graph
- `trustedBoundaries: NodeIdentity[]` — nodes at the edge of the trusted region
- `fixtures?: Record<string, PinDataItem[]>` — agent-provided fixture data keyed by node name
- `priorArtifacts?: Record<string, PinDataItem[]>` — cached pin data from prior validation runs

**Output:**
- `PinData` — record of node name to pin data items, covering all nodes that require mocking
- Pin data source map (which source provided data for each node) for diagnostic traceability

**Error:**
- Raises typed error identifying which specific nodes lack pin data. Does NOT substitute empty stubs.

### `executeBounded`

**Input:**
- `workflowId: string`
- `destinationNode: string` — the node to execute to
- `pinData: PinData`
- `mode: 'inclusive' | 'exclusive'` — inclusive executes through destination, exclusive executes up to but not destination

**Output:**
- `ExecutionResult` — executionId, status, error, partial flag

**Error:**
- Workflow not found or stale: precondition failure, advise push
- n8n unreachable or auth failure: infrastructure error
- Execution timeout: report as cancelled

### `executeSmoke`

**Input:**
- `workflowId: string`
- `pinData: PinData`
- `triggerNodeName?: string`

**Output:**
- `ExecutionResult` — executionId, status, error, partial flag (always `false` for smoke)

**Error:**
- Same error conditions as `executeBounded` minus destination-node-specific errors

### `getExecutionResult`

**Input:**
- `executionId: string`
- `nodeNames: NodeIdentity[]` — filter to specific nodes

**Output:**
- `ExecutionData` — per-node results map, lastNodeExecuted, top-level error, status

**Error:**
- Execution not found
- Redacted data: report with reduced detail, add hint about limited data

## Internal Types

```typescript
interface PinData {
  [nodeName: string]: PinDataItem[];
}

interface PinDataItem {
  json: Record<string, unknown>;
  binary?: Record<string, unknown>;
}

interface ExecutionResult {
  executionId: string;
  status: 'success' | 'error' | 'crashed' | 'canceled' | 'waiting';
  error: ExecutionErrorData | null;
  partial: boolean;
}

interface ExecutionErrorDataBase {
  type: string;
  message: string;
  description: string | null;
  node: string | null;
}

type ExecutionErrorData = ExecutionErrorDataBase & (
  | { contextKind: 'api'; context: { httpCode: string; errorCode?: string } }
  | { contextKind: 'cancellation'; context: { reason: 'manual' | 'timeout' | 'shutdown' } }
  | { contextKind: 'expression'; context: { expressionType?: string; parameter?: string } }
  | { contextKind: 'other'; context: { runIndex?: number; itemIndex?: number } }
);

interface ExecutionData {
  nodeResults: Map<NodeIdentity, NodeExecutionResult[]>;
  lastNodeExecuted: string | null;
  error: ExecutionErrorData | null;
  status: string;
}

interface NodeExecutionResult {
  executionIndex: number;
  status: 'success' | 'error';
  executionTimeMs: number;
  error: ExecutionErrorData | null;
  source: SourceInfo | null;
  hints: { message: string; severity: string }[];
}

interface SourceInfo {
  previousNode: string;
  previousNodeOutput: number;
  previousNodeRun: number;
}
```

## Upstream Interface Summary

- **`WorkflowGraph`**: nodes map (`Map<string, GraphNode>`) plus forward/backward adjacency (`Map<string, Edge[]>`). Used for determining which nodes need pin data based on node type and position in the graph.
- **Trusted boundaries**: nodes at the edge of the trusted region, provided as `NodeIdentity[]`. These are natural pin data placement points — their outputs are mocked so execution does not cross into already-validated territory.

## Behavior

### 1. Execution strategy selection

The caller provides one of two execution modes:

- **Bounded execution**: REST API `POST /workflows/:id/run` with `destinationNode`. Primary mode for slice validation. Executes only the subgraph between trigger/pin-data sources and the destination node. The `mode` field controls whether the destination itself executes (`inclusive`) or only its predecessors (`exclusive`).
- **Whole-workflow execution**: MCP `test_workflow` tool. For smoke tests or full-workflow validation. Runs the entire workflow from trigger with pin data applied. Synchronous with 5-minute timeout.

These are distinct operations, not a primary/fallback pair. The caller (request interpretation) selects the mode; execution does not silently switch between them.

### 2. Pin data construction

Pin data mocks the outputs of nodes that should not execute during a bounded or smoke validation run. Pin data construction follows a strict sourcing priority.

**Which nodes get pin data:**

1. Trigger nodes at the entry of the execution scope
2. Trusted boundary nodes (provided as input)
3. Nodes explicitly marked for mocking by the agent

**Sourcing priority (per node, first match wins):**

1. **Agent-provided fixtures** — explicit data supplied in the validation request
2. **Prior validation artifacts** — cached pin data from a previous successful validation of this node, where the node content hash has not changed
3. **Execution history inference** — MCP `prepare_test_pin_data` or equivalent 3-tier logic: (a) infer schema from last successful execution output, (b) discover schema from node type definition, (c) no schema available
4. **No pin data available** — raise a typed error identifying which specific nodes need pin data. Do NOT substitute empty stubs or `[{"json": {}}]` placeholders.

**Pin data format**: `Record<string, INodeExecutionData[]>` where each item has a `json` property. The `normalizePinData()` utility handles flat objects missing the `json` wrapper.

**Pin data source traceability**: the diagnostic summary MUST report which source (agent fixture, prior artifact, execution history) provided pin data for each mocked node. This is essential for understanding what assumptions a validation run relied on.

### 3. Bounded execution via REST API

`POST /workflows/:id/run` with the following payload shape for a fresh bounded execution (no prior `runData`):

```typescript
{
  destinationNode: { name: string; mode: 'inclusive' | 'exclusive' },
  pinData?: PinData
}
```

- `inclusive` mode: execute through the destination node (validate the node itself)
- `exclusive` mode: execute up to but not the destination node (validate the node's inputs)
- Default mode: `inclusive`

**Push coordination**: n8n-vet does NOT auto-push workflows to n8n. Pushing is the agent's responsibility via n8nac. If the workflow does not exist in n8n or is stale (local version differs from remote), report as a precondition failure with an actionable message advising the agent to push. Do not silently push.

**Response**: returns `{ executionId: string }`. Results must be retrieved separately via polling.

### 4. Whole-workflow execution via MCP

Uses the `test_workflow` MCP tool:

```typescript
{
  workflowId: string,
  pinData: Record<string, Array<{ json: Record<string, unknown> }>>,
  triggerNodeName?: string
}
```

- Synchronous execution with 5-minute timeout
- Returns `{ executionId, status, error? }`
- Does NOT support `destinationNode` — this is whole-workflow only
- Follow up with `get_execution` for per-node data

### 5. Execution result retrieval

**MCP `test_workflow`**: returns synchronously with `executionId` and top-level status. Follow up with `get_execution` (with `includeData: true` and `nodeNames` filter) for per-node execution data.

**REST API**: returns `executionId` immediately. Poll with `get_execution` until execution completes.

**Polling strategy**: two-phase polling with exponential backoff.

**Phase 1 — Status polling** (lightweight): poll `get_execution` with `includeData: false` to check execution status only. No node data is fetched during status checks. This keeps polling requests small and fast.

**Phase 2 — Data retrieval** (once): when status polling detects completion (any terminal status), make a single `get_execution` call with `includeData: true` and `nodeNames` filtering (only nodes in the validation slice) plus `truncateData` (default 5 items per node output). This keeps the data response proportional to the slice, not the workflow.

**Backoff constants** (named, not magic numbers):

| Constant | Value |
|----------|-------|
| `POLL_INITIAL_DELAY_MS` | 1000 |
| `POLL_BACKOFF_FACTOR` | 2 |
| `POLL_MAX_DELAY_MS` | 15000 |
| `POLL_TIMEOUT_MS` | 300000 (5 minutes) |

Sequence: 1s, 2s, 4s, 8s, 15s, 15s, ... until completion or timeout.

### 6. Per-node result extraction

Transform raw `IRunExecutionData` into the `ExecutionData` type:

1. For each node name present in `runData`, extract the `ITaskData[]` array
2. For each `ITaskData` entry, record:
   - `executionIndex` — position in the array
   - `status` — from `executionStatus` field (`'success'` or `'error'`)
   - `executionTimeMs` — from `executionTime` field
   - `error` — mapped to `ExecutionErrorData` with appropriate `contextKind` discriminant
   - `source` — from `ISourceData` (previousNode, previousNodeOutput, previousNodeRun)
   - `hints` — from node execution metadata if present
3. Do NOT extract raw output data (`INodeExecutionData[]`). Output data is large and not needed for diagnostics. The diagnostic layer works from error data, status, timing, and path information.
4. Record `lastNodeExecuted` from `resultData.lastNodeExecuted`
5. Record top-level `error` from `resultData.error`, mapped to `ExecutionErrorData`

### 7. Capability detection

Before execution, probe the environment to determine available capabilities:

| Check | Method | On failure |
|-------|--------|------------|
| n8n reachable | Health check endpoint | Raise typed error: infrastructure failure |
| REST authenticated | API key resolved from n8nac config, test with authenticated request | Raise typed error: infrastructure failure |
| MCP tools available | Tool discovery (check for `test_workflow`, `get_execution`) | MCP-specific operations unavailable. Report in `AvailableCapabilities`. REST operations unaffected. |
| Workflow exists in n8n | `GET /workflows/:id` | Raise typed error: precondition failure, advise push |

MCP and REST are separate capability surfaces. When MCP is unavailable, MCP-specific operations (whole-workflow smoke test, `prepare_test_pin_data` schema discovery) do not exist. REST-based bounded execution is unaffected.

Execution requires a reachable, authenticated n8n instance. If the instance is unavailable, the execution subsystem fails with `status: 'error'`. It does NOT silently degrade to static-only validation — that decision belongs to the caller (request interpretation).

### 8. Authentication

Credentials are resolved from the n8nac config cascade, in order:

1. Explicit config in the validation request
2. n8nac project config (`n8nac-config.json`)
3. n8nac global credential store
4. Environment variables: `N8N_HOST`, `N8N_API_KEY`

Missing credentials raise a typed configuration error with a message identifying which credential is missing and where it was expected.

## Error Conditions

| Condition | Behavior |
|-----------|----------|
| n8n unreachable | Raise typed error. Infrastructure failure. |
| API auth failure | Raise typed error. Infrastructure failure. |
| Workflow not found in n8n | Raise typed error. Precondition failure. Advise agent to push via n8nac. |
| Workflow stale (local differs from remote) | Raise typed error. Precondition failure. Advise agent to push via n8nac. |
| Execution timeout (>5 min) | Report as `ExecutionResult` with `status: 'canceled'` and error `contextKind: 'cancellation'`, `reason: 'timeout'`. This is a normal result, not a raised error — the execution completed (by timing out) and the result is usable by diagnostics. |
| Pin data construction failure | Raise typed error identifying which specific nodes lack pin data. No empty stubs. |
| Redacted execution data | Report with reduced detail using `contextKind`. Add diagnostic hint about limited data availability. |
| MCP unavailable | MCP-specific operations unavailable. Report in `AvailableCapabilities`. REST operations unaffected. |
| Missing credentials | Raise typed configuration error identifying the missing credential. |

## Acceptance Criteria

- Pin data construction follows the 4-tier sourcing priority (agent fixtures, prior artifacts, execution history, error on missing)
- No empty stubs — raises a typed error identifying nodes that lack pin data
- Bounded execution via REST API with `destinationNode` supports both `inclusive` and `exclusive` modes
- Whole-workflow execution via MCP `test_workflow` with pin data and optional trigger override
- Polling uses exponential backoff with named constants (`POLL_INITIAL_DELAY_MS`, `POLL_BACKOFF_FACTOR`, `POLL_MAX_DELAY_MS`, `POLL_TIMEOUT_MS`)
- Result extraction produces per-node `ExecutionData` without raw output data
- Capability detection probes n8n reachability, REST authentication, MCP tool availability, and workflow existence
- Stale or missing workflow reported as precondition failure with actionable message (no auto-push)
- Missing credentials raise a typed configuration error
- Pin data source traceability: diagnostic summary reports which source provided pin data for each mocked node
- Unit tests: pin data construction (all 4 tiers including error case), result extraction (success and error nodes), polling logic (mock HTTP)
- Integration tests gated behind `N8N_TEST_HOST` environment variable

## Decisions

1. **No auto-push.** Report stale/missing workflow as precondition failure. Pushing is the agent's responsibility via n8nac.
2. **Execution result caching.** Yes — cached alongside trust state so subsequent validations of unchanged nodes can skip re-execution.
3. **Concurrent execution.** Serialize requests. One execution at a time per n8n-vet session. No parallel execution support in this phase.
4. **REST API stability.** v1 API with no deprecation markers observed. Monitor for breaking changes in n8n releases.
5. **MCP and REST are independent surfaces.** Not primary/fallback. Each provides distinct operations. MCP unavailability does not affect REST-based bounded execution.
6. **No raw output extraction.** Per-node result extraction captures status, timing, errors, source lineage, and hints. Raw `INodeExecutionData[]` output is excluded — it is large and not needed for diagnostic synthesis.
