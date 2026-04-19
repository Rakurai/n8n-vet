# Phase 6 — Diagnostics

## Goal

Implement the diagnostic synthesis subsystem that assembles the final structured output — `DiagnosticSummary` — from evidence produced by static analysis, execution orchestration, trust reasoning, and guardrail evaluation. Every validation run terminates by producing exactly one `DiagnosticSummary`. The summary must be compact enough for agent consumption, legible enough for human supervision, and structured enough for programmatic branching. Implements STRATEGY.md principle 8: diagnostics optimize for next action.

## Context Files

| File | Role |
|------|------|
| `docs/reference/INDEX.md` | Shared type definitions (`DiagnosticSummary`, `DiagnosticError`, `DiagnosticHint`, `NodeAnnotation`, `ResolvedTarget`, `PathNode`, `AvailableCapabilities`, `ValidationMeta`, `GuardrailDecision`, `TrustState`, `NodeTrustRecord`, `ValidationLayer`) |
| `docs/CODING.md` | TypeScript rules — fail-fast, contract-driven, no fallbacks, schema-first |
| `docs/CONCEPTS.md` | Shared vocabulary — diagnostic summary, trusted boundary, mocked node, skipped node, guardrail, validation run |

## Scope

**In scope:**
- Status determination from combined evidence layers
- Error extraction and classification from static findings and execution data
- Error ordering (execution before static, by severity, by execution order)
- Path reconstruction from execution data
- Node annotation assignment (validated/trusted/mocked/skipped) with reason strings
- Guardrail action reporting in output
- Hint collection from execution runtime hints and static warnings
- Capabilities reporting
- Compact representation enforcement
- Schema versioning (`schemaVersion: 1`)

**Out of scope:**
- How static analysis produces findings (Phase 2)
- How execution produces data (Phase 5)
- How the MCP surface serializes or transports the summary (Phase 8)
- Trust state computation or persistence (Phase 3)
- Guardrail evaluation logic (Phase 4)

## Inputs and Outputs

### Inputs

| Input | Type | Required | Notes |
|-------|------|----------|-------|
| Static findings | `StaticFinding[]` | Yes (may be empty) | Produced by Phase 2 |
| Execution data | `ExecutionData \| null` | No | Null when static-only validation |
| Trust state | `TrustState` | Yes | For node trust annotations |
| Guardrail decisions | `GuardrailDecision[]` | Yes (may be empty) | For guardrail action reporting |
| Resolved target | `ResolvedTarget` | Yes | Describes what was validated |
| Available capabilities | `AvailableCapabilities` | Yes | What backends were available |
| Run metadata | `{ runId: string; executionId: string \| null; partialExecution: boolean; timestamp: string; durationMs: number }` | Yes | Timing and identification |

### Output

`DiagnosticSummary` — the canonical output type defined in `docs/reference/INDEX.md`.

## Internal Types

These types are internal to this phase and not shared across subsystem boundaries.

```typescript
/** Maps StaticFinding kind to DiagnosticError classification. */
type StaticKindClassificationMap = Record<StaticFindingKind, ErrorClassification>;

/** Intermediate representation during error extraction before final ordering. */
interface ClassifiedError {
  error: DiagnosticError;
  source: 'static' | 'execution';
  executionIndex: number | null;
}
```

## Upstream Interface Summary

**StaticFinding**: Discriminated union with `kind` field. Kinds: `data-loss`, `broken-reference`, `invalid-parameter`, `unresolvable-expression`, `schema-mismatch`, `missing-credentials`, `opaque-boundary`. Each carries `severity` (`error` | `warning`), `node`, `message`, and kind-specific context fields.

**ExecutionData**: Per-node results map plus `lastNodeExecuted`, top-level `error`, and `status`. Each `NodeExecutionResult` has `executionIndex`, `status`, `executionTimeMs`, `error`, `source` (`previousNode` / `output` / `run`), and `hints`.

**ExecutionErrorData**: Discriminated union with `contextKind` field (`'api'` | `'cancellation'` | `'expression'` | `'other'`). Base has `type`, `message`, `description`, `node`. Context shape varies by `contextKind`.

