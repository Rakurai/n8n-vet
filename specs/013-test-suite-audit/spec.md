# Feature Specification: Test Suite Audit

**Feature Branch**: `013-test-suite-audit`  
**Created**: 2026-04-19  
**Status**: Draft  
**Input**: User description: "read docs/prd/phase-13* and spec the work"

## User Scenarios & Testing

### User Story 1 - Remove Dead Code Tests (Priority: P1)

After phase-12 removes REST-based execution paths (`executeBounded`, `destinationNode`, `destinationMode`), the corresponding tests become dead code that will fail on deletion. The maintainer needs these tests removed alongside the source code so the test suite stays green and doesn't reference nonexistent functions.

**Why this priority**: Dead tests block CI after phase-12 merges. This is the only time-dependent work item — it must land with or immediately after phase-12.

**Independent Test**: After removal, `npm test` passes with zero failures, and no test file references `executeBounded`, `destinationNode`, or `destinationMode`.

**Acceptance Scenarios**:

1. **Given** phase-12 has removed `executeBounded` from source, **When** the dead test blocks in `rest-client.test.ts` (entire `executeBounded` describe block + `TriggerExecutionResponseSchema` tests, ~119 lines) are removed, **Then** no test file references `executeBounded`.
2. **Given** phase-12 has removed `destinationNode`/`destinationMode` from source, **When** the 4 dead test blocks in `interpret.test.ts` (~96 lines) are removed, **Then** no test file references `destinationNode` or `destinationMode`.
3. **Given** dead tests are removed from `interpret.test.ts`, **When** mock infrastructure is updated to remove `executeBounded` from `createMockDeps` and `destinationNode`/`destinationMode` from `DefaultBaseRequest`, **Then** no orphaned mock setup remains for removed functions.

---

### User Story 2 - Fix Mislabeled and Duplicate Tests (Priority: P1)

The guardrail evaluation tests have step numbers that don't match the source code's canonical step numbering, and the diagnostics errors tests contain an exact duplicate block. A maintainer reading the test suite gets confused about which guardrail step is actually being tested.

**Why this priority**: Mislabeled tests actively mislead anyone reading or modifying the guardrail logic. This is independent of phase-12 and can be done immediately.

**Independent Test**: After fixes, every `describe('Step N:` label in `evaluate.test.ts` matches the corresponding `// Step N:` comment in `evaluate.ts`, and `errors.test.ts` has no duplicate describe blocks.

**Acceptance Scenarios**:

1. **Given** `evaluate.test.ts` labels "Step 6: DeFlaker warn", **When** the label is corrected, **Then** it reads "Step 5: DeFlaker warn" matching `evaluate.ts` line 83.
2. **Given** `evaluate.test.ts` labels "Step 7: broad-target warn" (creating a duplicate Step 7), **When** the label is corrected, **Then** it reads "Step 6: broad-target warn" matching `evaluate.ts` line 98.
3. **Given** the pipeline test at ~line 357 is labeled "Step 4 wins over Steps 5-8" but actually retests the Step 3 redirect condition, **When** the test is rewritten, **Then** it tests Step 4 (narrow) winning — using `layer: 'static'`, a large graph with 1-2 changes out of 15, and asserting `action === 'narrow'`.
4. **Given** `errors.test.ts` has a duplicate `contextKind edge cases` describe block (6 tests, ~29 lines), **When** the duplicate is removed, **Then** only one `contextKind edge cases` block remains with no loss of unique test coverage.

---

### User Story 3 - Add Missing Coverage for Merge Node Classification (Priority: P2)

The static analysis classify tests cover If, Switch, and Filter nodes but have zero coverage for `classifyMergeNode()`, which contains 5 distinct mode branches. A contributor modifying merge classification logic has no test safety net.

**Why this priority**: Medium priority — the merge node classifier has real branching logic (5 modes) that is untested. This is the highest-value coverage gap.

**Independent Test**: After adding tests, each of the 5 merge modes (append, chooseBranch, combineByPosition, combineByFields, multiplex/combineBySql) has at least one test asserting the correct classification.

**Acceptance Scenarios**:

1. **Given** a Merge node configured with mode `append`, **When** `classifyMergeNode()` is called, **Then** the correct classification is returned.
2. **Given** a Merge node configured with each of the remaining 4 modes (chooseBranch, combineByPosition, combineByFields, multiplex), **When** `classifyMergeNode()` is called for each, **Then** each returns the correct distinct classification.

---

### User Story 4 - Add Missing Coverage for Expression Pattern Extractors (Priority: P2)

The expression tests cover `$json` and `$node["Name"]` bracket syntax but miss three extractor functions that exist in source: `extractBinaryRefs()`, `extractItemsRefs()`, and `extractNodeDotRefs()` (dot syntax). A contributor changing expression parsing has partial blind spots.

**Why this priority**: Medium priority — three extractor functions exist in production with no dedicated tests.

**Independent Test**: After adding tests, `$binary`, `$items()`, and `$node.DisplayName` dot syntax each have at least one test case verifying correct extraction.

**Acceptance Scenarios**:

1. **Given** an expression containing `$binary` references, **When** `extractBinaryRefs()` is called, **Then** the binary references are correctly extracted.
2. **Given** an expression containing `$items()` calls, **When** `extractItemsRefs()` is called, **Then** the items references are correctly extracted.
3. **Given** an expression containing `$node.DisplayName` dot syntax, **When** `extractNodeDotRefs()` is called, **Then** the node references are correctly extracted via dot syntax (not just bracket syntax).

---

### User Story 5 - Add Missing Coverage for Edge Cases (Priority: P3)

