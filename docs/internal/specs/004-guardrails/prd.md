# Phase 4 — Guardrails

## Goal

Implement the guardrail evaluator: the subsystem that receives a validation request and decides whether to proceed, warn, narrow, redirect, or refuse. This is core product identity — it prevents agent thrash by gating every validation request through a fixed evaluation order that prefers the cheapest sufficient action.

## Context Files

| File | Role |
|------|------|
| `docs/reference/INDEX.md` | Shared type definitions (`GuardrailDecision`, `GuardrailAction`, `GuardrailEvidence`, `WorkflowGraph`, `NodeChangeSet`, `TrustState`, `ValidationTarget`, `ValidationLayer`, `NodeClassification`) |
| `docs/CODING.md` | TypeScript rules — fail-fast, contract-driven, no fallbacks, no over-engineering |
| `docs/CONCEPTS.md` | Shared vocabulary — guardrail, trusted boundary, low-value rerun, bounded validation, validation locality |
| `docs/STRATEGY.md` | Guardrail philosophy, escalation heuristic, guardrail action order, DeFlaker-style relevance, rerun suppression, static-execution escalation |

## Scope

**In scope:**
- Guardrail evaluation function that accepts a validation request with trust state, change set, and graph, and returns a `GuardrailDecision`
- Fixed evaluation order: precondition checks (tier 1), then guardrail actions (tier 2)
- Force flag bypass
- Empty-target refusal
- Identical-rerun refusal (hash-based)
- Execution-to-static redirect when static analysis suffices
- Scope narrowing when broad target has narrow changes
- DeFlaker-style warn when prior failure path does not intersect changes
- Broad-target warn
- Evidence assembly for every decision
- Narrowing algorithm (changed nodes + forward/backward propagation within original target)
- Redirect escalation-trigger evaluation
- Named threshold constants

**Out of scope:**
- How request interpretation calls guardrails (Phase 7)
- How diagnostics reports guardrail decisions (Phase 6)
- Internal behavior of trust computation or change detection (Phase 3)
- Learning from agent behavior (post-v1)
- User-configurable thresholds (post-v1)

## Inputs and Outputs

### Inputs

**Validation request** — contains:
- `target`: resolved `ValidationTarget` (the nodes under consideration)
- `layer`: `ValidationLayer` (`'static'` | `'execution'` | `'both'`)
- `force`: `boolean` — when true, bypass all guardrails

**TrustState** — per-workflow trust state with per-node `NodeTrustRecord` entries (content hash, validation layer, fixture hash, timestamp).

**NodeChangeSet** — diff result: `added`, `removed`, `modified` (with `ChangeKind[]`), `unchanged` node lists.

**WorkflowGraph** — `nodes` map (`Map<string, GraphNode>`) with `forward` and `backward` adjacency (`Map<string, Edge[]>`).

### Output

**GuardrailDecision** — discriminated union:
- `{ action: 'proceed'; explanation; evidence; overridable }` — no guardrail triggered
- `{ action: 'warn'; explanation; evidence; overridable }` — advisory, validation continues
- `{ action: 'narrow'; narrowedTarget: ValidationTarget; explanation; evidence; overridable }` — reduced scope
- `{ action: 'redirect'; redirectedLayer: ValidationLayer; explanation; evidence; overridable }` — cheaper layer suffices
- `{ action: 'refuse'; explanation; evidence; overridable }` — high-confidence no-value request

Every decision includes `GuardrailEvidence`: `changedNodes`, `trustedNodes`, `lastValidatedAt`, `fixtureChanged`.

## Internal Types

