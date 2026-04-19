# Data Model: Request Interpretation

**Phase**: 1 — Design & Contracts
**Date**: 2026-04-19

## New Types (defined in `src/orchestrator/types.ts`)

### ValidationRequest

The agent's validation request. Validated at the orchestrator boundary via Zod.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflowPath` | `string` | yes | Path to the workflow file (.ts or .json) |
| `target` | `AgentTarget` | yes | What to validate (nodes, changed, workflow) |
| `layer` | `ValidationLayer` | yes | Evidence layer (static, execution, both) |
| `force` | `boolean` | yes | Override guardrail decisions |
| `pinData` | `PinData \| null` | yes | Agent-provided pin data for mocking |
| `destinationNode` | `string \| null` | yes | Bounded execution destination |
| `destinationMode` | `'inclusive' \| 'exclusive'` | yes | Whether destination node executes |

### InterpretedRequest

Internal orchestrator state after resolution and guardrail consultation.

| Field | Type | Description |
|-------|------|-------------|
| `resolvedTarget` | `ResolvedTarget` | Concrete nodes after resolution and guardrail narrowing |
| `guardrailDecision` | `GuardrailDecision` | The guardrail action applied |
| `effectiveLayer` | `ValidationLayer` | Layer after guardrail redirect |
| `graph` | `WorkflowGraph` | Parsed workflow graph |
| `changeSet` | `NodeChangeSet \| null` | Node diff (null if no prior snapshot) |
| `trustState` | `TrustState` | Trust state after invalidation |

### OrchestratorDeps

Dependency injection object for testability.

| Field | Type | Description |
|-------|------|-------------|
| `parseWorkflowFile` | `(path: string) => Promise<WorkflowAST>` | Workflow file parser |
| `buildGraph` | `(ast: WorkflowAST) => WorkflowGraph` | Graph construction |
| `loadTrustState` | `(workflowId: string) => TrustState` | Trust state loading |
| `persistTrustState` | `(state: TrustState, hash: string) => void` | Trust state persistence |
| `computeChangeSet` | `(prev: WorkflowGraph, curr: WorkflowGraph) => NodeChangeSet` | Node diff |
| `invalidateTrust` | `(state, changeSet, graph) => TrustState` | Forward invalidation |
| `recordValidation` | `(state, nodes, graph, layer, runId, fixtureHash) => TrustState` | Trust recording |
| `evaluate` | `(input: EvaluationInput) => GuardrailDecision` | Guardrail evaluation |
| `traceExpressions` | `(graph, nodes) => ExpressionReference[]` | Expression tracing |
| `detectDataLoss` | `(graph, refs, nodes, provider?) => StaticFinding[]` | Data loss detection |
| `checkSchemas` | `(graph, refs, provider?) => StaticFinding[]` | Schema checking |
| `validateNodeParams` | `(graph, nodes, provider?) => StaticFinding[]` | Param validation |
| `executeBounded` | `(id, dest, pin, creds, mode?) => Promise<ExecutionResult>` | REST execution |
| `executeSmoke` | `(id, pin, callTool, trigger?) => Promise<ExecutionResult>` | MCP execution |
| `getExecutionData` | `(id, creds) => Promise<RawExecutionData>` | Result retrieval |
| `constructPinData` | `(graph, boundaries, fixtures?, prior?) => PinDataResult` | Pin data |
| `synthesize` | `(input: SynthesisInput) => DiagnosticSummary` | Diagnostic synthesis |
| `loadSnapshot` | `(workflowId: string) => WorkflowGraph \| null` | Snapshot loading |
| `saveSnapshot` | `(workflowId: string, graph: WorkflowGraph) => void` | Snapshot saving |
| `detectCapabilities` | `(creds?, callTool?) => Promise<DetectedCapabilities>` | Capability probe |

### WorkflowSnapshot

Lightweight serialized form stored in `.n8n-vet/snapshots/{workflowId}.json`.

| Field | Type | Description |
|-------|------|-------------|
| `workflowId` | `string` | Workflow identifier (derived from file path) |
| `savedAt` | `string` | ISO 8601 timestamp |
| `nodes` | `SerializedGraphNode[]` | All nodes with full parameters |
| `forward` | `Record<string, SerializedEdge[]>` | Forward adjacency |
| `backward` | `Record<string, SerializedEdge[]>` | Backward adjacency |

## Existing Types (consumed, not modified)

- `AgentTarget`, `ValidationTarget`, `ValidationLayer` — from `src/types/target.ts`
- `WorkflowGraph`, `GraphNode`, `Edge` — from `src/types/graph.ts`
- `SliceDefinition`, `PathDefinition`, `PathEdge` — from `src/types/slice.ts`
- `TrustState`, `NodeChangeSet` — from `src/types/trust.ts`
- `GuardrailDecision` — from `src/types/guardrail.ts`
- `DiagnosticSummary`, `ResolvedTarget`, `AvailableCapabilities`, `ValidationMeta` — from `src/types/diagnostic.ts`
- `EvaluationInput` — from `src/guardrails/types.ts`
- `SynthesisInput` — from `src/diagnostics/types.ts`
- `PinData`, `PinDataResult`, `ExecutionResult`, `ExecutionData`, `DetectedCapabilities`, `ResolvedCredentials` — from `src/execution/types.ts`
- `StaticFinding`, `ExpressionReference` — from `src/static-analysis/types.ts`
- `NodeIdentity` — from `src/types/identity.ts`

## State Transitions

### Trust State Lifecycle (within orchestrator)

```
Load → Invalidate (if change set) → Use for guardrails/validation → Record (on pass only) → Persist
```

### Snapshot Lifecycle

```
Load previous (if exists) → Use for change set computation → Save current (on pass only)
```

## Key Relationships

```
ValidationRequest → [parse] → WorkflowGraph
                  → [load trust] → TrustState
                  → [load snapshot + diff] → NodeChangeSet
                  → [resolve target] → ResolvedTarget + SliceDefinition
                  → [select paths] → PathDefinition[]
                  → [evaluate guardrails] → GuardrailDecision
                  → [run static] → StaticFinding[]
                  → [run execution] → ExecutionData
                  → [synthesize] → DiagnosticSummary
```
