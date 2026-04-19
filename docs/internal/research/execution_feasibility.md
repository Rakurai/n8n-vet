# Execution Feasibility Research

Research date: 2026-04-18

Source repos examined:
- `/Users/QTE2333/repos/n8n` (n8n platform)
- `/Users/QTE2333/repos/n8n-as-code` (n8nac CLI/MCP)

---

## 2.1 Bounded Execution Reality

### How `destinationNode` and Partial Execution Work

n8n has a mature partial execution system in `packages/core/src/execution-engine/partial-execution-utils/`. The pipeline is:

1. **Find trigger** (`find-trigger-for-partial-execution.ts`) -- walks parents of `destinationNode` to find a trigger. Prefers triggers with run data, then pinned webhook triggers, then any webhook trigger, then first trigger found.

2. **Find subgraph** (`find-subgraph.ts`) -- backward-traces from destination to trigger, keeping only nodes on paths between the two. Non-Main connections (AI utility nodes) are re-added to preserve AI workflow structure.

3. **Filter disabled nodes** (`filter-disabled-nodes.ts`) -- removes disabled nodes, reconnecting around them.

4. **Find start nodes** (`find-start-nodes.ts`) -- traverses trigger-to-destination finding the earliest "dirty" nodes. A node is dirty if it has an error, or lacks both run data and pin data. Nodes with run data or pin data are considered clean.

5. **Handle cycles** (`handle-cycles.ts`) -- if a start node is inside an SCC (strongly connected component), replaces it with the cycle entry point to prevent partial cycle execution.

6. **Clean run data** (`clean-run-data.ts`) -- removes run data for start nodes and all their children, plus any nodes outside the subgraph.

7. **Recreate execution stack** (`recreate-node-execution-stack.ts`) -- builds the `nodeExecutionStack`, `waitingExecution`, and `waitingExecutionSource` from the subgraph, start nodes, run data, and pin data.

This all happens in `WorkflowExecute.runPartialWorkflow2()` at `packages/core/src/execution-engine/workflow-execute.ts:198`.

### The `IDestinationNode` Interface

```typescript
// packages/workflow/src/interfaces.ts:2924
export interface IDestinationNode {
  nodeName: string;
  mode: 'inclusive' | 'exclusive';
  // inclusive: execute up to AND including the destination node
  // exclusive: execute up to but NOT including the destination node
}
```

The `mode` field is critical for n8n-vet: `inclusive` mode runs the destination itself, while `exclusive` runs only its parents. This maps directly to "validate this node" vs "validate this node's inputs."

### The `run()` Method (Non-Partial)

`WorkflowExecute.run()` also supports `destinationNode` but via a simpler mechanism: it computes a `runNodeFilter` containing all parent nodes (and the destination in inclusive mode) and passes that as allowlist. The execution engine skips any node not in the filter.

### Interaction with Triggers

Partial execution requires a trigger as the graph root. `findTriggerForPartialExecution` finds one by walking parents. If no trigger exists, it falls back to the closest parent with run data. If neither exists, it throws `'Connect a trigger to run this node'`.

For n8n-vet implications: workflows without triggers cannot use partial execution. Pin data on the trigger avoids needing a real trigger event.

### Interaction with Pin Data

Pin data is deeply integrated. The `isDirty` function in `find-start-nodes.ts` treats pinned nodes as clean:

```typescript
const hasPinnedData = pinData[node.name] !== undefined;
if (hasPinnedData) return false; // not dirty
```

This means: any node with pin data is treated as already-executed and won't be re-run. This is the mechanism that makes bounded execution cheap -- pin upstream nodes to skip re-executing them.

### Interaction with Branching

The subgraph finder follows all Main-type parent connections recursively. Branching (If/Switch with multiple outputs) is handled by following all paths backward from the destination. The start-node finder only follows outputs that have run data, which means untaken branches are naturally excluded.

### Interaction with Sub-Workflows

Sub-workflow execution is tracked via `INodeExecutionData.metadata.subExecution` which contains `{ executionId, workflowId }`. The execution engine treats sub-workflow nodes like any other node -- they run normally within the bounded graph. Sub-workflow internals are opaque from the parent's perspective.

