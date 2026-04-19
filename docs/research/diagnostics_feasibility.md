# Diagnostics Feasibility Research

Status: **Research complete**
Updated: 2026-04-18

## Purpose

This document assesses three feasibility questions for n8n-vet's diagnostic output layer:

1. **Minimum useful summary shape** -- what is the smallest structured result that gives an agent enough info to act?
2. **Path observation fidelity** -- can we reconstruct which nodes executed and which branches were taken?
3. **Error extraction quality** -- can we reliably extract, classify, and present errors from execution data?

All findings are grounded in concrete code references from the n8n and n8n-as-code repositories.

---

## 1. Minimum Useful Summary Shape

### 1.1 What the agent needs

An agent consuming a validation result needs to answer three questions:
1. **Did it pass?** (status + which nodes succeeded/failed)
2. **If not, where did it fail?** (node name, position in the path)
3. **Why did it fail?** (error message, error class, actionable hint)

Everything else is optional context that improves quality but is not required for the agent to take a next action.

### 1.2 Essential fields from n8n execution data

Source: `n8n/packages/workflow/src/interfaces.ts`, `run-execution-data/run-execution-data.v1.ts`

**IRun** (line 2691 of interfaces.ts) -- the top-level execution envelope:

| Field | Type | Essential? | Why |
|---|---|---|---|
| `status` | `ExecutionStatus` | **Yes** | `'success' \| 'error' \| 'crashed' \| 'canceled' \| ...` -- the single most important field |
| `data.resultData.runData` | `IRunData` | **Yes** | Per-node results keyed by node name; the basis for path reconstruction |
| `data.resultData.error` | `ExecutionError` | **Yes** | Top-level execution error (if any) |
| `data.resultData.lastNodeExecuted` | `string` | **Yes** | Where execution stopped -- critical for locating failures |
| `startedAt` / `stoppedAt` | `Date` | Nice-to-have | Useful for timing diagnostics, not essential for agent action |
| `mode` | `WorkflowExecuteMode` | Nice-to-have | `'manual' \| 'trigger' \| ...` -- context only |
| `data.startData.destinationNode` | `IDestinationNode` | Nice-to-have | Tells us if this was a partial execution (`{ nodeName, mode: 'inclusive' \| 'exclusive' }`) |
| `data.startData.runNodeFilter` | `string[]` | Nice-to-have | Which nodes were in scope for execution |
| `data.resultData.pinData` | `IPinData` | Low | Only relevant when diagnosing pin-data-related issues |

**IRunData** (line 2727) -- the per-node result map:
```typescript
interface IRunData {
  // key = node name, value = array of task runs (one per execution of that node)
  [key: string]: ITaskData[];
}
```

**ITaskData** (line 2824) -- per-node execution result:

| Field | Type | Essential? | Why |
|---|---|---|---|
| `executionStatus` | `ExecutionStatus` | **Yes** | Per-node pass/fail |
| `error` | `ExecutionError` | **Yes** | Per-node error (may exist even when top-level error is absent) |
| `startTime` | `number` | Low | Timing only |
| `executionTime` | `number` | Low | Timing only |
| `executionIndex` | `number` | **Yes** | Execution order -- critical for path reconstruction |
| `source` | `Array<ISourceData \| null>` | **Yes** | Which node fed into this one; needed for path tracing |
| `data` | `ITaskDataConnections` | Low | Actual output data -- large, rarely needed in summary |
| `hints` | `NodeExecutionHint[]` | Nice-to-have | Runtime warnings from nodes (message + severity) |
| `metadata` | `ITaskMetadata` | Low | Sub-execution references, AI token usage, etc. |

**ISourceData** (line 2840):
```typescript
interface ISourceData {
  previousNode: string;
  previousNodeOutput?: number; // output index (default 0)
  previousNodeRun?: number;    // run index (default 0)
}
```

This is the key to reconstructing edges in the executed path.

