# Feature Specification: MCP Surface and CLI

**Feature Branch**: `008-mcp-surface-cli`  
**Created**: 2026-04-19  
**Status**: Draft  
**Input**: User description: "Phase 8 MCP surface — agent-facing MCP server and developer-facing CLI entry points for n8n-vet"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent validates a workflow via MCP (Priority: P1)

A coding agent working on an n8n workflow calls the `validate` MCP tool to check whether its recent changes are correct. The agent provides a workflow file path and optionally specifies which nodes changed, the validation layer, and whether to force past guardrails. The tool returns a structured diagnostic summary the agent can parse and act on.

**Why this priority**: This is the core use case — the entire product exists to give agents structured validation feedback. Without this, there is no product.

**Independent Test**: Can be tested by invoking the MCP server's `validate` tool with a workflow path and verifying that a well-formed `McpResponse<DiagnosticSummary>` is returned.

**Acceptance Scenarios**:

1. **Given** a running MCP server and a valid workflow file, **When** the agent calls `validate` with only `workflowPath`, **Then** the system applies defaults (`target: { kind: 'changed' }`, `layer: 'static'`, `force: false`) and returns `{ success: true, data: <DiagnosticSummary> }`.
2. **Given** a running MCP server and a valid workflow file, **When** the agent calls `validate` with `target: { kind: 'nodes', nodes: ['HTTP Request'] }` and `layer: 'both'`, **Then** the system validates those specific nodes and returns a diagnostic summary scoped to the requested target.
3. **Given** a running MCP server, **When** the agent calls `validate` with a path to a nonexistent file, **Then** the system returns `{ success: true, data: <DiagnosticSummary with status 'error'> }` — the orchestrator treats file-not-found as a foreseeable failure and produces an error diagnostic, not a tool-level failure.
4. **Given** a running MCP server and a malformed workflow file, **When** the agent calls `validate`, **Then** the system returns `{ success: true, data: <DiagnosticSummary with status 'error'> }` — the orchestrator treats parse failures as foreseeable and produces an error diagnostic, not a tool-level failure.
5. **Given** a validation that produces `status: 'fail'` in the diagnostic summary, **When** the response is returned, **Then** the tool-level envelope is `{ success: true, data: <DiagnosticSummary with status 'fail'> }` — tool success and validation failure are distinct.

---

### User Story 2 - Agent checks trust status via MCP (Priority: P1)

A coding agent wants to understand which nodes in a workflow are currently trusted and which have changed since their last validation. The agent calls `trust_status` with a workflow path and receives a structured report of trusted nodes, untrusted nodes, and what changed.

**Why this priority**: Trust status drives the agent's decision about what to validate next. Without this, the agent cannot make informed validation choices.

**Independent Test**: Can be tested by invoking `trust_status` with a workflow path and verifying the response contains the expected `TrustStatusReport` shape.

**Acceptance Scenarios**:

1. **Given** a workflow with some previously validated nodes and some changes, **When** the agent calls `trust_status`, **Then** the response contains `trustedNodes` with validation timestamps and layers, `untrustedNodes` with reasons, and `changedSinceLastValidation` listing changed node names.
2. **Given** a workflow with no prior trust state, **When** the agent calls `trust_status`, **Then** the response shows all nodes as untrusted with reason indicating no prior validation.
3. **Given** a nonexistent workflow path, **When** the agent calls `trust_status`, **Then** the system returns `{ success: false, error: { type: 'workflow_not_found', message } }`.

---

### User Story 3 - Agent previews guardrail behavior via MCP (Priority: P2)

Before committing to a validation run, the agent calls `explain` to understand what guardrails would do with a potential request. This is a read-only dry run that shows the guardrail decision, how the target would resolve, and what validation capabilities are available.

**Why this priority**: Explain helps agents make informed decisions about when to force-override guardrails. It reduces wasted validation cycles but is not required for core validation flow.

**Independent Test**: Can be tested by invoking `explain` with a workflow path and verifying the response contains a `GuardrailExplanation` with decision, target resolution, and capabilities.

