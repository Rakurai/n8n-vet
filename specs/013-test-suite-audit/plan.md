# Implementation Plan: Test Suite Audit

**Branch**: `013-test-suite-audit` | **Date**: 2026-04-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/013-test-suite-audit/spec.md`

## Summary

Audit the test suite (~8600 lines across 42 files) to remove dead code, fix mislabeled tests, delete duplicates, and close coverage gaps — then achieve zero errors/warnings across typecheck, test, and lint as the v0.1.0 release gate.

**Key finding from research**: R1 (dead code removal) is already complete — phase-12 removed `executeBounded`, `destinationNode`, `destinationMode` from both source and tests. The remaining work is F1/F2 (fix mislabeled steps), R2 (remove duplicates), A1-A4 (coverage gaps), and the zero-error gate.

## Technical Context

**Language/Version**: TypeScript 5.x, ESM, Node >= 20  
**Primary Dependencies**: vitest (testing), biome (lint/format), zod (schema validation)  
**Storage**: N/A  
**Testing**: vitest — factory-function fixtures, `vi.fn()` mocks, `describe`/`it` structure  
**Target Platform**: Node.js library + CLI + MCP server  
**Project Type**: Library/CLI  
**Performance Goals**: N/A (test audit, not runtime feature)  
**Constraints**: Zero errors, zero warnings, zero skipped tests across all tooling  
**Scale/Scope**: ~8600 test lines across 42 files; ~10 files modified

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Fail-Fast, No Fallbacks | PASS | No fallback logic being introduced |
| II. Contract-Driven Boundaries | PASS | Tests follow existing contract patterns |
| III. No Over-Engineering | PASS | Adding minimum tests for untested branches; no new abstractions |
| IV. Honest Code Only | PASS | Removing dead code and fixing mislabels is exactly this principle |
| V. Minimal, Meaningful Tests | PASS | Each new test covers a distinct untested branch (merge modes, expression extractors, unresolved refs). Removing duplicates aligns with "no redundant tests" |

No violations. No complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/013-test-suite-audit/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (minimal — test audit)
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
test/
├── diagnostics/
│   └── errors.test.ts          # R2: remove duplicate contextKind block (lines 268-304)
├── guardrails/
│   ├── evaluate.test.ts        # F1: fix step labels (lines 106, 243)
│   │                           # F2: rewrite pipeline test (line 367)
│   └── redirect.test.ts        # A3: add !ref.resolved test
├── orchestrator/
│   └── resolve.test.ts         # A4: complete trust-boundary propagation test
├── static-analysis/
│   ├── classify.test.ts        # A1: add 5 merge mode tests
│   └── expressions.test.ts     # A2: add $binary, $items(), dot-syntax tests
└── integration/
    └── scenarios/
        └── 06-bounded-execution.ts  # Already updated by phase-12
```

**Structure Decision**: No new files or directories. All changes are edits to existing test files.

## Phase 2: Implementation Tasks

### Work Stream 1: Fix & Remove (independent of each other, no dependencies)

**Task 1.1 — F1: Fix mislabeled guardrail step numbers**
- File: `test/guardrails/evaluate.test.ts`
- Line 106: Change `describe('Step 6: DeFlaker warn'` → `describe('Step 5: DeFlaker warn'`
- Line 243: Change `describe('Step 7: broad-target warn'` → `describe('Step 6: broad-target warn'`

**Task 1.2 — F2: Rewrite mislabeled pipeline precedence test**
- File: `test/guardrails/evaluate.test.ts`
- Line 367: Currently labeled "Step 4 wins over Steps 5-8" but triggers redirect (Step 3) — same condition as line 352
- Rewrite to test Step 4 (narrow) winning: use `layer: 'static'`, `largeGraph()` with 1-2 changes out of 15 nodes, partial trust state for non-changed nodes, expect `action === 'narrow'`
- Pattern reference: The existing Step 5 pipeline test at line 385 already tests narrow with a similar setup

