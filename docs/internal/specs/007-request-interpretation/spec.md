# Feature Specification: Request Interpretation

**Feature Branch**: `007-request-interpretation`  
**Created**: 2026-04-19  
**Status**: Draft  
**Input**: User description: "read docs/prd/plan.md and spec phase 7 request interpretation. make sure to read all context docs in the prd. use number 007"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent validates changed nodes (Priority: P1)

An agent has modified one or more nodes in an n8n workflow and wants to validate just the affected region. The agent submits a validation request with `target: { kind: 'changed' }`. The orchestrator loads the workflow, detects what changed since the last validation, computes the affected slice using forward/backward propagation, selects the best path through that slice, consults guardrails, runs static analysis (and optionally execution), and returns a compact diagnostic summary.

**Why this priority**: This is the primary use case — change-driven validation is the product's core value proposition and the most common agent interaction.

**Independent Test**: Can be fully tested with two workflow snapshots (before/after a node edit) and a static-only validation layer, verifying the orchestrator produces a correct diagnostic summary for the changed slice.

**Acceptance Scenarios**:

1. **Given** a workflow with a previous snapshot and one modified node, **When** the agent requests `target: { kind: 'changed' }, layer: 'static'`, **Then** the orchestrator computes the change set, resolves the affected slice, runs static analysis on the selected path, and returns a diagnostic summary with `status: 'pass'` or `status: 'fail'` reflecting the static findings.
2. **Given** a workflow with a previous snapshot and three modified nodes with downstream dependents, **When** the agent requests `target: { kind: 'changed' }, layer: 'both'`, **Then** the slice includes the modified nodes and their downstream dependents, static analysis runs first, execution follows, and the diagnostic summary includes evidence from both layers.
3. **Given** a workflow with no previous snapshot, **When** the agent requests `target: { kind: 'changed' }`, **Then** all nodes are treated as new (no trust, no change signal), and guardrails evaluate the request with an empty change set.

---

### User Story 2 - Agent validates specific named nodes (Priority: P1)

An agent wants to validate specific nodes by name — perhaps nodes it just created or is debugging. The agent submits a request with `target: { kind: 'nodes', nodes: [...] }`. The orchestrator verifies all named nodes exist in the graph, computes a slice around them, selects paths, and proceeds through the pipeline.

**Why this priority**: This is the second most common use case — targeted validation of known nodes provides precise control for the agent.

**Independent Test**: Can be tested by providing a workflow and a list of node names, verifying correct slice computation and diagnostic output.

**Acceptance Scenarios**:

1. **Given** a workflow with nodes A, B, C, D, **When** the agent requests `target: { kind: 'nodes', nodes: ['B', 'C'] }`, **Then** the orchestrator resolves the slice around B and C (including upstream/downstream context), selects paths, runs validation, and returns a diagnostic summary scoped to the relevant region.
2. **Given** a workflow, **When** the agent requests `target: { kind: 'nodes', nodes: ['NonExistent'] }`, **Then** the orchestrator returns a diagnostic with `status: 'error'` listing the missing node name.
3. **Given** a workflow, **When** the agent requests `target: { kind: 'nodes', nodes: [] }`, **Then** the orchestrator returns a diagnostic with `status: 'error'` indicating an empty target.

---

### User Story 3 - Agent validates entire workflow (Priority: P2)

An agent requests a whole-workflow validation (smoke test). The orchestrator targets all nodes, but guardrails evaluate the request and may warn about breadth, narrow to the changed subset, or redirect to static-only analysis.

**Why this priority**: Whole-workflow validation is a valid but discouraged use case — it exists for smoke tests and broad sanity checks, but guardrails actively steer toward narrower validation.

**Independent Test**: Can be tested by submitting a workflow-scoped request and verifying guardrail interaction (warning, narrowing, or pass-through).

**Acceptance Scenarios**:

1. **Given** a large workflow with 20 nodes where only 3 changed, **When** the agent requests `target: { kind: 'workflow' }`, **Then** guardrails narrow the target to the changed slice and the diagnostic summary reports the narrowing action.
2. **Given** a workflow where all nodes are new (no trust), **When** the agent requests `target: { kind: 'workflow' }`, **Then** guardrails warn about breadth but allow the validation to proceed, and the diagnostic summary includes the breadth warning.
3. **Given** a workflow-scoped request with `force: true`, **When** guardrails would normally narrow the target, **Then** the narrowing is overridden (if overridable) and the full workflow is validated.

---

### User Story 4 - Guardrail routing shapes validation (Priority: P2)

The orchestrator consults guardrails before running validation. Guardrail decisions (refuse, narrow, redirect, warn, proceed) alter what validation actually runs. The agent receives the guardrail action as part of the diagnostic summary so it understands why validation was shaped differently from what was requested.

