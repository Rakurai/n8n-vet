# Research: Guardrail Evaluation Subsystem

**Date**: 2026-04-18  
**Feature**: 004-guardrails

## Research Summary

No NEEDS CLARIFICATION items were found in the Technical Context. The guardrail evaluator is a pure in-memory subsystem with well-defined inputs/outputs and no external dependencies. Research focused on validating upstream API availability and confirming design decisions.

---

## 1. Upstream API Availability

**Decision**: All required upstream APIs exist in the current codebase.

**Rationale**: Direct inspection of the source confirms:
- `traceExpressions()` in `src/static-analysis/expressions.ts` — returns `ExpressionReference[]` with `referencedNode` and `fieldPath`, sufficient for redirect escalation trigger evaluation (downstream `$json` dependence check).
- `isTrusted()` in `src/trust/trust.ts` — checks trust record existence + content hash match. Used by narrowing (forward propagation stops at trusted unchanged nodes).
- `getRerunAssessment()` in `src/trust/trust.ts` — evaluates trust-level rerun conditions (all trusted, fixture hash match). Can be reused directly for the identical-rerun precondition check.
- `computeContentHash()` in `src/trust/hash.ts` — needed to compute current hashes for trust queries.
- All shared types (`GuardrailDecision`, `GuardrailEvidence`, `WorkflowGraph`, `NodeChangeSet`, `TrustState`, `ValidationTarget`, `ValidationLayer`, `NodeClassification`, `NodeIdentity`, `ExpressionReference`, `DiagnosticSummary`, `ErrorClassification`) exist in `src/types/`.

**Alternatives considered**: None — the APIs are already built and tested.

---

## 2. Prior Run Context Sourcing

**Decision**: `PriorRunContext` is derived from a `DiagnosticSummary` passed as an optional argument to the evaluator, not read from disk.

**Rationale**: The evaluator is a pure function with no side effects. Disk I/O for loading the cached diagnostic summary belongs to the orchestrator (Phase 7). The evaluator accepts an optional `DiagnosticSummary | null` and extracts `PriorRunContext` from it. This keeps the evaluator testable without filesystem mocking.

Fields extracted from `DiagnosticSummary`:
- `failed`: `summary.status === 'fail'`
- `failingPath`: `summary.executedPath` (already typed as `PathNode[] | null`)
- `failureClassification`: first error's `classification` field from `summary.errors[0]`

**Alternatives considered**: 
- Read cached summary from disk inside the evaluator → rejected (violates pure-function constraint, harder to test)
- Accept pre-built `PriorRunContext` as input → adds a type the orchestrator must construct; deriving from `DiagnosticSummary` is simpler since the type already exists

---

## 3. Expression Dependence Check for Redirect

**Decision**: Use `traceExpressions()` on downstream nodes of shape-replacing changed nodes to check for `$json` references flowing through them.

**Rationale**: The redirect escalation trigger asks: "does a downstream node have a `$json` expression reference that flows through the shape-replacing node?" This requires:
1. Identifying changed nodes with `shape-replacing` classification
2. Walking forward from each through `WorkflowGraph.forward`
3. For each downstream node, checking if any `ExpressionReference` with `referencedNode === null` (implicit `$json`) or `referencedNode` pointing to/through the shape-replacing node exists

The existing `ExpressionReference` type has `referencedNode` (resolved upstream) and `fieldPath`. For implicit `$json` references (Pattern 1: `$json.field`), `referencedNode` is `null` — meaning the reference depends on the immediate upstream node's output. If the immediate upstream path passes through a shape-replacing node, the dependency exists.

**Alternatives considered**:
- Full data-flow analysis → overkill; simple graph walk + expression check suffices
- Reuse `data-loss.ts` detection → that module checks for data-loss bugs specifically; the redirect check has different semantics (any `$json` sensitivity, not just loss)

---

## 4. Narrowing Algorithm Graph Traversal

**Decision**: BFS forward and backward from seed nodes, stopping at trusted-unchanged nodes or target boundaries.

**Rationale**: The narrowing algorithm is a bounded BFS:
- **Forward**: from changed nodes through `WorkflowGraph.forward`, stop at (a) nodes outside the original target, (b) trusted nodes with unchanged content hash
- **Backward**: from changed nodes through `WorkflowGraph.backward`, stop at (a) trigger nodes (nodes with no incoming edges), (b) trusted nodes with unchanged content hash, (c) nodes outside the original target
- **Result**: union of seed + forward + backward, intersected with original target

This is structurally similar to the BFS in `invalidateTrust()` in `src/trust/trust.ts`, but with different stopping conditions (trust-based vs. exhaustive).

**Alternatives considered**: None — BFS is the natural choice for bounded graph propagation.

---

## 5. Path Ambiguity Detection for Redirect

**Decision**: A branching node (If/Switch) has path ambiguity when its condition parameters contain expression references that resolve to (or flow through) a shape-opaque or shape-replacing source.

**Rationale**: Path ambiguity means "the branch outcome cannot be determined statically." This occurs when:
1. The node is shape-preserving with branching semantics (If, Switch — type `n8n-nodes-base.if`, `n8n-nodes-base.switch`)
2. Its condition parameters reference data from upstream nodes
3. Those upstream nodes include a shape-opaque or shape-replacing node in the data flow path

Detection: trace expressions on the branching node's parameters, check if any resolved reference traces back to a shape-opaque or shape-replacing node via backward graph walk.

**Alternatives considered**:
- Treat all branching nodes as path-ambiguous → too conservative; many If nodes branch on static or structurally-analyzable conditions
- Full symbolic evaluation of conditions → overkill for v1