**Task 1.3 — R2: Remove duplicate contextKind edge cases block**
- File: `test/diagnostics/errors.test.ts`
- Delete lines 264-304 (the `T034` comment block + entire `classifyExecutionErrors — contextKind edge cases` describe block)
- These 6 tests are exact duplicates of tests in the main `classifyExecutionErrors` block at lines 140-178
- Verify no unique test coverage is lost by comparing fixtures and assertions

### Work Stream 2: Add Coverage (independent of each other)

**Task 2.1 — A1: Add merge node classification tests**
- File: `test/static-analysis/classify.test.ts`
- Add 5 tests for `classifyMergeNode()` via the public `classifyNode()` API (which delegates to `classifyMergeNode` for Merge nodes)
- Node type: `n8n-nodes-base.merge`
- Test cases matching `src/static-analysis/classify.ts:93-110`:
  1. mode `append` → `'shape-preserving'`
  2. mode `chooseBranch` → `'shape-preserving'`
  3. mode `combineByPosition` → `'shape-augmenting'`
  4. mode `combineByFields` → `'shape-augmenting'`
  5. mode `combineBySql` → `'shape-replacing'`
- Use existing `makeNode()` helper pattern with `parameters: { mode: '...' }`

**Task 2.2 — A2: Add expression extractor tests**
- File: `test/static-analysis/expressions.test.ts`
- Test through `traceExpressions()` (the only exported function)
- Use existing `makeGraph()` helper to construct minimal graphs
- 3 test cases:
  1. `$binary.data` pattern → resolved: false, fieldPath: 'data' (binary can't be statically analyzed)
  2. `$items("NodeName")` pattern → resolved: true if NodeName in displayNameIndex
  3. `$node.DisplayName.json.field` dot syntax → resolved: true if DisplayName in displayNameIndex

**Task 2.3 — A3: Add unresolvable branching reference test**
- File: `test/guardrails/redirect.test.ts`
- Add 1 test: branching node with expression ref where `resolved: false` and `referencedNode: null`, upstream node classified as `shape-opaque`
- This tests `src/guardrails/redirect.ts:101-113` — the `else if (!ref.resolved)` branch
- Expected: redirect trigger fires with message containing "unresolvable expression"
- Follow existing test patterns in this file for fixture setup

**Task 2.4 — A4: Complete trust-boundary propagation test**
- File: `test/orchestrator/resolve.test.ts`
- Complete the test at line 330: `stops propagation at trusted boundaries`
- Current state: only asserts no-trust baseline (all 4 nodes in slice)
- Add: compute actual content hash for boundary nodes (A and D) using `computeContentHash` from trust module, insert matching trust records, call `resolveTarget` again, assert `slice.nodes.size < 4`
- The test's comment at line 335-339 explains the challenge: need real content hashes matching the minimal test AST

### Work Stream 3: Zero-Error Gate

**Task 3.1 — Run full quality gate and fix any issues**
- Run `npm run typecheck` — fix any errors
- Run `npm test` — fix any failures or skipped tests
- Run `npm run lint` — fix any errors or warnings (including preexisting ones in untouched files)
- This is the final task; depends on all other tasks being complete
- Any preexisting issues from earlier phases are in scope

## Execution Order

```
Work Stream 1 (F1, F2, R2) ──┐
                               ├── Task 3.1 (zero-error gate)
Work Stream 2 (A1-A4) ────────┘
```

Tasks within each work stream are independent and can be parallelized. Task 3.1 must run last.

## R1 Status (Dead Code Removal)

**ALREADY COMPLETE.** Phase-12 removed all `executeBounded`, `destinationNode`, `destinationMode` references from both source and test files. The `rest-client.test.ts` file no longer exists. Integration scenario 06 has been rewritten for the new MCP execution backend. No R1 work remains.

Evidence:
- `grep -r executeBounded test/` → no matches
- `grep -r 'destinationNode\|destinationMode' test/` → only in integration/scenarios/06 comment (not code)
- `test/execution/rest-client.test.ts` → file does not exist
