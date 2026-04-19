# Phase 13 — Test Suite Audit

## Goal

Audit 42 test files (9002 lines) for dead code, duplicates, mislabeled tests, coverage gaps, and redundancy. Remove what's wrong, fix what's misleading, and identify gaps worth closing — without over-testing a tool that isn't space shuttle code.

## Context Files

| File | Role |
|------|------|
| `docs/prd/phase-12-execution-backend-revision.md` | Execution backend revision — defines which code paths are dead |
| `docs/CODING.md` | Code discipline — fail-fast, contract-driven, no defensive programming |
| `docs/STRATEGY.md` | Validation strategy — guardrail step ordering, scoring tiers |
| `src/guardrails/evaluate.ts` | Canonical step numbering (Steps 1–8) |

## Findings

### Overall health

Trust (4 files, 1225 lines), diagnostics (6 files), execution MCP path (1 file), orchestrator non-execution (3 files), and graph/data-loss (2 files) are strong. No changes needed for ~32 of 42 files.

The main problems: dead code from the REST execution removal (phase-12), a block of duplicate tests, step-numbering errors in guardrails, and a few coverage gaps in static-analysis.

---

## Scope

### In scope — Remove

#### R1. Dead code tests (phase-12 dependency)

Tests that exercise `executeBounded()`, `destinationNode`, `destinationMode`, and REST-based execution triggering. These code paths are being removed in phase-12; the tests will break on deletion and should go with it.

| File | Test / block | ~Lines |
|------|-------------|--------|
| `test/execution/rest-client.test.ts` | Entire `executeBounded` describe block + `TriggerExecutionResponseSchema` tests | 119 |
| `test/orchestrator/interpret.test.ts` | `runs both static and execution for layer:both` | 22 |
| `test/orchestrator/interpret.test.ts` | `runs execution only for layer:execution` | 22 |
| `test/orchestrator/interpret.test.ts` | `uses inclusive/exclusive destination mode` | 22 |
| `test/orchestrator/interpret.test.ts` | `returns error on execution failure` (bounded path) | 30 |

**Total: ~215 lines removed.**

After removal, update mock infrastructure in `interpret.test.ts` to remove `executeBounded` from `createMockDeps` and `destinationNode`/`destinationMode` from `DefaultBaseRequest` (these become dead once source types are updated in phase-12).

#### R2. Duplicate tests

| File | Test / block | ~Lines | Reason |
|------|-------------|--------|--------|
| `test/diagnostics/errors.test.ts` | `classifyExecutionErrors — contextKind edge cases` describe block (6 tests) | 29 | Exact duplicates of tests in the main `classifyExecutionErrors` describe block directly above. Same fixtures, same assertions, same outcomes. |

### In scope — Fix

#### F1. Mislabeled guardrail step numbers

`test/guardrails/evaluate.test.ts` has step numbers off by one in two describe blocks, creating two blocks both claiming "Step 7":

| Line | Current | Correct |
|------|---------|---------|
| ~106 | `describe('Step 6: DeFlaker warn'` | `describe('Step 5: DeFlaker warn'` |
| ~245 | `describe('Step 7: broad-target warn'` | `describe('Step 6: broad-target warn'` |

Source reference: `src/guardrails/evaluate.ts` lines 83 (`// Step 5: DeFlaker warn`) and 98 (`// Step 6: Broad-target warn`).
**Note:** Staged changes already corrected `Step 3: identical rerun` → `Step 7: identical rerun` and fixed the pipeline test at ~349 (now expects `redirect` instead of `refuse`). The two items above remain unfixed.
#### F2. Mislabeled and redundant pipeline precedence test

`test/guardrails/evaluate.test.ts` pipeline integration suite, approximately line 357:

```
it('Step 4 wins over Steps 5-8: redirect fires before narrowing'
```

This test actually triggers redirect (Step 3) again — it uses `layer: 'execution'` and shape-preserving changes, which is the same redirect condition as the Step 3 test above it. It is **redundant with Step 3** and **mislabeled as Step 4**.

Options:
- **Preferred:** Rewrite to actually test Step 4 (narrow) winning — use `layer: 'static'` (skip redirect), `largeGraph()` with 1–2 changes out of 15, and expect `action === 'narrow'`.
- **Acceptable:** Delete as redundant.

