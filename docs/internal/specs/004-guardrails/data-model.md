# Data Model: Guardrail Evaluation Subsystem

**Date**: 2026-04-18  
**Feature**: 004-guardrails

## Shared Types (already exist in `src/types/`)

These types are consumed but not modified by the guardrails subsystem.

### GuardrailDecision (output)
- **Location**: `src/types/guardrail.ts`
- Discriminated union on `action`: `'proceed'` | `'warn'` | `'narrow'` | `'redirect'` | `'refuse'`
- Base fields: `explanation: string`, `evidence: GuardrailEvidence`, `overridable: boolean`
- `narrow` variant adds: `narrowedTarget: ValidationTarget`
- `redirect` variant adds: `redirectedLayer: ValidationLayer`

### GuardrailEvidence (output component)
- **Location**: `src/types/guardrail.ts`
- `changedNodes: NodeIdentity[]`
- `trustedNodes: NodeIdentity[]`
- `lastValidatedAt: string | null`
- `fixtureChanged: boolean`

### Input Types (from upstream subsystems)
- **WorkflowGraph**: `src/types/graph.ts` — nodes map, forward/backward adjacency, displayNameIndex
- **TrustState**: `src/types/trust.ts` — per-node trust records keyed by NodeIdentity
- **NodeChangeSet**: `src/types/trust.ts` — added, removed, modified (with ChangeKind[]), unchanged
- **ValidationTarget**: `src/types/target.ts` — discriminated union: nodes, changed, workflow, slice, path
- **ValidationLayer**: `src/types/target.ts` — `'static'` | `'execution'` | `'both'`
- **DiagnosticSummary**: `src/types/diagnostic.ts` — prior run output (optional, for DeFlaker check)
- **ExpressionReference**: `src/static-analysis/types.ts` — parsed expression with referencedNode/fieldPath

---

## Internal Types (new, in `src/guardrails/types.ts`)

### PriorRunContext
Derived from an optional `DiagnosticSummary`. Used by the DeFlaker rerun check.

| Field | Type | Description |
|-------|------|-------------|
| `failed` | `boolean` | Whether the prior run's status was `'fail'` |
| `failingPath` | `NodeIdentity[] \| null` | Node identities from the prior run's executed path, or null if not reconstructable |
| `failureClassification` | `ErrorClassification \| null` | Classification of the first error, or null if no errors |

### EscalationAssessment
Result of evaluating redirect escalation triggers.

| Field | Type | Description |
|-------|------|-------------|
| `triggered` | `boolean` | Whether any escalation trigger holds |
| `reasons` | `string[]` | Human-readable descriptions of which triggers fired |

### EvaluationInput
Bundled input to the evaluation pipeline.

| Field | Type | Description |
|-------|------|-------------|
| `target` | `ValidationTarget` | The resolved validation target |
| `targetNodes` | `Set<NodeIdentity>` | Concrete node set from the resolved target |
| `layer` | `ValidationLayer` | Requested evidence layer |
| `force` | `boolean` | Force flag — bypass all guardrails |
| `trustState` | `TrustState` | Current trust state |
| `changeSet` | `NodeChangeSet` | Diff between workflow versions |
| `graph` | `WorkflowGraph` | Current workflow graph |
| `currentHashes` | `Map<NodeIdentity, string>` | Content hashes for all target nodes |
| `priorSummary` | `DiagnosticSummary \| null` | Most recent cached diagnostic summary |
| `expressionRefs` | `ExpressionReference[]` | Expression references for target nodes |
| `llmValidationRequested` | `boolean` | Whether the agent explicitly requested LLM/agent output validation |

### Threshold Constants
Named constants (not a type — module-level `const` values).

| Constant | Value | Description |
|----------|-------|-------------|
| `NARROW_MIN_TARGET_NODES` | `5` | Minimum target size for narrowing to apply (target must have **more than** this) |
| `NARROW_MAX_CHANGED_RATIO` | `0.2` | Maximum ratio of changed nodes to target nodes for narrowing (must be **less than** this) |
| `BROAD_TARGET_WARN_RATIO` | `0.7` | Target node ratio to total workflow nodes that triggers a broad-target warning (must be **more than** this) |

---

## Entity Relationships

```
EvaluationInput
  ├── ValidationTarget ──→ Set<NodeIdentity> (targetNodes)
  ├── TrustState ──→ Map<NodeIdentity, NodeTrustRecord>
  ├── NodeChangeSet ──→ added/removed/modified/unchanged NodeIdentity[]
  ├── WorkflowGraph ──→ Map<string, GraphNode> + forward/backward adjacency
  ├── DiagnosticSummary? ──→ PriorRunContext (derived)
  └── ExpressionReference[] (from traceExpressions)

evaluate(EvaluationInput) → GuardrailDecision
  ├── GuardrailEvidence (always populated)
  ├── narrowedTarget? (narrow action only)
  └── redirectedLayer? (redirect action only)

Narrowing: seed(changedNodes) → BFS forward/backward → intersect(originalTarget) → SliceDefinition
Redirect: changedNodes → EscalationAssessment → redirect or continue
DeFlaker: DiagnosticSummary → PriorRunContext → warn or continue
```

---

## State Transitions

The guardrail evaluator is stateless — it is a pure function that takes inputs and returns a decision. There are no state transitions within the subsystem itself. Trust state mutations happen in the trust subsystem (Phase 3); diagnostic summary persistence happens in the orchestrator (Phase 7).
