# Data Model: Diagnostic Synthesis

## Input Types (consumed from other subsystems)

### StaticFinding (from `src/static-analysis/types.ts`)

Already implemented. Discriminated union on `kind` with 7 variants: `data-loss`, `broken-reference`, `invalid-parameter`, `unresolvable-expression`, `schema-mismatch`, `missing-credentials`, `opaque-boundary`. Each has `node`, `severity` (`error` | `warning`), `message`, and kind-specific `context`.

### ExecutionData (to be defined in `src/diagnostics/types.ts` temporarily)

Per-run execution results from the n8n instance.

| Field | Type | Notes |
|-------|------|-------|
| status | `'success' \| 'error' \| 'cancelled'` | Top-level run outcome |
| lastNodeExecuted | `string \| null` | Last node that ran before completion/failure |
| error | `ExecutionErrorData \| null` | Top-level execution error, if any |
| nodeResults | `Map<NodeIdentity, NodeExecutionResult>` | Per-node results keyed by node identity |

### NodeExecutionResult

| Field | Type | Notes |
|-------|------|-------|
| executionIndex | `number` | Ordered position in execution sequence |
| status | `'success' \| 'error'` | Node-level outcome |
| executionTimeMs | `number` | Time spent executing this node |
| error | `ExecutionErrorData \| null` | Node-level error, if any |
| source | `{ previousNodeOutput: number \| null }` | Which output of the previous node fed this one |
| hints | `NodeExecutionHint[]` | Runtime hints emitted by n8n |

### ExecutionErrorData (discriminated union on `contextKind`)

| Variant | Fields | Classification Logic |
|---------|--------|---------------------|
| `api` | `httpCode?`, `errorCode?` | httpCode 401/403 → credentials; 4xx → wiring; 5xx → external-service; absent → external-service |
| `cancellation` | `reason?` | → cancelled |
| `expression` | `expression?`, `parameter?`, `itemIndex?` | → expression |
| `other` | (none extra) | → unknown |

All variants share base fields: `type`, `message`, `description`, `node`.

### TrustState (from `src/types/trust.ts`)

Already implemented. Per-node trust records with `contentHash`, `validatedAt`, `validationLayer`, `fixtureHash`.

### GuardrailDecision (from `src/types/guardrail.ts`)

Already implemented. Discriminated union on `action`: `proceed`, `warn`, `narrow`, `redirect`, `refuse`.

### ResolvedTarget (from `src/types/diagnostic.ts`)

Already implemented. `description`, `nodes: NodeIdentity[]`, `automatic: boolean`.

### AvailableCapabilities (from `src/types/diagnostic.ts`)

Already implemented. `staticAnalysis: true`, `restApi: boolean`, `mcpTools: boolean`.

## Internal Types (defined in `src/diagnostics/types.ts`)

### SynthesisInput

The single input object for the `synthesize()` function.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| staticFindings | `StaticFinding[]` | Yes (may be empty) | From Phase 2 |
| executionData | `ExecutionData \| null` | No | Null for static-only |
| trustState | `TrustState` | Yes | For annotation assignment |
| guardrailDecisions | `GuardrailDecision[]` | Yes (may be empty) | For action reporting |
| resolvedTarget | `ResolvedTarget` | Yes | Nodes in scope |
| capabilities | `AvailableCapabilities` | Yes | Available backends |
| meta | `ValidationMeta` | Yes | Run identification |

### ClassifiedError

Intermediate representation during error extraction before final ordering.

| Field | Type | Notes |
|-------|------|-------|
| error | `DiagnosticError` | The classified error |
| source | `'static' \| 'execution'` | Which layer produced it |
| executionIndex | `number \| null` | For ordering; null for static errors |

### StaticKindClassificationMap

Static lookup table: `Record<StaticFindingErrorKind, ErrorClassification>`.

Only maps the 6 error-eligible kinds (excludes `opaque-boundary`):

| StaticFinding kind | ErrorClassification |
|-------------------|---------------------|
| `data-loss` | `wiring` |
| `broken-reference` | `wiring` |
| `invalid-parameter` | `wiring` |
| `schema-mismatch` | `wiring` |
| `missing-credentials` | `credentials` |
| `unresolvable-expression` | `expression` |

## Output Type

### DiagnosticSummary (from `src/types/diagnostic.ts`)

Already implemented. The canonical output — see `src/types/diagnostic.ts` for the full definition.

## State Transitions

None. The diagnostics subsystem is stateless. It receives inputs, produces a `DiagnosticSummary`, and has no side effects.