### Interaction with Cycles (SplitInBatches)

Cycle handling is explicit. `handleCycles` uses Tarjan's SCC algorithm. If a start node falls inside a cycle, the entire cycle reruns from its entry point. The `SplitInBatches` node gets special treatment in `findStartNodes` -- if its "done" output has no data on the last run, the loop wasn't completed and becomes a start node.

### Interaction with Large Workflows

The subgraph extraction is the key scalability mechanism. A 200-node workflow with a destination node that depends on 8 nodes will produce an 8-node subgraph. The partial execution pipeline is O(subgraph size), not O(workflow size).

### Availability: REST API vs MCP

**REST API (`POST /workflows/:id/run`)**: Full support for `destinationNode`. The `ManualRunPayload` type has three variants:

```typescript
// packages/cli/src/workflows/workflow.request.ts
type PartialManualExecutionToDestinationPayload = {
  runData: IRunData;
  destinationNode: IDestinationNode;
  dirtyNodeNames: string[];
};

type FullManualExecutionFromUnknownTriggerPayload = {
  destinationNode: IDestinationNode;
};

type FullManualExecutionFromKnownTriggerPayload = {
  triggerToStartFrom: { name: string; data?: ITaskData };
  destinationNode?: IDestinationNode;
};
```

**MCP tools (`test_workflow`, `execute_workflow`)**: Neither supports `destinationNode`. Both run the full workflow from trigger to end. The `test_workflow` tool takes `pinData` and `triggerNodeName` only. The `execute_workflow` tool takes `inputs` only.

### Verdict

Bounded execution is **production-grade and well-engineered** inside n8n. The partial execution pipeline handles cycles, branching, disabled nodes, AI utility nodes, and tool-as-node patterns. However, it is **only accessible via the REST API**, not MCP. n8n-vet must use `POST /workflows/:id/run` with `destinationNode` to get bounded execution. The MCP tools are whole-workflow only.

---

## 2.2 Pin-Data Construction Cost

### How `prepare_test_pin_data` Works

The MCP tool at `packages/cli/src/modules/mcp/tools/prepare-workflow-pin-data.tool.ts` implements a three-tier schema discovery system:

**Tier 1 -- Execution history inference**: Fetches the last successful execution via `executionService.getLastSuccessfulExecution()`, extracts the first output item from each node's `runData[nodeName][0].data.main[0]`, and generates a JSON Schema from the data shape using `generateJsonSchemaFromData()`. No actual data values are returned -- only the structural schema.

**Tier 2 -- Node type definition**: Calls `discoverOutputSchemaForNode()` which looks up schemas from node type definitions, filtered by `resource` and `operation` parameters. This works for well-typed n8n nodes (Slack, Gmail, etc.) but not for generic nodes.

**Tier 3 -- No schema available**: Nodes that need pin data but have no discoverable schema go into `nodesWithoutSchema[]`. The caller must provide `[{"json": {}}]` as a minimal stub.

### Which Nodes Need Pin Data

The `needsPinData()` function at `packages/@n8n/workflow-sdk/src/pin-data-utils.ts` is simple:

```typescript
function needsPinData(node, isTriggerNode?): boolean {
  if (isTriggerNode?.(node)) return true;       // triggers
  if (node.credentials && Object.keys(node.credentials).length > 0) return true; // credentialed
  if (node.type === HTTP_REQUEST_NODE_TYPE) return true;  // HTTP Request
  return false;
}
```

Logic nodes (Set, If, Switch, Code, Merge) execute normally. This is the correct split for validation: pin external dependencies, let logic nodes prove themselves.

### Pin Data Format

Pin data is `Record<string, INodeExecutionData[]>` where each entry is an array of items, each with a `json` property:

```typescript
{
  "Slack": [{ "json": { "ok": true, "channel": "C123" } }],
  "Trigger": [{ "json": { "body": { "event": "push" } } }]
}
```

