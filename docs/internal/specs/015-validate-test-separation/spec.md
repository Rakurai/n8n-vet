# Feature Specification: Validate / Test Tool Separation

**Feature Branch**: `015-validate-test-separation`  
**Created**: 2026-04-19  
**Status**: Draft  
**Input**: User description: "read docs/prd/validate-test-separation.md and then the docs it references. spec the work please"

## User Scenarios & Testing

### User Story 1 - Agent validates a workflow after editing (Priority: P1)

An agent edits a local `.workflow.ts` file and calls `validate` to check structural correctness. The tool runs static analysis only -- no n8n instance is needed, no `layer` parameter exists. The agent receives a diagnostic summary with `evidenceBasis: 'static'`.

**Why this priority**: This is the most common operation in the development loop. Every code change triggers a validate call. Removing the `layer` parameter from `validate` is the core behavioral change that enforces the strategic separation.

**Independent Test**: Can be fully tested by calling `validate` on any workflow file and confirming that (a) no `layer` parameter is accepted, (b) passing `layer` produces a clear error, (c) the response always has `evidenceBasis: 'static'`.

**Acceptance Scenarios**:

1. **Given** a local `.workflow.ts` file with edits, **When** the agent calls `validate({ kind: 'changed', workflowPath })`, **Then** the tool returns a `DiagnosticSummary` with `evidenceBasis: 'static'` and no execution occurs.
2. **Given** a `validate` call with `layer: 'execution'`, **When** the tool processes the request, **Then** it returns an error explaining that `layer` is not a valid parameter (not silent acceptance).
3. **Given** a `validate` call with `layer: 'both'`, **When** the tool processes the request, **Then** it returns the same clear error about `layer` being removed.

---

### User Story 2 - Agent tests a deployed workflow (Priority: P1)

After pushing a workflow to n8n with `n8nac push`, the agent calls the new `test` tool to run execution-backed validation. The tool requires `metadata.id` in the workflow file (evidence of a prior push) and a live n8n MCP connection. It returns a diagnostic summary with `evidenceBasis: 'execution'`.

**Why this priority**: This is the other half of the core separation. Without a dedicated `test` tool, execution-backed validation cannot exist as a distinct operation. The tool name itself acts as a guardrail, forcing the agent to consciously decide to cross from validation into testing.

**Independent Test**: Can be tested by calling `test` on a pushed workflow (with `metadata.id`) and confirming execution occurs, then calling `test` on a workflow without `metadata.id` and confirming a precondition error.

**Acceptance Scenarios**:

1. **Given** a pushed workflow with `metadata.id` and a live n8n MCP connection, **When** the agent calls `test({ kind: 'changed', workflowPath })`, **Then** the tool executes the workflow and returns a `DiagnosticSummary` with `evidenceBasis: 'execution'`.
2. **Given** a workflow file without `metadata.id`, **When** the agent calls `test`, **Then** the tool returns `{ type: 'precondition_error', message: 'Workflow has no metadata.id -- push with n8nac first.' }`.
3. **Given** no n8n MCP connection available, **When** the agent calls `test`, **Then** the tool returns `{ type: 'configuration_error', message: 'n8n MCP connection not available -- configure n8n_host and n8n_mcp_token.' }`.
4. **Given** a pushed workflow, **When** the agent calls `test` with `pinData`, **Then** the tool uses the provided pin data to mock upstream node outputs during execution.

---

### User Story 3 - Guardrail refuses unnecessary test calls (Priority: P1)

When the agent calls `test` and all changes are structurally analyzable (no escalation triggers fire), the guardrail refuses the call with an explanation: "All changes are structurally analyzable -- use validate instead." The agent can override with `force: true`.

**Why this priority**: This is the replacement for the old redirect guardrail and is core to the product's identity. A visible refusal that requires conscious override is a stronger guardrail than a silent redirect. Without this, agents will habitually call `test` after every push regardless of need.

**Independent Test**: Can be tested by calling `test` on a workflow where all changed nodes are structurally analyzable and confirming refusal, then retrying with `force: true` and confirming execution proceeds.

**Acceptance Scenarios**:

1. **Given** a workflow where all changed nodes are structurally analyzable, **When** the agent calls `test({ kind: 'changed', workflowPath })`, **Then** the tool refuses with explanation "All changes are structurally analyzable -- use validate instead" and `status: 'skipped'`.
2. **Given** the same workflow, **When** the agent calls `test({ kind: 'changed', workflowPath, force: true })`, **Then** the tool proceeds with execution despite no escalation triggers.
3. **Given** a workflow with an opaque Code node that changed, **When** the agent calls `test`, **Then** the escalation trigger fires and the tool proceeds normally (no refusal).

---

### User Story 4 - Agent uses explain to preview guardrail decisions (Priority: P2)

The agent calls `explain` with a `tool` parameter (`'validate'` or `'test'`) to preview what guardrails would decide, without actually running validation or testing. The `layer` parameter is removed; the `tool` parameter replaces it.

**Why this priority**: The explain tool supports agent decision-making but is not on the critical path. It's important for the complete experience but secondary to the core validate/test separation.

**Independent Test**: Can be tested by calling `explain` with `tool: 'validate'` and `tool: 'test'` on the same workflow and confirming different guardrail evaluations (e.g., test-refusal appears only for `tool: 'test'`).

**Acceptance Scenarios**:

1. **Given** a workflow, **When** the agent calls `explain({ workflowPath, tool: 'test' })`, **Then** the tool returns guardrail evaluation results including test-refusal assessment.
2. **Given** a workflow, **When** the agent calls `explain({ workflowPath, tool: 'validate' })`, **Then** the tool returns guardrail evaluation with no test-refusal (since that guardrail only applies to `test`).
3. **Given** an `explain` call with the old `layer` parameter, **When** the tool processes the request, **Then** it returns a clear error.

---

### User Story 5 - Documentation guides agent to three-step lifecycle (Priority: P2)

SKILL.md, CONCEPTS.md, STRATEGY.md, and PRD.md are updated to reflect the validate-push-test lifecycle. An agent reading the updated SKILL.md understands that `validate` and `test` are separate tools at different lifecycle points, with `n8nac push` between them.

**Why this priority**: Documentation shapes agent reasoning. Incorrect or legacy framing causes agents to conflate validation and testing regardless of the tool surface. However, the code changes must land first for the documentation to be accurate.

**Independent Test**: Can be verified by reading the updated documents and confirming: SKILL.md shows separate tool tables, no `layer` parameter, and a three-step lifecycle; CONCEPTS.md distinguishes "validation run" from "test run"; STRATEGY.md refers to testing as a separate step.

**Acceptance Scenarios**:

1. **Given** the updated SKILL.md, **When** an agent reads the "When to validate" and "When to test" sections, **Then** it finds two separate tables with distinct guidance for each tool.
2. **Given** the updated CONCEPTS.md, **When** an agent reads the definitions, **Then** "validation run" and "test run" are defined as separate concepts with different characteristics.
3. **Given** the updated STRATEGY.md, **When** an agent reads section 5, **Then** it refers to testing as a separate development step, not a "validation layer."

---

### User Story 6 - Trust records use separate evidence types (Priority: P2)

When a node passes static validation, a trust record is created with `validatedWith: 'static'`. When a node passes execution testing, a separate trust record is created with `validatedWith: 'execution'`. The `'both'` value no longer exists. The field is renamed from `validationLayer` to `validatedWith`.

**Why this priority**: The trust model change is necessary for correctness but is an internal concern. The agent-facing impact is minimal since trust querying remains evidence-agnostic (checks content hash only).

**Independent Test**: Can be tested by running `validate` on a workflow and checking that resulting trust records have `validatedWith: 'static'`, then running `test` and checking for `validatedWith: 'execution'`. Confirm no `'both'` value exists in any type or output.

**Acceptance Scenarios**:

1. **Given** a successful `validate` call, **When** trust records are updated, **Then** affected nodes have `validatedWith: 'static'`.
2. **Given** a successful `test` call, **When** trust records are updated, **Then** affected nodes have `validatedWith: 'execution'`.
3. **Given** any trust record in the system, **When** its `validatedWith` field is inspected, **Then** it contains only `'static'` or `'execution'`, never `'both'`.

