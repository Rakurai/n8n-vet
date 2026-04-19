# Tasks: Test Suite Audit

**Input**: Design documents from `/specs/013-test-suite-audit/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: This feature IS a test audit — new test cases are part of the implementation, not a separate testing phase.

**Organization**: Tasks grouped by user story. US1 (dead code) is already complete and excluded.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US2, US3)
- Exact file paths included in descriptions

---

## Phase 1: Fix Mislabeled and Duplicate Tests — US2 (Priority: P1) - MVP

**Goal**: Correct guardrail step numbering, rewrite mislabeled pipeline test, remove duplicate test block.

**Independent Test**: All `describe('Step N:` labels in `evaluate.test.ts` match `// Step N:` comments in `evaluate.ts`. No duplicate describe blocks in `errors.test.ts`. `npm test` passes.

### Implementation

- [x] T001 [P] [US2] Fix step label "Step 6: DeFlaker warn" → "Step 5: DeFlaker warn" at line 106 in test/guardrails/evaluate.test.ts
- [x] T002 [P] [US2] Fix step label "Step 7: broad-target warn" → "Step 6: broad-target warn" at line 243 in test/guardrails/evaluate.test.ts
- [x] T003 [US2] Rewrite mislabeled pipeline test "Step 4 wins over Steps 5-8" at line 367 in test/guardrails/evaluate.test.ts — change to test Step 4 (narrow) winning: use `layer: 'static'`, `largeGraph()` with 1-2 changes out of 15 nodes, partial trust for non-changed nodes, assert `action === 'narrow'`
- [x] T004 [P] [US2] Delete duplicate `classifyExecutionErrors — contextKind edge cases` describe block (lines 264-304, including T034 comment) in test/diagnostics/errors.test.ts

**Checkpoint**: Step labels match source. No duplicates. `npm test` passes.

---

## Phase 2: Merge Node Classification Coverage — US3 (Priority: P2)

**Goal**: Add test coverage for all 5 `classifyMergeNode()` mode branches.

**Independent Test**: `npx vitest run test/static-analysis/classify.test.ts` passes with 5 new merge mode tests.

### Implementation

- [x] T005 [US3] Add 5 test cases to test/static-analysis/classify.test.ts for `classifyNode()` with Merge nodes (`type: 'n8n-nodes-base.merge'`): mode `append` → `shape-preserving`, `chooseBranch` → `shape-preserving`, `combineByPosition` → `shape-augmenting`, `combineByFields` → `shape-augmenting`, `combineBySql` → `shape-replacing`. Use existing `makeNode()` helper with `parameters: { mode: '...' }`.

**Checkpoint**: All 5 merge modes tested. `npx vitest run test/static-analysis/classify.test.ts` passes.

---

## Phase 3: Expression Extractor Coverage — US4 (Priority: P2)

**Goal**: Add test coverage for `$binary`, `$items()`, and `$node.DisplayName` dot-syntax expression extractors.

**Independent Test**: `npx vitest run test/static-analysis/expressions.test.ts` passes with 3 new extractor tests.

### Implementation

- [x] T006 [US4] Add 3 test cases to test/static-analysis/expressions.test.ts via `traceExpressions()` using existing `makeGraph()` helper: (1) node parameter containing `$binary.data` → ref with `resolved: false`, `fieldPath: 'data'`; (2) node parameter containing `$items("NodeDisplay")` with NodeDisplay in displayNameIndex → ref with `resolved: true`; (3) node parameter containing `$node.NodeDisplay.json.field` with NodeDisplay in displayNameIndex → ref with `resolved: true`, `fieldPath: 'field'`.

**Checkpoint**: All 3 extractor patterns tested. `npx vitest run test/static-analysis/expressions.test.ts` passes.

---

## Phase 4: Edge Case Coverage — US5 (Priority: P3)

**Goal**: Close remaining coverage gaps: unresolvable branching reference and trust-boundary propagation.

**Independent Test**: `npx vitest run test/guardrails/redirect.test.ts test/orchestrator/resolve.test.ts` passes with new tests.

### Implementation

- [x] T007 [P] [US5] Add 1 test case to test/guardrails/redirect.test.ts for `!ref.resolved` branch: branching node with expression ref where `resolved: false` and `referencedNode: null`, upstream node classified as `shape-opaque` → redirect trigger fires with message containing "unresolvable expression". Tests src/guardrails/redirect.ts lines 101-113.
- [x] T008 [P] [US5] Complete trust-boundary propagation test at line 330 in test/orchestrator/resolve.test.ts: import `computeContentHash` from trust module, compute hashes for boundary nodes A and D using the test's linearGraph AST, insert trust records with matching hashes, call `resolveTarget` again, assert `slice.nodes.size < 4`.

**Checkpoint**: Both edge cases covered. `npx vitest run test/guardrails/redirect.test.ts test/orchestrator/resolve.test.ts` passes.

---

## Phase 5: Zero-Error Gate — US6 (Priority: P1)

**Goal**: Achieve zero errors and zero warnings across all quality tooling — release gate for v0.1.0.

**Independent Test**: All three commands exit cleanly with zero issues.

### Implementation

- [x] T009 Run `npm run typecheck` and fix any errors found
- [x] T010 Run `npm test` and fix any failures or skipped tests (including preexisting issues from earlier phases)
- [x] T011 Run `npm run lint` and fix any errors or warnings across all files (including preexisting issues in untouched files)
- [x] T012 Final verification: run all three commands (`npm run typecheck`, `npm test`, `npm run lint`) and confirm zero errors, zero warnings, zero skipped tests

**Checkpoint**: Clean baseline for v0.1.0 tagging.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (US2 — Fix/Remove)**: No dependencies — start immediately
- **Phase 2 (US3 — Merge)**: No dependencies — can run in parallel with Phase 1
- **Phase 3 (US4 — Expressions)**: No dependencies — can run in parallel with Phases 1-2
- **Phase 4 (US5 — Edge cases)**: No dependencies — can run in parallel with Phases 1-3
- **Phase 5 (US6 — Zero-error gate)**: Depends on ALL previous phases completing

### Within Each Phase

- T001 and T002 are parallel (same file, different lines — no conflict)
- T003 depends on T001/T002 (same file, ensures step labels are correct before rewriting pipeline test)
- T004 is parallel with T001-T003 (different file)
- T005, T006, T007, T008 are all parallel (different files)
- T009-T012 are sequential (each may reveal issues the next must account for)

### Parallel Opportunities

```
Parallel batch 1 (all independent files):
  T001 — fix Step 5 label in evaluate.test.ts
  T002 — fix Step 6 label in evaluate.test.ts
  T004 — delete duplicate in errors.test.ts
  T005 — add merge mode tests in classify.test.ts
  T006 — add expression tests in expressions.test.ts
  T007 — add redirect test in redirect.test.ts
  T008 — complete trust test in resolve.test.ts

Sequential after batch 1:
  T003 — rewrite pipeline test in evaluate.test.ts (after T001, T002)

Sequential final gate:
  T009 → T010 → T011 → T012
```

---

## Implementation Strategy

### MVP First (Phase 1 Only)

1. Complete Phase 1: Fix mislabeled steps and remove duplicates
2. **STOP and VALIDATE**: `npm test` passes, step labels match source
3. This alone resolves the most visible quality issues

### Incremental Delivery

1. Phase 1 → Fix/Remove → Validate
2. Phase 2 → Merge coverage → Validate
3. Phase 3 → Expression coverage → Validate
4. Phase 4 → Edge case coverage → Validate
5. Phase 5 → Zero-error gate → Tag v0.1.0

### Parallel Strategy

With multiple agents:
1. Agent A: T001 + T002 + T003 (evaluate.test.ts)
2. Agent B: T004 (errors.test.ts) + T005 (classify.test.ts)
3. Agent C: T006 (expressions.test.ts) + T007 (redirect.test.ts) + T008 (resolve.test.ts)
4. All: T009-T012 (sequential gate)

---

## Notes

- US1 (Remove Dead Code Tests) is **already complete** — phase-12 removed all `executeBounded`/`destinationNode`/`destinationMode` references. No tasks generated for it.
- T003 (pipeline test rewrite) is the most complex task — reference the existing Step 5 test at line 385 for the narrow-test pattern.
- T008 (trust-boundary completion) requires importing `computeContentHash` and working with the test's minimal AST to get real hashes.
- All new tests use existing helpers (`makeNode`, `makeGraph`, `makeEvaluationInput`) — no new test infrastructure needed.