**Acceptance Scenarios**:

1. **Given** a workflow where the agent targets the entire workflow, **When** the agent calls `explain`, **Then** the response shows a guardrail decision of `warn` or `narrow` with an explanation of why whole-workflow validation is discouraged.
2. **Given** a workflow and a narrowed target, **When** the agent calls `explain`, **Then** the response shows `proceed` with the resolved target nodes and selected path.
3. **Given** `explain` is called, **When** the response is returned, **Then** no trust state is modified and no validation is performed (read-only operation).

---

### User Story 4 - Developer validates via CLI (Priority: P2)

A developer uses the `n8n-vet validate` command during local development to inspect validation results in a human-readable format. They can also pass `--json` to get machine-readable output identical to the MCP response.

**Why this priority**: CLI is the secondary interface for development and debugging. It enables human inspection of the same data agents consume, which is critical for building and debugging the MCP surface.

**Independent Test**: Can be tested by running `n8n-vet validate <path>` and verifying human-readable output, then running with `--json` and verifying output matches the MCP response envelope.

**Acceptance Scenarios**:

1. **Given** a valid workflow file, **When** the developer runs `n8n-vet validate <path>`, **Then** the output is a human-readable formatted summary with color-coded status, indented findings, and readable error messages.
2. **Given** a valid workflow file, **When** the developer runs `n8n-vet validate <path> --json`, **Then** the output to stdout is identical to the MCP `validate` response envelope.
3. **Given** a valid workflow file, **When** the developer runs `n8n-vet validate <path> --target nodes --nodes "HTTP Request,Set"`, **Then** the validation targets only those named nodes.
4. **Given** a nonexistent workflow path, **When** the developer runs `n8n-vet validate <path>`, **Then** an error message is printed to stderr and the process exits with a non-zero code.

---

### User Story 5 - Developer inspects trust and explains via CLI (Priority: P3)

A developer runs `n8n-vet trust <path>` to see the current trust state or `n8n-vet explain <path>` to preview guardrail behavior, both in human-readable format.

**Why this priority**: These are secondary CLI commands that mirror the less-frequent MCP tools. Useful for debugging but not the primary development flow.

**Independent Test**: Can be tested by running each CLI command and verifying human-readable output, then with `--json` for machine-readable output.

**Acceptance Scenarios**:

1. **Given** a workflow with trust state, **When** the developer runs `n8n-vet trust <path>`, **Then** the output shows trusted/untrusted nodes in a readable table or list.
2. **Given** a workflow, **When** the developer runs `n8n-vet explain <path> --json`, **Then** the output is identical to the MCP `explain` response envelope.

---

### Edge Cases

