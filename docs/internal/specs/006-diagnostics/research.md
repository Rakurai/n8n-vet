# Research: Diagnostic Synthesis

## 1. Execution Data Input Shape

**Decision**: Define minimal `ExecutionData`, `NodeExecutionResult`, `ExecutionErrorData`, and `NodeExecutionHint` interfaces in `src/diagnostics/types.ts` as the input contract. Refactor to import from `src/execution/types.ts` when Phase 5 is implemented.

**Rationale**: The diagnostics subsystem depends on the *shape* of execution data, not on Phase 5's implementation. INDEX.md and the Phase 6 PRD define this shape precisely. Defining the minimal interface now enables independent development and testing with fixture data.

**Alternatives considered**:
- Wait for Phase 5: Rejected — would block diagnostics on an unrelated subsystem.
- Define in shared `src/types/`: Rejected — INDEX.md explicitly lists `ExecutionData` as internal to the execution spec, not shared.

## 2. Error Classification Strategy

**Decision**: Static lookup map (`Record`) for static findings. Two-tier function for execution errors: constructor name matching first, `contextKind` discriminant fallback second.

**Rationale**: Both classification tables in the PRD are exhaustive and deterministic. A static map is the simplest correct implementation for static findings. The two-tier approach mirrors the PRD's explicit structure.

**Alternatives considered**:
- Unified classification function for both sources: Rejected — fundamentally different input shapes.
- Pattern-matching library (ts-pattern): Rejected — adds dependency for ~30 lines of switch logic.

## 3. Handling `opaque-boundary` Static Finding Kind

**Decision**: `opaque-boundary` findings are expected as warnings only. They route through the hint path, not the error classification path. If one arrives with `severity: 'error'`, the classifier raises an error (fail-fast).

**Rationale**: The PRD's error classification table maps 6 of 7 kinds, omitting `opaque-boundary`. The PRD states warnings become hints. `opaque-boundary` signals reduced static confidence — inherently a warning, not a structural error.

**Alternatives considered**:
- Add to error classification map: Rejected — no sensible error classification exists.
- Silently skip: Rejected — violates fail-fast principle.

## 4. Node Annotation Assignment Logic

**Decision**: Determine annotation status using this priority order:
1. Node has execution data sourced from pin data → `mocked`
2. Node was actively analyzed/executed in this run (changed or explicitly targeted) → `validated`
3. Node has a trust record in `TrustState` and is unchanged → `trusted`
4. All remaining in-scope nodes → `skipped`

**Rationale**: Matches the PRD's annotation table. The ordering prevents ambiguity — a mocked node that also has trust records is annotated as `mocked`, not `trusted`, because the mock is the more specific status for this run.

**Alternatives considered**:
- Flat lookup without priority: Rejected — multiple conditions can apply to the same node.

## 5. Evidence Basis Determination

**Decision**: `evidenceBasis` reflects which layers *contributed data to this run*:
- `executionData` is null → `'static'`
- `staticFindings` is empty → `'execution'`
- Both are present → `'both'`

**Rationale**: The PRD says "Static findings only, no execution data → `'static'`" and "Execution errors, no static findings → `'execution'`". This maps cleanly to presence/absence of input data, not presence of errors.

**Alternatives considered**:
- Base on which layers produced errors: Rejected — PRD says "Static findings only, no execution data", not "only static errors".