The `normalizePinData()` utility handles the common mistake of sending flat objects without the `json` wrapper.

### Cost for n8n-vet

Pin data construction maps directly to fixture generation:

1. **For previously-executed workflows**: Tier 1 schema inference from execution history is automatic and free. n8n-vet can call `prepare_test_pin_data` (MCP) or replicate its logic locally.

2. **For new workflows**: Need Tier 2 (node type schemas) or Tier 3 (empty stubs). Agent must generate realistic data. This is where "trusted boundary" pin data from prior validations becomes valuable.

3. **From n8nac artifacts**: If the n8n-as-code TypeScript file includes fixture data alongside the workflow definition, pin data can be constructed mechanically. The format is simple enough that `{ json: fixtureData }` wrapping is trivial.

### Verdict

Pin data construction is **low-cost for most cases**. The three-tier system means n8n-vet can usually generate pin data automatically from execution history. The format is simple (JSON wrapper around fixture data). The main challenge is Tier 3 (no schema) which requires either agent-generated data or user-provided fixtures.

---

## 2.3 Execution Backend Split

### Surface 1: `test_workflow` MCP Tool

**File**: `packages/cli/src/modules/mcp/tools/test-workflow.tool.ts`

**Capabilities**:
- Accepts `workflowId`, `pinData`, optional `triggerNodeName`
- Runs entire workflow from trigger with pin data
- Synchronous: waits up to 5 minutes for result
- Returns `{ executionId, status, error? }`
- Does NOT support `destinationNode` (no partial execution)
- Does NOT return per-node execution data

**Best for**: Whole-workflow smoke tests where you want a simple pass/fail answer.

**Limitations for n8n-vet**: Cannot bound execution to a slice. Cannot inspect per-node results. Cannot do partial execution with existing run data.

### Surface 2: `execute_workflow` MCP Tool

**File**: `packages/cli/src/modules/mcp/tools/execute-workflow.tool.ts`

**Capabilities**:
- Accepts `workflowId`, `executionMode` (manual/production), `inputs` (chat/form/webhook)
- Returns immediately with `{ executionId, status: 'started' }` -- does NOT wait for completion
- Maps inputs to trigger pin data automatically
- Supports `manual` mode (current version) and `production` mode (published version)
- Does NOT support `destinationNode`

**Best for**: Triggering production or manual runs asynchronously when you plan to poll for results.

### Surface 3: `get_execution` MCP Tool

**File**: `packages/cli/src/modules/mcp/tools/get-execution.tool.ts`

**Capabilities**:
- Accepts `workflowId`, `executionId`, optional `includeData`, `nodeNames`, `truncateData`
- Can return metadata only (lightweight status check) or full execution data
- Supports **node-name filtering**: `nodeNames: ["Node A", "Node B"]` returns data only for those nodes
- Supports **truncation**: `truncateData: 5` limits items per output to 5
- Returns full `IRunExecutionData` structure when `includeData: true`

**Best for**: Inspecting execution results with surgical precision. The `nodeNames` filter directly supports n8n-vet's "inspect only the slice" pattern.

### Surface 4: `POST /workflows/:id/run` REST API

**File**: `packages/cli/src/workflows/workflows.controller.ts:513`, delegates to `WorkflowExecutionService.executeManually()`

**Capabilities**:
- Full `ManualRunPayload` support including `destinationNode`, `runData`, `dirtyNodeNames`
- Triggers partial execution via `runPartialWorkflow2()` when runData + destinationNode provided
- Full execution from known/unknown triggers
- Returns `{ executionId }` -- results must be polled separately via execution API

**Best for**: Bounded execution to a destination node. This is the only surface that supports n8n's partial execution engine.

### Surface 5: `WorkflowExecute` Class (Package API)

**File**: `packages/core/src/execution-engine/workflow-execute.ts`

**Methods**:
- `run()`: Full execution with optional `destinationNode` filter
- `runPartialWorkflow2()`: Partial execution with full pipeline (subgraph, start nodes, cycles)
- `processRunExecutionData()`: Low-level execution of pre-built execution state

