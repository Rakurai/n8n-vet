# Tasks: Trust & Change Subsystem

**Input**: Design documents from `/specs/003-trust-and-change/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Tests are included for this feature. The spec requires all functionality to be testable with graph fixtures (SC-008) and the constitution mandates happy-path + public error-path tests.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US6)
- Include exact file paths in descriptions

## Path Conventions

```text
src/trust/           # Trust subsystem source
test/trust/          # Trust subsystem tests
src/types/trust.ts   # Existing shared types (read-only for this feature)
src/index.ts         # Package entry point (updated)
```

---

## Phase 1: Setup

**Purpose**: Install dependency, create directory structure, define error types and internal types

- [ ] T001 Install `json-stable-stringify` and `@types/json-stable-stringify` via npm
- [ ] T002 [P] Create `src/trust/errors.ts` with `TrustPersistenceError` (filePath, cause) and `ContentHashError` (nodeName, cause) typed error classes per data-model.md
- [ ] T003 [P] Create `src/trust/types.ts` with `RerunAssessment`, `PersistedTrustStore`, and `PersistedWorkflowTrust` internal types per data-model.md, plus Zod schemas for `PersistedTrustStore` persistence validation

---

## Phase 2: Foundational — Content Hashing (User Story 6, P1)

**Purpose**: Hash functions that all other modules depend on. Must be complete before change detection, trust, or persistence.

**Goal**: Produce stable, deterministic SHA-256 hashes for node content and connection topology

**Independent Test**: Hash same node content with different property orders → identical hashes. Excluded properties don't affect hash.

### Tests

- [ ] T004 [P] [US6] Write content hash tests in `test/trust/hash.test.ts`: hash stability across property insertion orders, excluded properties (position, name, notes, id) don't affect hash, different parameters produce different hashes, connections hash determinism, workflow composite hash

### Implementation

- [ ] T005 [US6] Implement `computeContentHash(node, ast)` in `src/trust/hash.ts`: extract trust-relevant properties from GraphNode + execution settings from WorkflowAST, canonicalize with `json-stable-stringify`, SHA-256 hash. Throw `ContentHashError` on serialization failure. Per research R1, R2, R3.
- [ ] T006 [US6] Implement `computeConnectionsHash(graph)` in `src/trust/hash.ts`: sort forward adjacency map by node name, sort edges by output index, canonicalize with `json-stable-stringify`, SHA-256 hash
- [ ] T007 [US6] Implement `computeWorkflowHash(graph)` in `src/trust/hash.ts`: compute all node content hashes sorted by name + connections hash, compose into single SHA-256. Per research R6.
- [ ] T008 [US6] Verify all hash tests pass in `test/trust/hash.test.ts`

**Checkpoint**: Content hashing is verified. All downstream modules can use `computeContentHash`, `computeConnectionsHash`, `computeWorkflowHash`.

---

## Phase 3: User Story 1 — Change Detection (Priority: P1) MVP

**Goal**: Given two WorkflowGraph snapshots, produce a NodeChangeSet classifying every node as added, removed, modified (sub-classified), or unchanged

**Independent Test**: Provide two graph snapshots with known differences → verify all change kinds are correctly classified, rename detection works, quick check short-circuits on identical graphs

### Tests

- [ ] T009 [P] [US1] Write change detection tests in `test/trust/change.test.ts`: parameter change, expression change (={{ pattern}), type-version change, credential change, execution-setting change, position-only change, metadata-only change, connection change, added node, removed node, rename detection (removed+added with identical content), workflow-level quick check short-circuit, multiple simultaneous change kinds on single node, empty graph

### Implementation

- [ ] T010 [US1] Implement `computeChangeSet(previous, current)` in `src/trust/change.ts`: workflow-level quick check via `computeWorkflowHash`, index both graphs by name, compute added/removed sets, classify common nodes by comparing content hashes and sub-classifying change kinds (parameter, expression, type-version, credential, execution-setting, position-only, metadata-only), check connections hash for connection changes on unchanged-content nodes, apply rename detection for removed+added pairs with matching type/typeVersion/parameters. Per contracts/trust-api.md and research R4.
- [ ] T011 [US1] Verify all change detection tests pass in `test/trust/change.test.ts`

**Checkpoint**: Change detection is verified. Can produce accurate NodeChangeSet from any two workflow snapshots.

---

## Phase 4: User Story 3 — Trust Invalidation (Priority: P1)

**Goal**: When nodes change in trust-breaking ways, propagate invalidation forward through the graph so downstream nodes lose trust

**Independent Test**: Construct graph with trusted nodes, apply trust-breaking change set → verify forward-only BFS invalidation removes correct records, trust-preserving changes don't trigger invalidation

### Tests

- [ ] T012 [P] [US3] Write trust invalidation tests in `test/trust/trust.test.ts` (invalidation section): linear chain A→B→C invalidation from B (B+C lose trust, A keeps), branching A→{B,C} invalidation from A (all lose), downstream-only C change in A→B→C (only C loses), position-only change preserves trust, added node seeds invalidation, connection change triggers invalidation, stale records removed for deleted nodes

### Implementation

- [ ] T013 [US3] Implement `invalidateTrust(state, changeSet, graph)` in `src/trust/trust.ts`: seed invalidation set from trust-breaking modified nodes + added nodes + connection-changed nodes (skip position-only and metadata-only), BFS forward through `graph.forward` adjacency, remove trust records for all nodes in final invalidation set, remove stale records for nodes not in current graph. Return new TrustState (immutable).
- [ ] T014 [US3] Verify all trust invalidation tests pass in `test/trust/trust.test.ts`

**Checkpoint**: Trust invalidation is verified. Forward-only BFS propagation works correctly.

---

## Phase 5: User Story 2 — Trust Derivation (Priority: P1)

**Goal**: Record trust from successful validation runs, creating NodeTrustRecord entries for validated nodes

**Independent Test**: Simulate successful validation → verify trust records created with correct hashes, timestamps, layers. Verify mocked/skipped nodes excluded. Verify record replacement on re-validation.

### Tests

- [ ] T015 [P] [US2] Write trust derivation tests in `test/trust/trust.test.ts` (derivation section): record static validation (fixture hash null), record execution validation (with fixture hash), record replaces existing trust, mocked/skipped nodes excluded (caller responsibility — verify only specified nodes get records)

### Implementation

- [ ] T016 [US2] Implement `recordValidation(state, nodes, graph, layer, runId, fixtureHash)` in `src/trust/trust.ts`: compute content hash for each node via `computeContentHash`, create `NodeTrustRecord` with hash, runId, ISO timestamp, layer, fixtureHash. Insert/replace in nodes Map. Return new TrustState (immutable).
- [ ] T017 [US2] Verify all trust derivation tests pass in `test/trust/trust.test.ts`

**Checkpoint**: Trust derivation is verified. Successful validations create correct trust records.

---

## Phase 6: User Story 5 — Trust Queries (Priority: P2)

**Goal**: Provide query functions for downstream subsystems to check trust status, find boundaries, identify untrusted nodes, and assess rerun value

**Independent Test**: Construct trust state with various configurations → verify isTrusted, getTrustedBoundaries, getUntrustedNodes, getRerunAssessment return correct results

### Tests

- [ ] T018 [P] [US5] Write trust query tests in `test/trust/trust.test.ts` (queries section): isTrusted with matching hash (true), isTrusted with mismatched hash (false), isTrusted with no record (false), getTrustedBoundaries returns trusted nodes adjacent to untrusted downstream, getUntrustedNodes returns nodes without trust in scope, getRerunAssessment returns isLowValue:true when all trusted + fixture matches, getRerunAssessment returns isLowValue:false when any node untrusted

### Implementation

- [ ] T019 [US5] Implement `isTrusted(state, node, currentHash)` in `src/trust/trust.ts`: check if trust record exists AND contentHash matches currentHash
- [ ] T020 [US5] Implement `getTrustedBoundaries(state, graph, scope, currentHashes)` in `src/trust/trust.ts`: for each node in/adjacent to scope, check if trusted and has at least one untrusted downstream neighbor via graph.forward
- [ ] T021 [US5] Implement `getUntrustedNodes(state, scope, currentHashes)` in `src/trust/trust.ts`: filter scope to nodes where isTrusted returns false
- [ ] T022 [US5] Implement `getRerunAssessment(state, target, currentHashes, fixtureHash)` in `src/trust/trust.ts`: check trust-level conditions only (all target trusted, fixture matches). Return RerunAssessment with explanation and optional narrowed target. Per clarification: failing-path checks owned by guardrails.
- [ ] T023 [US5] Verify all trust query tests pass in `test/trust/trust.test.ts`

**Checkpoint**: All trust queries verified. Downstream subsystems can query trust state correctly.

---

## Phase 7: User Story 4 — Trust Persistence (Priority: P2)

**Goal**: Read and write trust state to local JSON file with schema versioning, Zod validation, and correct error handling

**Independent Test**: Write trust state → read back → verify equivalence. Missing file → empty trust. Corrupt file → typed error. Schema version mismatch → empty trust.

### Tests

- [ ] T024 [P] [US4] Write persistence tests in `test/trust/persistence.test.ts`: round-trip write+read produces equivalent state, missing file returns empty trust (no error), corrupt JSON throws TrustPersistenceError with file path, schema version mismatch returns empty trust (no error), workflow not in file returns empty trust, N8N_VET_DATA_DIR override, Map↔Record conversion correctness, multiple workflows in single file preserved on write

### Implementation

- [ ] T025 [US4] Implement `loadTrustState(workflowId, dataDir?)` in `src/trust/persistence.ts`: resolve file path (N8N_VET_DATA_DIR or .n8n-check/), handle missing file (empty trust), parse JSON, validate with Zod schema, check schemaVersion (mismatch → empty trust), look up workflowId (missing → empty trust), convert Record to Map for NodeTrustRecord entries. Throw TrustPersistenceError on invalid JSON or schema failure.
- [ ] T026 [US4] Implement `persistTrustState(state, workflowHash, dataDir?)` in `src/trust/persistence.ts`: resolve file path, create directory if needed, read existing file to preserve other workflows, convert Map to Record, merge workflow entry, write with schemaVersion:1 and workflowHash. Per research R5.
- [ ] T027 [US4] Verify all persistence tests pass in `test/trust/persistence.test.ts`

**Checkpoint**: Trust persistence verified. Trust state survives across sessions.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Public API exports, build verification, cross-module integration

- [ ] T028 Update `src/index.ts` to export trust subsystem functions (`computeContentHash`, `computeConnectionsHash`, `computeWorkflowHash`, `computeChangeSet`, `recordValidation`, `invalidateTrust`, `isTrusted`, `getTrustedBoundaries`, `getUntrustedNodes`, `getRerunAssessment`, `loadTrustState`, `persistTrustState`) and types (`RerunAssessment`, `TrustPersistenceError`, `ContentHashError`)
- [ ] T029 Run `npm run build` and verify TypeScript compilation succeeds with no errors
- [ ] T030 Run `npm test` and verify all tests pass (trust + existing static analysis tests)
- [ ] T031 Run `npm run lint` and verify no lint/format violations

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Hashing/US6)**: Depends on Phase 1 (errors.ts, types.ts, json-stable-stringify)
- **Phase 3 (Change Detection/US1)**: Depends on Phase 2 (hash functions)
- **Phase 4 (Invalidation/US3)**: Depends on Phase 2 (hash functions). Can run in parallel with Phase 3.
- **Phase 5 (Derivation/US2)**: Depends on Phase 2 (hash functions). Can run in parallel with Phase 3 and 4.
- **Phase 6 (Queries/US5)**: Depends on Phase 5 (trust derivation for creating test fixtures with trust records)
- **Phase 7 (Persistence/US4)**: Depends on Phase 2 (types). Can run in parallel with Phases 3-6.
- **Phase 8 (Polish)**: Depends on all previous phases

### User Story Dependencies

- **US6 (Hashing, P1)**: Foundation — blocks all other stories
- **US1 (Change Detection, P1)**: Depends on US6 only
- **US3 (Invalidation, P1)**: Depends on US6 only. Can parallel with US1.
- **US2 (Derivation, P1)**: Depends on US6 only. Can parallel with US1 and US3.
- **US5 (Queries, P2)**: Depends on US2 (needs recordValidation for test setup)
- **US4 (Persistence, P2)**: Depends on US6 types. Can parallel with US1-US3.

### Within Each User Story

- Tests written first, verified to exist
- Implementation follows
- Tests verified to pass before moving on

### Parallel Opportunities

Within Phase 1: T002 and T003 can run in parallel (different files)
Within Phase 2: T004 (tests) can be written while T005-T007 are implemented
Across Phases 3-5 and 7: US1, US3, US2, US4 can all run in parallel after Phase 2 completes
Within each story: Test writing ([P]) can start alongside implementation

---

## Parallel Example: After Phase 2 Completes

```
# These can all start simultaneously after hashing is complete:
Agent A: Phase 3 (US1 - Change Detection) — T009 → T010 → T011
Agent B: Phase 4 (US3 - Invalidation) — T012 → T013 → T014
Agent C: Phase 5 (US2 - Derivation) — T015 → T016 → T017
Agent D: Phase 7 (US4 - Persistence) — T024 → T025 → T026 → T027
```

---

## Implementation Strategy

### MVP First (Phase 1 + 2 + 3)

1. Complete Phase 1: Setup (install dependency, create error types)
2. Complete Phase 2: US6 Hashing (foundational — all other modules need this)
3. Complete Phase 3: US1 Change Detection (the core user-facing capability)
4. **STOP and VALIDATE**: Can now compute accurate change sets between workflow versions
5. This is the minimum useful deliverable for downstream phases (guardrails, orchestrator)

### Incremental Delivery

1. Setup + Hashing → Foundation ready
2. Add Change Detection → Can diff workflow snapshots (MVP)
3. Add Invalidation + Derivation → Full trust lifecycle
4. Add Queries → Downstream subsystems can consume trust
5. Add Persistence → Trust survives across sessions
6. Polish → Exports, build verification

### Single Agent Strategy (Recommended)

Implement sequentially in phase order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
Each phase builds on the previous. Total: 31 tasks.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- All tests use graph fixtures — no n8n instance required
- All trust functions are immutable (return new TrustState, never mutate input)
- Persistence uses Zod validation at the boundary, trusts types internally
- Content hashing must match n8nac's `HashUtils.computeHash()` behavior

---

## Audit Remediation

> Generated by `/speckit.audit` on 2026-04-18. Address before next `/speckit.implement` run.

- [x] T032 [AR] Fix rename detection to transfer trust records from old NodeIdentity to new NodeIdentity in `src/trust/change.ts` and/or `src/trust/trust.ts` — SD-001, FR-007
- [x] T033 [AR] Read `process.env.N8N_VET_DATA_DIR` in `src/trust/persistence.ts:119-121` as fallback before hardcoded default — SD-002, FR-013, US4-S6
- [x] T034 [AR] Narrow bare `catch {}` in `src/trust/persistence.ts:95-97` to only handle JSON parse / Zod validation failures; re-throw unexpected errors — CV-001
- [x] T035 [AR] Replace `stringify(hashInput) ?? ''` with explicit undefined check that throws `ContentHashError` in `src/trust/hash.ts:40` — CV-002
- [x] T036 [AR] Throw error in `recordValidation` at `src/trust/trust.ts:37-38` when a requested NodeIdentity is not found in the graph instead of silently skipping — SF-001
- [x] T037 [AR] Add `ContentHashError` throwing test in `test/trust/hash.test.ts` and remove unused import — TQ-001, CQ-001
- [x] T038 [AR] Implement `position-only` change detection in `src/trust/change.ts` by comparing AST positions when content hash is unchanged — SD-003, FR-005
- [x] T039 [AR] Move stale record removal from `invalidateTrust` to `computeChangeSet` or document the deviation — SD-004, FR-021
- [x] T040 Run `npm run build` and verify TypeScript compilation succeeds after remediation
- [x] T041 Run `npm test` and verify all tests pass after remediation
- [x] T042 Run `npm run lint` and verify no lint/format violations after remediation