```typescript
/** Tunable threshold constants. Defined as named constants, not magic numbers. */
const NARROW_MIN_TARGET_NODES = 5;
const NARROW_MAX_CHANGED_RATIO = 0.2;
const BROAD_TARGET_WARN_RATIO = 0.7;

/** Prior run context for DeFlaker-style warn evaluation. */
interface PriorRunContext {
  /** Whether the prior run failed. */
  failed: boolean;

  /** Node identities on the failing path, if reconstructable. */
  failingPath: NodeIdentity[] | null;

  /** Classification of the prior failure. */
  failureClassification: ErrorClassification | null;
}

/** Escalation trigger evaluation result for redirect logic. */
interface EscalationAssessment {
  /** Whether any escalation trigger holds. */
  triggered: boolean;

  /** Which specific triggers fired (for explanation text). */
  reasons: string[];
}
```

## Upstream Interface Summary

**NodeClassification** (string union on `GraphNode.classification`):
- `'shape-preserving'` — forwards input items unchanged (If, Switch, Merge, NoOp, Wait). Safe to reason about statically; does not alter data shape.
- `'shape-augmenting'` — adds fields to input items, may drop fields depending on config (Set/Edit Fields). Statically analyzable with parameter inspection.
- `'shape-replacing'` — replaces `$json` entirely with data from an external source (HTTP Request, API nodes, DB nodes). Downstream expressions depending on its output cannot be statically verified. Triggers execution escalation only when downstream has `$json` expression dependence through it.
- `'shape-opaque'` — output shape unknowable statically (Code, Function, AI Transform). Always triggers execution escalation.

**TrustState + NodeTrustRecord**: a node is trusted when it has a `NodeTrustRecord` in the current `TrustState` AND its current content hash matches the record's `contentHash`. Trust is per-node, keyed by `NodeIdentity`.

**NodeChangeSet**: result of comparing two workflow snapshots. `added` / `removed` / `modified` (each `NodeModification` carries `ChangeKind[]`: `'parameter'`, `'expression'`, `'connection'`, `'type-version'`, `'credential'`, `'execution-setting'`, `'position-only'`, `'metadata-only'`) / `unchanged`. Trust-breaking changes are all kinds except `'position-only'` and `'metadata-only'`.

**WorkflowGraph**: `nodes: Map<string, GraphNode>` with `forward: Map<string, Edge[]>` (source to outgoing edges) and `backward: Map<string, Edge[]>` (destination to incoming edges). Provides the adjacency structure needed for forward/backward propagation in the narrowing algorithm.

## Behavior

### 1. Evaluation order

Fixed order. First non-proceed action wins. Two tiers.

**Tier 1 — Precondition checks (hard stops):**

1. **Force flag** — if `force` is true, skip all remaining checks. Return `{ action: 'proceed' }` with full evidence. Noted in explanation for diagnostic summary consumption.

2. **Empty target** — if the resolved target contains zero nodes, return `{ action: 'refuse', explanation: 'Target resolves to zero nodes — nothing to validate.' }`. `overridable: false`.

3. **Identical rerun** — if ALL of: every node in target is trusted, no trust-breaking changes exist in target, and fixture hash matches the prior validation's fixture hash, return `{ action: 'refuse', explanation: 'All target nodes are trusted with unchanged fixtures — rerun would produce no new information.' }`. `overridable: true`.

**Tier 2 — Guardrail actions (first match wins):**

4. **Redirect: execution to static** — when the requested layer is `'execution'` or `'both'`, and static analysis alone would suffice. ALL of the following must be true:
   - Layer is `'execution'` or `'both'`
   - No changed node has classification `'shape-opaque'`
   - No changed node has classification `'shape-replacing'` WITH downstream `$json` expression dependence through it
   - No changed node is a sub-workflow call (`n8n-nodes-base.executeWorkflow`)
   - No explicit LLM/agent output validation request
   - No path ambiguity: no branching node whose condition depends on runtime data from an opaque or shape-replacing source
   - Changes are limited to structurally analyzable kinds: `'expression'`, `'parameter'`, `'connection'`, `'type-version'`, `'credential'` (all statically analyzable — they change what a node does but not in ways that require runtime evidence)

   When all conditions hold: return `{ action: 'redirect', redirectedLayer: 'static' }` with explanation describing why static suffices.

   **Path ambiguity**: a branching node (If, Switch) whose condition depends on runtime data flowing from a shape-opaque or shape-replacing source. The branch outcome cannot be determined statically.