### 1.3 What n8nac does today

Source: `n8n-as-code/packages/cli/src/core/types.ts`

n8nac's `ITestResult` is a webhook-level result (did the HTTP call succeed?) -- it does NOT inspect execution data at all. It classifies errors into three categories:

- `config-gap` -- missing credentials, LLM model, env vars (inform user, do not iterate)
- `runtime-state` -- webhook not armed, workflow not active (not a code bug)
- `wiring-error` -- bad expression, wrong field name (agent should fix)

This classification is valuable but is done heuristically from HTTP response codes and error message string matching. n8n-vet can do better by inspecting actual execution data via the API.

The `IExecutionDetails` type (from `n8nac/packages/cli/src/core/types.ts` line 183) shows what comes back from the execution API:
```typescript
interface IExecutionDetails extends IExecutionSummary {
  data?: Record<string, unknown>;       // <-- this is the full IRunExecutionData
  workflowData?: Record<string, unknown>;
  executedNode?: string;
  triggerNode?: string;
}
```

The `data` field is the raw `IRunExecutionData` and is available when `includeData: true` is passed to the API. This gives us everything we need.

### 1.4 Proposed minimum diagnostic summary schema

```typescript
/** Top-level diagnostic summary returned by n8n-vet after validation. */
interface DiagnosticSummary {
  /** Overall execution outcome. */
  status: 'pass' | 'fail' | 'error' | 'skipped';

  /** What was validated: slice name or path description. */
  target: string;

  /** Ordered list of nodes that actually executed. */
  executedPath: PathNode[];

  /** The node where execution stopped (if different from last in path). */
  failedAt: string | null;

  /** Extracted error information, if execution failed. */
  error: DiagnosticError | null;

  /** Per-node status for every node in the executed path. */
  nodeResults: NodeResult[];

  /** Hints/warnings emitted by nodes during execution. */
  hints: DiagnosticHint[];

  /** Timing (optional, included when available). */
  timing: {
    totalMs: number;
    startedAt: string;
    stoppedAt: string;
  } | null;

  /** Whether this was a partial execution (destinationNode was set). */
  partial: boolean;

  /** Metadata about how this summary was produced. */
  meta: {
    executionId: string | null;
    source: 'execution' | 'static-analysis' | 'hybrid';
  };
}

/** A node in the reconstructed execution path. */
interface PathNode {
  /** Node name as it appears in the workflow. */
  name: string;
  /** Execution order index (from ITaskData.executionIndex). */
  executionIndex: number;
  /** Which output of the previous node fed into this one. */
  sourceOutput: number | null;
}

/** Compact per-node result. */
interface NodeResult {
  name: string;
  status: 'success' | 'error' | 'skipped';
  /** Execution time in milliseconds. */
  executionTimeMs: number | null;
  /** Error on this specific node (if any). */
  error: DiagnosticError | null;
  /** Runtime hints emitted by this node. */
  hints: DiagnosticHint[];
}

/** Structured error extracted from n8n execution data. */
interface DiagnosticError {
  /** Error class name (e.g. 'NodeApiError', 'ExpressionError'). */
  type: string;
  /** Human-readable error message. */
  message: string;
  /** More detailed description (when available). */
  description: string | null;
  /** n8n-vet classification for agent decision-making. */
  classification: ErrorClassification;
  /** HTTP status code (for API errors). */
  httpCode: string | null;
  /** The node that produced this error. */
  nodeName: string | null;
  /** Context fields from the error (runIndex, itemIndex, parameter, etc.). */
  context: Record<string, unknown>;
}

/** How n8n-vet classifies errors for agent action routing. */
type ErrorClassification =
  /** Workflow wiring problem -- agent should fix and retry. */
  | 'wiring'
  /** Expression evaluation failure -- agent should fix the expression. */
  | 'expression'
  /** Missing/invalid credentials -- inform user, do not iterate. */
  | 'credentials'
  /** External service failure -- may be transient, retry or inform user. */
  | 'external-service'
  /** n8n platform/infrastructure issue -- not fixable by editing workflow. */
  | 'platform'
  /** Execution was cancelled (manual, timeout, shutdown). */
  | 'cancelled'
  /** Unknown/unclassifiable error. */
  | 'unknown';

/** A hint or warning emitted during node execution. */
interface DiagnosticHint {
  nodeName: string;
  message: string;
  severity: 'info' | 'warning' | 'danger';
}
```