---

### Edge Cases

- What happens when an agent passes the removed `layer` parameter to `validate`? The tool returns a clear, descriptive error -- not silent acceptance or unexpected behavior.
- What happens when an agent passes the removed `layer` parameter to `explain`? Same clear error behavior.
- What happens when `test` is called on a workflow with `metadata.id` but the n8n instance is unreachable? A `configuration_error` is returned, not a hang or timeout without explanation.
- What happens when `test` is called with `kind: 'workflow'` and `force: true`? Execution proceeds even though the broad target would normally trigger narrowing warnings, since `force` overrides all guardrails.
- What happens when trust records exist with the old `validationLayer` field name? Migration or backward compatibility handling is needed for existing trust state files.
- What happens when an agent passes `pinData` to `validate`? The tool returns a clear error -- pin data is only accepted by `test`.
- What happens when `explain` is called with `tool: 'test'` but no MCP connection is available? The explain tool reports precondition status (MCP unavailable, metadata.id presence) as part of the guardrail evaluation, without attempting execution.

## Requirements

### Functional Requirements

- **FR-001**: The `validate` tool MUST NOT accept a `layer` parameter. Passing `layer` MUST produce a clear, descriptive error.
- **FR-002**: A new `test` tool MUST exist that executes deployed workflows against a live n8n instance via MCP.
- **FR-003**: The `test` tool MUST require `metadata.id` in the workflow file. Missing `metadata.id` MUST produce a `precondition_error`.
- **FR-004**: The `test` tool MUST require an active n8n MCP connection. Missing connection MUST produce a `configuration_error`.
- **FR-005**: The `test` tool MUST accept `kind`, `workflowPath`, `nodes`, `force`, and `pinData` parameters.
- **FR-006**: The `explain` tool MUST NOT accept a `layer` parameter. Passing `layer` MUST produce a clear error.
- **FR-007**: The `explain` tool MUST accept a `tool` parameter (`'validate' | 'test'`) defaulting to `'validate'`.
- **FR-008**: The redirect guardrail (current Step 3 in `evaluate.ts`, after empty-target refuse at Step 2) MUST be replaced with a test-refusal guardrail that refuses `test` calls when no escalation triggers fire. The codebase step order is: (1) force bypass, (2) empty target refuse, (3) redirect [becomes test-refusal], (4) narrow, (5) DeFlaker warn, (6) broad-target warn, (7) identical-rerun refuse, (8) proceed.
- **FR-009**: The test-refusal message MUST read "All changes are structurally analyzable -- use validate instead."
- **FR-010**: The `force: true` parameter MUST override the test-refusal guardrail.
- **FR-011**: The `GuardrailDecision` type MUST NOT contain a `'redirect'` action variant or `redirectedLayer` field.
- **FR-012**: `NodeTrustRecord` MUST use field name `validatedWith` (not `validationLayer`) with values `'static' | 'execution'` only.
- **FR-013**: The `'both'` value MUST NOT exist in any type, parameter, or output (`ValidationLayer`, `DiagnosticSummary.evidenceBasis`, `NodeAnnotation`, trust reports).
- **FR-014**: Each tool invocation MUST produce exactly one `DiagnosticSummary` with exactly one `evidenceBasis` value.
- **FR-015**: The `validate` tool MUST always produce `evidenceBasis: 'static'`. The `test` tool MUST always produce `evidenceBasis: 'execution'`.
- **FR-016**: The CLI MUST add a `test` command, remove `--layer` from `validate` and `explain`, and add `--tool` to `explain`.
- **FR-017**: SKILL.md MUST present `validate` and `test` as separate tools with separate parameter tables and describe a three-step lifecycle: validate, push, test.
- **FR-018**: CONCEPTS.md MUST define "validation run" and "test run" as separate concepts.
- **FR-019**: STRATEGY.md section 5 MUST describe testing as a separate development step, not a validation layer.
- **FR-020**: PRD.md section 8.0.2 MUST describe validation and testing as separate operations with separate tools.
- **FR-021**: All existing tests MUST be updated. No test may reference `'both'`, `redirectedLayer`, or the removed `layer` parameter.
- **FR-022**: Trust persistence MUST read legacy `validationLayer` fields and treat them as `validatedWith`. Old `'both'` values MUST map to `'execution'`. New writes MUST use `validatedWith` only.
- **FR-023**: `TrustedNodeInfo` (in `surface.ts`) MUST rename `validationLayer` to `validatedWith` with type `ValidationEvidence`.
- **FR-024**: `validate` MUST NOT accept a `pinData` parameter. Pin data is only meaningful for execution and belongs to `test`.
- **FR-025**: When `explain` is called with `tool: 'test'`, the guardrail evaluation MUST report MCP availability and `metadata.id` presence as precondition status, even though `explain` does not execute.
- **FR-026**: When `test` is called, static analysis runs internally for graph building, target resolution, and trust computation, but static findings MUST NOT appear in the diagnostic output. The diagnostic output reflects execution evidence only.

