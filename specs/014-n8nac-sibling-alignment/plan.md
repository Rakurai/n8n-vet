# Implementation Plan: n8nac Sibling Alignment

**Branch**: `014-n8nac-sibling-alignment` | **Date**: 2026-04-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/014-n8nac-sibling-alignment/spec.md`

## Summary

Correct n8n-vet's relationship with n8nac from "wrapped dependency" to "sibling tool". Three code fixes (remove dead JSON parser, fix workflowId conflation bug, remove unused skills dependency) plus documentation and skill updates to reflect the sibling model.

## Technical Context

**Language/Version**: TypeScript 5.x, ESM, Node >= 20  
**Primary Dependencies**: `@n8n-as-code/transformer` ^1.2.0 (parsing only), `@modelcontextprotocol/sdk`, `zod`  
**Storage**: File-based (`.n8n-vet/` directory for trust state, snapshots, pin data cache)  
**Testing**: vitest  
**Target Platform**: Node.js CLI / MCP server  
**Project Type**: Library with CLI and MCP server interfaces  
**Performance Goals**: N/A (dev tooling, not latency-sensitive)  
**Constraints**: Fresh clone must build and test with zero errors; no external setup beyond Node >= 20  
**Scale/Scope**: Single-developer tool; ~15 source files modified, ~8 doc files updated

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Fail-Fast, No Fallbacks | PASS | Missing `metadata.id` returns error diagnostic (not a fallback — `interpret()` uses error-return pattern by design). JSON rejection throws `MalformedWorkflowError`. |
| II. Contract-Driven Boundaries | PASS | `metadata.id` validated at the orchestrator boundary before passing to execution. No re-checking deeper in MCP client. |
| III. No Over-Engineering | PASS | No new abstractions. ID extraction is inline. No wrapper for the two ID concepts. |
| IV. Honest Code Only | PASS | Removing dead code (`parseJsonFile`, `@n8n-as-code/skills`). No stubs or TODOs introduced. |
| V. Minimal, Meaningful Tests | PASS | Remove JSON parsing tests (dead code). Add tests for: JSON rejection error, missing metadata.id error, correct ID routing to MCP. |

**Post-Phase 1 re-check**: No violations introduced by design artifacts. Data model documents existing entities without new abstractions. Contract change is a removal (simpler, not more complex).

## Project Structure

### Documentation (this feature)

```text
specs/014-n8nac-sibling-alignment/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research findings
├── data-model.md        # Entity clarification (workflowFileId vs n8nWorkflowId)
├── quickstart.md        # Implementation overview
├── contracts/
│   └── parse-workflow-file.md  # parseWorkflowFile behavior change
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── static-analysis/
│   └── graph.ts              # B1: Remove parseJsonFile(), reject .json
├── orchestrator/
│   ├── interpret.ts          # B2: Extract ast.metadata.id, route to MCP calls
│   └── types.ts              # B2: Add clarifying comment to deriveWorkflowId()
├── execution/
│   └── mcp-client.ts         # No change (signature unchanged, receives correct ID)
skills/
└── validate-workflow/
    └── SKILL.md              # S1: Two-phase validation rewrite
docs/
├── DESIGN.md                 # D1: Sibling model, remove dependency framing
├── TECH.md                   # D1: Remove skills, ConfigService references
├── SCOPE.md                  # D1: Add non-goal for n8nac wrapping
├── CONCEPTS.md               # D1: Define two-phase validation vocabulary
├── prd/PLAN.md               # D1: Update phase descriptions
├── reference/execution.md    # D1: Remove skills package references
└── reference/static-analysis.md  # D1: Remove skills package references
README.md                     # D2: Add Prerequisites, Setup; fix JSON mention
package.json                  # P1: Remove @n8n-as-code/skills
.env.example                  # Verified: already correct (no N8N_HOST/API_KEY needed)

test/
├── static-analysis/
│   └── graph.test.ts         # Remove JSON tests, add JSON rejection test
└── orchestrator/
    └── interpret.test.ts     # Add metadata.id routing tests, missing-id error test
```

**Structure Decision**: Existing project structure. No new directories or files beyond spec artifacts. Changes are edits to existing files.

## Complexity Tracking

No constitution violations to justify.

## Implementation Phases

### Phase A: Code fixes (B1 + B2 + P1)

These are independent and can be implemented in parallel:

**B1 — Remove JSON parser** (`src/static-analysis/graph.ts`):
1. Delete `parseJsonFile()` function (lines 126-139)
2. In `parseWorkflowFile()`, replace `.json` branch with `throw new MalformedWorkflowError('...')`
3. Remove JSON imports (`JsonToAstParser` if applicable)
4. Update `test/static-analysis/graph.test.ts`: remove JSON fixture tests (lines 45-51, 149-152), add test for JSON rejection error

**B2 — Fix workflowId conflation** (`src/orchestrator/interpret.ts`):
1. After line 59 (`graph = deps.buildGraph(ast)`), extract: `const n8nWorkflowId = graph.ast.metadata.id.trim();`
2. Before execution block (line 167), add guard: if `effectiveLayer` includes execution and `!n8nWorkflowId`, return `errorDiagnostic('Workflow file missing metadata.id — cannot execute. Run n8nac push first to assign an n8n ID.', ...)`
3. At line 195, change `deps.executeSmoke(workflowId, ...)` → `deps.executeSmoke(n8nWorkflowId, ...)`
4. At line 205, change `getExecution(workflowId, ...)` → `getExecution(n8nWorkflowId, ...)`
5. Add clarifying comment to `deriveWorkflowId()` in `src/orchestrator/types.ts`
6. Update `test/orchestrator/interpret.test.ts`: add tests for correct ID routing and missing-id error

**P1 — Fresh-clone provisions** (`package.json`):
1. Remove `@n8n-as-code/skills` from `optionalDependencies`
2. Verify: `npm install && npm run build && npm test`

### Phase B: Documentation (D1 + D2 + S1)

Depends on Phase A being complete (docs reference the corrected behavior).

**D1 — Doc corrections** (7 files):
1. `docs/DESIGN.md` — Replace dependency framing with sibling model
2. `docs/TECH.md` — Remove skills and ConfigService references
3. `docs/SCOPE.md` — Add non-goal: n8nac wrapping
4. `docs/CONCEPTS.md` — Add two-phase validation definition
5. `docs/prd/PLAN.md` — Update phase descriptions referencing n8nac integration
6. `docs/reference/execution.md` — Remove skills package references (lines 293-294 area)
7. `docs/reference/static-analysis.md` — Remove skills package references (lines 224, 240, 285 area)

**D2 — Setup documentation** (`README.md`):
1. Add Prerequisites section (Node >= 20, n8n instance, n8nac)
2. Add Setup section (clone, install, build, .env)
3. Fix "TypeScript or JSON" → "TypeScript"
4. Update "Built on" section for sibling model

**S1 — Skill rewrite** (`skills/validate-workflow/SKILL.md`):
1. Add two-phase validation flow: static → push → execution
2. Explain `n8nac push` is agent's responsibility
3. Describe trust persistence across calls
4. Describe when `metadata.id` is needed vs. not

### Phase C: Verification

1. `npm run typecheck` — zero errors
2. `npm test` — zero failures
3. `npm run lint` — zero errors
4. Grep audit: `ConfigService`, `skills.*integration`, `n8nac.*dependency` across `docs/` → zero false claims
5. Verify no `parseJsonFile` or JSON parsing code in `src/static-analysis/graph.ts`
6. Verify `@n8n-as-code/skills` absent from `package.json`