**Why this priority**: Guardrail routing is essential to the product's identity — it's what makes n8n-vet a guardrailed validation tool rather than a simple test runner.

**Independent Test**: Can be tested by simulating each guardrail action type and verifying the orchestrator routes correctly.

**Acceptance Scenarios**:

1. **Given** a request where guardrails return `refuse` (e.g., identical rerun with no changes), **When** the orchestrator processes the request, **Then** validation is skipped and the diagnostic summary has `status: 'skipped'` with the refusal explanation.
2. **Given** a request where guardrails return `redirect` (e.g., execution requested but static suffices), **When** the orchestrator processes the request, **Then** the effective layer changes to `'static'` and no execution runs.
3. **Given** a request where guardrails return `narrow`, **When** the orchestrator processes the request, **Then** the resolved target is replaced with the narrowed target, path selection re-runs on the narrowed slice, and the diagnostic summary reports the narrowing.

---

### User Story 5 - Trust state persists across validations (Priority: P2)

After a successful validation (status: 'pass'), the orchestrator updates trust records for validated nodes and saves the current workflow snapshot. On the next validation, previously trusted unchanged nodes are treated as stable boundaries, reducing the scope of validation.

**Why this priority**: Trust persistence is the mechanism that makes bounded validation practical over time — without it, every validation starts from scratch.

**Independent Test**: Can be tested by running two sequential validations and verifying that the second validation reuses trust from the first for unchanged nodes.

**Acceptance Scenarios**:

1. **Given** a first validation that passes for nodes A, B, C, **When** the agent modifies node C and requests `target: { kind: 'changed' }`, **Then** nodes A and B retain trust, the change set shows only C as modified, and validation focuses on C and its downstream dependents.
2. **Given** a validation that fails (`status: 'fail'`), **When** the orchestrator processes the result, **Then** trust state is NOT updated — no new trust records are created for any node.
3. **Given** a workflow with existing trust state, **When** a node's content hash changes, **Then** trust is invalidated for that node and forward-propagated to its downstream dependents.

---

### User Story 6 - Multi-path validation covers distinct paths (Priority: P3)

When a slice contains multiple meaningful paths (e.g., through branching nodes), the orchestrator uses additional-greedy selection to validate paths that collectively cover the most changed and untrusted elements, without redundantly re-validating shared nodes.

**Why this priority**: Multi-path coverage is important for branching workflows but is an optimization over single-path validation — the core product works with single-path selection.

**Independent Test**: Can be tested with a branching workflow fixture where multiple paths through a slice cover different changed nodes, verifying that additional paths are selected only when they add meaningful new coverage.

**Acceptance Scenarios**:

1. **Given** a slice with two candidate paths where path A covers changed nodes {X, Y} and path B covers changed nodes {Y, Z}, **When** path selection runs, **Then** path A is selected first (covers 2 changed nodes), then path B is selected (covers 1 new changed node Z), and both are validated sequentially.
2. **Given** a slice with three candidate paths where path C adds no new coverage beyond paths A and B, **When** path selection runs, **Then** path C is not selected.

---

### Edge Cases

