# Feature Specification: Diagnostic Synthesis

**Feature Branch**: `006-diagnostics`  
**Created**: 2026-04-18  
**Status**: Draft  
**Input**: User description: "Phase 6 — Diagnostics: Synthesize all evidence into a DiagnosticSummary"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Static-Only Validation Summary (Priority: P1)

An agent runs a static-only validation against a workflow slice and receives a compact, structured diagnostic summary that tells it: the overall status (pass/fail), what was validated, any errors classified by type, and per-node annotations showing which nodes were validated, trusted, or skipped.

**Why this priority**: This is the most common validation path. Static analysis is the default first layer, and the diagnostic summary is the only output the agent sees. Without this, no validation run produces usable results.

**Independent Test**: Can be fully tested by providing fixture static findings and trust state, then verifying the output summary has correct status, errors, annotations, and structure.

**Acceptance Scenarios**:

1. **Given** a set of static findings with no error-severity items, **When** synthesis runs, **Then** the summary has `status: 'pass'`, empty `errors` array, and `evidenceBasis: 'static'`.
2. **Given** a set of static findings where one finding has `severity: 'error'` and `kind: 'data-loss'`, **When** synthesis runs, **Then** the summary has `status: 'fail'`, one error with `classification: 'wiring'`, and the error includes the node and message from the finding.
3. **Given** static findings with `severity: 'warning'`, **When** synthesis runs, **Then** the warnings appear in the `hints` array (not in `errors`) with `severity: 'warning'`.

---

### User Story 2 - Execution-Backed Validation Summary (Priority: P1)

An agent runs an execution-backed validation and receives a diagnostic summary that includes execution errors classified by type, the executed path with node ordering, and combined evidence from both static and execution layers.

**Why this priority**: Execution-backed validation is the other core validation mode. The summary must correctly classify n8n runtime errors and reconstruct the execution path so agents can pinpoint failures.

**Independent Test**: Can be tested by providing fixture execution data alongside static findings and verifying error classification, path reconstruction, and error ordering.

**Acceptance Scenarios**:

1. **Given** execution data where a node failed with a `NodeApiError` (httpCode 500), **When** synthesis runs, **Then** the error is classified as `external-service` and appears before any static errors in the output.
2. **Given** execution data with multiple nodes that executed successfully, **When** synthesis runs, **Then** `executedPath` contains nodes sorted by `executionIndex` ascending with correct `sourceOutput` values.
3. **Given** both static findings (1 error) and execution errors (1 error) for the same node, **When** synthesis runs, **Then** both errors appear in the output (no deduplication) with the execution error ordered first.

---

### User Story 3 - Node Annotation Assignment (Priority: P2)

An agent receives a diagnostic summary where every in-scope node has an annotation explaining its role in the validation: whether it was actively validated, trusted from prior runs, replaced with mock data, or skipped.

**Why this priority**: Annotations are how agents understand the coverage and confidence level of a validation run. Without them, the agent cannot distinguish between "tested and passed" and "skipped because unchanged."

**Independent Test**: Can be tested by providing a resolved target with known nodes, a trust state with some nodes previously validated, and verifying each node gets the correct annotation status and reason string.

**Acceptance Scenarios**:

1. **Given** a node that changed since last validation and was included in this run, **When** annotations are assigned, **Then** the node receives `status: 'validated'` with reason indicating the change.
2. **Given** a node in scope that is unchanged and has a trust record, **When** annotations are assigned, **Then** the node receives `status: 'trusted'` with reason including the validation timestamp.
3. **Given** a node that was replaced with pin data during execution, **When** annotations are assigned, **Then** the node receives `status: 'mocked'` with reason indicating the pin data source.

---

### User Story 4 - Guardrail Action Reporting (Priority: P2)

An agent's validation request was narrowed or redirected by guardrails, and the diagnostic summary clearly reports what guardrail actions were taken and why, so the agent understands the scope difference between what it requested and what was actually validated.

**Why this priority**: Guardrail transparency is a core product principle. Agents must understand when and why the system changed their request to maintain trust and make informed follow-up decisions.

**Independent Test**: Can be tested by providing guardrail decisions with various actions and verifying they appear in the summary's `guardrailActions` array with correct detail.

**Acceptance Scenarios**:

1. **Given** a guardrail decision with `action: 'narrow'` and a `narrowedTarget`, **When** synthesis runs, **Then** the decision appears in `guardrailActions` and the summary's `target` reflects the narrowed scope.
2. **Given** a guardrail decision with `action: 'refuse'`, **When** synthesis runs, **Then** the summary has `status: 'skipped'` and the decision's explanation is accessible.

---

### User Story 5 - Execution Error Classification via contextKind (Priority: P3)

An agent receives a diagnostic summary where execution errors from serialized n8n error data (lacking constructor names) are correctly classified using the `contextKind` discriminant, including the fallback to `external-service` for API errors without an httpCode.

**Why this priority**: Serialized errors are common in real n8n execution results. Without contextKind-based classification, many execution errors would be classified as `unknown`, reducing the agent's ability to diagnose issues.

**Independent Test**: Can be tested with fixture execution errors using each `contextKind` variant and verifying the classification output.

**Acceptance Scenarios**:

1. **Given** an execution error with `contextKind: 'api'` and `httpCode: 401`, **When** classified, **Then** it receives `classification: 'credentials'`.
2. **Given** an execution error with `contextKind: 'api'` and no `httpCode`, **When** classified, **Then** it receives `classification: 'external-service'`.
3. **Given** an execution error with `contextKind: 'cancellation'`, **When** classified, **Then** it receives `classification: 'cancelled'`.
4. **Given** an execution error with `contextKind: 'other'`, **When** classified, **Then** it receives `classification: 'unknown'`.

