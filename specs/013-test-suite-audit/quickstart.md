# Quickstart: Test Suite Audit

**Feature**: 013-test-suite-audit  
**Branch**: `013-test-suite-audit`

## Prerequisites

- Node.js >= 20
- `npm install` (dependencies already present)

## Development Loop

```sh
# Run all tests (after any change)
npm test

# Run a specific test file
npx vitest run test/guardrails/evaluate.test.ts

# Type-check
npm run typecheck

# Lint
npm run lint

# Lint auto-fix
npm run lint:fix
```

## Files to Modify

| File | Change |
|------|--------|
| `test/guardrails/evaluate.test.ts` | Fix step labels (lines 106, 243), rewrite pipeline test (line 367) |
| `test/diagnostics/errors.test.ts` | Delete duplicate block (lines 264-304) |
| `test/static-analysis/classify.test.ts` | Add 5 merge mode tests |
| `test/static-analysis/expressions.test.ts` | Add 3 extractor tests |
| `test/guardrails/redirect.test.ts` | Add 1 unresolved-ref test |
| `test/orchestrator/resolve.test.ts` | Complete trust-boundary test |

## Verification

All three must pass with zero errors/warnings:

```sh
npm run typecheck    # 0 errors
npm test             # 0 failures, 0 skipped
npm run lint         # 0 errors, 0 warnings
```
