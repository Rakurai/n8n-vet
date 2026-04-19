# Tasks: Static Analysis Subsystem

**Input**: Design documents from `/specs/002-static-analysis/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Included — the PRD mandates "Unit tests with fixture workflow files" and CODING.md requires happy-path + public error-path tests.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the foundational types, error classes, and classification sets that all user stories depend on.

- [X] T001 [P] Create typed error classes (MalformedWorkflowError, ConfigurationError) in src/static-analysis/errors.ts
- [X] T002 [P] Create node type classification sets (shape-preserving, shape-opaque, trigger types) as const sets in src/static-analysis/node-sets.ts
- [X] T003 [P] Add `displayNameIndex: Map<string, string>` field to WorkflowGraph interface in src/types/graph.ts
- [X] T004 [P] Define StaticFinding discriminated union and ExpressionReference types in src/static-analysis/types.ts

---

## Phase 2: Foundational (Workflow Fixtures)

**Purpose**: Create workflow fixture files used by tests across all user stories. MUST complete before any user story tests.

**Note**: Fixtures are real n8n-as-code TypeScript workflow files that can be parsed by `TypeScriptParser`. Each fixture targets a specific analysis scenario.

- [X] T005 [P] Create simple linear workflow fixture (Trigger → HTTP Request → Set → output) in test/fixtures/workflows/linear-simple.ts
- [X] T006 [P] Create JSON equivalent of linear workflow fixture in test/fixtures/workflows/linear-simple.json
- [X] T007 [P] Create branching workflow fixture (If node with true/false paths) in test/fixtures/workflows/branching-if.ts
- [X] T008 [P] Create canonical data-loss bug pattern fixture (Trigger → API → Set referencing $json from trigger) in test/fixtures/workflows/data-loss-bug.ts
- [X] T009 [P] Create Code node opaque boundary fixture in test/fixtures/workflows/code-node-opaque.ts
- [X] T010 [P] Create explicit expression references fixture ($('NodeName') patterns) in test/fixtures/workflows/explicit-references.ts
- [X] T011 [P] Create single-trigger edge case fixture in test/fixtures/workflows/single-trigger.ts
- [X] T012 [P] Create malformed workflow fixtures (parseable TS files with structural issues: connections referencing non-existent propertyNames, duplicate propertyNames) in test/fixtures/workflows/malformed-broken-ref.ts and test/fixtures/workflows/malformed-duplicate-names.ts

**Checkpoint**: All shared infrastructure and fixtures ready. User story implementation can begin.

---

## Phase 3: User Story 1 — Parse Workflow and Build Graph (Priority: P1) MVP

**Goal**: Parse .ts/.json workflow files into a traversable WorkflowGraph with node classifications and displayName index.

**Independent Test**: Provide a fixture workflow file, verify the returned graph has correct nodes, edges, adjacency maps, classifications, and displayName index.

### Implementation for User Story 1

- [X] T013 [US1] Implement classifyNode() — node classification logic with priority-ordered matching rules from data-model.md classification decision table — in src/static-analysis/classify.ts
- [X] T014 [US1] Implement buildGraph() — construct WorkflowGraph from WorkflowAST with node map, edge list, forward/backward adjacency, displayNameIndex (FR-007), classification per node, and invariant enforcement (unique names, valid edge refs) — in src/static-analysis/graph.ts
- [X] T015 [US1] Implement parseWorkflowFile() — auto-detect .ts/.json by extension, delegate to TypeScriptParser.parseFile() or JsonToAstParser.parse(), raise ConfigurationError if transformer unavailable — in src/static-analysis/graph.ts

### Tests for User Story 1

- [X] T016 [P] [US1] Test classifyNode() — shape-preserving set, Set node options.include variants, credential-based detection, trigger detection, opaque defaults — in test/static-analysis/classify.test.ts
- [X] T017 [P] [US1] Test buildGraph() — TS parsing, JSON parsing, adjacency maps, displayNameIndex construction, malformed workflow errors (broken refs, duplicate names), single-trigger edge case, DAG assumption (n8n workflows cannot have cycles) — in test/static-analysis/graph.test.ts

**Checkpoint**: WorkflowGraph construction works for TS and JSON workflows. Node classification is correct. Malformed workflows raise typed errors.

---

## Phase 4: User Story 2 — Trace Expression References (Priority: P1)

**Goal**: Extract all expression references from node parameters, resolving display names to graph nodes via the displayNameIndex.

**Independent Test**: Provide a workflow with various expression patterns, verify ExpressionReference[] contains correct entries with resolved nodes and field paths.

### Implementation for User Story 2

- [X] T018 [US2] Implement expression pattern parser — port 4 ACCESS_PATTERNS regex ($json.field, $('DisplayName')..., $input..., $node["DisplayName"]...) with recursive parameter walking — in src/static-analysis/expressions.ts
- [X] T019 [US2] Implement traceExpressions() — walk target nodes' parameters, call expression parser, resolve display names via graph.displayNameIndex, return ExpressionReference[] — in src/static-analysis/expressions.ts

### Tests for User Story 2

- [X] T020 [US2] Test traceExpressions() — all 4 reference patterns, displayName resolution, nested parameters, unresolvable expressions ($fromAI(), dynamic keys), multiple expressions in one parameter — in test/static-analysis/expressions.test.ts

**Checkpoint**: Expression references extracted correctly for all supported patterns. Display name resolution works. Unresolvable references recorded with resolved=false.

---

## Phase 5: User Story 3 — Detect Data Loss Through Shape-Replacing Nodes (Priority: P1)

**Goal**: Detect data-loss-through-replacement patterns and opaque boundary warnings. Includes US6 (opaque boundary reporting) since opaque-boundary findings are emitted by the same detection logic.

**Independent Test**: Provide workflows with the canonical data-loss bug pattern, verify data-loss errors are produced for intervening shape-replacing nodes but NOT for first data sources (triggers, initial API nodes).

### Implementation for User Story 3

- [X] T021 [US3] Implement detectDataLoss() — upstream walk through shape-preserving nodes, first-data-source rule (all backward paths), opaque-boundary warning emission, explicit reference bypass, schema downgrade logic — in src/static-analysis/data-loss.ts

### Tests for User Story 3

- [X] T022 [US3] Test detectDataLoss() — canonical data-loss pattern, trigger as first data source (no false positive), first API node as first data source, shape-preserving pass-through, opaque boundary warning for Code nodes, branching graph first-data-source rule (all paths), explicit $('NodeName') reference bypass — in test/static-analysis/data-loss.test.ts

**Checkpoint**: Data-loss detection catches the canonical bug pattern. First data sources are NOT flagged. Opaque boundaries produce warnings. Explicit references bypass data-loss check.

---

## Phase 6: User Story 4 — Check Schema Compatibility (Priority: P2)

**Goal**: Check referenced field paths against upstream node schemas when available via NodeSchemaProvider. Skip gracefully when schemas are unavailable.

**Independent Test**: Provide a workflow where upstream node has a known schema, verify schema-mismatch warnings for non-existent fields and clean pass for existing fields.

### Implementation for User Story 4

- [X] T023 [US4] Implement checkSchemas() — look up upstream node type schema via optional NodeSchemaProvider.getNodeSchema(), check field existence against schema.properties, skip per-node when schema unavailable, return schema-mismatch findings — in src/static-analysis/schemas.ts

### Tests for User Story 4

- [X] T024 [US4] Test checkSchemas() — schema available with matching field (no finding), schema available with missing field (schema-mismatch warning), schema unavailable (skip without error), no schemaProvider passed (empty findings) — in test/static-analysis/schemas.test.ts

**Checkpoint**: Schema checking works when schemas are available. Graceful skip when unavailable. No crashes from missing schemas.

---

## Phase 7: User Story 5 — Validate Node Parameters (Priority: P2)

**Goal**: Validate node parameters against type definitions from n8nac skills, flagging missing required parameters and undefined credential types.

**Independent Test**: Provide a workflow with nodes missing required parameters or having invalid credentials, verify invalid-parameter and missing-credentials findings.

### Implementation for User Story 5

- [X] T025 [US5] Implement validateNodeParams() — look up IEnrichedNode via optional NodeSchemaProvider.getNodeSchema(nodeType), check required params in schema.properties, check credential type validity, skip nodes with no schema — in src/static-analysis/params.ts

### Tests for User Story 5

- [X] T026 [US5] Test validateNodeParams() — all params present (no finding), missing required param (invalid-parameter finding), undefined credential type (missing-credentials finding), no schemaProvider (empty findings), unknown node type (skip) — in test/static-analysis/params.test.ts

**Checkpoint**: Parameter validation catches missing required params and invalid credentials. Graceful degradation when skills package unavailable.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Wire up public API exports, verify build, ensure all pieces work together.

- [X] T027 Export parseWorkflowFile, buildGraph, traceExpressions, detectDataLoss, checkSchemas, validateNodeParams, and internal types (StaticFinding, ExpressionReference) from src/index.ts — matching the INDEX.md cross-subsystem contract (FR-024)
- [X] T028 Verify `npm run build` succeeds with no type errors
- [X] T029 Verify `npm test` passes all static-analysis tests
- [X] T030 Run quickstart.md validation — verify the documented usage pattern works end-to-end against a fixture workflow

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: No dependency on Phase 1 source code, but logically parallel — fixtures don't import error types
- **US1 (Phase 3)**: Depends on Phase 1 (types, errors, node-sets) — BLOCKS US2, US3
- **US2 (Phase 4)**: Depends on US1 (needs WorkflowGraph) — BLOCKS US3
- **US3 (Phase 5)**: Depends on US1 + US2 (needs graph + expression references)
- **US4 (Phase 6)**: Depends on US2 (needs expression references) — can run PARALLEL with US3
- **US5 (Phase 7)**: Depends on US1 (needs WorkflowGraph) — can run PARALLEL with US2, US3, US4
- **US6**: Folded into US3 (opaque-boundary findings are part of detectDataLoss)
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1 (Setup) ──┬── Phase 2 (Fixtures) ── needed by all tests
                   │
                   └── US1 (Graph) ──┬── US2 (Expressions) ──┬── US3 (Data Loss + US6 Opaque)
                                     │                        │
                                     │                        └── US4 (Schemas) [parallel with US3]
                                     │
                                     └── US5 (Params) [parallel with US2/US3/US4]
```

