# Research: Execution Subsystem

**Feature**: 005-execution-subsystem
**Date**: 2026-04-18

## R1: REST API Payload Shape for Bounded Execution

**Decision**: Use `FullManualExecutionFromUnknownTriggerPayload` variant — `{ destinationNode, pinData }` with no `runData`.

**Rationale**: n8n-check performs fresh bounded executions, not continuations of prior runs. The "unknown trigger" variant lets n8n's partial execution engine find the trigger automatically via `findTriggerForPartialExecution()`. Providing `runData` would require maintaining prior execution state, which is unnecessary complexity — pin data on trusted boundary nodes achieves the same isolation effect (pinned nodes are treated as "clean" by `isDirty()` in `find-start-nodes.ts`).

**Alternatives considered**:
- `PartialManualExecutionToDestinationPayload` (with `runData` + `dirtyNodeNames`): More control but requires caching and managing full `IRunData` from prior executions. Unnecessary for fresh validation runs.
- `FullManualExecutionFromKnownTriggerPayload` (with `triggerToStartFrom`): Useful when pin data includes trigger-specific payload, but adds complexity of trigger discovery. n8n handles this automatically in the unknown-trigger path.

**Payload shape**:
```typescript
{
  destinationNode: { nodeName: string; mode: 'inclusive' | 'exclusive' },
  pinData?: Record<string, INodeExecutionData[]>
}
```

Returns `{ executionId: string }`. Results polled separately.

---

## R2: MCP Tool Interfaces

**Decision**: Use MCP `get_execution` for both status polling and data retrieval. Use `test_workflow` for whole-workflow smoke tests. Use `prepare_test_pin_data` as tier-3 pin data source.

**Rationale**: MCP tools provide the surgical filtering (`nodeNames`, `truncateData`) needed for slice-proportional data retrieval. REST API lacks equivalent filtering — it returns full execution data.

### get_execution

```typescript
// Input
{ workflowId: string; executionId: string; includeData?: boolean; nodeNames?: string[]; truncateData?: number }

// Output (status-only: includeData omitted/false)
{ execution: { id, workflowId, mode, status, startedAt, stoppedAt, ... } | null; error?: string }

// Output (full data: includeData true)
// Same + data: IRunExecutionData filtered to nodeNames, truncated to truncateData items per output
```

### test_workflow

```typescript
// Input
{ workflowId: string; pinData: Record<string, Array<{json: Record<string, unknown>}>>; triggerNodeName?: string }

// Output (synchronous, blocks up to 5 min)
{ executionId: string | null; status: ExecutionStatus; error?: string }
```

### prepare_test_pin_data

```typescript
// Input
{ workflowId: string }

// Output
{
  nodeSchemasToGenerate: Record<string, JsonSchema>;
  nodesWithoutSchema: string[];
  nodesSkipped: string[];
  coverage: { withSchemaFromExecution: number; withSchemaFromDefinition: number; withoutSchema: number; skipped: number; total: number }
}
```

**Note**: Returns schemas, not actual pin data. n8n-check uses the schemas to understand what data shape is expected, but the actual pin data generation (from schemas) is the agent's responsibility. Nodes in `nodesWithoutSchema` fall through to tier 4 (error).

---

## R3: Credential Resolution Strategy

**Decision**: Replicate the n8nac config cascade logic rather than importing `ConfigService` directly.

**Rationale**: `ConfigService` is internal to n8nac CLI and not exported as a public API. Its cascade logic is simple (5-level priority) and stable. Replicating it avoids a coupling to n8nac's internal module structure. The implementation reads from well-defined file paths and env vars.

**Cascade priority (high to low)**:
1. Explicit config in the validation request (`host`, `apiKey` fields)
2. Environment variables: `N8N_HOST`, `N8N_API_KEY`
3. n8nac project config: `n8nac-config.json` in project root (active instance entry)
4. Global credential store: `~/.config/n8nac/credentials.json`

**Alternatives considered**:
- Importing n8nac `ConfigService`: Tight coupling to internal API. Would break on n8nac refactors.
- Supporting only env vars: Too limited. Agents using n8nac already have config files.

**Note**: The PRD lists the cascade as "explicit config > project config > global credential store > env vars." The n8nac research shows env vars have higher priority than config files. We follow the n8nac convention (env vars above config files) since that matches what users of n8nac expect. Updated cascade order reflects actual n8nac behavior.

---

## R4: Polling Strategy — REST vs MCP for Status Checks

**Decision**: Use MCP `get_execution` with `includeData: false` for status polling when MCP is available. Fall back to REST `GET /executions/:id` when MCP is unavailable.

**Rationale**: MCP `get_execution` with `includeData: false` returns only metadata (status, timestamps) — lightweight for polling. When MCP is available, it also provides `nodeNames` filtering for the final data retrieval call. When MCP is unavailable (REST-only mode), use the REST execution API for both polling and data retrieval.

**Important**: This is NOT a fallback in the constitution-prohibited sense. REST and MCP are independent capability surfaces detected at initialization. The polling implementation selects a strategy based on detected capabilities, not by trying MCP and "falling back" to REST on failure.

**Alternatives considered**:
- Always use REST for polling: Misses the `nodeNames` filtering benefit of MCP `get_execution` for the final data call.
- Always require MCP: Would make bounded execution unusable when MCP is unavailable (e.g., after n8nac push strips `availableInMCP` flag).

---

## R5: Pin Data Artifact Caching

**Decision**: Cache pin data artifacts in `.n8n-check/pin-data/` as JSON files keyed by `<workflowId>/<nodeContentHash>.json`.

**Rationale**: Tier 2 sourcing (prior validation artifacts) requires persisted pin data from successful prior runs. Content-hash keying ensures cached data is automatically invalidated when node content changes — a stale cache simply has no matching file. No explicit invalidation logic needed.

**File structure**:
```
.n8n-check/
├── trust-state.json          # Existing (Phase 3)
├── pin-data/
│   └── <workflowId>/
│       └── <nodeContentHash>.json   # Cached pin data for a specific node version
```

**Alternatives considered**:
- Single flat file with all pin data: Harder to invalidate per-node. Grows unbounded.
- In-memory only: Loses tier 2 sourcing across sessions.
- Content-addressed store (like git objects): Over-engineered for the number of artifacts expected.

---

## R6: Error Type Design

**Decision**: Three typed error classes covering the distinct failure domains, all extending a common base.

**Error taxonomy**:
- `ExecutionInfrastructureError`: n8n unreachable, API auth failure, MCP unavailable for requested operation
- `ExecutionPreconditionError`: Workflow not found, workflow stale, missing pin data for required nodes
- `ExecutionConfigError`: Missing credentials, invalid config cascade resolution

**Rationale**: The spec defines three distinct error categories (infrastructure, precondition, configuration) that require different caller responses. Infrastructure errors mean "retry later or fix environment." Precondition errors mean "the agent needs to take action (push workflow, provide pin data)." Config errors mean "fix the configuration."

**Alternatives considered**:
- Single `ExecutionError` with a `kind` discriminant: Less ergonomic for callers who want to catch specific categories.
- Result type (`Result<T, E>`): The project doesn't use Result types elsewhere (errors are thrown per CODING.md conventions).