**Best for**: Direct programmatic use if n8n-vet were to import n8n-core. Requires setting up `IWorkflowExecuteAdditionalData` which includes credentials, hooks, and execution context -- not trivial to replicate outside n8n's DI container.

### Recommended Split for n8n-vet

| Operation | Backend | Rationale |
|-----------|---------|-----------|
| Bounded slice execution | REST API `POST /workflows/:id/run` | Only surface with `destinationNode` support |
| Whole-workflow smoke test | MCP `test_workflow` | Simpler, handles pin data, synchronous |
| Execution status polling | MCP `get_execution` with `includeData: false` | Lightweight metadata check |
| Per-node result inspection | MCP `get_execution` with `nodeNames` filter | Surgical data extraction |
| Async production run | MCP `execute_workflow` | Non-blocking trigger |

### Verdict

The execution backend split is clear. **REST API is required for bounded execution** (the core value prop of n8n-vet). **MCP tools are sufficient for whole-workflow runs and result inspection.** The `get_execution` tool's `nodeNames` filter is a strong fit for slice-focused diagnostics. n8n-vet should use REST for execution and MCP for inspection.

---

## 2.4 Execution Inspection Quality

### Data Structures Available

After execution, results live in `IRunExecutionData.resultData`:

```typescript
interface IRunExecutionData {
  resultData: {
    error?: ExecutionError;          // top-level execution error
    runData: IRunData;               // per-node results: { [nodeName]: ITaskData[] }
    pinData?: IPinData;              // pin data used during execution
    lastNodeExecuted?: string;       // last node that ran
  };
}

interface ITaskData {
  startTime: number;
  executionTime: number;             // ms
  executionStatus?: ExecutionStatus; // 'success' | 'error' | etc
  data?: ITaskDataConnections;       // { main: INodeExecutionData[][] }
  error?: ExecutionError;            // per-node error
  metadata?: ITaskMetadata;          // sub-execution info, AI agent data
}

interface INodeExecutionData {
  json: IDataObject;                 // the actual output data
  binary?: IBinaryKeyData;           // binary attachments
  error?: NodeApiError | NodeOperationError;  // item-level error
  pairedItem?: IPairedItemData;      // lineage tracking
  metadata?: { subExecution: RelatedExecution };
}
```

### Node-Level Filtering

The `get_execution` MCP tool implements `filterExecutionData()` which:

1. Filters `runData` to only requested `nodeNames`
2. Filters `pinData` to only requested `nodeNames`
3. Truncates output items per node to `truncateData` count

This is exactly what n8n-vet needs: "show me what happened at nodes X, Y, Z with at most 5 items each."

### Error State Extraction

Errors exist at three levels:

1. **Execution-level**: `resultData.error` -- fatal errors that stopped the whole execution
2. **Node-level**: `runData[nodeName][runIndex].error` -- errors in specific node runs
3. **Item-level**: `runData[nodeName][runIndex].data.main[outputIndex][itemIndex].error` -- per-item errors

The `executionStatus` field on `ITaskData` provides a quick check: if it's `'error'`, the node failed. The `error` field contains the full `ExecutionError` with message, stack trace, node name, and optional `description` (user-facing explanation).

### Path Reconstruction

Execution data supports path reconstruction through:

1. **`ISourceData`**: Each node's execution records `previousNode`, `previousNodeOutput`, and `previousNodeRun`, forming a linked chain of which node produced the input for which other node.

2. **`pairedItem`**: Item-level lineage tracking that maps output items back to their source input items. Present on `INodeExecutionData` as `IPairedItemData | IPairedItemData[] | number`.

3. **`runData` keys**: The set of node names present in `runData` tells you exactly which nodes executed. Combined with the workflow graph, you can reconstruct which branches were taken (present in runData) vs skipped (absent).

4. **`lastNodeExecuted`**: Quick pointer to where execution ended, whether by completion or error.

### Branch Detection from Execution Data

For If/Switch nodes with multiple outputs, the output index tells you which branch was taken:

