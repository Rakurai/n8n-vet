# Contract: Guardrail Evaluation API

**Date**: 2026-04-18  
**Feature**: 004-guardrails  
**Consumer**: Request Interpretation orchestrator (Phase 7)

## Public Interface

The guardrails subsystem exposes a single public function. All other functions are internal implementation details.

### `evaluate`

**Purpose**: Evaluate a validation request against guardrail rules and return a decision.

**Signature**:
```
evaluate(input: EvaluationInput): GuardrailDecision
```

**Input** (`EvaluationInput`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | `ValidationTarget` | Yes | The resolved validation target |
| `targetNodes` | `Set<NodeIdentity>` | Yes | Concrete node set derived from the target |
| `layer` | `ValidationLayer` | Yes | Requested evidence layer (`'static'`, `'execution'`, `'both'`) |
| `force` | `boolean` | Yes | When true, bypass all guardrails |
| `trustState` | `TrustState` | Yes | Current trust state (may be empty on first run) |
| `changeSet` | `NodeChangeSet` | Yes | Diff between previous and current workflow |
| `graph` | `WorkflowGraph` | Yes | Current workflow graph |
| `currentHashes` | `Map<NodeIdentity, string>` | Yes | Content hashes for all target nodes |
| `priorSummary` | `DiagnosticSummary \| null` | Yes | Most recent cached diagnostic summary, or null |
| `expressionRefs` | `ExpressionReference[]` | Yes | Expression references for nodes in the graph |
| `llmValidationRequested` | `boolean` | Yes | Whether the agent explicitly requested LLM/agent output validation |
| `fixtureHash` | `string \| null` | Yes | Current fixture/pin-data hash, or null if no fixtures are in use |

**Output** (`GuardrailDecision`):

Discriminated union on `action`:

| Action | Additional Fields | Overridable | Description |
|--------|------------------|-------------|-------------|
| `proceed` | — | `true` | No guardrail triggered |
| `warn` | — | `true` | Advisory warning; validation continues |
| `narrow` | `narrowedTarget: ValidationTarget` | `true` | Reduced scope computed |
| `redirect` | `redirectedLayer: ValidationLayer` | `true` | Cheaper layer suffices |
| `refuse` | — | varies | High-confidence no-value request |

All decisions include: `explanation: string`, `evidence: GuardrailEvidence`, `overridable: boolean`.

**Error conditions**:
- Throws if `targetNodes` is inconsistent with `target` (contract violation)
- Throws if `graph` is missing nodes referenced by `changeSet` (upstream failure)

**Behavioral guarantees**:
- Deterministic: same inputs always produce the same output
- Synchronous: no async operations
- Pure: no side effects, no filesystem, no network
- Evidence is always fully populated (no null/undefined evidence fields)

---

## Evaluation Order Contract

The evaluation pipeline runs in this exact order. First non-proceed result wins.

| Step | Tier | Check | Possible Actions |
|------|------|-------|-----------------|
| 1 | Precondition | Force flag | `proceed` (with bypass note) |
| 2 | Precondition | Empty target | `refuse` (overridable: false) |
| 3 | Precondition | Identical rerun | `refuse` (overridable: true) |
| 4 | Guardrail | Execution → static redirect | `redirect` |
| 5 | Guardrail | Broad scope → narrow change | `narrow` |
| 6 | Guardrail | DeFlaker failure relevance | `warn` |
| 7 | Guardrail | Broad target | `warn` |
| 8 | Guardrail | Default | `proceed` |

---

## Internal Functions (not public API)

These are implementation details, documented here for clarity but not part of the public contract:

- `computeNarrowedTarget(input): ValidationTarget` — narrowing algorithm
- `assessEscalationTriggers(input): EscalationAssessment` — redirect trigger evaluation
- `extractPriorRunContext(summary): PriorRunContext | null` — derive prior run context
- `assembleEvidence(input): GuardrailEvidence` — evidence assembly
