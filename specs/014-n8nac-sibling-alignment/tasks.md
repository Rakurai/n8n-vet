# Tasks: n8nac Sibling Alignment

**Input**: Design documents from `/specs/014-n8nac-sibling-alignment/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included where the spec requires verification of new behavior (JSON rejection, ID routing, missing-ID error). No separate TDD phase — tests are inline with implementation tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: No project initialization needed — existing codebase. This phase handles the one shared prerequisite.

- [x] T001 Remove `@n8n-as-code/skills` from `optionalDependencies` in `package.json`

---

## Phase 2: User Story 1 — Agent validates with correct execution ID (Priority: P1)

**Goal**: Fix the workflowId conflation bug so MCP execution calls receive the n8n UUID from `ast.metadata.id` instead of the file-path-based ID, while trust/snapshot persistence continues using the file-path ID.

**Independent Test**: Parse a `.ts` file with `@workflow({ id: 'uuid' })`, request execution validation, and verify the UUID reaches `executeSmoke`/`getExecution` while trust state uses the file path.

### Implementation

- [x] T002 [US1] In `src/orchestrator/interpret.ts`, after `graph = deps.buildGraph(ast)` (line 59), extract `const n8nWorkflowId = graph.ast.metadata.id.trim()`
- [x] T003 [US1] In `src/orchestrator/interpret.ts`, inside the execution block (line 167), add guard: if `!n8nWorkflowId`, skip the MCP calls and instead push an error into the diagnostic flow (e.g., add an OrchestratorError to a collected errors array) rather than returning `errorDiagnostic()` early — this preserves any static findings already collected when `layer: 'both'`
- [x] T004 [US1] In `src/orchestrator/interpret.ts`, change `deps.executeSmoke(workflowId, ...)` (line 195) to `deps.executeSmoke(n8nWorkflowId, ...)` and `getExecution(workflowId, ...)` (line 205) to `getExecution(n8nWorkflowId, ...)`
- [x] T005 [US1] In `src/orchestrator/types.ts`, add clarifying comment to `deriveWorkflowId()`: "Returns project-relative file path for local persistence (trust state, snapshots, pin data). NOT for n8n API calls — use WorkflowAST.metadata.id for MCP execution."
- [x] T006 [US1] In `test/orchestrator/interpret.test.ts`, add test: execution calls receive `ast.metadata.id` (UUID), not the file-path workflowId
- [x] T007 [US1] In `test/orchestrator/interpret.test.ts`, add test: missing `metadata.id` with execution layer returns error diagnostic with message containing "missing metadata.id"
- [x] T008 [US1] In `test/orchestrator/interpret.test.ts`, add test: missing `metadata.id` with static-only layer proceeds without error
- [x] T009 [US1] In `test/orchestrator/interpret.test.ts`, add test: trust state and snapshot persistence still use file-path-based workflowId (not n8n UUID)
- [x] T010 [US1] In `test/orchestrator/interpret.test.ts`, add test: `layer: 'both'` with missing `metadata.id` returns static findings AND an execution error (not an early-return that discards static results)
- [x] T011 [US1] In `test/orchestrator/interpret.test.ts`, add test: whitespace-only `metadata.id` (e.g., `'   '`) is treated as missing — same error as empty string

**Checkpoint**: `npm run typecheck` and `npm test` pass. Execution calls route the correct ID type.

---

## Phase 3: User Story 2 — JSON files rejected with clear error (Priority: P2)

**Goal**: Remove dead `parseJsonFile()` code and reject `.json` files with `MalformedWorkflowError` directing users to n8nac.

**Independent Test**: Call `parseWorkflowFile('foo.json')` and verify it throws `MalformedWorkflowError`. Verify no `parseJsonFile` function exists in source.

### Implementation

- [x] T012 [US2] In `src/static-analysis/graph.ts`, delete the `parseJsonFile()` function (lines 126-139) and remove any associated imports (e.g., `JsonToAstParser`)
- [x] T013 [US2] In `src/static-analysis/graph.ts`, update `parseWorkflowFile()` to replace the `.json` branch (line 107) with `throw new MalformedWorkflowError('JSON workflow files are not supported. Use n8nac to author workflows in TypeScript.')`
- [x] T014 [US2] In `test/static-analysis/graph.test.ts`, remove JSON fixture tests (lines 45-51 area: `buildGraph` from JSON fixture) and JSON file parsing tests (lines 149-152 area)
- [x] T015 [US2] In `test/static-analysis/graph.test.ts`, add test: `parseWorkflowFile('foo.json')` throws `MalformedWorkflowError` with message mentioning n8nac
- [x] T016 [US2] In `test/static-analysis/graph.test.ts`, add test: `parseWorkflowFile('foo.ts')` still works as before (regression guard)
- [x] T017 [US2] In `test/static-analysis/graph.test.ts`, add test: `parseWorkflowFile('foo')` (no extension) throws `MalformedWorkflowError`

**Checkpoint**: `npm run typecheck` and `npm test` pass. No JSON parsing code in `src/static-analysis/graph.ts`.

---

## Phase 4: User Story 3 — Skill describes two-phase validation (Priority: P2)

**Goal**: Rewrite the skill file to clearly describe static validation (before push), n8nac push (agent responsibility), and execution validation (after push), plus trust persistence.

**Independent Test**: Skill file contains explicit references to all three phases and trust persistence.

### Implementation

- [x] T018 [US3] Rewrite `skills/validate-workflow/SKILL.md` to describe two-phase validation: (1) static validation before push (no n8n instance needed), (2) n8nac push as agent's responsibility, (3) execution validation after push (requires deployed workflow)
- [x] T019 [US3] In `skills/validate-workflow/SKILL.md`, add section on trust persistence: static trust carries forward to execution validation, reducing re-validation work
- [x] T020 [US3] In `skills/validate-workflow/SKILL.md`, note that execution validation requires `metadata.id` (populated after first `n8nac push`)

**Checkpoint**: Skill file covers all three phases, trust persistence, and metadata.id requirement.

---

## Phase 5: User Story 4 — Fresh clone setup works (Priority: P3)

**Goal**: README has Prerequisites and Setup sections. Fresh clone builds and tests with zero errors.

**Independent Test**: Follow README setup instructions; `npm install && npm run build && npm test` succeeds.

### Implementation

- [x] T021 [US4] In `README.md`, add a "Prerequisites" section before Quick Start listing: Node >= 20, n8n instance (for execution validation), n8nac (for workflow authoring/push)
- [x] T022 [US4] In `README.md`, add a "Setup" section with steps: clone, `npm install`, `npm run build`, copy `.env.example` → `.env`, fill in values
- [x] T023 [US4] In `README.md`, fix "TypeScript or JSON via n8n-as-code" → "TypeScript via n8n-as-code"
- [x] T024 [US4] In `README.md`, update "Built on" section to describe n8nac as a sibling tool, not a dependency
- [x] T025 [US4] Verify fresh-clone pipeline: `npm install && npm run build && npm test` succeeds with zero errors (run after T001 changes)

**Checkpoint**: README has Prerequisites and Setup sections. Build pipeline verified.

---

## Phase 6: User Story 5 — Documentation accurately describes sibling model (Priority: P3)

**Goal**: All documentation files consistently describe n8nac as a sibling tool. No stale references to ConfigService, skills integration, or n8nac-as-dependency.

**Independent Test**: Grep audit across `docs/` for stale references returns zero false claims.

### Implementation

- [x] T026 [P] [US5] Update `docs/DESIGN.md`: replace "n8nac (dependency)" architecture framing with sibling-tool model; remove claims about transformer + skills + ConfigService; add "Relationship to n8nac" section
- [x] T027 [P] [US5] Update `docs/TECH.md`: remove `@n8n-as-code/skills` from technology decisions; remove ConfigService references; clarify transformer is for `.ts` parsing only
- [x] T028 [P] [US5] Update `docs/SCOPE.md`: add explicit non-goal: "n8n-vet does not wrap, proxy, or orchestrate n8nac. The agent coordinates both tools independently."
- [x] T029 [P] [US5] Update `docs/CONCEPTS.md`: add two-phase validation definition (static before push, execution after push) as shared vocabulary
- [x] T030 [P] [US5] Update `docs/prd/PLAN.md`: correct phase descriptions that reference n8nac integration to reflect sibling model
- [x] T031 [P] [US5] Update `docs/reference/execution.md`: remove `@n8n-as-code/skills` references (lines 293-294 area about "schema discovery for pin data construction")
- [x] T032 [P] [US5] Update `docs/reference/static-analysis.md`: remove skills package references (lines 224, 240, 285 area)

**Checkpoint**: All documentation consistent. Grep audit for `ConfigService`, `skills.*integration`, `n8nac.*dependency` across `docs/` returns zero false claims.

---

## Phase 7: Polish & Cross-Cutting Verification

**Purpose**: Final verification that all changes work together.

- [x] T033 Run `npm run typecheck` — zero errors
- [x] T034 Run `npm test` — zero failures
- [x] T035 Run `npm run lint` — zero errors
- [x] T036 Verify no `parseJsonFile` or JSON parsing code in `src/static-analysis/graph.ts`
- [x] T037 Verify `@n8n-as-code/skills` absent from `package.json`
- [x] T038 Run grep audit across `docs/` for stale n8nac-as-dependency references — zero false claims

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (US1 — workflowId fix)**: Depends on Phase 1
- **Phase 3 (US2 — JSON removal)**: Depends on Phase 1; can run in parallel with Phase 2
- **Phase 4 (US3 — Skill rewrite)**: Depends on Phases 2 and 3 (skill references corrected code behavior)
- **Phase 5 (US4 — README/setup)**: Depends on Phases 1, 2, 3 (docs reference corrected behavior)
- **Phase 6 (US5 — Doc corrections)**: Depends on Phases 2 and 3 (docs reference corrected behavior); can run in parallel with Phases 4 and 5
- **Phase 7 (Verification)**: Depends on all previous phases

### Parallel Opportunities

- **Phase 2 + Phase 3**: US1 (workflowId fix) and US2 (JSON removal) touch different files and can be implemented in parallel
- **Phase 4 + Phase 5 + Phase 6**: Skill rewrite, README update, and doc corrections all touch different files and can be implemented in parallel
- **Within Phase 6**: All T026-T032 are marked [P] — they edit different documentation files

### Parallel Example: Code Fixes (Phase 2 + Phase 3)

```
Agent A: T002-T011 — Fix workflowId in interpret.ts and its tests
Agent B: T012-T017 — Remove JSON parser in graph.ts and its tests
```

### Parallel Example: Documentation (Phase 4 + Phase 5 + Phase 6)

```
Agent A: T018-T020 — Skill rewrite
Agent B: T021-T025 — README setup docs
Agent C: T026-T032 — Doc corrections (all [P] within phase)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Remove unused skills dependency
2. Complete Phase 2: Fix workflowId conflation bug
3. **STOP and VALIDATE**: `npm run typecheck && npm test` — execution calls now use correct n8n UUID
4. This alone fixes the critical runtime bug

### Incremental Delivery

1. Phase 1 + Phase 2 → workflowId bug fixed (MVP)
2. Phase 3 → JSON dead code removed
3. Phase 4 → Skill documentation corrected
4. Phase 5 → README setup docs added
5. Phase 6 → All documentation aligned to sibling model
6. Phase 7 → Final verification sweep

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Tests are inline with implementation (not a separate TDD phase) because this is a corrective/cleanup feature, not a greenfield build
- Commit after each phase checkpoint
- The workflowId fix (US1) is the highest-value change — it fixes a runtime bug blocking all execution validation