**GuardrailDecision**: Discriminated union by `action` (`proceed` | `warn` | `narrow` | `redirect` | `refuse`). Base has `explanation`, `evidence`, `overridable`. `narrow` carries `narrowedTarget`; `redirect` carries `redirectedLayer`.

**TrustState**: Per-node trust records with `contentHash`, `validatedAt` timestamp, and `validationLayer`. Used for node annotation assignment.

**ResolvedTarget**: `description` (human-readable), `nodes` (concrete `NodeIdentity[]` in scope), `automatic` (whether system-computed or agent-specified).

## Behavior

### 1. Status determination

Determine the single top-level `status` field that agents branch on.

| Condition | Status |
|-----------|--------|
| Any guardrail decision has `action: 'refuse'` | `skipped` |
| No error-severity findings from any layer | `pass` |
| At least one error-severity static finding or execution error | `fail` |
| Tool or infrastructure failure (diagnostics cannot complete) | `error` |

Evaluate in the order listed. First matching condition wins.

### 2. Error extraction and classification

#### From static findings

Each `StaticFinding` with `severity: 'error'` becomes a `DiagnosticError`. Classification is determined by the finding's `kind`:

| StaticFinding kind | DiagnosticError classification |
|-------------------|-------------------------------|
| `data-loss` | `wiring` |
| `broken-reference` | `wiring` |
| `invalid-parameter` | `wiring` |
| `schema-mismatch` | `wiring` |
| `missing-credentials` | `credentials` |
| `unresolvable-expression` | `expression` |

Static findings produce only `wiring`, `expression`, or `credentials` classifications. Never `external-service`, `platform`, or `cancelled`.

Static findings with `severity: 'warning'` are reported as `DiagnosticHint` entries (severity `'warning'`), not as errors.

#### From execution data

When the constructor name is available in the error, classify using the n8n error hierarchy:

| Error signal | Classification |
|-------------|---------------|
| Constructor name contains `Cancelled` | `cancelled` |
| `ExpressionError` | `expression` |
| `NodeApiError` with httpCode 401 or 403 | `credentials` |
| `NodeApiError` with httpCode 4xx (other) | `wiring` |
| `NodeApiError` with httpCode 5xx | `external-service` |
| `NodeApiError` with network errors (`ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`) | `external-service` |
| `NodeSslError` | `external-service` |
| `WorkflowOperationError` / `WorkflowActivationError` | `platform` |
| `WorkflowConfigurationError` | `wiring` |
| `NodeOperationError` credential-related | `credentials` |
| `NodeOperationError` (other) | `wiring` |
| Unrecognizable | `unknown` |

When the constructor name is unavailable (serialized errors), classify using the `contextKind` discriminant on `ExecutionErrorData`:

| `contextKind` | Classification |
|---------------|---------------|
| `'api'` | Apply httpCode logic from the table above. When `httpCode` is absent (network-level failures, unparseable responses), classify as `external-service`. |
| `'cancellation'` | `cancelled` |
| `'expression'` | `expression` |
| `'other'` | `unknown` |

#### Error ordering

Final error list is ordered by:
1. Source: execution errors before static errors
2. Severity: error-severity before warning-severity
3. Execution order: earliest failing node first (by `executionIndex`)

### 3. Path reconstruction

When execution data is present:
1. Collect `(nodeName, NodeExecutionResult)` pairs from the execution results map
2. Sort by `executionIndex` ascending
3. Record `sourceOutput` from `source.previousNodeOutput`
4. Emit as `PathNode[]` in the `executedPath` field

Parallel branches are flattened to execution order. Branch structure is lost; sequence is preserved.

When execution data is null (static-only): `executedPath` is `null`. The analyzed path is conveyed through the `target` field's `PathDefinition`.

### 4. Node annotations

Every node in scope (from `ResolvedTarget.nodes`) receives a `NodeAnnotation` with a status and reason string.

