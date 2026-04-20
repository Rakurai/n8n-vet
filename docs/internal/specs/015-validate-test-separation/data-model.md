# Data Model: Validate / Test Tool Separation

**Date**: 2026-04-19  
**Feature**: [spec.md](spec.md)

## Changed Entities

### ValidationEvidence (replaces ValidationLayer)

**Location**: `src/types/target.ts`

| Field | Old Type | New Type |
|-------|----------|----------|
| (type itself) | `'static' \| 'execution' \| 'both'` | `'static' \| 'execution'` |

**Migration**: `'both'` value eliminated. Direct rename from `ValidationLayer` to `ValidationEvidence`.

---

### NodeTrustRecord

**Location**: `src/types/trust.ts`

| Field | Old Name | New Name | Type |
|-------|----------|----------|------|
| validationLayer | `validationLayer` | `validatedWith` | `ValidationEvidence` |

All other fields unchanged: `contentHash`, `validatedBy`, `validatedAt`, `fixtureHash`.

**Migration**: Trust persistence reads both `validationLayer` (old) and `validatedWith` (new). Writes always use `validatedWith`. Old `'both'` values map to `'execution'`.

---

### GuardrailDecision

**Location**: `src/types/guardrail.ts`

| Variant | Status |
|---------|--------|
| `proceed` | Unchanged |
| `warn` | Unchanged |
| `narrow` (with `narrowedTarget`) | Unchanged |
| `redirect` (with `redirectedLayer`) | **Removed** |
| `refuse` | Unchanged |

**Migration**: `redirect` variant removed from discriminated union. All code matching on `action === 'redirect'` is removed.

---

### EvaluationInput

**Location**: `src/guardrails/types.ts`

| Field | Old | New |
|-------|-----|-----|
| `layer` | `ValidationLayer` | **Removed** |
| `tool` | (new) | `'validate' \| 'test'` |

---

### ValidationRequest

**Location**: `src/orchestrator/types.ts`

| Field | Old | New |
|-------|-----|-----|
| `layer` | `ValidationLayer` | **Removed** |
| `tool` | (new) | `'validate' \| 'test'` |

When `tool: 'test'`: `callTool` is required, `pinData` is optional.  
When `tool: 'validate'`: `callTool` is absent, `pinData` is absent.

---

### DiagnosticSummary

**Location**: `src/types/diagnostic.ts`

| Field | Old Type | New Type |
|-------|----------|----------|
| `evidenceBasis` | `'static' \| 'execution' \| 'both'` | `'static' \| 'execution'` |

**Invariant**: `validate` always produces `'static'`. `test` always produces `'execution'`.

---

### TrustedNodeInfo

**Location**: `src/types/surface.ts`

| Field | Old Name | New Name | Type |
|-------|----------|----------|------|
| validationLayer | `validationLayer` | `validatedWith` | `ValidationEvidence` |

**Migration**: Direct rename. Used in `trust_status` tool output.

---

## State Transitions

### Trust Record Lifecycle

```
[No record] → validate passes → { validatedWith: 'static', contentHash: H1 }
                                          ↓
                              push + test passes → { validatedWith: 'execution', contentHash: H1 }
                                          ↓
                              code changes → { contentHash: H2 } → trust invalidated → [needs re-validation]
```

Each tool invocation produces its own trust update. A node validated statically and then tested gets two separate trust writes at different times with different `validatedWith` values. The later write overwrites the earlier one (same node key). Trust checking uses `contentHash` only -- `validatedWith` is informational.

---

## Unchanged Entities

These entities are not modified by this feature:

- `AgentTarget` / `ValidationTarget` (target.ts)
- `TrustState` (trust.ts) -- container is unchanged, only record fields change
- `ExecutionData` / `ExecutionResult` (execution/types.ts)
- `StaticFinding` (static-analysis types)
- `NodeAnnotation` (diagnostic.ts) -- no structural change, but reason strings must not reference `'both'` (verified by T045 sweep)
- `McpResponse` envelope
- `AvailableCapabilities`