```typescript
// If node has main[0] (true branch) and main[1] (false branch)
const ifNodeData = runData["If"][0].data;
const trueBranchItems = ifNodeData?.main?.[0];  // items sent to true branch
const falseBranchItems = ifNodeData?.main?.[1]; // items sent to false branch
```

An empty or null array at an output index means that branch was not taken. This gives full path visibility without needing to trace execution logs.

### Sub-Workflow Visibility

Sub-workflow execution is opaque at the parent level. You get:
- `metadata.subExecution: { executionId, workflowId }` on the output items
- The executionId can be used to fetch the sub-workflow's execution data separately

n8n-vet would need a separate `get_execution` call per sub-workflow to inspect sub-workflow internals.

### What Cannot Be Inspected

1. **Expression evaluation intermediate values**: Only final outputs are recorded, not how expressions were resolved.
2. **Retry attempts within a single node**: If a node retries internally (e.g., HTTP retry on 429), only the final result appears.
3. **Timing of individual items in batch processing**: `executionTime` is per-node-run, not per-item.
4. **Credential values used**: Redacted for security. Only `usedDynamicCredentials?: boolean` flag.

### Verdict

Execution inspection quality is **excellent for n8n-vet's needs**. The `get_execution` MCP tool with `nodeNames` filtering provides surgical access to exactly the nodes in a validation slice. Error states are available at execution, node, and item levels. Path reconstruction is possible from `runData` key presence and output-index analysis. The main gap is sub-workflow opacity -- inspecting sub-workflow internals requires additional API calls.

---

## Summary of Key Findings

| Question | Answer | Confidence |
|----------|--------|------------|
| Is bounded execution reliable? | Yes. Mature partial execution pipeline with cycle, branch, and AI node handling. | High |
| Is bounded execution available via MCP? | **No.** REST API only. MCP tools run whole workflows. | High |
| Is pin data construction cheap? | Yes for previously-executed workflows (schema inference). Moderate for new ones. | High |
| Which backend for bounded execution? | REST API `POST /workflows/:id/run` with `destinationNode` | High |
| Which backend for result inspection? | MCP `get_execution` with `nodeNames` filter | High |
| Can paths be reconstructed from execution data? | Yes, via runData key presence and output-index analysis | High |
| Can errors be filtered to specific nodes? | Yes, at execution/node/item levels | High |

### Critical Implication for n8n-vet Architecture

n8n-vet **must use the REST API** for its core bounded-execution feature. The MCP tools are useful for whole-workflow testing and result inspection, but they lack `destinationNode` support. This means n8n-vet needs:

1. An authenticated HTTP client for `POST /workflows/:id/run`
2. A way to construct `IWorkflowExecutionDataProcess`-shaped payloads with `destinationNode`, `runData`, and `pinData`
3. Either the MCP `get_execution` tool or the REST execution API for polling results

The n8nac client at `packages/cli/src/core/services/n8n-api-client.ts` already has an authenticated REST client pattern that could serve as reference, though it does not currently use `destinationNode` or partial execution.

---

## Errata

Added: 2026-04-19 (during phase 012-execution-backend-revision implementation)

1. **`POST /workflows/:id/run` is internal/editor-only.** This endpoint is not accessible via API key authentication. It is gated behind session-based auth used by the n8n editor UI. External clients authenticating with an API key cannot call it. The research above correctly identifies this as the only surface with `destinationNode` support, but incorrectly assumes it is available to external API consumers.

2. **The n8n REST public API is read-only for executions.** The public API (authenticated via API key) exposes only GET endpoints for executions — listing and retrieving execution data. There are no public POST endpoints for triggering workflow runs. Workflow execution by external clients must go through MCP tools (`test_workflow`, `execute_workflow`) or webhooks.

3. **Impact on n8n-vet architecture.** The "Critical Implication" section's recommendation to use `POST /workflows/:id/run` for bounded execution is not feasible with API key auth. Bounded execution via `destinationNode` is only available to the editor frontend. n8n-vet must rely on MCP tools for execution triggering, which means whole-workflow runs only (no partial execution). This was confirmed empirically during phase 012 implementation.
