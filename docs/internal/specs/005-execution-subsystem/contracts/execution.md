# Contracts: Execution Subsystem

**Feature**: 005-execution-subsystem

The execution subsystem exposes functions consumed by the orchestrator (Phase 7). These are the public interface contracts.

## constructPinData

Constructs pin data for a validation run using 4-tier sourcing priority.

```typescript
function constructPinData(
  graph: WorkflowGraph,
  trustedBoundaries: NodeIdentity[],
  fixtures?: Record<string, PinDataItem[]>,
  priorArtifacts?: Record<string, PinDataItem[]>
): PinDataResult

// Returns:
interface PinDataResult {
  pinData: PinData;
  sourceMap: PinDataSourceMap;
}
```

**Preconditions**: `graph` is a valid `WorkflowGraph` from static analysis. `trustedBoundaries` are node identities at the edge of the trusted region.

**Errors**:
- `ExecutionPreconditionError` with `reason: 'missing-pin-data'` — identifies which specific nodes lack pin data. Includes node names in the error message.

**Guarantees**:
- Every node that requires mocking (triggers, trusted boundaries, explicitly mocked) has pin data in the result.
- No empty stubs. If data cannot be sourced, throws.
- `sourceMap` has an entry for every key in `pinData`.

---

## executeBounded

Executes a bounded subgraph via REST API.

```typescript
function executeBounded(
  workflowId: string,
  destinationNodeName: string,
  pinData: PinData,
  mode?: 'inclusive' | 'exclusive'  // default: 'inclusive'
): Promise<ExecutionResult>
```

**Preconditions**: n8n reachable and authenticated. Workflow exists in n8n.

**Errors**:
- `ExecutionInfrastructureError` with `reason: 'unreachable'` — n8n not reachable.
- `ExecutionInfrastructureError` with `reason: 'auth-failure'` — API key invalid or missing.
- `ExecutionPreconditionError` with `reason: 'workflow-not-found'` — workflow does not exist in n8n.
- `ExecutionPreconditionError` with `reason: 'workflow-stale'` — local version differs from remote.

**Guarantees**:
- Returns `ExecutionResult` with `executionId` on successful trigger.
- `partial` is always `true` for bounded execution.
- Timeout reported as `ExecutionResult` with `status: 'canceled'`, not as a thrown error.

---

## executeSmoke

Executes whole workflow via MCP `test_workflow`.

```typescript
function executeSmoke(
  workflowId: string,
  pinData: PinData,
  triggerNodeName?: string
): Promise<ExecutionResult>
```

**Preconditions**: MCP tools available. Workflow exists in n8n.

**Errors**:
- `ExecutionInfrastructureError` with `reason: 'mcp-unavailable'` — MCP tools not discovered.
- Same workflow errors as `executeBounded`.

**Guarantees**:
- Returns `ExecutionResult` with `executionId` on successful execution.
- `partial` is always `false` for smoke tests.
- Synchronous — blocks until execution completes or times out (5 minutes).

---

## getExecutionResult

Retrieves per-node execution data from a completed execution.

```typescript
function getExecutionResult(
  executionId: string,
  nodeNames: NodeIdentity[]
): Promise<ExecutionData>
```

**Preconditions**: `executionId` refers to a completed execution.

**Errors**:
- `ExecutionInfrastructureError` — execution not found or data unavailable.

**Guarantees**:
- `nodeResults` contains entries only for nodes that actually executed within the requested filter.
- No raw output data (`INodeExecutionData[]`) in the result.
- `lastNodeExecuted` and top-level `error` always populated from execution metadata.

---

## pollForCompletion

Polls an execution until terminal status, then retrieves filtered data.

```typescript
function pollForCompletion(
  executionId: string,
  workflowId: string,
  nodeNames: NodeIdentity[]
): Promise<ExecutionData>
```

**Preconditions**: `executionId` was returned by a prior `executeBounded` call.

**Errors**:
- Timeout: returns `ExecutionData` with `status: 'canceled'` and error `contextKind: 'cancellation'`, `reason: 'timeout'`. This is a normal return, not a thrown error.
- `ExecutionInfrastructureError` — n8n becomes unreachable during polling.

**Guarantees**:
- Status polling uses `includeData: false` (lightweight).
- Data retrieval is a single call with `nodeNames` filter and `truncateData`.
- Backoff sequence: 1s, 2s, 4s, 8s, 15s, 15s, ...

---

## detectCapabilities

Probes the execution environment.

```typescript
function detectCapabilities(
  workflowId?: string
): Promise<DetectedCapabilities>
```

**Preconditions**: None (this is the precondition check itself).

**Errors**:
- `ExecutionInfrastructureError` with `reason: 'unreachable'` — n8n not reachable.
- `ExecutionInfrastructureError` with `reason: 'auth-failure'` — authentication failed.
- `ExecutionPreconditionError` with `reason: 'workflow-not-found'` or `'workflow-stale'` — only when `workflowId` provided.
- `ExecutionConfigError` — credentials cannot be resolved from config cascade.

**Guarantees**:
- If no errors thrown, `restAvailable` is `true`.
- `mcpAvailable` reflects actual MCP tool discovery, not assumption.
- `mcpTools` lists the specific tool names discovered.

---

## resolveCredentials

Resolves n8n host and API key from the config cascade.

```typescript
function resolveCredentials(
  explicit?: { host?: string; apiKey?: string }
): { host: string; apiKey: string }
```

**Preconditions**: At least one source in the cascade provides both `host` and `apiKey`.

**Errors**:
- `ExecutionConfigError` — identifies which credential is missing and which sources were checked.

**Guarantees**:
- Returns fully resolved `host` (URL) and `apiKey`.
- Cascade order: explicit > env vars (`N8N_HOST`, `N8N_API_KEY`) > n8nac project config > global credential store.