---

### Edge Cases

- What happens when execution data is provided but a node's structural data is missing during path reconstruction? The system raises an error (retrieval bug, not recoverable).
- What happens when execution data is redacted for a node? A `DiagnosticHint` with `severity: 'danger'` is emitted per affected node, and the error is classified using `contextKind`.
- What happens when all guardrail decisions are `refuse`? Status is `skipped` regardless of any findings in other evidence.
- What happens when static findings and execution data both exist but neither contains errors? Status is `pass` with `evidenceBasis: 'both'`.
- What happens when the summary exceeds ~150 JSON lines? This is a diagnostic smell to investigate, not a hard limit.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST determine a single top-level status (`pass`, `fail`, `error`, `skipped`) by evaluating conditions in priority order: refuse-guardrail check, then error-free check, then error-present check, then infrastructure failure.
- **FR-002**: System MUST classify static findings into `DiagnosticError` entries using the kind-to-classification mapping: `data-loss`/`broken-reference`/`invalid-parameter`/`schema-mismatch` to `wiring`, `missing-credentials` to `credentials`, `unresolvable-expression` to `expression`.
- **FR-003**: System MUST classify execution errors using constructor name when available, following the n8n error hierarchy (e.g., `ExpressionError` to `expression`, `NodeApiError` with httpCode 5xx to `external-service`).
- **FR-004**: System MUST classify serialized execution errors (no constructor name) using the `contextKind` discriminant: `api` applies httpCode logic (falling back to `external-service` when httpCode is absent), `cancellation` to `cancelled`, `expression` to `expression`, `other` to `unknown`.
- **FR-005**: System MUST order errors by: execution before static, error-severity before warning-severity, earliest failing node first (by `executionIndex`).
- **FR-006**: System MUST reconstruct the executed path from execution data sorted by `executionIndex` ascending, including `sourceOutput` from `source.previousNodeOutput`.
- **FR-007**: System MUST raise an error when path reconstruction encounters missing structural data in execution results (not a recoverable condition).
- **FR-008**: System MUST assign a `NodeAnnotation` to every node in the resolved target's scope with status (`validated`, `trusted`, `mocked`, `skipped`) and a human-readable reason string.
- **FR-009**: System MUST include all `GuardrailDecision` entries in the output's `guardrailActions` array. Narrowed decisions carry the `narrowedTarget` on the decision itself; the pre-narrowing scope is conveyed by the decision's `evidence` (which includes the original changed/trusted node lists) and `explanation` field.
- **FR-010**: System MUST report static warnings as `DiagnosticHint` entries with `severity: 'warning'`, not as errors.
- **FR-011**: System MUST collect execution runtime hints as `DiagnosticHint` entries without deduplication within a single run.
- **FR-012**: System MUST emit a `DiagnosticHint` with `severity: 'danger'` for each node with redacted execution data.
- **FR-013**: System MUST report available capabilities (`staticAnalysis: true`, `restApi: boolean`, `mcpTools: boolean`) in the summary.
- **FR-014**: System MUST include `schemaVersion: 1` in every `DiagnosticSummary`.
- **FR-015**: System MUST include run metadata (`runId`, `executionId`, `partialExecution`, `timestamp`, `durationMs`) in the summary's `meta` field.
- **FR-016**: System MUST set `evidenceBasis` based on which layers contributed data: `'static'` when executionData is null, `'execution'` when staticFindings is empty, `'both'` when both executionData is non-null and staticFindings is non-empty.
- **FR-017**: System MUST produce compact output. Typical summaries (static-only, 5 nodes, no errors) SHOULD be ~30-40 JSON lines. Exceeding ~150 lines is a diagnostic smell requiring investigation.

### Key Entities

- **DiagnosticSummary**: The canonical output of every validation run. Contains status, target, evidence basis, errors, path, annotations, guardrail actions, hints, capabilities, and metadata.
- **DiagnosticError**: A classified error with type, message, description, node, classification (discriminated union), and classification-specific context.
- **NodeAnnotation**: Per-node status assignment (validated/trusted/mocked/skipped) with reason string explaining why.
- **DiagnosticHint**: A per-node advisory message with severity (info/warning/danger).
- **PathNode**: A node in the reconstructed execution path with execution index and source output.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every validation run produces exactly one `DiagnosticSummary` with a deterministic status for any given set of inputs.
- **SC-002**: Error classification accuracy: 100% of static findings map to the correct classification per the defined mapping table; 100% of execution errors with known constructor names or contextKind map to the correct classification per the defined hierarchy.
- **SC-003**: Agents can determine the next action (fix, rerun, expand scope, or stop) from the summary alone without inspecting raw execution logs or static analysis output.
- **SC-004**: Typical static-only summaries (5 nodes, no errors) fit within 40 JSON lines; execution-backed summaries (8 nodes, 1 error) fit within 100 JSON lines.
- **SC-005**: All nodes in the resolved target receive annotations. No node in scope is left without a status and reason.
- **SC-006**: All unit tests pass using fixture evidence data with no dependency on a running n8n instance.

## Assumptions

- Static findings arrive as `StaticFinding[]` conforming to the discriminated union defined in the static analysis spec (Phase 2).
- Execution data arrives as `ExecutionData | null` conforming to the execution spec (Phase 5), with per-node results accessible by node name.
- Trust state arrives as a `TrustState` with per-node records conforming to INDEX.md definitions.
- Guardrail decisions arrive as `GuardrailDecision[]` conforming to the discriminated union in INDEX.md.
- The resolved target provides the concrete list of in-scope nodes. Diagnostics does not resolve targets itself.
- Error constructor names may or may not be available in serialized execution data; the `contextKind` fallback path is the expected norm for production use.
