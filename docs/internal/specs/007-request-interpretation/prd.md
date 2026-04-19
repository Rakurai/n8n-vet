# Phase 7 — Request Interpretation

## Goal

Implement the system's control center: receive a validation request, resolve the target to concrete nodes, consult guardrails, orchestrate static analysis and execution subsystems, synthesize a diagnostic summary, and update trust state. This phase provides the `interpret` function defined in the cross-subsystem contracts and wires all subsystems into a sequential 10-step pipeline.

## Context Files

| File | Role |
|------|------|
| `docs/reference/INDEX.md` | Shared types: `WorkflowGraph`, `NodeIdentity`, `SliceDefinition`, `PathDefinition`, `PathEdge`, `AgentTarget`, `ValidationTarget`, `ValidationLayer`, `TrustState`, `NodeChangeSet`, `GuardrailDecision`, `DiagnosticSummary`, `ResolvedTarget`, `AvailableCapabilities` |
| `docs/CODING.md` | TypeScript rules — fail-fast, contract-driven, no fallbacks, no phantom implementations |
| `docs/CONCEPTS.md` | Shared vocabulary — workflow slice, workflow path, trusted boundary, validation target, guardrail, diagnostic summary, low-value rerun, happy-path validation |
| `docs/STRATEGY.md` | Validation target selection (RTS/TIA heuristic), path prioritization (additional greedy), rerun suppression, static-execution escalation, guardrail action order |

## Scope

**In scope:**
- 10-step sequential pipeline: parse, load trust, compute changes, resolve target, consult guardrails, run validation, synthesize diagnostics, update trust, persist snapshot, return summary
- Workflow parsing dispatch (.ts and .json via appropriate parser)
- Trust state loading from `.n8n-vet/trust-state.json`
- Change set computation with forward invalidation via content hash comparison
- Target resolution for all `AgentTarget` kinds: `nodes`, `changed`, `workflow`
- Target resolution producing `ValidationTarget` kinds: `slice`, `path`
- Path selection using 4-tier lexicographic preference
- Multi-path additional-greedy selection with path enumeration cap
- Guardrail decision routing: refuse, narrow, redirect, warn, proceed
- Orchestration of static analysis and execution subsystems
- Trust state update on pass (only)
- Snapshot persistence after successful validation

**Out of scope:**
- Internal behavior of static analysis (Phase 2) — called via public interface
- Internal behavior of trust and change (Phase 3) — called via public interface
- Internal behavior of guardrails (Phase 4) — called via public interface
- Internal behavior of execution (Phase 5) — called via public interface
- Internal behavior of diagnostics (Phase 6) — called via public interface
- MCP/CLI tool definitions (Phase 8) — they call `interpret`
- Workflow file I/O and n8nac transformer internals

## Inputs and Outputs

### `interpret`

**Input:**
- `request: ValidationRequest` — the agent's validation request

**Output:**
- `DiagnosticSummary` — the canonical validation output

**Error:**
- Workflow file not found: diagnostic with `status: 'error'`, tool failure
- Workflow parse error: diagnostic with `status: 'error'`, tool failure
- Target nodes not found: diagnostic with `status: 'error'`, list of missing nodes
- Static analysis internal error: raised, not caught — prerequisite for synthesis
- Execution fails to start: diagnostic with `status: 'error'`, tool failure

## Internal Types

```typescript
interface ValidationRequest {
  /** Path to the workflow file (.ts or .json). */
  workflowPath: string;

  /** What the agent wants to validate. */
  target: AgentTarget;

  /** Which evidence layer to use. */
  layer: ValidationLayer;

  /** Override guardrail refusal or narrowing. */
  force: boolean;

  /** Agent-provided pin data for mocking. */
  pinData: PinData | null;

  /** Execute up to (or through) this node. Null for automatic destination selection. */
  destinationNode: string | null;

  /** Whether destinationNode executes ('inclusive') or stops before it ('exclusive'). */
  destinationMode: 'inclusive' | 'exclusive';
}

interface InterpretedRequest {
  /** The concrete target after resolution and guardrail application. */
  resolvedTarget: ResolvedTarget;

  /** The guardrail decision for this request. */
  guardrailDecision: GuardrailDecision;

  /** The effective layer after guardrail redirect (may differ from requested layer). */
  effectiveLayer: ValidationLayer;

  /** The parsed workflow graph. */
  graph: WorkflowGraph;

  /** The change set, if a previous snapshot was available. Null otherwise. */
  changeSet: NodeChangeSet | null;

  /** The trust state after invalidation. */
  trustState: TrustState;
}
```

