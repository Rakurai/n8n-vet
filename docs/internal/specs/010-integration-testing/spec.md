# Feature Specification: Integration Testing Suite

**Feature Branch**: `010-integration-testing`  
**Created**: 2026-04-19  
**Status**: Draft  
**Input**: User description: "Phase 10 integration testing — end-to-end test suite verifying n8n-vet's full pipeline against a live n8n instance using real test artifacts"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verify Full Pipeline Correctness Against Live n8n (Priority: P1)

A developer or CI operator wants to confirm that n8n-vet's complete validation pipeline — static analysis, trust tracking, execution, guardrails, and diagnostics — produces correct results when run against real workflows on a live n8n instance. Unit tests with mocks prove internal logic but cannot catch integration failures: REST API behavior, n8nac push/pull round-trips, pin data acceptance by the execution engine, real polling timing, and diagnostic accuracy against actual execution outcomes.

**Why this priority**: This is the core value of the integration test suite. Without proving the pipeline works end-to-end, all other subsystem testing provides only partial confidence. The phase-10 PRD identifies 8 specific failure classes that unit tests cannot catch.

**Independent Test**: Can be fully tested by running the test runner against a live n8n instance with seeded fixtures and confirming all 8 scenarios pass.

**Acceptance Scenarios**:

1. **Given** a live n8n instance with seeded test fixtures, **When** the test runner executes all 8 scenarios sequentially, **Then** each scenario reports pass/fail with clear output identifying fixture name, expected outcome, and actual outcome.
2. **Given** a static-only validation against a workflow with known wiring bugs, **When** validate is called with layer 'static', **Then** the diagnostic summary includes the expected static findings (disconnected-node, data-loss-risk) and the execution engine was not invoked.
3. **Given** a clean workflow pushed to n8n, **When** validate is called with layer 'both', **Then** static analysis reports no findings, execution returns success, diagnostic summary status is 'pass', and trust state is updated for all validated nodes.

---

### User Story 2 - Seed and Manage Test Fixtures (Priority: P1)

A developer setting up integration testing for the first time (or refreshing fixtures after an n8n upgrade) needs to create test workflows on a live n8n instance and pull them back as n8nac artifacts with real server IDs and server-normalized parameters. The seeded artifacts must be committed to the repo so that subsequent test runs work without re-seeding.

**Why this priority**: Without fixtures, no integration scenarios can run. The seed script is a prerequisite for all testing. Fixtures must carry real server IDs and normalized parameters to prove the round-trip works.

**Independent Test**: Can be tested by running the seed script against a live n8n instance and verifying that 7 fixture `.ts` files and a manifest are produced, all compile, and pass `n8nac verify`.

**Acceptance Scenarios**:

1. **Given** a live n8n instance with API access, **When** the seed script runs, **Then** 7 test workflows are created (prefixed with `n8n-vet-test--`), pulled as `.ts` artifacts, and a manifest mapping fixture names to workflow IDs is written.
2. **Given** the seed script has already been run, **When** it runs again, **Then** existing workflows are updated (not duplicated), the manifest is overwritten with current IDs, and pulled artifacts overwrite previous versions.
3. **Given** the seed script has completed, **When** the pulled `.ts` files are compiled and verified, **Then** all files compile without errors and pass `n8nac verify`.

---

### User Story 3 - Trust Lifecycle Validation (Priority: P2)

A developer wants to verify that n8n-vet's trust system correctly builds trust after successful validation, detects changes that invalidate trust, and narrows validation scope on re-validation to only the changed nodes and their downstream dependencies.

**Why this priority**: Trust reuse is a core product principle. If trust doesn't work correctly end-to-end — building, persisting, invalidating on change, and narrowing scope — the guardrail system loses its primary locality mechanism.

**Independent Test**: Can be tested by running the trust lifecycle scenario (validate, check trust, edit a node, check trust again, re-validate) against a multi-node workflow.

**Acceptance Scenarios**:

1. **Given** a multi-node workflow validated with static analysis, **When** trust_status is queried, **Then** all nodes are reported as trusted with no pending changes.
2. **Given** a trusted workflow where one node's parameters have been edited locally, **When** trust_status is queried, **Then** the edited node is untrusted while unmodified nodes remain trusted.
3. **Given** a workflow with one untrusted node, **When** validate is called, **Then** only the untrusted node and its downstream are validated — upstream trusted nodes are not re-validated.

---

### User Story 4 - Guardrail Behavior Validation (Priority: P2)

A developer wants to verify that n8n-vet's guardrails correctly detect and handle low-value reruns, refusing or redirecting when a validation request adds no new information.

**Why this priority**: Guardrails are core product identity. If they don't fire correctly against real workflows with real trust state, agents will waste tokens on redundant validation.

**Independent Test**: Can be tested by validating an already-trusted workflow a second time and verifying the guardrail refusal/redirect with explanation.

**Acceptance Scenarios**:

1. **Given** a workflow that has been fully validated and all nodes are trusted, **When** validate is called again with no changes, **Then** the guardrail decision is refuse or redirect with an explanation that all nodes are already trusted.
2. **Given** the same scenario, **When** explain is called, **Then** it reports what the guardrail would do and why, without modifying trust state.

---

### User Story 5 - MCP Tool Round-Trip (Priority: P2)

A developer wants to verify that n8n-vet's MCP server correctly accepts tool calls via the MCP SDK and returns well-formed structured JSON responses for all three tools (validate, trust_status, explain).

**Why this priority**: The MCP server is the primary agent-facing interface. If tool schemas, input validation, or response envelopes are broken, agents cannot use the product.

**Independent Test**: Can be tested by spawning the MCP server as a child process, sending tool calls via the MCP SDK client, and asserting on response shape and content.

**Acceptance Scenarios**:

1. **Given** the n8n-vet MCP server running via stdio transport, **When** a validate tool call is sent for a valid workflow file, **Then** the response matches `{ success: true, data: DiagnosticSummary }` shape.
2. **Given** the MCP server, **When** a validate tool call is sent for a nonexistent file, **Then** the response matches `{ success: false, error: { type: 'workflow_not_found' } }`.
3. **Given** the MCP server, **When** trust_status and explain tool calls are sent, **Then** both return valid JSON matching their expected response shapes.

---

### User Story 6 - Bounded Execution (Priority: P3)

A developer wants to verify that n8n-vet can execute a subgraph of a workflow using `destinationNode` — running only the nodes on the path from trigger to destination — rather than the full workflow.

**Why this priority**: Bounded execution is the mechanism that makes slice-focused validation cheap. It depends on REST API `destinationNode` behavior working correctly, which cannot be verified without a live n8n instance.

**Independent Test**: Can be tested by executing a multi-node workflow with a destination node and verifying that only the expected subset of nodes received execution results.

**Acceptance Scenarios**:

1. **Given** a multi-node workflow pushed to n8n with pin data for the trigger, **When** validate is called with a destination node targeting a mid-workflow node, **Then** only nodes from trigger to the destination node have execution results; nodes after the destination have no results.

---

### Edge Cases