**Size assessment**: For a typical 5-node path with one error, this schema produces roughly 40-60 lines of JSON. The `data` field from `ITaskDataConnections` (actual node output) is deliberately excluded -- it is large and almost never needed for the agent to decide its next action.

---

## 2. Path Observation Fidelity

### 2.1 Can executed nodes be reconstructed from IRunData?

**Yes.** `IRunData` is keyed by node name, so every node that executed has an entry. Each entry is an `ITaskData[]` array (one element per run of that node -- relevant for loops/retries).

Each `ITaskData` contains:
- `executionIndex` (line 2818) -- a monotonically increasing counter tracking execution order
- `source` (line 2819) -- an array of `ISourceData | null` indicating which node(s) fed data into this one

**Reconstruction algorithm**:
1. Collect all `(nodeName, taskData)` pairs from `runData`
2. Sort by `taskData[runIndex].executionIndex` (use run index 0 for single runs)
3. For each node, `source[0].previousNode` gives the inbound edge; `source[0].previousNodeOutput` gives which output index

This produces the full ordered execution path with edges.

### 2.2 Can branch decisions be inferred?

**Partially.** Branch decisions can be inferred from which nodes appear in `runData`:

- **If/Switch nodes**: When an If node routes to "true" branch, only the true-branch downstream nodes appear in `runData`. The false-branch nodes are absent. The routing decision is implicit in what executed.
- **`source[].previousNodeOutput`**: This tells us WHICH output of a multi-output node (like If or Switch) was used. Output index 0 typically means "true"/"first case"; output index 1 means "false"/"default". This is the most reliable branch indicator.

**Reference**: `ISourceData.previousNodeOutput` (line 2842):
```typescript
interface ISourceData {
  previousNode: string;
  previousNodeOutput?: number; // If undefined "0" gets used
}
```

### 2.3 Where path reporting becomes ambiguous

**Parallel branches**: When a workflow forks (e.g., a node has two downstream nodes that both execute), the execution order from `executionIndex` is reliable but the "path" is no longer linear -- it is a DAG. Both branches will appear in `runData` with distinct `executionIndex` values. n8n-vet must handle this by representing the path as a directed graph segment, not a simple list.

**Merge nodes**: When parallel branches converge at a Merge node, the Merge node's `source` array will contain multiple entries (one per input). The `previousNodeOutput` on each tells us which branch fed in. This is unambiguous.

**Loops / retries**: A node that executes multiple times has multiple entries in its `ITaskData[]` array. Each has its own `executionIndex` and `source`. The path reconstruction must handle this as multiple passes through the same node.

**Sub-workflows**: When execution triggers a sub-workflow, the parent node's `metadata.subExecution` contains a `RelatedExecution` with the sub-workflow's execution ID. The sub-workflow's own execution data must be fetched separately. Path reporting across sub-workflow boundaries requires an additional API call.

### 2.4 Assessment

| Scenario | Fidelity | Notes |
|---|---|---|
| Linear path | **High** | `executionIndex` + `source` gives perfect reconstruction |
| If/Switch branching | **High** | `previousNodeOutput` reliably indicates which branch |
| Parallel branches | **Medium** | Both branches visible; must model as DAG not list |
| Merge after parallel | **High** | Multi-source array is explicit |
| Loops / multi-run | **Medium** | Multiple `ITaskData` entries per node; manageable |
| Sub-workflows | **Low** | Requires separate execution fetch; cross-boundary path is fragmented |