- What happens when the MCP server receives input that does not conform to the JSON schema (e.g., missing `workflowPath`, invalid `layer` value)? The server returns `{ success: false, error: { type: 'parse_error', message } }` with a clear description of the validation failure.
- What happens when `--nodes` is used without `--target nodes` in the CLI? The system treats this as an error and prints a usage message to stderr with a non-zero exit code.
- What happens when `target.kind` is `'nodes'` but `target.nodes` is empty or missing? The system returns a parse error indicating that node names are required when target kind is `'nodes'`.
- What happens when the library core throws an unexpected exception not matching any known domain error? The MCP layer catches it and returns `{ success: false, error: { type: 'internal_error', message } }`. The CLI layer prints the error to stderr and exits with a non-zero code.
- What happens when `--force` is used with `explain`? Force is not applicable to explain (read-only), so the flag is ignored.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST register three MCP tools: `validate`, `trust_status`, and `explain`, as defined in the MCP surface reference specification.
- **FR-002**: System MUST wrap all MCP tool responses in a consistent envelope: `{ success: true, data: T }` for successful operations or `{ success: false, error: McpError }` for tool-level failures.
- **FR-003**: System MUST distinguish between tool-level failure (`success: false`) and validation failure (`success: true` with `status: 'fail'` in the diagnostic summary). A workflow that fails validation is a successful tool invocation.
- **FR-004**: System MUST apply documented defaults when optional fields are omitted: `target` defaults to `{ kind: 'changed' }`, `layer` defaults to `'static'`, `force` defaults to `false`, `destinationMode` defaults to `'inclusive'`.
- **FR-005**: System MUST map domain errors from the library core to exactly four `McpError` types: `workflow_not_found`, `parse_error`, `configuration_error`, `internal_error`.
- **FR-006**: System MUST provide CLI commands `n8n-vet validate <path>`, `n8n-vet trust <path>`, and `n8n-vet explain <path>` with options that mirror MCP tool inputs: `--target`, `--nodes`, `--layer`, `--force`, `--destination`, `--json`.
- **FR-007**: CLI MUST produce human-readable formatted output with color-coded status by default. Human formatting is applied exclusively in the CLI layer.
- **FR-008**: CLI with `--json` flag MUST produce output identical to the MCP response envelope. No human formatting is applied in JSON mode.
- **FR-009**: CLI MUST print errors to stderr and exit with a non-zero code on failure. Invalid arguments produce a clear usage message.
- **FR-010**: MCP tools MUST validate input against their JSON schemas before delegation. Invalid input produces `McpError` with `type: 'parse_error'`.
- **FR-011**: `validate` (MCP and CLI) MUST delegate to `interpret()` as its sole upstream call. `trust_status`/`trust` and `explain` compose existing subsystem functions (workflow parsing, graph building, trust loading, change detection, guardrail evaluation) at the surface layer — no single facade function exists for these; the composition is the handler's responsibility.
- **FR-012**: The MCP and CLI layers MUST NOT contain validation logic, orchestration, or diagnostic construction. They parse input, delegate, and format output.
- **FR-013**: The `explain` tool MUST be read-only: it performs a dry-run guardrail evaluation without modifying trust state or performing actual validation.

### Key Entities

- **McpResponse<T>**: The response envelope wrapping all tool outputs. Either `{ success: true, data: T }` or `{ success: false, error: McpError }`.
- **McpError**: Typed error with exactly four discriminants: `workflow_not_found`, `parse_error`, `configuration_error`, `internal_error`. Each includes a descriptive `message`.
- **TrustStatusReport**: The output of `trust_status`, containing `workflowId`, `totalNodes`, `trustedNodes` (with validation metadata), `untrustedNodes` (with reasons), and `changedSinceLastValidation`.
- **GuardrailExplanation**: The output of `explain`, containing `guardrailDecision`, `targetResolution`, and `capabilities`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An agent can invoke each of the three MCP tools and receive a correctly enveloped response within a single request/response cycle.
- **SC-002**: All MCP tool responses conform to the documented JSON schemas — no undocumented fields, no missing required fields.
- **SC-003**: Invalid inputs to any MCP tool produce a structured `parse_error` response, not an unhandled exception or malformed output.
- **SC-004**: CLI `--json` output is byte-for-byte structurally identical to MCP output for the same request — an agent could consume either interchangeably.
- **SC-005**: CLI default output is readable by a developer without referring to the JSON schema — status, findings, and errors are clearly presented with visual hierarchy.
- **SC-006**: CLI exits with code 0 on successful tool operations and non-zero on tool-level failures or invalid arguments.
- **SC-007**: The MCP and CLI layers contain no validation, orchestration, or diagnostic logic — all business logic lives in the library core accessed through the upstream interfaces.

## Assumptions

- The `@modelcontextprotocol/sdk` package is already installed and provides the MCP server framework for tool registration and stdio transport.
- `node:util.parseArgs` (Node.js built-in) is used for CLI argument parsing. No additional CLI framework dependency is needed.
- The upstream library core function `interpret()` is implemented by prior phases. The `trust_status` and `explain` handlers compose existing subsystem functions (parseWorkflowFile, buildGraph, loadTrustState, computeChangeSet, evaluate, detectCapabilities) directly at the surface layer.
- The MCP server uses stdio transport as specified in the plugin integration design.
- Error types thrown by the library core are typed domain errors that can be reliably mapped to the four `McpError` discriminants.
