# Data Model: Execution Subsystem

**Feature**: 005-execution-subsystem
**Date**: 2026-04-18

## Internal Types (src/execution/types.ts)

These types are internal to the execution subsystem. Cross-subsystem types (`NodeIdentity`, `WorkflowGraph`, `AvailableCapabilities`, etc.) are imported from `src/types/`.

### PinData

Record mapping node names to arrays of pin data items. Used to mock node outputs during bounded or whole-workflow execution.

| Field | Type | Description |
|-------|------|-------------|
| `[nodeName]` | `PinDataItem[]` | Array of output items for the named node |

### PinDataItem

A single output item in pin data format.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `json` | `Record<string, unknown>` | Yes | Arbitrary JSON key-value data |
| `binary` | `Record<string, unknown>` | No | Binary attachment data |

### PinDataSource

Discriminated label for traceability.

| Value | Description |
|-------|-------------|
| `'agent-fixture'` | Provided explicitly by the agent in the validation request |
| `'prior-artifact'` | Loaded from cached pin data (content hash matched) |
| `'execution-history'` | Inferred from MCP `prepare_test_pin_data` schema |

### PinDataSourceMap

Record mapping node names to their pin data source.

| Field | Type | Description |
|-------|------|-------------|
| `[nodeName]` | `PinDataSource` | Which tier provided the pin data for this node |

### PinDataResult

Output of pin data construction.

| Field | Type | Description |
|-------|------|-------------|
| `pinData` | `PinData` | The constructed pin data record |
| `sourceMap` | `PinDataSourceMap` | Traceability map |

### ExecutionResult

Outcome of triggering an execution (bounded or smoke).

| Field | Type | Description |
|-------|------|-------------|
| `executionId` | `string` | n8n execution identifier |
| `status` | `ExecutionStatus` | Terminal or non-terminal status |
| `error` | `ExecutionErrorData \| null` | Error data if status indicates failure |
| `partial` | `boolean` | Whether this was a bounded (partial) execution |

### ExecutionStatus

```
'success' | 'error' | 'crashed' | 'canceled' | 'waiting' | 'running' | 'new' | 'unknown'
```

Terminal statuses (trigger data retrieval): `success`, `error`, `crashed`, `canceled`.
Non-terminal statuses (continue polling): `waiting`, `running`, `new`, `unknown`.

### ExecutionErrorDataBase

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | Error class name (e.g., `'NodeApiError'`) |
| `message` | `string` | Primary error message |
| `description` | `string \| null` | Detailed description if available |
| `node` | `string \| null` | Node that produced the error |

### ExecutionErrorData

Discriminated union on `contextKind`:

| contextKind | Context fields | When |
|-------------|---------------|------|
| `'api'` | `httpCode: string`, `errorCode?: string` | HTTP/API errors from external services |
| `'cancellation'` | `reason: 'manual' \| 'timeout' \| 'shutdown'` | Execution cancelled |
| `'expression'` | `expressionType?: string`, `parameter?: string` | Expression evaluation failure |
| `'other'` | `runIndex?: number`, `itemIndex?: number` | All other error types |

### ExecutionData

Per-node results extracted from a completed execution.

| Field | Type | Description |
|-------|------|-------------|
| `nodeResults` | `Map<NodeIdentity, NodeExecutionResult[]>` | Per-node execution results |
| `lastNodeExecuted` | `string \| null` | Last node that ran |
| `error` | `ExecutionErrorData \| null` | Top-level execution error |
| `status` | `ExecutionStatus` | Final execution status |

### NodeExecutionResult

A single execution attempt for one node.

| Field | Type | Description |
|-------|------|-------------|
| `executionIndex` | `number` | Position in the `ITaskData[]` array |
| `status` | `'success' \| 'error'` | Node-level outcome |
| `executionTimeMs` | `number` | Duration in milliseconds |
| `error` | `ExecutionErrorData \| null` | Node-level error data |
| `source` | `SourceInfo \| null` | Which node produced input for this execution |
| `hints` | `ExecutionHint[]` | Non-blocking informational hints |

### SourceInfo

Execution lineage — which upstream node produced the input.

| Field | Type | Description |
|-------|------|-------------|
| `previousNode` | `string` | Name of the upstream node |
| `previousNodeOutput` | `number` | Output index from the upstream node |
| `previousNodeRun` | `number` | Run index of the upstream node |

### ExecutionHint

| Field | Type | Description |
|-------|------|-------------|
| `message` | `string` | Hint message |
| `severity` | `string` | Severity level |

### CapabilityLevel

Detected execution environment capabilities.

| Value | Meaning |
|-------|---------|
| `'full'` | REST API + MCP tools available |
| `'rest-only'` | REST API available, MCP unavailable |
| `'static-only'` | Neither REST nor MCP available |

### DetectedCapabilities

| Field | Type | Description |
|-------|------|-------------|
| `level` | `CapabilityLevel` | Summary capability level |
| `restAvailable` | `boolean` | n8n REST API reachable and authenticated |
| `mcpAvailable` | `boolean` | MCP tools discoverable |
| `mcpTools` | `string[]` | List of discovered MCP tool names |

### PollingConstants

Named constants (not a runtime type — defined as module-level `as const`).

| Constant | Value | Description |
|----------|-------|-------------|
| `POLL_INITIAL_DELAY_MS` | `1000` | First poll delay |
| `POLL_BACKOFF_FACTOR` | `2` | Exponential multiplier |
| `POLL_MAX_DELAY_MS` | `15000` | Maximum delay between polls |
| `POLL_TIMEOUT_MS` | `300000` | Total polling timeout (5 minutes) |

## Relationships

```
PinDataResult ──── PinData (record of PinDataItem[])
     │
     └──── PinDataSourceMap (record of PinDataSource)

ExecutionResult ──── ExecutionErrorData (discriminated on contextKind)

ExecutionData ──── Map<NodeIdentity, NodeExecutionResult[]>
     │                        │
     │                        ├── ExecutionErrorData
     │                        ├── SourceInfo
     │                        └── ExecutionHint
     │
     └──── ExecutionErrorData (top-level)

DetectedCapabilities ──── CapabilityLevel
```

## State Transitions

### Execution Status Flow

```
[triggered] → running → success
                     → error
                     → crashed
                     → canceled (timeout, manual, shutdown)
                     → waiting (async sub-workflow)

[triggered] → new → running → ...
```

Only terminal statuses (`success`, `error`, `crashed`, `canceled`) trigger the data retrieval phase of polling. `waiting`, `running`, `new`, and `unknown` continue the status polling loop.