## Upstream Interface Summary

- **Static Analysis**: `buildGraph(ast: WorkflowAST): WorkflowGraph` — parses workflow, returns traversable graph. `traceExpressions(graph: WorkflowGraph, nodes: NodeIdentity[]): ExpressionReference[]` — expression reference extraction. `detectDataLoss(graph: WorkflowGraph, path: PathDefinition): StaticFinding[]` — data-loss-through-replacement detection. `checkSchemas(graph: WorkflowGraph, path: PathDefinition): StaticFinding[]` — schema compatibility. `validateNodeParams(graph: WorkflowGraph, nodes: NodeIdentity[]): StaticFinding[]` — node parameter validation.
- **Trust and Change**: `loadTrustState(workflowId: string): TrustState` — load persisted trust. `computeChangeSet(previous: WorkflowGraph, current: WorkflowGraph): NodeChangeSet` — node-level diff. `invalidateTrust(state: TrustState, changeSet: NodeChangeSet, graph: WorkflowGraph): TrustState` — forward-only invalidation. `recordValidation(state: TrustState, nodes: NodeIdentity[], layer: ValidationLayer, fixtureHash: string | null): TrustState` — record successful validation. `persistTrustState(state: TrustState): void` — write trust state.
- **Guardrails**: `evaluate(request: ValidationRequest, trustState: TrustState, changeSet: NodeChangeSet): GuardrailDecision` — assess request and return action.
- **Execution**: `executeBounded(workflowId: string, destinationNode: string, pinData: PinData, mode: 'inclusive' | 'exclusive'): ExecutionResult` — bounded REST execution. `executeSmoke(workflowId: string, pinData: PinData): ExecutionResult` — whole-workflow MCP execution. `getExecutionResult(executionId: string, nodeNames: NodeIdentity[]): ExecutionData` — filtered result retrieval. `constructPinData(graph: WorkflowGraph, trustedBoundaries: NodeIdentity[]): PinData` — pin data construction.
- **Diagnostics**: `synthesize(staticFindings: StaticFinding[], executionData: ExecutionData | null, trustState: TrustState, guardrailDecisions: GuardrailDecision[], resolvedTarget: ResolvedTarget): DiagnosticSummary` — assemble final output.

## Behavior

### 1. Request processing pipeline (sequential)

The pipeline executes 10 steps in strict order. No step is skipped except where guardrails intervene.

1. Parse workflow into `WorkflowGraph`
2. Load trust state
3. Compute change set (if previous snapshot available)
4. Resolve target to concrete nodes
5. Consult guardrails
6. If not refused: run validation
   - a. Static analysis (always, unless layer is `'execution'`)
   - b. Execution (if layer is `'execution'` or `'both'`, and not redirected to `'static'`)
7. Synthesize diagnostic summary
8. Update trust state with results
9. Persist snapshot of current graph
10. Return diagnostic summary

### 2. Workflow parsing

1. Determine file type from extension: `.ts` dispatches to the TypeScript parser, `.json` dispatches to the JSON-to-AST parser.
2. Parse to `WorkflowAST`.
3. Build `WorkflowGraph` via `buildGraph(ast)`.

If parsing fails at any step, return a diagnostic with `status: 'error'`. This is a tool failure — the workflow file is unreadable.

### 3. Trust state loading

1. Read `.n8n-vet/trust-state.json`.
2. Find the entry matching the current workflow ID.
3. If no entry found, start with empty trust state (no trusted nodes, no connections hash).

### 4. Change set computation

**When previous snapshot or trust state with prior hash is available:**

1. Parse previous workflow snapshot (stored in `.n8n-vet/`) into `WorkflowGraph`.
2. Compute `NodeChangeSet` via `computeChangeSet(previous, current)`.
3. Apply `invalidateTrust(trustState, changeSet, graph)` to produce updated trust state.

**Automatic detection without explicit snapshot:** when trust state records a workflow hash that differs from the current workflow's hash, identify nodes whose content hash no longer matches. Mark those as changed and forward-propagate invalidation through the graph. This provides approximate change detection without requiring a full previous snapshot.

