# Contract: `interpret()`

**Subsystem**: Orchestrator (`src/orchestrator/interpret.ts`)
**Date**: 2026-04-19

## Public Interface

The orchestrator exposes a single public function. It is the only subsystem called directly by MCP/CLI surfaces.

### `interpret(request: ValidationRequest, deps: OrchestratorDeps): Promise<DiagnosticSummary>`

**Input**: `ValidationRequest` — the agent's validation request (Zod-validated at entry).

**Input**: `OrchestratorDeps` — injected subsystem interfaces for testability.

**Output**: `DiagnosticSummary` — always. Never throws for foreseeable failures (workflow not found, parse error, missing nodes, execution failures). These produce `status: 'error'` diagnostics.

**Throws**: Only on internal bugs (assertion failures, subsystem programming errors). These are defects, not user-facing errors.

### Pipeline Contract (10 steps, strict order)

```
Step 1: Parse workflow file → WorkflowGraph
        Error → DiagnosticSummary { status: 'error' }

Step 2: Load trust state
        Missing → empty TrustState (spec-defined)

Step 3: Compute change set (if previous snapshot available)
        No snapshot → changeSet = null

Step 4: Resolve target → ResolvedTarget + SliceDefinition
        Missing nodes → DiagnosticSummary { status: 'error' }
        Empty nodes list → DiagnosticSummary { status: 'error' }
        Empty changed set → pass to guardrails (they refuse)

Step 5: Consult guardrails → GuardrailDecision
        refuse → skip to Step 7, status: 'skipped'
        narrow → replace target, re-select paths
        redirect → change effective layer
        warn → proceed, include warning
        proceed → no changes

Step 6: Run validation
        6a. Static (layer 'static' or 'both'): all 4 static checks
        6b. Execution (layer 'execution' or 'both', not redirected):
            - Construct pin data
            - Select execution strategy
            - Execute + retrieve results
        Static errors do NOT prevent execution

Step 7: Synthesize → DiagnosticSummary

Step 8: Update trust (pass only, validated nodes only)

Step 9: Save snapshot (pass only)

Step 10: Return DiagnosticSummary
```

### Execution Strategy Selection

| Condition | Strategy | Function |
|-----------|----------|----------|
| `destinationNode` is set | Bounded REST | `executeBounded()` |
| Target is `'workflow'` | Whole-workflow MCP | `executeSmoke()` |
| Target is a slice | Bounded REST (furthest downstream = destination) | `executeBounded()` |

### Guarantees

1. **Deterministic**: Same inputs → same outputs (SC-004). Path selection uses tiered lexicographic comparison with stable tie-breaking.
2. **No side effects on failure**: Trust state and snapshots are only updated on `status: 'pass'`.
3. **Complete**: Every `ValidationRequest` produces exactly one `DiagnosticSummary`.
4. **Sequential**: Pipeline steps never run concurrently. Step N completes before Step N+1 begins.

## Supporting Functions (internal, not exported)

### `resolveTarget(target: AgentTarget, graph: WorkflowGraph, changeSet: NodeChangeSet | null, trustState: TrustState): ResolvedTarget`

Converts agent target to concrete nodes. Implementation varies by `target.kind`.

### `selectPaths(slice: SliceDefinition, graph: WorkflowGraph, changeSet: NodeChangeSet | null, trustState: TrustState): PathDefinition[]`

Enumerates candidate paths, applies 4-tier ranking, runs additional-greedy multi-path selection.

### `loadSnapshot(workflowId: string): WorkflowGraph | null`

Reads `.n8n-vet/snapshots/{workflowId}.json`. Returns null if missing or unreadable.

### `saveSnapshot(workflowId: string, graph: WorkflowGraph): void`

Writes serialized graph to `.n8n-vet/snapshots/{workflowId}.json`.

### `deriveWorkflowId(workflowPath: string): string`

Resolves the file path to an absolute, normalized string for use as a stable key.
