# Feature Specification: Execution Backend Revision

**Feature Branch**: `012-execution-backend-revision`  
**Created**: 2026-04-19  
**Status**: Draft  
**Input**: User description: "read docs/prd/phase-12-execution-backend-revision.md and spec the revisions"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent validates a workflow slice using MCP execution (Priority: P1)

An agent working on an n8n workflow change requests execution-backed validation through the tool. The tool routes all execution through the MCP `test_workflow` backend. The agent does not need to know or choose between execution backends — there is one path: MCP with pin data controlling effective scope.

**Why this priority**: This is the core product function. Without a working execution path, no execution-backed validation can occur. Removing the broken REST execution path and consolidating on MCP is the fundamental change.

**Independent Test**: Can be tested by requesting execution-backed validation on any workflow with an active MCP connection and confirming execution completes via MCP `test_workflow`.

**Acceptance Scenarios**:

1. **Given** a workflow with MCP available and a validation request, **When** the agent requests execution-backed validation, **Then** the tool executes via MCP `test_workflow` with appropriate pin data and returns a diagnostic summary.
2. **Given** a workflow with MCP available, **When** the agent requests validation of a specific slice, **Then** pin data is placed at trusted boundaries so that only the target slice region actually executes.
3. **Given** a validation request, **When** no MCP connection is available, **Then** the tool reports that execution-backed validation is unavailable and proceeds with static-only analysis, with a clear explanation of the limitation.

---

### User Story 2 - Capability detection accurately reflects MCP-only execution (Priority: P1)

When the tool starts up or detects available backends, it correctly identifies MCP as the sole execution trigger surface and REST as read-only (execution data retrieval, not triggering). The capability level reported to the agent accurately reflects what is possible.

**Why this priority**: Incorrect capability detection led to the original problem — the tool claimed REST execution was available when it was not. Accurate capability reporting is essential for the agent to make informed decisions and for guardrails to function correctly.

**Independent Test**: Can be tested by checking capability detection output with various backend configurations (MCP only, REST only, both, neither) and confirming the reported capability levels match reality.

**Acceptance Scenarios**:

1. **Given** MCP is available and REST is reachable, **When** capability detection runs, **Then** the capability level is `'mcp'` and REST is flagged as read-only (data retrieval, not execution triggering).
2. **Given** only REST is reachable (no MCP), **When** capability detection runs, **Then** the capability level is `'static-only'` — REST alone cannot trigger execution.
3. **Given** neither MCP nor REST is available, **When** capability detection runs, **Then** the capability level is `'static-only'`.

---

### User Story 3 - Dead code and non-functional interfaces are removed (Priority: P2)

All references to REST-based execution triggering, `destinationNode`, bounded execution via REST, and related CLI flags are removed from the codebase. The tool no longer exposes non-functional options to agents or users.

**Why this priority**: Non-functional interfaces mislead agents and humans, causing wasted effort and confusion. Removing them is important but secondary to establishing the working execution path.

**Independent Test**: Can be tested by searching the codebase for removed symbols (`executeBounded`, `destinationNode`, `destinationMode`, `--destination` flag) and confirming zero occurrences in source, tests, and interface schemas.

**Acceptance Scenarios**:

1. **Given** the updated codebase, **When** searching for `executeBounded`, **Then** zero matches are found in source code and tests.
2. **Given** the updated codebase, **When** searching for `destinationNode` in request types, MCP schemas, and CLI flags, **Then** zero matches are found.
3. **Given** the updated codebase, **When** the `--destination` CLI flag is passed, **Then** the CLI rejects it as an unknown option.

---

### User Story 4 - Documentation reflects the MCP-only execution model (Priority: P3)

All design documents, reference docs, and developer-facing documentation accurately describe the MCP-only execution model, the deferral of bounded execution, and the concept of scoped pin data as the v0.1.0 mechanism for controlling execution scope.

**Why this priority**: Documentation accuracy prevents future confusion but does not block functional correctness. This can be completed after the code changes.

**Independent Test**: Can be tested by reviewing each documentation file listed in the PRD and confirming it reflects the current execution model with no references to REST-based execution triggering as a current capability.

**Acceptance Scenarios**:

1. **Given** the updated documentation, **When** reading execution reference docs, **Then** MCP `test_workflow` is described as the primary execution mode and bounded execution via REST is noted as deferred.
2. **Given** the updated documentation, **When** reading strategy docs, **Then** scoped pin data is described as the v0.1.0 mechanism for controlling execution scope.
3. **Given** the updated CLAUDE.md, **When** reading the execution backend section, **Then** it states MCP is primary for triggering and REST is read-only.

