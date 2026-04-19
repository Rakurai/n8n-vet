# Research: Execution Backend Revision

**Branch**: `012-execution-backend-revision` | **Date**: 2026-04-19

## R-001: Current CapabilityLevel values

**Decision**: Replace `'full' | 'rest-only' | 'static-only'` with `'mcp' | 'static-only'`

**Rationale**: The current `'full'` level implies REST+MCP execution, but REST cannot trigger execution (only read). `'rest-only'` is misleading — REST alone cannot execute. The only execution trigger is MCP `test_workflow`. The two meaningful states are: MCP available (can execute) or not (static-only).

**Alternatives considered**:
- Keep `'rest-only'` to indicate REST read capability → rejected: conflates "readable" with "executable"
- Three levels (`'mcp'`, `'mcp+rest'`, `'static-only'`) → rejected: over-engineering, REST read capability is orthogonal to execution level

## R-002: AvailableCapabilities.restApi field

**Decision**: Rename to `restReadable` to indicate read-only REST availability

**Rationale**: `restApi: true` currently implies REST can be used for execution, which is false. Renaming to `restReadable` accurately conveys "REST is reachable for data retrieval (execution results, workflow reads) but not execution triggering."

**Alternatives considered**:
- Keep `restApi` name but document meaning → rejected: name is misleading, violates constitution principle IV (Honest Code Only)
- Remove field entirely → rejected: REST read capability is still useful information (execution data retrieval)

## R-003: ExecutionResult.partial and ValidationMeta.partialExecution fields

**Decision**: Remove both. `ExecutionResult.partial` is always `false` when MCP is the only backend. `ValidationMeta.partialExecution` was tied to `destinationNode` which is removed.

**Rationale**: With MCP `test_workflow` as the sole execution path, all executions are whole-workflow. The `partial` flag was set to `true` when `executeBounded()` was used. With that removed, the field is always `false` — a constant is not useful information.

**Alternatives considered**:
- Keep `partial` and always set to `false` → rejected: violates constitution principle III (No Over-Engineering) — a field that's always `false` serves no purpose

## R-004: Polling simplification

**Decision**: Keep poll.ts mostly unchanged. MCP `test_workflow` is synchronous (returns execution result directly), so polling is not needed for the primary path. However, `execute_workflow` (async MCP tool) could use polling in future. The polling infrastructure is backend-agnostic and small enough to retain.

**Rationale**: Removing poll.ts entirely would be premature — it's a small file (120 lines), is backend-agnostic, and may be needed if `execute_workflow` support is added. Only the lock.ts comment referencing REST execution needs updating.

**Alternatives considered**:
- Remove poll.ts entirely → rejected: still useful for potential `execute_workflow` async path
- Major refactor → rejected: it's already backend-agnostic via PollingStrategy interface

## R-005: Execution data retrieval after MCP execution

**Decision**: After MCP `test_workflow` returns an execution ID, the orchestrator should use MCP `get_execution` (via `deps.getExecution`) for data retrieval when MCP is available, or REST `getExecutionData` when REST is readable. The current code only uses REST for data retrieval — this needs updating to prefer MCP.

**Rationale**: The current orchestrator at interpret.ts:230 checks `detected.restAvailable` before calling `getExecutionData`. Since REST is read-only but still functional for data retrieval, this path still works. However, MCP `get_execution` is already available and should be preferred for consistency. When REST is not available, MCP data retrieval must be the fallback.

**Alternatives considered**:
- REST-only data retrieval → rejected: breaks when REST is unavailable but MCP is available
- MCP-only data retrieval → acceptable but REST may provide richer data; prefer MCP with REST as supplementary