**No previous snapshot and no trust state:** `changeSet` is `null`. All nodes are treated as new (no trust, no change signal).

### 5. Target resolution

Convert `AgentTarget` to concrete `ValidationTarget` with `ResolvedTarget`.

**`kind: 'nodes'`:**
Use the specified node names. Verify each exists in the graph. If any are missing, return a diagnostic with `status: 'error'` listing the missing nodes.

**`kind: 'changed'`:**
Compute from change set using the RTS/TIA heuristic:
1. Start with trust-breaking changes (modified nodes + added nodes).
2. Forward-propagate to affected downstream nodes until a trusted boundary or workflow exit is reached.
3. Backward-walk to the nearest trigger or trusted boundary to establish input context.
4. The result is a `SliceDefinition`. The happy path is the default path (see path selection below).
5. If no changes exist (empty change set), the target is empty. Guardrails will refuse.

**`kind: 'workflow'`:**
All nodes in the graph. Guardrails will warn about breadth.

After target resolution, perform path selection (see next section) to produce the final `ValidationTarget`.

### 6. Path selection (tiered lexicographic preference)

When the agent does not specify a specific path, select paths through the resolved slice.

**Enumeration:**
1. Enumerate candidate paths through the slice from entry points to exit points.
2. Path enumeration cap: if more than 20 candidate paths exist, apply a quick heuristic (fewest error outputs, then fewest total nodes) to select the top 20 candidates BEFORE full ranking. The cap bounds enumeration cost — full 4-tier ranking runs only on the capped candidate set. The cap of 20 is a tunable constant.

**Selection (tiered lexicographic preference):**

Each tier produces a boolean or count outcome. Higher tiers dominate — Tier 1 is evaluated first, and lower tiers break ties only when higher tiers are equal. This is ordered preference, not weighted scoring.

| Tier | Criterion | Preference |
|------|-----------|------------|
| 1 | Error output usage | Prefer paths using no error outputs (all `isError: false`) |
| 2 | Output index on branching nodes | Prefer paths taking output index 0 |
| 3 | Changed nodes covered | More changed nodes covered is better (count) |
| 4 | Untrusted boundaries crossed | More untrusted boundaries crossed is better (count) |

Select the highest-ranked path.

**Multi-path (additional greedy):**
After selecting the first path, update the set of covered elements (changed nodes, untrusted boundaries). Re-rank remaining candidate paths by newly covered elements. Select the next path if it covers meaningful new elements not already covered. Repeat until no remaining path adds meaningful new coverage.

Record the selection reason for each path for diagnostic reporting.

### 7. Guardrail consultation

```
guardrailDecision = guardrails.evaluate(request, trustState, changeSet)
```

Route based on the guardrail action:

| Action | Effect |
|--------|--------|
| `refuse` | Skip validation entirely. Proceed to synthesis with `status: 'skipped'`. |
| `narrow` | Replace the resolved target with the narrowed target from the decision. Re-run path selection on the narrowed slice. |
| `redirect` | Replace the effective layer with the redirected layer from the decision. |
| `warn` | Proceed with validation. Include the warning in the diagnostic summary. |
| `proceed` | No changes to target or layer. |

If `request.force` is `true` and the decision is `overridable`, override the guardrail and proceed.

### 8. Validation execution

**Static analysis (layer `'static'` or `'both'`):**

Run all static checks against the resolved target:
1. `traceExpressions(graph, resolvedTarget.nodes)` — extract expression references
2. `detectDataLoss(graph, path)` — check for data-loss-through-replacement patterns
3. `checkSchemas(graph, path)` — verify schema compatibility
4. `validateNodeParams(graph, resolvedTarget.nodes)` — validate node parameters

Collect all results into `StaticFinding[]`.

**Execution (layer `'execution'` or `'both'`, not redirected to `'static'`):**

1. Construct pin data for out-of-scope nodes via `constructPinData(graph, trustedBoundaries)`.
2. Determine execution strategy:
   - If `destinationNode` is set: bounded REST execution via `executeBounded`.
   - If target is `'workflow'`: whole-workflow execution via `executeSmoke`.
   - If target is a slice: compute the furthest downstream node in the slice as the destination, use `executeBounded`.
3. Execute and retrieve results via `getExecutionResult`.
4. Extract per-node execution data.