### Key Entities

- **ValidationEvidence**: Replaces `ValidationLayer`. Values: `'static' | 'execution'`. Represents what kind of evidence confirmed a validation result.
- **GuardrailDecision**: Discriminated union of guardrail outcomes. Loses the `'redirect'` variant and `redirectedLayer` field. Retains `proceed`, `warn`, `narrow`, and `refuse`.
- **NodeTrustRecord**: Per-node trust state. Field `validationLayer` renamed to `validatedWith` with values `'static' | 'execution'`.
- **DiagnosticSummary**: Validation/test result envelope. `evidenceBasis` narrows from `'static' | 'execution' | 'both'` to `'static' | 'execution'`.
- **TrustedNodeInfo**: Surface type for trust status reports. Field `validationLayer` renamed to `validatedWith` with type `ValidationEvidence`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Agent development workflow follows a three-step lifecycle (validate, push, test) with no ability to collapse validation and testing into a single tool call.
- **SC-002**: 100% of `validate` calls return `evidenceBasis: 'static'` with no execution side effects.
- **SC-003**: 100% of `test` calls either return `evidenceBasis: 'execution'` or produce a clear error (precondition, configuration, or guardrail refusal).
- **SC-004**: When an agent calls `test` on a workflow where all changes are structurally analyzable, the tool refuses and directs the agent to use `validate` instead -- unless `force: true` is set.
- **SC-005**: No `'both'` value appears in any type definition, tool parameter, tool output, trust record, or diagnostic summary across the entire codebase.
- **SC-006**: All existing tests pass after the migration with no references to removed concepts (`'both'`, `redirectedLayer`, `layer` parameter on validate/explain).
- **SC-007**: An agent reading the updated SKILL.md can correctly determine which tool to use (validate vs test) for any given development situation without ambiguity.

## Assumptions

- Existing trust state files with the old `validationLayer` field name will need migration. The trust persistence layer handles reading old records and writing new ones with `validatedWith`.
- The escalation trigger logic in `redirect.ts` (`assessEscalationTriggers`) is preserved unchanged -- only the action taken when no triggers fire changes (from redirect to refuse).
- The response envelope (`McpResponse<DiagnosticSummary>`) remains unchanged. Only the contents of the summary change (narrower `evidenceBasis` values).
- The `n8nac push` step remains outside n8n-vet's scope. n8n-vet does not orchestrate or invoke n8nac.
- The `availableInMCP` pre-flight check (currently in `interpret.ts`) moves to the `test` path only. `validate` never needs it.

## Dependencies

- The n8n MCP connection infrastructure (already implemented in Phase 011) is required for the `test` tool.
- The escalation trigger assessment logic (already implemented in `redirect.ts`) is reused by the test-refusal guardrail.

## Risks

- **Agent habit inertia**: Agents trained on the old SKILL.md may continue attempting to pass `layer` parameters. Mitigation: clear error messages that explain the new model and point to the correct tool.
- **Trust state migration**: Existing `.trust.json` files contain the old `validationLayer` field. Mitigation: the trust persistence layer reads both old and new field names during a transition period.
