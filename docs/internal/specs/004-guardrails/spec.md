# Feature Specification: Guardrail Evaluation Subsystem

**Feature Branch**: `004-guardrails`  
**Created**: 2026-04-18  
**Status**: Draft  
**Input**: User description: "Phase 4 guardrails from docs/prd/plan.md — the subsystem that evaluates validation requests and decides whether to proceed, warn, narrow, redirect, or refuse."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Evaluate a Validation Request (Priority: P1)

An agent submits a validation request targeting specific workflow nodes. The guardrail evaluator examines the request against the current trust state and change set, then returns a decision — proceed, warn, narrow, redirect, or refuse — with evidence explaining the rationale. The agent uses this decision to understand whether the validation is worth running and what scope it should cover.

**Why this priority**: This is the core function of the guardrails subsystem. Without the evaluation pipeline, none of the other guardrail behaviors exist. Every other story depends on this foundation.

**Independent Test**: Can be fully tested by passing a validation request, trust state, change set, and workflow graph to the evaluator and verifying the returned decision matches expectations. Delivers the core gating logic that prevents wasteful validation.

**Acceptance Scenarios**:

1. **Given** a validation request with a non-empty target and no special conditions, **When** the evaluator runs all checks, **Then** it returns `proceed` with fully populated evidence (changedNodes, trustedNodes, lastValidatedAt, fixtureChanged).
2. **Given** a validation request with `force: true`, **When** the evaluator runs, **Then** it skips all guardrail checks and returns `proceed` with evidence populated and the force bypass noted in the explanation.
3. **Given** a validation request whose target resolves to zero nodes, **When** the evaluator runs, **Then** it returns `refuse` with `overridable: false` and an explanation stating the target is empty.

---

### User Story 2 - Narrow Broad Scope to Changed Slice (Priority: P1)

An agent requests validation of the entire workflow (or a large region), but only a small subset of nodes actually changed. The guardrail evaluator detects the mismatch between scope and change, computes a narrowed target covering just the changed nodes plus their downstream dependents and backward context, and returns a `narrow` decision with the reduced target. The agent then validates only the narrowed scope instead of the full workflow.

**Why this priority**: Narrowing is the highest-value guardrail behavior — it directly prevents the most common agent failure mode (validating everything when only a small region changed). It delivers immediate cost savings on every broad request.

**Independent Test**: Can be tested by providing a workflow graph with many nodes, a change set affecting few nodes, and a broad validation target. Verify the narrowed target contains only the changed nodes, their downstream dependents, and backward context — and is always a subset of the original target.

**Acceptance Scenarios**:

1. **Given** a target with more than 5 nodes and fewer than 20% of target nodes have trust-breaking changes, **When** the evaluator runs, **Then** it returns `narrow` with a `narrowedTarget` containing the changed nodes plus forward-propagated and backward-context nodes, intersected with the original target.
2. **Given** a target with exactly 5 nodes and 1 changed node, **When** the evaluator runs, **Then** it returns `proceed` (not narrow), because the minimum node threshold for narrowing is "more than 5."
3. **Given** a target where the narrowed result would be the same size as the original, **When** the evaluator runs, **Then** it returns `proceed` (not narrow), because narrowing did not produce a smaller viable target.

---

### User Story 3 - Redirect Execution to Static Analysis (Priority: P1)

An agent requests execution-backed validation, but all changed nodes are structurally analyzable — no opaque nodes, no shape-replacing nodes with downstream expression dependence, no sub-workflow calls, no LLM validation, and no path ambiguity. The guardrail evaluator detects that static analysis alone would answer the validation question and redirects the request to the static layer, avoiding the cost of execution.

**Why this priority**: Redirect delivers the largest per-request cost savings by avoiding runtime execution entirely. It directly implements the "static-first" strategic principle and the testing-pyramid pattern.

**Independent Test**: Can be tested by constructing a change set where all modifications are to structurally analyzable nodes and verifying the evaluator returns `redirect` with `redirectedLayer: 'static'`. Also test that adding a single opaque node to the changed set blocks the redirect.

**Acceptance Scenarios**:

1. **Given** a request for `execution` or `both` layer where all changed nodes are shape-preserving or shape-augmenting with only structural change kinds, **When** the evaluator runs, **Then** it returns `redirect` with `redirectedLayer: 'static'`.
2. **Given** a request for `execution` layer where one changed node has classification `shape-opaque`, **When** the evaluator runs, **Then** the redirect is blocked and evaluation continues to the next guardrail check.
3. **Given** a request for `both` layer where a changed node is `shape-replacing` and a downstream node has a `$json` expression reference flowing through it, **When** the evaluator runs, **Then** the redirect is blocked.
4. **Given** a request for `static` layer only, **When** the evaluator runs, **Then** the redirect check is skipped entirely (redirect only applies when execution is requested).

---