**When layer is `'both'`:** always run static analysis first. If static analysis finds errors, still proceed with execution. Execution provides stronger evidence and may reveal additional issues beyond what static analysis detected.

**Multi-path validation:** validate paths sequentially. Each path gets its own static analysis and execution pass. Future optimization (skipping execution on shared nodes across paths) is deferred.

### 9. Diagnostic synthesis

```
summary = diagnostics.synthesize(
  staticFindings,
  executionData,
  trustState,
  [guardrailDecision],
  resolvedTarget
)
```

### 10. Trust state update

After successful validation (`status: 'pass'`):

1. For each validated node (not mocked, not skipped): record trust with current content hash, run ID, timestamp, validation layer, and fixture hash.
2. Persist updated trust state via `persistTrustState`.

Trust is recorded only on pass. Failed, errored, or skipped validations do not update trust state.

### Snapshot management

After each successful validation, save the current `WorkflowGraph` as the previous snapshot for the next run. Stored in `.n8n-vet/`. The agent does not manage snapshots — this is automatic and internal.

## Error Conditions

| Condition | Behavior |
|-----------|----------|
| Workflow file not found | Diagnostic with `status: 'error'`. Tool failure. |
| Workflow parse error | Diagnostic with `status: 'error'`. Tool failure. |
| Target nodes not found | Diagnostic with `status: 'error'`. List missing node names. |
| Target resolution produces empty node set | Diagnostic with `status: 'error'` when `kind: 'nodes'` with empty list. For `kind: 'changed'` with no changes, pass empty target to guardrails — they will refuse with explanation. |
| Static analysis internal error | Raise error. Prerequisite for synthesis. No partial results. |
| Execution fails to start | Diagnostic with `status: 'error'`. Tool failure. |
| Execution returns node-level errors | Normal operation — `status: 'fail'`, not an internal error. Errors are classified by diagnostics. |

## Acceptance Criteria

- 10-step pipeline executes in correct order with no step reordering
- Workflow parsing handles `.ts` and `.json` via appropriate parser, errors produce `status: 'error'` diagnostic
- Trust state loading from `.n8n-vet/trust-state.json` with empty trust when entry is missing
- Change set computation with forward invalidation when previous snapshot or trust hash is available
- Approximate change detection via content hash comparison when only trust state (no full snapshot) is available
- Target resolution for all `AgentTarget` kinds: `nodes` (with existence verification), `changed` (RTS/TIA heuristic with forward/backward propagation), `workflow` (all nodes)
- Path selection uses 4-tier lexicographic preference (error outputs, output index 0, changed node count, untrusted boundary count) — not weighted scoring
- Multi-path additional-greedy selection: each subsequent path covers meaningful new elements
- Path enumeration capped at 20 candidates (tunable constant) with quick heuristic applied BEFORE full 4-tier ranking
- Empty target for `kind: 'nodes'` with empty list produces `status: 'error'` diagnostic; empty target for `kind: 'changed'` delegates to guardrails for refusal
- Guardrail decisions correctly route: `refuse` skips to synthesis with `status: 'skipped'`, `narrow` re-scopes target and re-selects paths, `redirect` changes effective layer, `warn` includes warning in summary, `proceed` passes through
- `force` flag overrides `overridable` guardrail decisions
- Static analysis runs before execution when layer is `'both'`; static errors do not prevent execution
- Execution strategy selection: `destinationNode` set uses bounded REST, `'workflow'` target uses MCP smoke, slice target computes furthest downstream as destination
- Trust updated only on `status: 'pass'`, only for validated (not mocked, not skipped) nodes
- Snapshot saved after successful validation in `.n8n-vet/`
- Multi-path validation runs sequentially with independent static and execution passes per path
- Integration tests wiring all subsystems with mocked subsystem interfaces (static-only pipeline, mock execution pipeline, guardrail routing for each action type)

## Decisions

1. **Snapshot management**: automatic, internal. Stored in `.n8n-vet/`. The agent never manages snapshots directly.
2. **Multi-path execution**: sequential. Each path gets its own validation pass. Optimization to skip shared-node re-execution is deferred to a future phase.
3. **Uniform target and layer**: no partial-static/partial-execution split within a single validation run. The resolved target and effective layer apply uniformly to all nodes in scope.