### Parallel Opportunities

- **Phase 1**: All 4 setup tasks (T001–T004) are independent files → all [P]
- **Phase 2**: All 8 fixture tasks (T005–T012) are independent files → all [P]
- **US1**: T016 and T017 test files are independent → [P]
- **US4 + US5**: Can run in parallel once their dependencies are met
- **US3 + US4**: Can run in parallel (US4 needs US2, US3 needs US2 — both can start after US2)

---

## Parallel Example: Phase 1 + Phase 2

```
# All setup tasks in parallel:
T001: Create error types in src/static-analysis/errors.ts
T002: Create node sets in src/static-analysis/node-sets.ts
T003: Add displayNameIndex to src/types/graph.ts
T004: Define internal types in src/static-analysis/types.ts

# All fixture tasks in parallel:
T005–T012: Create all workflow fixtures in test/fixtures/workflows/
```

## Parallel Example: US4 + US5 (after US2 completes)

```
# These can run simultaneously:
T023: Implement checkSchemas in src/static-analysis/schemas.ts
T025: Implement validateNodeParams in src/static-analysis/params.ts

# Their tests can also run in parallel:
T024: Test checkSchemas in test/static-analysis/schemas.test.ts
T026: Test validateNodeParams in test/static-analysis/params.test.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T004)
2. Complete Phase 2: Fixtures (T005–T012)
3. Complete Phase 3: US1 — Graph construction (T013–T017)
4. **STOP and VALIDATE**: `npm run build` + `npm test` — graph construction works
5. This alone is valuable: later phases (Trust, Guardrails, Orchestrator) can start consuming WorkflowGraph

### Incremental Delivery

1. Setup + Fixtures → Infrastructure ready
2. US1 (Graph) → WorkflowGraph available for downstream consumers (MVP!)
3. US2 (Expressions) → Expression references enable data-loss detection
4. US3 (Data Loss) → The highest-value static finding is now active
5. US4 + US5 (Schemas + Params) → Additional validation coverage (parallel)
6. Polish → Build verification, exports, end-to-end validation

---

## Notes

- US6 (Opaque Boundaries) is folded into US3 — opaque-boundary findings are emitted by `detectDataLoss()` when upstream is shape-opaque
- `@n8n-as-code/skills` is optional — US4 and US5 return empty findings when it's not installed (not an error per constitution principle I)
- `discoverOutputSchemaForNode()` does not exist in skills package (see research.md R4) — schema checking is intentionally limited in v1
- `NodeAST` has no `disabled` field (see research.md R2) — default to `false` in graph construction
- `NodeAST.version` (not `typeVersion`) holds the schema version number
- All 30 tasks, commit after each task or logical group

---

## Audit Remediation

> Generated by `/speckit.audit` on 2026-04-18. Address before next `/speckit.implement` run.

- [X] T031 [AR] Record unresolvable expressions with `resolved: false` in `src/static-analysis/expressions.ts` — add fallback detection for `$fromAI()`, dynamic key access (`$json[variable]`), and other unparseable patterns within `={{ }}` blocks that don't match the 4 known ACCESS_PATTERNS. Emit `unresolvable-expression` entries in the ExpressionReference[] output. Add test cases in `test/static-analysis/expressions.test.ts` for `$fromAI()` and dynamic bracket access. Fixes SD-001 / FR-011.
- [X] T032 [AR] Add schema downgrade logic to `detectDataLoss()` in `src/static-analysis/data-loss.ts` — add optional `schemaProvider?: NodeSchemaProvider` parameter. When a `data-loss` finding with severity `error` would be emitted, check if the upstream shape-replacing node's schema (via `schemaProvider.getNodeSchema()`) contains the referenced field; if so, downgrade severity to `warning`. Add test in `test/static-analysis/data-loss.test.ts`. Fixes SD-002 / FR-023.
- [X] T033 [AR] Remove phantom credential validation from `src/static-analysis/params.ts:51-65` — the `typeof credentialType !== 'string'` guard is always false and the empty-string check is vacuous. Replace with a comment documenting that credential type validation requires a credential registry not available in v1 (deferred). Fixes PH-001 / FR-017 / Constitution IV.
- [X] T034 [AR] Add missing-credentials test or remove dead code path in `test/static-analysis/params.test.ts` — if T033 removes the credential check, delete the `missing-credentials` variant from the `StaticFinding` union only if no other producer exists. If credential checking is kept in any form, add a test exercising it. Fixes TQ-001.
- [X] T035 [AR] Update FR-019 in `specs/002-static-analysis/spec.md` to reflect that `@n8n-as-code/skills` unavailability is not a configuration error — skills is an optional dependency; `checkSchemas()` and `validateNodeParams()` return empty findings when no provider is given. Amend FR-019 to scope ConfigurationError to transformer only. Fixes SD-003.