Two low-priority coverage gaps exist: the unresolvable branching reference path in redirect logic, and an incomplete trust-boundary propagation test in the orchestrator.

**Why this priority**: Low priority — these are edge-case paths with limited blast radius, but they round out the audit.

**Independent Test**: Each gap is independently testable with a single new test case.

**Acceptance Scenarios**:

1. **Given** a branching node with `resolved: false` from an opaque upstream node, **When** the redirect escalation logic evaluates it, **Then** the branching trigger fires (testing the `!ref.resolved` branch).
2. **Given** the trust-boundary propagation test in `resolve.test.ts`, **When** matching trust records are inserted with correct content hashes for boundary nodes, **Then** the slice size is smaller than the full 4-node baseline (`slice.nodes.size < 4`).

---

### User Story 6 - Zero-Error Gate (Priority: P1)

This is the final polish pass before v0.1.0 release. After all audit items are resolved, the codebase must achieve zero errors and zero warnings across typecheck, tests, and lint — including preexisting issues from earlier phases.

**Why this priority**: This is a release gate. No exceptions, no carve-outs.

**Independent Test**: Run `npm run typecheck`, `npm test`, and `npm run lint` — all three must exit with zero errors, zero warnings, and zero skipped tests.

**Acceptance Scenarios**:

1. **Given** all audit changes are applied, **When** `npm run typecheck` is run, **Then** it reports 0 errors.
2. **Given** all audit changes are applied, **When** `npm test` is run, **Then** it reports 0 failures and 0 skipped tests.
3. **Given** all audit changes are applied, **When** `npm run lint` is run, **Then** it reports 0 errors and 0 warnings across all files.
4. **Given** a preexisting lint warning exists in a file untouched by the audit, **When** the audit phase completes, **Then** that warning has been fixed (preexisting issues are in scope).

---

### Edge Cases

- What happens if phase-12 source removal is incomplete when R1 tests are removed? Tests must only be removed after confirming the corresponding source functions no longer exist.
- What happens if fixing a lint warning in an untouched file causes a behavioral change? Each fix must be verified with a test run to ensure no regressions.
- What happens if the pipeline precedence test rewrite (F2) exposes a bug in the narrow logic? The test should faithfully assert current behavior; if the behavior is wrong, that's a separate fix tracked outside this audit.

## Requirements

### Functional Requirements

- **FR-001**: System MUST remove all test code exercising `executeBounded()`, `destinationNode`, `destinationMode`, and REST-based execution triggering after phase-12 source removal (~215 lines across 2 files).
- **FR-002**: System MUST remove the duplicate `contextKind edge cases` describe block from `errors.test.ts` (~29 lines).
- **FR-003**: System MUST correct the "Step 6: DeFlaker warn" label to "Step 5: DeFlaker warn" in `evaluate.test.ts`.
- **FR-004**: System MUST correct the "Step 7: broad-target warn" label to "Step 6: broad-target warn" in `evaluate.test.ts`.
- **FR-005**: System MUST rewrite the mislabeled "Step 4 wins" pipeline test to actually test Step 4 (narrow) winning over later steps, or delete it if rewriting is not feasible.
- **FR-006**: System MUST add 5 test cases for `classifyMergeNode()` covering modes: append, chooseBranch, combineByPosition, combineByFields, and multiplex/combineBySql.
- **FR-007**: System MUST add test cases for `extractBinaryRefs()`, `extractItemsRefs()`, and `extractNodeDotRefs()` (dot syntax).
- **FR-008**: System MUST add a test case for the `!ref.resolved` branch in redirect escalation logic.
- **FR-009**: System MUST complete the trust-boundary propagation test in `resolve.test.ts` with correct content hashes and a smaller-slice assertion.
- **FR-010**: System MUST achieve zero errors from `npm run typecheck`, zero failures and zero skipped from `npm test`, and zero errors and zero warnings from `npm run lint` after all changes.
- **FR-011**: System MUST fix any preexisting typecheck, test, or lint issues discovered during the audit, regardless of which phase introduced them.

### Constraints

- **C-001**: R1 (dead code removal) MUST NOT be performed until phase-12 source removal is confirmed complete.
- **C-002**: R2, F1, F2 are independent of phase-12 and may be performed immediately.
- **C-003**: A1-A4 (coverage gaps) are independent and may be performed in any order.
- **C-004**: The audit must not introduce new test patterns that conflict with the project's testing conventions (vitest, fail-fast, contract-driven).

## Success Criteria

### Measurable Outcomes

- **SC-001**: Zero test files reference `executeBounded`, `destinationNode`, or `destinationMode` after audit completion.
- **SC-002**: Every `describe('Step N:` label in guardrail evaluation tests matches the corresponding `// Step N:` comment in the source file.
- **SC-003**: No duplicate test blocks exist in the diagnostics errors test file.
- **SC-004**: `classifyMergeNode()` has test coverage for all 5 merge modes.
- **SC-005**: Expression extractors for `$binary`, `$items()`, and dot-syntax node references each have at least one dedicated test.
- **SC-006**: Net test line reduction of approximately 185+ lines (215 removed from dead code + 29 removed from duplicates, minus ~60 lines of new coverage tests).
- **SC-007**: All three quality gate commands (`typecheck`, `test`, `lint`) exit with zero errors, zero warnings, and zero skipped tests.

### Assumptions

- Phase-12 execution backend revision will be merged before R1 dead code removal begins.
- The existing test infrastructure (vitest, fixtures, mock patterns) is sufficient for all new test cases — no new test dependencies are needed.
- The 5 merge mode branches in `classifyMergeNode()` are the complete set; no additional modes exist in the current source.
- Preexisting lint/typecheck issues are minor and fixable without architectural changes.