### User Story 4 - Suppress Low-Value Reruns (Priority: P2)

An agent retries validation after a previous failure, but the changes made since the failure do not touch the failing path. The guardrail evaluator detects that the rerun is unlikely to produce new information about the failure and warns the agent, explaining that the prior failure path does not intersect the current changes.

**Why this priority**: Rerun suppression prevents one of the most wasteful agent behaviors — retrying the same failing validation without addressing the root cause. It is a warning (not a block), so it adds safety without preventing the agent from proceeding.

**Independent Test**: Can be tested by providing a prior run context with a failed status and a reconstructed failing path, along with a change set that does not intersect that path. Verify the evaluator returns `warn` with a DeFlaker-style explanation.

**Acceptance Scenarios**:

1. **Given** a prior run that failed with a reconstructable failing path, and the current changes do not intersect that path, and the failure is not classified as `external-service` or `platform`, **When** the evaluator runs, **Then** it returns `warn` explaining the prior failure may be unrelated to the current edit.
2. **Given** a prior run that failed but the failing path is not reconstructable (null), **When** the evaluator runs, **Then** the DeFlaker check is skipped.
3. **Given** a prior run that failed with a path that intersects the current changes, **When** the evaluator runs, **Then** the DeFlaker check does not trigger (changes address the failing area).
4. **Given** a prior run that failed with classification `external-service`, **When** the evaluator runs, **Then** the DeFlaker check does not trigger (external failures are not blamed on code changes).

---

### User Story 5 - Refuse Identical Reruns (Priority: P2)

An agent requests validation on a target where every node is already trusted, no trust-breaking changes exist, and the fixture hash matches the prior validation. The guardrail evaluator refuses the request, explaining that the rerun would produce no new information.

**Why this priority**: Identical-rerun refusal is the strongest guardrail action and prevents completely redundant work. It is the only refusal case and must be high-confidence — hash-based evidence proves zero information gain.

**Independent Test**: Can be tested by constructing a trust state where all target nodes are trusted with matching content hashes and fixture hashes, and verifying the evaluator returns `refuse` with `overridable: true`.

**Acceptance Scenarios**:

1. **Given** all target nodes are trusted, no trust-breaking changes exist in the target, and fixture hashes match, **When** the evaluator runs, **Then** it returns `refuse` with `overridable: true`.
2. **Given** all target nodes are trusted but one node has a trust-breaking change, **When** the evaluator runs, **Then** the identical-rerun check does not trigger.
3. **Given** all target nodes are trusted and unchanged but the fixture hash differs, **When** the evaluator runs, **Then** the identical-rerun check does not trigger.

---

### User Story 6 - Warn on Broad Target (Priority: P3)

An agent requests validation of a target that covers more than 70% of the workflow's nodes. The guardrail evaluator warns the agent that the target is unusually broad and suggests narrowing to the changed region.

**Why this priority**: Broad-target warning is a lightweight advisory guardrail. It does not block or modify the request — it simply flags that the scope is large relative to the workflow size.

**Independent Test**: Can be tested by providing a workflow graph and a target that covers more than 70% of nodes, and verifying the evaluator returns `warn`.

**Acceptance Scenarios**:

1. **Given** a workflow with 10 nodes and a target covering 8 of them, **When** the evaluator runs, **Then** it returns `warn` suggesting the agent narrow to the changed region.
2. **Given** a workflow with 10 nodes and a target covering 6 of them, **When** the evaluator runs, **Then** the broad-target check does not trigger (60% < 70% threshold).

---

### Edge Cases

