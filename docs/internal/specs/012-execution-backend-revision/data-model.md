# Data Model Changes: Execution Backend Revision

**Branch**: `012-execution-backend-revision` | **Date**: 2026-04-19

## Modified Entities

### CapabilityLevel (src/execution/types.ts)

**Before**: `'full' | 'rest-only' | 'static-only'`
**After**: `'mcp' | 'static-only'`

- `'full'` removed — implied REST+MCP execution, but REST cannot execute
- `'rest-only'` removed — REST alone cannot trigger execution
- `'mcp'` added — MCP available, execution possible

### DetectedCapabilities (src/execution/types.ts)

**Before**:
```
{
  level: 'full' | 'rest-only' | 'static-only'
  restAvailable: boolean
  mcpAvailable: boolean
  mcpTools: string[]
}
```

**After**:
```
{
  level: 'mcp' | 'static-only'
  restReadable: boolean
  mcpAvailable: boolean
  mcpTools: string[]
}
```

- `restAvailable` renamed to `restReadable` — REST is read-only (health, data retrieval), not an execution trigger
- Level determination: `mcpAvailable ? 'mcp' : 'static-only'` — REST availability does not affect execution level

### ExecutionResult (src/execution/types.ts)

**Before**: `{ executionId, status, error, partial }`
**After**: `{ executionId, status, error }`

- `partial: boolean` removed — all MCP executions are whole-workflow

### AvailableCapabilities (src/types/diagnostic.ts)

**Before**: `{ staticAnalysis: true, restApi: boolean, mcpTools: boolean }`
**After**: `{ staticAnalysis: true, restReadable: boolean, mcpTools: boolean }`

- `restApi` renamed to `restReadable` — semantic accuracy

### ValidationMeta (src/types/diagnostic.ts)

**Before**: `{ runId, executionId, partialExecution, timestamp, durationMs }`
**After**: `{ runId, executionId, timestamp, durationMs }`

- `partialExecution: boolean` removed — was set based on `destinationNode` presence, which is removed

### ValidationRequest (src/orchestrator/types.ts)

**Before**: `{ workflowPath, target, layer, force, pinData?, destinationNode?, destinationMode, callTool? }`
**After**: `{ workflowPath, target, layer, force, pinData?, callTool? }`

- `destinationNode: string | null` removed
- `destinationMode: 'inclusive' | 'exclusive'` removed

### OrchestratorDeps (src/orchestrator/types.ts)

**Before**: includes `executeBounded` function
**After**: `executeBounded` removed from deps interface

## Removed Entities

### executeBounded function (src/execution/rest-client.ts)

Entire function removed. Was: `executeBounded(workflowId, destinationNodeName, pinData, credentials, mode) → ExecutionResult`

### TriggerExecutionResponseSchema (src/execution/rest-client.ts)

Zod schema for REST execution trigger response. Removed — no REST execution triggering.

### --destination CLI flag (src/cli/index.ts)

CLI option mapping to `destinationNode`. Removed.

### destinationNode/destinationMode in MCP schema (src/mcp/server.ts)

Input schema fields for the `validate` MCP tool. Removed.