### In scope — Add (coverage gaps)

#### A1. Merge node classification (medium priority)

`test/static-analysis/classify.test.ts` tests If, Switch, Filter nodes (all hitting `SHAPE_PRESERVING_TYPES.has()`) but has **zero tests** for `classifyMergeNode()`, which has 5 distinct mode branches: append, chooseBranch, combineByPosition, combineByFields, multiplex/combineBySql.

Add 5 test cases covering each merge mode classification.

#### A2. Expression pattern extractors (medium priority)

`test/static-analysis/expressions.test.ts` tests `$json`, `$node["Name"]` (bracket), and now `$json["bracket"]` string literal access (staged). Still missing:
- `$binary` patterns (`extractBinaryRefs()` exists in source)
- `$items()` patterns (`extractItemsRefs()` exists in source)
- `$node.DisplayName` dot syntax (`extractNodeDotRefs()` exists, only bracket tested)

Add 3 test cases.

#### A3. Unresolvable branching reference (low priority)

`test/guardrails/redirect.test.ts` tests the resolved branching trigger but not the `!ref.resolved` branch in the escalation logic. The code handles unresolvable references from opaque upstream nodes differently from resolved references.

Add 1 test case: branching node with `resolved: false` from opaque upstream → triggered.

#### A4. Incomplete trust-boundary propagation test (low priority)

`test/orchestrator/resolve.test.ts` has a staged test `stops propagation at trusted boundaries during node-targeted validation` that only asserts the no-trust baseline (all 4 nodes in slice). The trust-bounded assertion — showing a smaller slice when trust records exist — is missing. A comment in the test shows the author realized hash setup was non-trivial and left it incomplete.

Complete the test: compute the actual content hash for the boundary nodes, insert matching trust records, and assert `slice.nodes.size < 4`.

### Out of scope — Not worth changing

#### Redundant guard tests (static-analysis)

`schemas.test.ts` tests the same "no provider" guard 3 times; `params.test.ts` tests "unavailable schema" 3 times. These are noise but not harmful — collapsing them saves ~20 lines but risks losing clarity in test names.

#### Plugin structure tests

`mcp-config.test.ts`, `manifest.test.ts`, `hook.test.ts` are static file checks better suited to linting. They're cheap, catch real breakage (version sync, env var presence), and not worth refactoring into a schema validator.

#### Trivial passthrough tests (synthesize)

`synthesize.test.ts` US1 block has 4 tests verifying fields are passed through unchanged (schemaVersion, guardrailActions, capabilities, target). Low value individually but serve as lightweight integration checks.

#### narrow.test.ts overlap

Tests 1 and 5 both test happy-path narrowing with different trust setups. Minor overlap but each tests a different trust configuration, so they're defensible.

---

## Dependencies

- **R1 depends on phase-12**: Dead code tests should be removed alongside the source code they exercise. Don't remove tests for functions that still exist.
- **R2, F1, F2 are independent**: Can be done immediately.
- **A1–A3 are independent**: Can be done anytime. No dependency on other phases.

## Success Criteria

### Test audit

- No test references `executeBounded`, `destinationNode`, or `destinationMode` (after phase-12 source removal)
- Step numbers in `evaluate.test.ts` match `evaluate.ts` source comments exactly
- No duplicate test blocks remain in `errors.test.ts`
- `classifyMergeNode()` has test coverage for all 5 modes
- Expression extractors for `$binary`, `$items()`, and dot syntax are tested

### Zero-error gate (release condition)

This is the final polish pass before release. After all audit items are resolved, the codebase must reach zero errors and zero warnings across all tooling — no exceptions, no "preexisting" carve-outs.

```
npm run typecheck    # 0 errors
npm run test         # 0 failures, 0 skipped
npm run lint         # 0 errors, 0 warnings (all files)
```

Any preexisting failures surfaced during this phase are in scope to fix, regardless of which phase introduced them. If a lint warning exists in a file untouched by the audit, fix it here. If a test was already flaky before this phase, stabilize or remove it here. The goal is a clean baseline for tagging v0.1.0.