- What happens when the n8n instance is unreachable at test start? The runner must fail fast with a clear prerequisite error, not hang or produce misleading results.
- What happens when n8nac push hits an OCC conflict? The push utility must retry with conflict resolution and only fail on genuine errors.
- What happens when a fixture's node type schema has drifted due to an n8n version upgrade? The seed script should be re-run to capture the current schema; stale fixtures should fail noisily rather than silently produce wrong results.
- What happens when trust state from a previous test run leaks into the current run? Trust state must be isolated per test run via a fresh temporary directory.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a seed script that creates 7 test workflows on a live n8n instance via REST API and pulls them as n8nac `.ts` artifacts with real server-assigned IDs.
- **FR-002**: Seed script MUST be idempotent — re-running updates existing workflows rather than creating duplicates.
- **FR-003**: Seed script MUST produce a manifest file mapping fixture names to n8n workflow IDs.
- **FR-004**: System MUST provide a sequential test runner that executes 8 integration scenarios, each receiving a shared integration context.
- **FR-005**: Test runner MUST verify prerequisites (n8n reachable, n8nac available, API key configured) before running any scenarios and fail fast if prerequisites are unmet.
- **FR-006**: Test runner MUST isolate trust state per run using a fresh temporary directory, preventing cross-contamination between runs.
- **FR-007**: Test runner MUST support running a single scenario by number (e.g., `--scenario 04`) for targeted debugging.
- **FR-008**: Test runner MUST support a `--check` flag that validates prerequisites without running tests.
- **FR-009**: Each scenario MUST be independently runnable — no scenario depends on side effects from a prior scenario's execution.
- **FR-010**: Scenarios MUST call n8n-vet's library API directly for most tests (not CLI), with the exception of scenario 07 which tests the MCP surface.
- **FR-011**: Failure output MUST include the fixture name, expected outcome, actual outcome, and diagnostic summary for diagnosis.
- **FR-012**: System MUST provide a push utility that handles OCC conflicts automatically (retry with `--mode keep-current`).
- **FR-013**: System MUST provide typed assertion helpers for DiagnosticSummary validation (status, findings, trust status, guardrail actions).
- **FR-014**: System MUST provide an MCP test client that spawns the n8n-vet MCP server as a child process and provides typed tool call methods.
- **FR-015**: Each test fixture MUST target a single primary validation signal (one fixture, one signal) and use 3-6 nodes.
- **FR-016**: All fixture workflow names MUST be prefixed with `n8n-vet-test--` to avoid collision with real workflows.
- **FR-017**: Scenarios that edit workflows MUST copy the fixture to a temporary directory and modify the copy — committed fixtures are never modified by tests.

### Key Entities

- **Test Fixture**: A real n8nac workflow artifact pulled from a live n8n instance, carrying server-assigned IDs and server-normalized parameters. Each targets one validation signal.
- **Manifest**: A JSON file mapping fixture names (e.g., `"happy-path"`) to n8n workflow IDs (e.g., `"wf-abc123"`), produced by the seed script.
- **Integration Context**: A shared context object containing n8n connection details, API key, isolated trust state directory, fixtures directory path, and a cleanup function.
- **Scenario**: A self-contained integration test function that receives an IntegrationContext, exercises a specific n8n-vet capability against real workflows, and throws on failure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 8 integration scenarios pass against a fresh n8n instance with seeded fixtures in a single test run.
- **SC-002**: Any single scenario can run in isolation without depending on prior scenario execution.
- **SC-003**: The seed script creates all 7 fixtures on a live n8n instance and produces valid, compilable artifacts in under 2 minutes.
- **SC-004**: Test failures identify the specific fixture, expected outcome, and actual outcome within the failure message — no log diving required to understand what failed.
- **SC-005**: Trust state is fully isolated between runs — running the suite twice produces identical results (no state leakage).
- **SC-006**: The prerequisite check validates all 7 prerequisites and reports any missing ones within 5 seconds.
- **SC-007**: OCC conflicts during fixture push are handled automatically — no manual intervention needed during test runs.

## Assumptions

- A live n8n instance is available and configured with API access for integration testing.
- n8nac CLI is installed and pointed at the test n8n instance.
- Node.js 20+ is available in the test environment.
- The n8n-vet project is built before running integration tests.
- Test workflows use Manual Trigger and target deterministic endpoints or require no external calls.
- The integration test suite is NOT part of the default unit test suite — it runs separately as a standalone script.

## Dependencies

- Phases 2-9 must be implemented (the integration tests exercise the full pipeline).
- A running n8n instance with REST API access.
- n8nac CLI configured and pointed at the n8n instance.