---

### Edge Cases

- What happens when MCP is available but `test_workflow` returns an error? The tool surfaces the MCP error in the diagnostic summary rather than attempting a REST fallback.
- What happens when REST health check succeeds but MCP is unavailable? The tool reports `static-only` capability — REST availability alone does not enable execution.
- What happens when the MCP connection drops mid-execution? The tool reports the execution as failed with the connection error, not silently succeeding or hanging. Existing MCP client error propagation handles this.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tool MUST route all execution-backed validation through MCP `test_workflow` exclusively.
- **FR-002**: The tool MUST remove the `executeBounded()` function and all call sites from the codebase.
- **FR-003**: The tool MUST remove `destinationNode` and `destinationMode` from all request types, MCP input schemas, and CLI interfaces.
- **FR-004**: The tool MUST remove the `--destination` CLI flag.
- **FR-005**: Capability detection MUST report only two levels: `'mcp'` (execution available) and `'static-only'` (execution unavailable). The previous `'full'` and `'rest-only'` levels MUST be removed.
- **FR-006**: REST availability MUST be reclassified as `restReadable` — indicating health check and execution data retrieval capability, not execution triggering.
- **FR-007**: The orchestrator MUST use a single execution path: if MCP is available and execution is requested, call `executeSmoke` with pin data. There MUST be no bounded vs. smoke branching logic.
- **FR-008**: The tool MUST preserve REST read capabilities (`resolveCredentials()`, `getExecutionStatus()`, `getExecutionData()`) — the REST public API is valid for data retrieval.
- **FR-009**: The `ExecutionMeta.partial` field MUST be removed from diagnostic types since all execution is whole-workflow via MCP.
- **FR-010**: Execution-triggering Zod schemas (e.g., `TriggerExecutionResponseSchema`) MUST be removed from the REST client.
- **FR-011**: All existing tests MUST be updated to remove REST execution mocks and `destinationNode` test inputs while preserving test coverage for the MCP execution path.
- **FR-012**: Documentation MUST be updated to reflect the MCP-only execution model, the deferral of bounded execution, and the scoped pin data concept.
- **FR-013**: When retrieving execution data after MCP-triggered execution, the tool MUST prefer MCP `get_execution` over REST `getExecutionData`. REST data retrieval is used only when MCP data retrieval is unavailable but REST is readable.

### Key Entities

- **CapabilityLevel**: Enumeration of detected execution capability. Changes from `'full' | 'rest-only' | 'static-only'` to `'mcp' | 'static-only'`.
- **DetectedCapabilities**: Structure describing available backends. `restAvailable` is replaced by `restReadable` to accurately convey REST's read-only role.
- **ValidationRequest**: The input to the orchestrator. `destinationNode` and `destinationMode` fields are removed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero occurrences of `executeBounded` exist anywhere in the codebase after the revision.
- **SC-002**: Zero occurrences of `destinationNode` exist in any request type, schema, or CLI interface after the revision.
- **SC-003**: 100% of execution-backed validation requests are routed through MCP `test_workflow` — no alternative execution trigger path exists.
- **SC-004**: Capability detection produces only `'mcp'` or `'static-only'` — no other capability levels are possible.
- **SC-005**: All automated checks pass cleanly: type checking, test suite, and linting produce zero errors.
- **SC-006**: All documentation files listed in the PRD are updated to reflect the MCP-only execution model with no stale references to REST-based execution triggering.

## Assumptions

- The n8n MCP `test_workflow` tool remains the stable, supported execution surface for external callers.
- Pin data placement at trusted boundaries is sufficient to control effective execution scope for v0.1.0 without true `destinationNode` support.
- The REST public API will continue to support read operations (execution data retrieval, health checks) even though it cannot trigger execution.
- The 011 audit remediations (specifically FR-009 MCP wiring) are completed before this phase begins, providing the end-to-end `executeSmoke` path that this phase promotes to the sole execution mechanism.

## Dependencies

- **Depends on**: Phase 011 audit remediations — FR-009 (MCP wiring) must be complete, providing the working `executeSmoke` path.
- **Blocks**: v0.2.0 opportunistic trust harvesting, which requires the simplified single-backend model.

## Out of Scope

- True bounded execution via `destinationNode` — deferred pending n8n platform support.
- Opportunistic trust harvesting (v0.2.0 feature — harvesting trust evidence from non-target nodes during whole-workflow execution).
- Session-based authentication to n8n internal APIs.
- Direct use of `@n8n/core` package APIs for execution.
- Pin data node reference validation against the workflow graph (potential future enhancement, not part of execution backend revision).