- What happens when the trust state is empty (first run, no prior validation)? The evaluator uses an empty trust state — no nodes are trusted. Identical-rerun cannot trigger. Narrowing uses an empty trusted set. This is correct initialization, not an error.
- What happens when the change set computation fails upstream? The evaluator raises an error. The change set is a prerequisite — the evaluator cannot produce a meaningful decision without it.
- What happens when a narrowing seed set is non-empty but forward/backward propagation reaches every node in the original target? The narrowed target equals the original target, so narrowing does not trigger (no size reduction).
- What happens when `force: true` is set alongside conditions that would normally refuse? Force bypasses all checks — the evaluator returns `proceed` regardless.
- What happens when multiple guardrail actions could trigger? The evaluation order is fixed and deterministic. The first non-proceed action wins. Tier 1 (preconditions) is evaluated before Tier 2 (guardrail actions).
- What happens when a prior run's cached diagnostic summary is missing or corrupt? The DeFlaker check is skipped (prior run context is unavailable). This is not an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept a validation request (target, layer, force flag), trust state, change set, and workflow graph as inputs and return a guardrail decision.
- **FR-002**: System MUST evaluate guardrails in a fixed, deterministic order: Tier 1 precondition checks (force flag, empty target, identical rerun) then Tier 2 guardrail actions (redirect, narrow, DeFlaker warn, broad-target warn, proceed). First non-proceed action wins.
- **FR-003**: System MUST bypass all guardrail checks when `force: true` and return `proceed` with full evidence and the bypass noted in the explanation.
- **FR-004**: System MUST refuse requests whose target resolves to zero nodes with `overridable: false`.
- **FR-005**: System MUST refuse identical reruns (all target nodes trusted, no trust-breaking changes, matching fixture hash) with `overridable: true`.
- **FR-006**: System MUST redirect execution requests to static-only when all of these hold: no changed node is shape-opaque, no changed node is shape-replacing with downstream `$json` expression dependence, no changed node is a sub-workflow call, no LLM/agent output validation is requested, no path ambiguity exists, and changes are limited to structurally analyzable kinds.
- **FR-007**: System MUST narrow the validation scope when the target contains more than 5 nodes, fewer than 20% of target nodes have trust-breaking changes, and the narrowed result is smaller than the original target.
- **FR-008**: System MUST compute narrowed targets using: seed (changed nodes) + forward propagation (to target boundary or trusted unchanged node) + backward context (to trusted unchanged node or trigger) — intersected with the original target.
- **FR-009**: System MUST warn when a prior run failed, the failing path is reconstructable, the failing path does not intersect current changes, and the failure classification is not `external-service` or `platform`.
- **FR-010**: System MUST warn when the target covers more than 70% of the workflow's total nodes.
- **FR-011**: System MUST populate `GuardrailEvidence` (changedNodes, trustedNodes, lastValidatedAt, fixtureChanged) for every decision, including `proceed`.
- **FR-012**: System MUST define threshold constants as named values (not magic numbers): minimum target size for narrowing, maximum changed ratio for narrowing, and broad-target warning ratio.
- **FR-013**: System MUST source prior run context from the most recent cached diagnostic summary stored alongside the trust state. When no cached summary exists, the DeFlaker check is skipped.
- **FR-014**: System MUST evaluate redirect escalation triggers by inspecting node classifications, downstream expression dependence, sub-workflow call types, and branching-node path ambiguity.
- **FR-015**: System MUST treat narrowed targets as always non-empty (they contain at least the seed nodes) and always report them as `kind: 'slice'`.

### Key Entities

- **GuardrailDecision**: The output of the evaluation pipeline. A discriminated union of five possible actions (proceed, warn, narrow, redirect, refuse), each carrying an explanation, evidence, and overridable flag.
- **GuardrailEvidence**: Accompanies every decision. Contains changed nodes, trusted nodes, last validation timestamp, and fixture-change indicator for the evaluated target.
- **PriorRunContext**: Derived from the most recent cached diagnostic summary. Contains whether the prior run failed, the failing path (if reconstructable), and the failure classification.
- **EscalationAssessment**: The result of evaluating redirect escalation triggers. Contains whether any trigger fired and which specific triggers activated.
- **Threshold Constants**: Named, tunable constants governing narrowing and broad-target warning behavior (minimum target size, maximum changed ratio, broad-target ratio).

## Assumptions

- Trust state and change set are computed correctly by the Trust & Change subsystem (Phase 3) before being passed to the guardrail evaluator. The evaluator does not recompute or validate them.
- The workflow graph is well-formed (nodes exist, edges reference valid nodes). Graph construction validation happens in Static Analysis (Phase 2).
- Node classifications are assigned during static analysis and are available on each `GraphNode` in the workflow graph.
- Expression references (including `$json` dependencies) are traced during static analysis and available for redirect escalation-trigger evaluation.
- The prior run's diagnostic summary, when available, is a structurally valid cached artifact. If missing or corrupt, the DeFlaker check is simply skipped.
- All guardrail evaluation is purely local — it operates on in-memory data structures and does not require network access or an n8n instance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Given a workflow-scoped validation request where only 2 out of 15 nodes changed, the evaluator narrows the target to fewer than 8 nodes (changed + dependents + context) in under 50ms.
- **SC-002**: Given a request for execution-backed validation where all changes are to shape-preserving nodes with structural change kinds, the evaluator redirects to static-only 100% of the time.
- **SC-003**: Given a fully trusted, unchanged target with matching fixture hashes, the evaluator refuses the rerun 100% of the time.
- **SC-004**: The evaluation pipeline produces deterministic results — the same inputs always produce the same decision, regardless of invocation order or timing.
- **SC-005**: Every decision returned by the evaluator includes fully populated evidence (no null or missing fields in changedNodes, trustedNodes, lastValidatedAt, fixtureChanged).
- **SC-006**: The force flag bypasses all guardrail logic and returns `proceed` 100% of the time, regardless of trust state or change conditions.
- **SC-007**: Pipeline test scenarios covering all 8 evaluation steps (force, empty target, identical rerun, redirect, narrow, DeFlaker warn, broad-target warn, proceed) all pass, each exercising a distinct behavior not covered by other tests.