5. **Narrow: broad scope with narrow change** — ALL must be true:
   - Target contains more than `NARROW_MIN_TARGET_NODES` nodes (> 5)
   - Fewer than `NARROW_MAX_CHANGED_RATIO` of target nodes have trust-breaking changes (< 20%)
   - The union of changed nodes + downstream propagation + backward context forms a smaller viable target than the original

   When all conditions hold: compute the narrowed target (see narrowing algorithm below) and return `{ action: 'narrow', narrowedTarget }` with explanation identifying the reduced scope.

6. **Warn: DeFlaker-style failure relevance** — ALL must be true:
   - A prior run for this target failed (`PriorRunContext.failed`)
   - The prior failing path is reconstructable (`PriorRunContext.failingPath` is non-null)
   - Changed nodes do not intersect the prior failing path
   - The prior failure classification is not `'external-service'` or `'platform'`

   **Prior run context sourcing:** `PriorRunContext` is derived from the most recent `DiagnosticSummary` cached alongside the trust state in `.n8n-vet/`. When a validation run completes, the diagnostic summary is persisted. On the next run, the guardrail evaluator reads this cached summary to extract the prior run's failure status, failing path (from `executedPath`), and error classification. If no cached summary exists (first run), the DeFlaker check is skipped (condition 1 cannot be met).

   When all conditions hold: return `{ action: 'warn', explanation: 'Prior failure path does not intersect current changes — failure may be unrelated to this edit.' }`.

7. **Warn: broad target** — the target is the entire workflow OR covers more than `BROAD_TARGET_WARN_RATIO` of all workflow nodes (> 70%).

   When triggered: return `{ action: 'warn', explanation: 'Target covers a large portion of the workflow. Consider narrowing to the changed region.' }`.

8. **Proceed** — no guardrail triggered. Return `{ action: 'proceed' }` with full evidence.

### 2. Refusal as strongest action

Refusal is reserved for high-confidence cases where hash-based evidence proves the run would produce no new information. Prefer narrowing or redirection over blocking when the request has partial value.

### 3. Override mechanism

`force: true` skips all guardrail checks. All-or-nothing — there is no per-rule override. The force bypass is noted in the `explanation` field so the diagnostic summary can report it.

### 4. Evidence assembly

Every `GuardrailDecision` includes a populated `GuardrailEvidence`:
- `changedNodes`: nodes in the target with trust-breaking changes (from `NodeChangeSet.added` + `modified` with trust-breaking `ChangeKind`)
- `trustedNodes`: nodes in the target with valid, current trust records (from `TrustState.nodes` where content hash matches)
- `lastValidatedAt`: most recent `validatedAt` timestamp across trusted nodes in the target, or `null` if none are trusted
- `fixtureChanged`: true if any trusted node's `fixtureHash` differs from the current fixture hash

Evidence is populated for every decision, including `proceed`. It is never omitted or partially filled.

### 5. Narrowing algorithm

1. **Seed**: start with changed nodes (trust-breaking changes within the original target).
2. **Forward propagation**: walk forward through `WorkflowGraph.forward` adjacency from seed nodes to the edge of the original target boundary or the nearest trusted node with unchanged content (where `isTrusted` returns true AND `contentHash` matches — i.e., `contentUnchanged` is true), whichever is reached first.
3. **Backward context**: walk backward through `WorkflowGraph.backward` adjacency from seed nodes to the nearest trusted node with unchanged content or trigger node.
4. **Narrowed target**: the union of seed + forward + backward nodes, intersected with the original target's node set.