For n8n-vet's primary use case (validating a bounded workflow slice), linear and branching paths dominate. The fidelity is sufficient.

---

## 3. Error Extraction Quality

### 3.1 Error hierarchy

Source: `n8n/packages/workflow/src/errors/`

```
BaseError (base/base.error.ts)
  +-- level: ErrorLevel
  +-- description: string | null
  +-- tags: ErrorTags
  |
  +-- ApplicationError (@n8n/errors)
  |     |
  |     +-- ExecutionBaseError (abstract/execution-base.error.ts)
  |           +-- description: string | null
  |           +-- cause?: Error
  |           +-- errorResponse?: JsonObject
  |           +-- timestamp: number
  |           +-- context: IDataObject  <-- carries runIndex, itemIndex, parameter, etc.
  |           +-- lineNumber?: number
  |           +-- functionality: Functionality
  |           |
  |           +-- NodeError (abstract/node.error.ts)
  |           |     +-- node: INode       <-- the node that errored
  |           |     +-- messages: string[] <-- collected error messages
  |           |     |
  |           |     +-- NodeApiError (node-api.error.ts)
  |           |     |     +-- httpCode: string | null
  |           |     |
  |           |     +-- NodeOperationError (node-operation.error.ts)
  |           |     |     +-- type?: string
  |           |     |
  |           |     +-- WorkflowConfigurationError (extends NodeOperationError)
  |           |     |
  |           |     +-- NodeSslError
  |           |
  |           +-- ExpressionError (expression.error.ts)
  |           |     context carries: causeDetailed, descriptionTemplate,
  |           |       itemIndex, nodeCause, parameter, runIndex, type
  |           |     type enum: 'no_execution_data' | 'no_node_execution_data' |
  |           |       'no_input_connection' | 'internal' | 'paired_item_*'
  |           |
  |           +-- WorkflowOperationError (workflow-operation.error.ts)
  |           |     +-- node?: INode
  |           |
  |           +-- ExecutionCancelledError (execution-cancelled.error.ts)
  |                 +-- reason: 'manual' | 'timeout' | 'shutdown'
  |                 subclasses: ManualExecutionCancelledError,
  |                   TimeoutExecutionCancelledError,
  |                   SystemShutdownExecutionCancelledError
```

### 3.2 Fields available on errors

Every error in the hierarchy carries these fields (accumulated from the chain):

| Field | Source class | Always present? | Value for diagnostics |
|---|---|---|---|
| `message` | BaseError | Yes | Primary error text |
| `description` | ExecutionBaseError | Often | More detailed explanation |
| `context` | ExecutionBaseError | Yes (may be `{}`) | `runIndex`, `itemIndex`, `parameter`, `nodeCause`, etc. |
| `timestamp` | ExecutionBaseError | Yes | When the error occurred |
| `node` | NodeError | On node errors | Full `INode` object -- has `.name`, `.type`, `.parameters` |
| `httpCode` | NodeApiError | On API errors | HTTP status code string |
| `messages` | NodeError | Yes (may be `[]`) | Accumulated related messages |
| `functionality` | ExecutionBaseError | Yes | `'regular'` or `'configuration-node'` or `'pairedItem'` |
| `cause` | ExecutionBaseError | Sometimes | Original error |
| `errorResponse` | ExecutionBaseError | On API errors | Raw API response body |
| `type` | ExpressionError / NodeOperationError | Sometimes | Error subtype for classification |
| `reason` | ExecutionCancelledError | On cancellation | `'manual' \| 'timeout' \| 'shutdown'` |
| `level` | BaseError | Yes | `'error' \| 'warning' \| 'fatal'` |

### 3.3 How errors appear in execution data

Errors surface at two levels:

**Top-level** (`resultData.error`): Present when execution failed globally. This is the "headline" error. Type is `ExecutionError` which is a union:
```typescript
type ExecutionError =
  | ExpressionError
  | WorkflowActivationError
  | WorkflowOperationError
  | ExecutionCancelledError
  | NodeOperationError
  | NodeApiError;
```
Source: interfaces.ts line 100.

**Per-node** (`runData[nodeName][runIndex].error`): Present when a specific node failed. Same `ExecutionError` type. A node can have an error even if the top-level execution "succeeded" (e.g., error was caught by an error workflow or the node was configured to continue on error).

**Redacted errors**: When execution data is redacted (privacy/compliance), errors are replaced with `IRedactedErrorInfo`:
```typescript
interface IRedactedErrorInfo {
  type: string;      // e.g. 'NodeApiError'
  httpCode?: string;  // e.g. '404'
}
```
This preserves enough for classification but loses the message and description. The `redactedError` field appears alongside `error` at both the top-level (`resultData.redactedError`) and per-node (`ITaskData.redactedError`) levels. Source: interfaces.ts line 1424.

### 3.4 Distinguishing wiring failures from runtime/environmental failures

This is possible with high confidence using error class + fields:

| Error type | Classification | Key discriminator |
|---|---|---|
| `NodeApiError` with `httpCode` 401/403 | Credentials/config gap | `httpCode` field |
| `NodeApiError` with `httpCode` 4xx | Wiring (bad request) | `httpCode` + `message` |
| `NodeApiError` with `httpCode` 5xx | External service | `httpCode` field |
| `NodeApiError` with ECONNREFUSED/ENOTFOUND | Environmental/infra | `message` contains network error code |
| `ExpressionError` | Wiring (expression bug) | Error `type` field + `context.parameter` |
| `NodeOperationError` | Wiring (node config) | Generic -- check `message` |
| `WorkflowConfigurationError` | Wiring (structure) | Subclass of NodeOperationError |
| `NodeSslError` | Environmental/config | Always SSL-related |
| `WorkflowOperationError` | Platform | Timeout, operation-level failure |
| `ExecutionCancelledError` | Cancelled | `reason` tells us manual vs timeout vs shutdown |
| `WorkflowActivationError` | Platform | Workflow could not activate |

**Concrete examples of extracted errors**:

**Example 1: API credential error (NodeApiError)**
```json
{
  "type": "NodeApiError",
  "message": "Authorization failed - please check your credentials",
  "description": "The API key provided is invalid",
  "classification": "credentials",
  "httpCode": "401",
  "nodeName": "HTTP Request",
  "context": { "runIndex": 0, "itemIndex": 0 }
}
```

**Example 2: Expression error (ExpressionError)**
```json
{
  "type": "ExpressionError",
  "message": "No execution data found",
  "description": "The expression references a node that hasn't executed yet",
  "classification": "expression",
  "httpCode": null,
  "nodeName": null,
  "context": {
    "type": "no_node_execution_data",
    "nodeCause": "Set Fields",
    "parameter": "value",
    "runIndex": 0,
    "itemIndex": 0
  }
}
```

**Example 3: Connection refused (NodeApiError wrapping ECONNREFUSED)**
```json
{
  "type": "NodeApiError",
  "message": "The service refused the connection - perhaps it is offline",
  "description": "connect ECONNREFUSED 127.0.0.1:3000",
  "classification": "external-service",
  "httpCode": null,
  "nodeName": "Webhook Call",
  "context": { "runIndex": 0 }
}
```

**Example 4: Timeout cancellation (ExecutionCancelledError)**
```json
{
  "type": "TimeoutExecutionCancelledError",
  "message": "The execution was cancelled because it timed out",
  "description": null,
  "classification": "cancelled",
  "httpCode": null,
  "nodeName": null,
  "context": {}
}
```

### 3.5 Error extraction algorithm

