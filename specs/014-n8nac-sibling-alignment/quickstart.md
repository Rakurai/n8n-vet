# Quickstart: n8nac Sibling Alignment

**Feature**: 014-n8nac-sibling-alignment  
**Date**: 2026-04-19

## What changes

This phase corrects n8n-vet's relationship with n8nac from "wrapped dependency" to "sibling tool". Three code changes and three documentation updates.

## Code changes at a glance

### B1: Remove JSON parser
- **File**: `src/static-analysis/graph.ts`
- **What**: Delete `parseJsonFile()`, update `parseWorkflowFile()` to reject non-`.ts` with `MalformedWorkflowError`
- **Tests**: Remove JSON fixture tests in `test/static-analysis/graph.test.ts`

### B2: Fix workflowId conflation
- **File**: `src/orchestrator/interpret.ts` (lines 195, 205)
- **What**: After `graph = deps.buildGraph(ast)` (line 59), extract `graph.ast.metadata.id`. Pass it to `deps.executeSmoke()` and `getExecution()` instead of `workflowId`. Add guard: if `metadata.id` is empty and execution layer requested, return error diagnostic.
- **Key insight**: `workflowId` (file path) stays correct for trust/snapshot/pin-data. Only MCP calls need the n8n UUID.

### P1: Fresh-clone provisions
- **File**: `package.json`
- **What**: Remove `@n8n-as-code/skills` from `optionalDependencies`
- **Verify**: `npm install && npm run build && npm test` on clean state

## Documentation changes at a glance

### S1: Skill rewrite
- **File**: `skills/validate-workflow/SKILL.md`
- **What**: Add two-phase validation flow (static → push → execution), trust persistence

### D1: Doc corrections
- **Files**: `docs/DESIGN.md`, `docs/TECH.md`, `docs/SCOPE.md`, `docs/CONCEPTS.md`, `docs/prd/PLAN.md`, `docs/reference/execution.md`, `docs/reference/static-analysis.md`
- **What**: Replace "dependency" framing with "sibling tool", remove ConfigService/skills references

### D2: Setup documentation
- **File**: `README.md`
- **What**: Add Prerequisites and Setup sections, fix "TypeScript or JSON" → "TypeScript"

## Verification

```sh
npm run typecheck   # Zero errors
npm test            # Zero failures
npm run lint        # Zero errors
```

Then grep docs for stale references:
```sh
grep -rn 'ConfigService\|skills.*integration\|n8nac.*dependency' docs/
# Expected: zero matches
```