The narrowed target is always non-empty (it contains at least the seed nodes, which exist because narrowing only triggers when changes exist). Reported as `kind: 'slice'` in the `narrowedTarget`.

### 6. Redirect logic — escalation triggers

Redirect from execution to static is blocked when ANY of these escalation triggers holds:

- A changed node has classification `'shape-opaque'`
- A changed node has classification `'shape-replacing'` AND a downstream node has a `$json` expression reference that flows through the shape-replacing node
- A changed node is a sub-workflow call (`type === 'n8n-nodes-base.executeWorkflow'`)
- The request explicitly targets LLM/agent output validation
- A branching node's condition depends on runtime data from a shape-opaque or shape-replacing source (path ambiguity)

The distinction between "any shape-replacing change" and "shape-replacing with downstream `$json` sensitivity" is significant. A shape-replacing node whose downstream consumers do not reference its output fields via `$json` does not require execution escalation — static analysis can verify the structural change without runtime data.

### 7. Calibration

The threshold constants (`NARROW_MIN_TARGET_NODES = 5`, `NARROW_MAX_CHANGED_RATIO = 0.2`, `BROAD_TARGET_WARN_RATIO = 0.7`) are tunable defaults, not architecture. They are defined as named constants, instrumented for trigger-frequency observation, and adjusted based on real workflow data. They are not user-configurable in v1.

## Error Conditions

| Condition | Behavior |
|-----------|----------|
| Trust state unavailable (first run, no prior validation) | Use empty trust state (no nodes trusted). Guardrails are permissive — identical-rerun check cannot trigger, narrowing uses empty trusted set. Correct initialization, not an error. |
| Change set computation fails | Raise error. The change set is a prerequisite for guardrail evaluation. Cannot proceed without it. |
| Target resolution produces empty or malformed graph | Raise error. This is a tool failure upstream of guardrails. |

## Acceptance Criteria

- Force flag bypasses all guardrails and returns proceed with evidence populated
- Empty target produces refuse with `overridable: false`
- Identical rerun (all nodes trusted, no trust-breaking changes, matching fixture hash) produces refuse with `overridable: true`
- Execution redirect triggers when all changed nodes are structurally analyzable (no opaque, no shape-replacing with downstream `$json` dependence, no sub-workflow calls, no LLM validation, no path ambiguity)
- Redirect is blocked when a changed node is shape-opaque
- Redirect is blocked when a changed node is shape-replacing with downstream `$json` expression dependence
- Redirect is blocked when a changed node is a sub-workflow call
- Narrowing reduces scope to changed + downstream + backward context when < 20% of target nodes changed and target > 5 nodes
- Narrowed target is always a subset of the original target and always non-empty
- DeFlaker warn triggers when prior failure path is reconstructable, does not intersect changes, and failure is not external-service or platform
- Broad target warn triggers at > 70% node coverage of the workflow
- Evidence (`changedNodes`, `trustedNodes`, `lastValidatedAt`, `fixtureChanged`) is populated for every decision including proceed
- Thresholds are defined as named constants (`NARROW_MIN_TARGET_NODES`, `NARROW_MAX_CHANGED_RATIO`, `BROAD_TARGET_WARN_RATIO`), not magic numbers
- Evaluation order is deterministic: first non-proceed action wins, tier 1 before tier 2
- Pipeline tests exercise evaluation order in context (force bypass, empty target, identical rerun, redirect, narrow, warn, proceed)
- No n8n instance required — all evaluation is local, operating on in-memory data structures

## Decisions

1. **Multi-path guardrails**: evaluate against the union of all paths as a single target. Do not evaluate guardrails per-path.
2. **Redirect for mixed changes**: do not split the target between static and execution layers. If any escalation trigger holds for any changed node, the entire target gets execution. No partial redirect.
3. **Learning from agent behavior**: deferred to post-v1. The guardrail evaluator does not adapt based on prior agent decisions or override patterns.