| Status | Condition | Example reason |
|--------|-----------|---------------|
| `validated` | Actively analyzed or executed in this run | `"Changed since last validation"` / `"New node"` / `"Requested by agent"` |
| `trusted` | In scope but skipped because unchanged since prior validation | `"Unchanged since validation at [timestamp]"` |
| `mocked` | Replaced with pin data during execution | `"Pin data provided from [source]"` where source is `agent` / `execution-history` / `schema` / `stub` |
| `skipped` | Outside the active validation scope | `"Outside validation scope"` / `"Beyond trusted boundary"` |

Annotation assignment uses `TrustState` to determine which nodes are trusted and their validation timestamps.

### 5. Guardrail action reporting

Every `GuardrailDecision` from the input is included in the `guardrailActions` array of the summary. When a decision has `action: 'narrow'`, report both the original and narrowed targets. When a decision has `action: 'refuse'`, the top-level `status` is `skipped` with the decision's `explanation` conveying the reason.

### 6. Hints

Collect runtime hints (`NodeExecutionHint` from execution data) as `DiagnosticHint[]`. Static findings with `severity: 'warning'` are also reported as hints (not errors). No deduplication within a single run.

### 7. Capabilities reporting

Report what backends were available for this validation run:

```typescript
{ staticAnalysis: true, restApi: boolean, mcpTools: boolean }
```

`staticAnalysis` is always `true` (always available). `restApi` and `mcpTools` reflect runtime availability.

### 8. Summary exclusions

The `DiagnosticSummary` intentionally excludes:
- Raw node output data (large, rarely needed)
- Full execution logs or transcripts
- Long lists of passing checks
- Code excerpts larger than diagnostic context
- Sub-execution details (reference only, not inline)

### 9. Compact representation

Target JSON sizes for the serialized summary:

| Scenario | Approximate JSON lines |
|----------|----------------------|
| Static-only, 5 nodes, no errors | ~30-40 |
| Static-only, 5 nodes, 1 error | ~50-60 |
| Execution-backed, 8 nodes, 1 error | ~80-100 |
| Guardrail narrowed, 3 validated, 10 trusted | ~60-70 |

If a summary exceeds ~150 lines, investigate inflation causes. This is a diagnostic smell, not a hard limit.

## Error Conditions

| Condition | Behavior |
|-----------|----------|
| Static findings only, no execution data | Report static findings. Set `evidenceBasis: 'static'`. Add a hint noting execution may catch additional issues. |
| Execution errors, no static findings | Report execution errors. Set `evidenceBasis: 'execution'`. Static silence does not imply soundness. |
| Both layers have findings for the same node | Report both. Execution errors ordered first. Do not merge or deduplicate cross-layer findings. |
| Execution data redacted for a node | Add `DiagnosticHint` with `severity: 'danger'` per affected node: `"Execution data redacted for node [name]."` Classify using `contextKind` discriminant. |
| Path reconstruction fails (missing structural data) | Raise an error. Structural field absence in execution data is a retrieval bug, not a recoverable condition. |

## Acceptance Criteria

- Status determination correctly maps evidence combinations to `pass` / `fail` / `error` / `skipped`
- Static finding classification maps each `kind` to the correct `DiagnosticError` classification per the table
- Execution error classification handles all n8n error types including serialized errors via `contextKind` (with `'api'` context falling back to `external-service` when `httpCode` is absent)
- Error ordering: execution before static, by severity, by execution order (earliest failing node first)
- Path reconstruction sorts by `executionIndex` and includes `sourceOutput` data
- Node annotations correctly assigned (`validated` / `trusted` / `mocked` / `skipped`) with reason strings
- Guardrail decisions included in output; narrowed decisions report both original and narrowed targets
- Redacted execution data produces `DiagnosticHint` with `severity: 'danger'` per affected node
- Summary stays within ~150 line target for typical scenarios
- `schemaVersion` field present, set to `1`
- Unit tests use fixture evidence data; no n8n instance required

## Decisions

1. **Cross-layer finding merge**: Findings from static and execution layers are reported separately with the `evidenceBasis` tag. They are not merged or deduplicated. Same-node findings from different layers both appear in the output.
2. **Hint deduplication**: No deduplication of hints within a single run. If two sources produce the same hint text, both appear.
3. **Schema versioning**: The `schemaVersion` field is a `number`, starting at `1`. Consumers should check this field before parsing.