- What happens when the workflow file does not exist or is unreadable? The orchestrator returns a diagnostic with `status: 'error'` indicating a tool failure.
- What happens when the workflow fails to parse (malformed `.ts` or `.json`)? The orchestrator returns a diagnostic with `status: 'error'` indicating a parse failure.
- What happens when path enumeration exceeds the 20-candidate cap? A quick heuristic (fewest error outputs, then fewest total nodes) selects the top 20 candidates before full 4-tier ranking runs.
- What happens when execution fails to start (n8n unreachable, auth failure)? The orchestrator returns a diagnostic with `status: 'error'` indicating a tool failure.
- What happens when the trust state file is corrupt or missing? The orchestrator starts with empty trust (no trusted nodes, no connections hash).
- What happens when `target: { kind: 'changed' }` finds no changes? The target is empty, and guardrails refuse with an explanation.
- What happens when `layer: 'both'` and static analysis finds errors? Execution still proceeds — execution provides stronger evidence and may reveal additional issues.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST execute a 10-step sequential pipeline in strict order: parse workflow, load trust state, compute change set, resolve target, consult guardrails, run validation, synthesize diagnostics, update trust state, persist snapshot, return summary.
- **FR-002**: System MUST parse `.ts` workflow files via the TypeScript parser and `.json` files via the JSON-to-AST parser, producing a `WorkflowGraph`.
- **FR-003**: System MUST load trust state from `.n8n-vet/trust-state.json`, starting with empty trust when no entry exists for the current workflow.
- **FR-004**: System MUST compute a change set when a previous snapshot or trust state with a prior hash is available, applying forward-only trust invalidation through downstream nodes.
- **FR-005**: System MUST support approximate change detection via content hash comparison when only trust state (no full snapshot) is available.
- **FR-006**: System MUST resolve `target: { kind: 'nodes' }` by verifying each named node exists in the graph and returning `status: 'error'` for missing nodes.
- **FR-007**: System MUST resolve `target: { kind: 'changed' }` using the RTS/TIA heuristic: forward-propagate from trust-breaking changes to trusted boundaries or workflow exit, backward-walk to the nearest trigger or trusted boundary.
- **FR-008**: System MUST resolve `target: { kind: 'workflow' }` to all nodes in the graph.
- **FR-009**: System MUST select paths using 4-tier lexicographic preference: (1) prefer non-error-output paths, (2) prefer output-index-0 on branching nodes, (3) prefer more changed-node coverage, (4) prefer more untrusted-boundary coverage.
- **FR-010**: System MUST cap path enumeration at 20 candidates (tunable constant), applying a quick heuristic (fewest error outputs, then fewest total nodes) to select the top 20 BEFORE full 4-tier ranking.
- **FR-011**: System MUST support multi-path selection using additional-greedy: after selecting the best path, update covered elements, re-rank remaining paths by newly covered elements, and select additional paths only when they cover meaningful new elements.
- **FR-012**: System MUST route based on guardrail decisions: `refuse` skips to synthesis with `status: 'skipped'`; `narrow` replaces the target and re-runs path selection; `redirect` changes the effective layer; `warn` includes the warning in the summary; `proceed` passes through unchanged.
- **FR-013**: System MUST honor the `force` flag to override `overridable` guardrail decisions.
- **FR-014**: System MUST run static analysis before execution when `layer: 'both'`, and static errors MUST NOT prevent execution from proceeding.
- **FR-015**: System MUST select execution strategy based on context: bounded REST execution when `destinationNode` is set, whole-workflow MCP execution when target is `'workflow'`, and bounded REST with computed furthest-downstream destination when target is a slice.
- **FR-016**: System MUST update trust state only on `status: 'pass'`, only for validated nodes (not mocked, not skipped), recording content hash, run ID, timestamp, validation layer, and fixture hash.
- **FR-017**: System MUST save a snapshot of the current workflow graph after each successful validation for use in future change detection.
- **FR-018**: System MUST validate multiple paths sequentially, with independent static analysis and execution passes per path.
- **FR-019**: System MUST support `destinationNode` with `'inclusive'` and `'exclusive'` modes, controlling whether the destination node itself executes.
- **FR-020**: System MUST record a path selection reason for each selected path, included in the diagnostic summary for transparency.

### Key Entities

- **ValidationRequest**: The agent's input — specifies workflow path, target, layer, force flag, pin data, and destination node configuration.
- **InterpretedRequest**: The orchestrator's internal resolved state — contains the concrete resolved target, guardrail decision, effective layer, parsed graph, change set, and trust state after invalidation.
- **ResolvedTarget**: The concrete set of nodes and their description, produced by target resolution and potentially modified by guardrail narrowing.
- **WorkflowGraph**: The traversable graph representation of the parsed workflow — central data structure for all analysis.
- **TrustState**: Per-workflow trust records tracking what has been validated and the evidence supporting that trust.
- **NodeChangeSet**: The diff between two workflow snapshots, classifying nodes as added, removed, modified, or unchanged.
- **GuardrailDecision**: The guardrail evaluation result — determines whether validation proceeds, is narrowed, redirected, warned, or refused.
- **DiagnosticSummary**: The canonical validation output — compact, structured, machine-readable summary of all validation evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A change-driven validation request (`target: 'changed'`) completes end-to-end (all 10 pipeline steps) and returns a correct diagnostic summary within 5 seconds for static-only validation of a 50-node workflow.
- **SC-002**: The orchestrator correctly reuses trust from a prior successful validation — a second validation of a workflow with one changed node validates only the affected slice (changed node + downstream), not the entire workflow.
- **SC-003**: All five guardrail actions (refuse, narrow, redirect, warn, proceed) correctly alter the validation pipeline behavior as specified, verified by distinct test scenarios for each action type.
- **SC-004**: Path selection produces deterministic, reproducible results — the same workflow state and request always produces the same selected paths in the same order.
- **SC-005**: Multi-path selection covers at least 90% of changed nodes across a branching workflow slice, using the fewest paths necessary (additional-greedy property).
- **SC-006**: Error conditions (missing file, parse failure, missing nodes, execution failure) produce structured diagnostics with `status: 'error'` — never unhandled exceptions.
- **SC-007**: Trust state persists correctly across validation runs — a pass updates trust, a failure does not, and subsequent validations reflect the correct trust state without manual intervention.
- **SC-008**: The orchestrator correctly integrates all upstream subsystem interfaces (static analysis, trust and change, guardrails, execution, diagnostics) — each subsystem is called with correct inputs and its outputs are correctly consumed.