```typescript
function extractDiagnosticError(error: ExecutionError): DiagnosticError {
  const type = error.constructor?.name ?? error.name ?? 'UnknownError';
  const message = error.message;
  const description = ('description' in error ? error.description : null) ?? null;
  const httpCode = ('httpCode' in error ? error.httpCode : null) ?? null;
  const nodeName = ('node' in error && error.node ? error.node.name : null) ?? null;
  const context = ('context' in error ? error.context : {}) ?? {};

  return {
    type,
    message,
    description,
    classification: classifyError(error),
    httpCode,
    nodeName,
    context,
  };
}

function classifyError(error: ExecutionError): ErrorClassification {
  const type = error.constructor?.name ?? '';

  // Cancellation
  if (type.includes('Cancelled')) {
    return 'cancelled';
  }

  // Expression errors are always wiring/expression issues
  if (type === 'ExpressionError') {
    return 'expression';
  }

  // API errors -- classify by HTTP code
  if (type === 'NodeApiError' && 'httpCode' in error) {
    const code = error.httpCode;
    if (code === '401' || code === '403') return 'credentials';
    if (code && code.startsWith('5')) return 'external-service';
    if (code && code.startsWith('4')) return 'wiring';
  }

  // Connection-level errors in the message
  const msg = error.message?.toUpperCase() ?? '';
  const networkCodes = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'];
  if (networkCodes.some(code => msg.includes(code))) {
    return 'external-service';
  }

  // SSL errors
  if (type === 'NodeSslError') return 'external-service';

  // Workflow-level operational errors
  if (type === 'WorkflowOperationError' || type === 'WorkflowActivationError') {
    return 'platform';
  }

  // Node operation / configuration errors are likely wiring
  if (type === 'WorkflowConfigurationError' || type === 'NodeOperationError') {
    // Check for credential-related messages
    const lc = (error.message ?? '').toLowerCase();
    if (lc.includes('credential') || lc.includes('authentication')) {
      return 'credentials';
    }
    return 'wiring';
  }

  return 'unknown';
}
```

### 3.6 Assessment

| Capability | Quality | Notes |
|---|---|---|
| Error message extraction | **High** | `message` + `description` always available |
| Error localization (which node) | **High** | `NodeError.node.name` for node errors; `lastNodeExecuted` as fallback |
| HTTP code extraction | **High** | `NodeApiError.httpCode` is reliable |
| Wiring vs. environmental classification | **High** | Error class hierarchy + httpCode + message patterns |
| Credential vs. wiring distinction | **Medium-High** | httpCode 401/403 is reliable; message-based heuristics needed for some cases |
| Expression error detail | **High** | `ExpressionError.context` carries parameter name, node cause, error subtype |
| Redacted execution handling | **Medium** | `IRedactedErrorInfo` preserves type + httpCode but loses message/description |
| Sub-execution errors | **Low** | Requires following `metadata.subExecution` to fetch child execution data |

---

## 4. Key Takeaways and Risks

### What works well

1. **IRunData is an excellent diagnostic source.** Per-node keying with `executionIndex` and `source` gives us reliable path reconstruction for the common case (linear and branching paths).

2. **The error hierarchy is well-structured for classification.** Error class names, httpCode, context fields, and ExpressionError subtypes give us enough signal to route agent actions with high confidence.

3. **n8nac's error classification (config-gap/wiring-error/runtime-state) is a proven pattern** that n8n-vet should extend, not replace. Our classification adds finer granularity (expression vs. credentials vs. external-service) while maintaining the same action-oriented philosophy.

4. **The execution API provides full data.** The `GET /api/v1/executions/{id}?includeData=true` endpoint returns the complete `IRunExecutionData` including per-node results. n8nac already uses this path.

### Risks and gaps

1. **Execution data may be redacted.** When `redactionInfo.isRedacted === true`, error messages and node output are stripped. The summary degrades to type + httpCode only. n8n-vet should detect this and warn the agent that diagnostic quality is reduced.

