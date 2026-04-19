# Feature Specification: Execution Subsystem

**Feature Branch**: `005-execution-subsystem`  
**Created**: 2026-04-18  
**Status**: Draft  
**Input**: User description: "Phase 5 Execution: implement execution-backed validation with pin data construction, bounded/whole-workflow execution against n8n, polling, result extraction, and capability detection"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bounded Execution of a Changed Slice (Priority: P1)

An agent has modified a node in a workflow and wants to validate that the changed slice executes correctly. The agent provides the workflow ID, a destination node, and the trusted boundaries from prior validation. The system constructs pin data for trusted boundary nodes, executes only the subgraph between the trigger/pin-data sources and the destination node against the running n8n instance, polls for completion, and returns per-node execution results (status, timing, errors, source lineage) without raw output data.

**Why this priority**: Bounded execution is the primary execution mode — it validates a specific slice with minimal cost, directly supporting the product's core principle of keeping validation local and bounded. Without this, the tool cannot perform execution-backed validation at all.

**Independent Test**: Can be fully tested by providing a workflow ID, destination node, and pin data, then verifying that the system sends the correct request to the n8n REST API, polls for results, and returns structured per-node execution data. Unit tests use mock HTTP; integration tests require a running n8n instance (opt-in).

**Acceptance Scenarios**:

1. **Given** a workflow exists in n8n and pin data covers all trusted boundary nodes, **When** the agent requests bounded execution with a destination node in inclusive mode, **Then** the system executes through the destination node and returns per-node results with status, timing, and source lineage for each executed node.
2. **Given** a workflow exists in n8n and pin data covers all trusted boundary nodes, **When** the agent requests bounded execution in exclusive mode, **Then** the system executes up to but not including the destination node and returns per-node results for predecessor nodes only.
3. **Given** a bounded execution is triggered, **When** the execution completes with errors at a specific node, **Then** the system returns the error data classified by context kind (api, expression, cancellation, other) with the failing node identified.
4. **Given** a bounded execution is triggered, **When** the execution exceeds the timeout threshold, **Then** the system reports a cancellation result with reason "timeout" — this is a normal result, not a raised error.

---

### User Story 2 - Pin Data Construction with Source Traceability (Priority: P1)

An agent needs pin data constructed for a validation run. The system determines which nodes require mocking (trigger nodes, trusted boundary nodes, explicitly mocked nodes), resolves pin data from a strict 4-tier sourcing priority (agent fixtures, prior artifacts, execution history inference, error), and reports which source provided data for each mocked node so the agent understands what assumptions the validation relied on.

**Why this priority**: Pin data is a prerequisite for both bounded and whole-workflow execution. Without correctly constructed pin data with clear sourcing, execution results are unreliable and the agent cannot understand the basis for validation outcomes.

**Independent Test**: Can be fully tested with fixture data representing each sourcing tier. Provide a graph, trusted boundaries, and varying combinations of fixtures/artifacts/history to verify the 4-tier priority and source traceability output. No n8n instance required for unit tests.

**Acceptance Scenarios**:

1. **Given** agent-provided fixtures exist for a node, **When** pin data is constructed, **Then** the agent fixtures are used (tier 1) and the source map records "agent-fixture" for that node.
2. **Given** no agent fixtures but prior validation artifacts exist for an unchanged node, **When** pin data is constructed, **Then** the cached artifacts are used (tier 2) and the source map records "prior-artifact".
3. **Given** no agent fixtures and no prior artifacts but execution history is available, **When** pin data is constructed, **Then** execution history inference is used (tier 3) and the source map records "execution-history".
4. **Given** no pin data source is available for a required node, **When** pin data construction is attempted, **Then** the system raises a typed error identifying which specific nodes lack pin data. No empty stubs or placeholder data is substituted.
5. **Given** pin data items arrive as flat objects without the `json` wrapper, **When** normalization runs, **Then** the items are wrapped into the correct `{ json: ... }` format.

---

### User Story 3 - Whole-Workflow Smoke Test (Priority: P2)

An agent requests a smoke test of the entire workflow. The system uses the MCP `test_workflow` tool to execute the full workflow from the trigger with pin data applied, then retrieves per-node execution data for diagnostic synthesis.

**Why this priority**: Whole-workflow execution supports smoke tests and broad sanity checks — a necessary but less frequent validation mode. It depends on the same pin data and result extraction infrastructure as bounded execution.

**Independent Test**: Can be tested by verifying MCP tool invocation with correct parameters, timeout handling, and follow-up data retrieval via `get_execution`. Integration tests require both n8n and MCP availability (opt-in).

**Acceptance Scenarios**:

1. **Given** MCP tools are available and a workflow exists in n8n, **When** the agent requests a smoke test with pin data, **Then** the system invokes `test_workflow` and retrieves per-node results.
2. **Given** MCP tools are available, **When** the agent requests a smoke test with a specific trigger node override, **Then** the system passes the trigger node name to `test_workflow`.
3. **Given** MCP tools are NOT available, **When** the agent requests a smoke test, **Then** the system reports that whole-workflow execution is unavailable (MCP-specific operation) with a clear error.

---

### User Story 4 - Capability Detection Before Execution (Priority: P2)

Before attempting execution, the system probes the environment to determine what is available: n8n reachability, REST API authentication, MCP tool availability, and workflow existence. The agent receives a clear capability report so it knows what execution modes are possible.

**Why this priority**: Capability detection prevents wasted execution attempts and provides actionable error messages. It is the precondition gate for all execution operations.

**Independent Test**: Can be tested by mocking health check endpoints, API auth responses, and MCP tool discovery to verify correct capability-level reporting (full, REST-only, static-only) and appropriate error messages.

**Acceptance Scenarios**:

1. **Given** n8n is reachable and REST API is authenticated, **When** capability detection runs, **Then** the system reports REST capabilities as available.
2. **Given** n8n is reachable, REST is authenticated, and MCP tools are discoverable, **When** capability detection runs, **Then** the system reports full capabilities (REST + MCP).
3. **Given** n8n is unreachable, **When** capability detection runs, **Then** the system raises a typed infrastructure error with a clear message.
4. **Given** REST API authentication fails (invalid or missing API key), **When** capability detection runs, **Then** the system raises a typed infrastructure error identifying the credential issue.
5. **Given** the workflow ID does not exist in n8n or the local version differs from remote, **When** workflow existence is checked, **Then** the system raises a typed precondition error advising the agent to push via n8nac.

---

### User Story 5 - Execution Result Retrieval with Polling (Priority: P2)

After a bounded execution is triggered (which returns only an execution ID), the system polls for completion using a two-phase strategy: lightweight status polling with exponential backoff, followed by a single data retrieval call filtered to only the nodes in the validation slice.

**Why this priority**: Polling bridges the gap between triggering execution and obtaining results. The two-phase approach (status-only polling, then filtered data retrieval) keeps polling cheap and the final data response proportional to the slice.

**Independent Test**: Can be tested with mock HTTP responses simulating various polling sequences (immediate completion, gradual backoff, timeout). Verify backoff timing, timeout behavior, and that data retrieval filters to only requested nodes.

**Acceptance Scenarios**:

1. **Given** an execution has been triggered, **When** the system polls for completion, **Then** status-only checks use exponential backoff (1s, 2s, 4s, 8s, 15s, 15s, ...) without fetching node data.
2. **Given** status polling detects a terminal status, **When** the system retrieves execution data, **Then** it makes a single data request filtered to only the nodes in the validation slice with truncated data.
3. **Given** an execution does not complete within 5 minutes, **When** the timeout is reached, **Then** the system reports a cancellation result with reason "timeout".

---

### Edge Cases

- What happens when credentials are resolved from multiple conflicting sources in the n8nac config cascade? The highest-priority source wins (explicit config > env vars > project config > global credential store).
- What happens when a node in the execution result has redacted data? The system reports with reduced detail using the appropriate context kind and adds a diagnostic hint about limited data availability.
- What happens when the n8n instance returns an unexpected execution status not in the known set? The system maps it to the closest known status and includes the raw status in error context.
- What happens when MCP `prepare_test_pin_data` returns no schema for a node type? That node falls through to tier 4 (error identifying the node as lacking pin data).
- What happens when a previously cached pin data artifact exists but the node's content hash has changed? The cached artifact is invalidated; sourcing falls through to the next tier.
- What happens when the execution completes but some nodes in the requested filter set have no execution data? The system returns results for the nodes that did execute and omits absent nodes — the diagnostic layer interprets missing nodes as "not reached."

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST construct pin data following a strict 4-tier sourcing priority: (1) agent-provided fixtures, (2) prior validation artifacts with matching content hash, (3) execution history inference, (4) typed error identifying nodes that lack pin data.
- **FR-002**: System MUST NOT substitute empty stubs, placeholder data, or `[{"json": {}}]` when pin data is unavailable for a required node.
- **FR-003**: System MUST record which source (agent-fixture, prior-artifact, execution-history) provided pin data for each mocked node, producing a source map for diagnostic traceability.
- **FR-004**: System MUST normalize flat pin data objects missing the `json` wrapper into the correct `{ json: ... }` format.
- **FR-005**: System MUST support bounded execution via the n8n REST API with a destination node in both `inclusive` (execute through destination) and `exclusive` (execute up to but not destination) modes.
- **FR-006**: System MUST support whole-workflow execution via the MCP `test_workflow` tool with pin data and optional trigger node override.
- **FR-007**: System MUST poll for execution results using a two-phase strategy: lightweight status-only polling with exponential backoff, followed by a single data retrieval call filtered to the validation slice.
- **FR-008**: System MUST use named polling constants: initial delay of 1 second, backoff factor of 2, maximum delay of 15 seconds, and timeout of 5 minutes.
- **FR-009**: System MUST extract per-node execution results (status, timing, errors with context kind, source lineage, hints) without extracting raw output data.
- **FR-010**: System MUST detect execution environment capabilities: n8n reachability, REST API authentication, MCP tool availability, and workflow existence.
- **FR-011**: System MUST report stale or missing workflows as a precondition failure with an actionable message advising the agent to push via n8nac. System MUST NOT auto-push workflows.
- **FR-012**: System MUST resolve authentication credentials from the n8nac config cascade in priority order: explicit config, environment variables (`N8N_HOST`, `N8N_API_KEY`), n8nac project config (`n8nac-config.json`), global credential store (`~/.config/n8nac/credentials.json`).
- **FR-013**: System MUST raise a typed configuration error identifying the specific missing credential when authentication cannot be resolved.
- **FR-014**: System MUST report execution timeout as a normal execution result with cancellation status and timeout reason, not as a raised error.
- **FR-015**: System MUST treat MCP and REST as independent capability surfaces — MCP unavailability does not affect REST-based bounded execution.
- **FR-016**: System MUST serialize execution requests — one execution at a time per session, no parallel execution.

