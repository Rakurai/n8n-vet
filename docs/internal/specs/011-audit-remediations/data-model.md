# Data Model: Audit Findings Remediation

**Date**: 2026-04-19  
**Branch**: `011-audit-remediations`

## Entity Changes

### 1. ExecutionData (type unification — S0-1, FR-001, FR-002)

**Current state**: Two incompatible `ExecutionData` types exist.

| Field | `execution/types.ts` | `diagnostics/types.ts` |
|-------|---------------------|----------------------|
| `nodeResults` | `Map<NodeIdentity, NodeExecutionResult[]>` | `Map<NodeIdentity, NodeExecutionResult>` |
| `status` | `ExecutionStatus` (union) | `'success' \| 'error' \| 'cancelled'` |
| `NodeExecutionResult.source` | `SourceInfo \| null` | `{ previousNodeOutput: number \| null }` |
| `NodeExecutionResult.hints` | `ExecutionHint[]` | `NodeExecutionHint[]` |

**Target state**: Single `ExecutionData` in `execution/types.ts`. The diagnostics-local type is deleted. All consumers import from `execution/types.ts`.

The `nodeResults` shape uses arrays (`NodeExecutionResult[]`) since nodes can execute multiple times. Diagnostics code that assumed single results must iterate or select the last result.

### 2. WorkflowGraph (key type — S1-1, FR-006)

**Current state**: All maps use `Map<string, ...>`.

**Target state**: 
```
nodes: Map<NodeIdentity, GraphNode>
forward: Map<NodeIdentity, Edge[]>
backward: Map<NodeIdentity, Edge[]>
displayNameIndex: Map<string, NodeIdentity>
```

Cascading change to ~30 files. All `as` casts at map access sites are removed.

### 3. SerializedGraphNode (snapshot fields — S1-2, FR-007)

**Current state**: Missing execution settings.

**Target state**: Add fields:
- `retryOnFail: boolean`
- `executeOnce: boolean`
- `onError: 'stopWorkflow' | 'continueRegularOutput' | 'continueErrorOutput'`

Deserialization reconstructs these into the graph's AST-equivalent representation.

### 4. TrustState (workflow identity — S0-4, FR-004, FR-024)

**Current state**: `workflowHash` field contains an absolute file path.

**Target state**: `workflowHash` contains the output of `computeWorkflowHash(graph)` — a content-derived hash. Portable across machines.

### 5. NodeChangeSet (incoming edges — S0-5, FR-005)

**Current state**: `nodeEdgesChanged()` only compares `graph.forward.get(nodeName)`.

**Target state**: Also compares `graph.backward.get(nodeName)`. A change in incoming edges marks the node as changed.

### 6. GraphNode (disabled field — S2-7, FR-021)

**Current state**: `disabled` hardcoded to `false` during construction.

**Target state**: `disabled` read from raw node data. Disabled nodes excluded from active analysis (data-loss detection, schema checks, parameter validation).

### 7. MCP GetExecution Response (schema fix — R2)

**Current state**: `GetExecutionResponseSchema` nests `data` inside `execution`.

**Target state**: `execution` and `data` are top-level siblings:
```
{ execution: { id, workflowId, mode, status, ... } | null, data?: IRunExecutionData, error?: string }
```

### 8. REST TriggerExecution Response (schema fix — R1)

**Current state**: `TriggerExecutionResponseSchema` expects `{ data: { executionId } }`.

**Target state**: Verified shape from live testing. Likely `{ executionId }` (flat).