2. **Parallel branches produce non-linear paths.** The proposed `executedPath: PathNode[]` is a simplification. For workflows with parallel branches, we should either (a) flatten to execution order (losing branch structure) or (b) add a `branches` field. Recommendation: start with flat execution order; add branch awareness in a later iteration.

3. **Sub-workflow errors are fragmented.** Following sub-execution chains requires multiple API calls. For v1, report the sub-execution reference and let the agent decide whether to drill deeper.

4. **Serialized errors may lose class information.** When errors are serialized to JSON (as happens in the execution API response), the constructor name is lost. The `toJSON()` method on `ExecutionBaseError` preserves `name`, `message`, `description`, `context`, and `cause` -- but `httpCode` (on `NodeApiError`) and `node` (on `NodeError`) are NOT included in the default `toJSON()`. We may need to reconstruct these from the raw JSON structure.

5. **Node hints (`NodeExecutionHint`) are execution-time-only.** They are useful warnings but only available when execution actually ran. Static analysis cannot produce them.

---

## 5. Code References

| Item | File | Line(s) |
|---|---|---|
| `IRun` | `n8n/packages/workflow/src/interfaces.ts` | 2691 |
| `IRunData` | `n8n/packages/workflow/src/interfaces.ts` | 2727 |
| `ITaskData` | `n8n/packages/workflow/src/interfaces.ts` | 2824 |
| `ITaskStartedData` | `n8n/packages/workflow/src/interfaces.ts` | 2815 |
| `INodeExecutionData` | `n8n/packages/workflow/src/interfaces.ts` | 1456 |
| `ISourceData` | `n8n/packages/workflow/src/interfaces.ts` | 2840 |
| `ExecutionError` (type union) | `n8n/packages/workflow/src/interfaces.ts` | 100 |
| `ExecutionStatus` | `n8n/packages/workflow/src/execution-status.ts` | 1 |
| `IRunExecutionDataV1` | `n8n/packages/workflow/src/run-execution-data/run-execution-data.v1.ts` | 26 |
| `IDestinationNode` | `n8n/packages/workflow/src/interfaces.ts` | 2924 |
| `IRedactedErrorInfo` | `n8n/packages/workflow/src/interfaces.ts` | 1424 |
| `NodeHint` | `n8n/packages/workflow/src/interfaces.ts` | 2509 |
| `ExecutionBaseError` | `n8n/packages/workflow/src/errors/abstract/execution-base.error.ts` | 10 |
| `NodeError` | `n8n/packages/workflow/src/errors/abstract/node.error.ts` | 37 |
| `NodeApiError` | `n8n/packages/workflow/src/errors/node-api.error.ts` | 120 |
| `NodeOperationError` | `n8n/packages/workflow/src/errors/node-operation.error.ts` | 9 |
| `ExpressionError` | `n8n/packages/workflow/src/errors/expression.error.ts` | 31 |
| `ExecutionCancelledError` | `n8n/packages/workflow/src/errors/execution-cancelled.error.ts` | 5 |
| `WorkflowConfigurationError` | `n8n/packages/workflow/src/errors/workflow-configuration.error.ts` | 6 |
| `WorkflowOperationError` | `n8n/packages/workflow/src/errors/workflow-operation.error.ts` | 7 |
| `createErrorExecutionData` | `n8n/packages/workflow/src/run-execution-data-factory.ts` | 125 |
| n8nac `ITestResult` | `n8n-as-code/packages/cli/src/core/types.ts` | 101 |
| n8nac `TestErrorClass` | `n8n-as-code/packages/cli/src/core/types.ts` | 88 |
| n8nac `IExecutionDetails` | `n8n-as-code/packages/cli/src/core/types.ts` | 183 |
| n8nac `classifyTestError` | `n8n-as-code/packages/cli/src/core/services/n8n-api-client.ts` | 1176 |
| n8nac `getExecution` | `n8n-as-code/packages/cli/src/core/services/n8n-api-client.ts` | 683 |