### Key Entities

- **PinData**: A record mapping node names to arrays of pin data items. Each item contains a `json` property with arbitrary key-value data and an optional `binary` property. Represents mocked node outputs used to isolate the execution scope.
- **PinDataSourceMap**: A record mapping node names to their pin data source (agent-fixture, prior-artifact, execution-history). Provides traceability for understanding validation assumptions.
- **ExecutionResult**: The outcome of triggering an execution — contains an execution ID, status (success, error, crashed, canceled, waiting), optional error data, and a partial flag indicating whether results are incomplete.
- **ExecutionData**: Per-node execution results extracted from a completed run — contains a map of node results (status, timing, errors, source lineage, hints), the last node executed, and any top-level error.
- **ExecutionErrorData**: Classified error information with a base (type, message, description, node) and a discriminated context kind (api, cancellation, expression, other) carrying context-specific fields.
- **AvailableCapabilities**: The detected capability level of the execution environment — whether REST is available, MCP is available, and which specific operations are supported.
- **NodeExecutionResult**: A single execution attempt for a node — includes execution index, status, execution time, error data, source info (previous node, output index, run index), and hints.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Pin data construction correctly applies the 4-tier sourcing priority in 100% of test scenarios, with no empty stubs ever produced.
- **SC-002**: Pin data source traceability correctly identifies the source for every mocked node in every validation run.
- **SC-003**: Bounded execution with `destinationNode` produces correct per-node results for all nodes in the execution subgraph, verified against known workflow fixture outcomes.
- **SC-004**: Polling completes within the 5-minute timeout for all normal-length executions, with exponential backoff verified to follow the defined constant sequence.
- **SC-005**: Result extraction captures status, timing, errors, and source lineage for every executed node without including raw output data — verified by inspecting extraction output for absence of `INodeExecutionData[]` content.
- **SC-006**: Capability detection correctly identifies all four capability dimensions (reachability, auth, MCP, workflow existence) and produces actionable error messages for each failure mode.
- **SC-007**: Stale or missing workflows produce a precondition failure with a message that includes guidance to push via n8nac, verified by checking error message content.
- **SC-008**: Missing credentials produce a typed configuration error identifying the specific credential and expected source, verified by checking error type and message.
- **SC-009**: Unit tests for pin data construction, result extraction, and polling logic pass without requiring a running n8n instance.
- **SC-010**: Integration tests (gated behind `N8N_TEST_HOST` environment variable) exercise real bounded execution and result retrieval against a live n8n instance.

## Assumptions

- The n8n REST API v1 `POST /workflows/:id/run` endpoint supports `destinationNode` with `inclusive`/`exclusive` mode semantics as documented in n8n platform research.
- The n8nac `ConfigService` or equivalent config cascade logic is importable or replicable for credential resolution.
- MCP `test_workflow`, `get_execution`, and `prepare_test_pin_data` tools follow the interfaces documented in n8n MCP research. When MCP is unavailable, only MCP-specific operations are affected.
- The n8n execution data structure (`IRunExecutionData`) contains `runData` keyed by node name with `ITaskData[]` arrays that include `executionStatus`, `executionTime`, `error`, `source`, and `hints` fields.
- Execution result caching (alongside trust state) is handled at the orchestration layer (Phase 7), not within the execution subsystem itself. The execution subsystem provides raw results; caching decisions are external.
