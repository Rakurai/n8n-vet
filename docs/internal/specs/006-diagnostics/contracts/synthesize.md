# Contract: synthesize()

## Public API

The diagnostics subsystem exposes a single public function:

```
synthesize(input: SynthesisInput): DiagnosticSummary
```

This is the only entry point. All other modules (`status.ts`, `errors.ts`, `annotations.ts`, `path.ts`, `hints.ts`) are internal implementation details.

## Input Contract

`SynthesisInput` is validated at the `synthesize()` boundary. After validation, all internal functions trust the types.

| Field | Type | Constraint |
|-------|------|-----------|
| staticFindings | `StaticFinding[]` | Valid discriminated union members. May be empty. |
| executionData | `ExecutionData \| null` | When non-null, `nodeResults` must have valid `executionIndex` values. |
| trustState | `TrustState` | Valid per-node records. |
| guardrailDecisions | `GuardrailDecision[]` | Valid discriminated union members. May be empty. |
| resolvedTarget | `ResolvedTarget` | `nodes` must be non-empty. |
| capabilities | `AvailableCapabilities` | `staticAnalysis` must be `true`. |
| meta | `ValidationMeta` | `runId` must be non-empty. `timestamp` must be valid ISO 8601. |

## Output Contract

Returns a `DiagnosticSummary` with these guarantees:

1. `schemaVersion` is always `1`.
2. `status` is deterministic for a given set of inputs (same inputs → same status).
3. `errors` is ordered: execution before static, error-severity before warning, earliest executionIndex first.
4. `nodeAnnotations` contains exactly one entry per node in `resolvedTarget.nodes`. No duplicates, no omissions.
5. `executedPath` is non-null if and only if `executionData` is non-null.
6. `guardrailActions` contains all decisions from the input, unmodified.
7. `evidenceBasis` reflects which layers provided data: `'static'` if executionData is null, `'execution'` if staticFindings is empty, `'both'` otherwise.

## Error Contract

`synthesize()` may throw:

| Error Condition | Behavior |
|----------------|----------|
| Missing structural data during path reconstruction (`executionIndex`, `source`) | Throws a typed error. Not recoverable — indicates a retrieval bug upstream. |
| `opaque-boundary` finding with `severity: 'error'` | Throws a typed error. This combination is unexpected per the analysis spec. |
| Empty `resolvedTarget.nodes` | Throws a typed error. A validation run with no nodes in scope is a caller bug. |

No silent failures. No default returns on error paths.

## Consumers

- **Request Interpretation** (Phase 7): calls `synthesize()` as the final step of the validation pipeline.
- **MCP Surface** (Phase 8): serializes the returned `DiagnosticSummary` to JSON for agent consumption.
- **CLI** (Phase 8): formats the returned `DiagnosticSummary` for human-readable display.
