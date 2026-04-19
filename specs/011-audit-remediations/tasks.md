# Tasks: Audit Findings Remediation

**Input**: Design documents from `/specs/011-audit-remediations/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. User stories map to audit severity tiers: US1/US2 = S0 (runtime bugs), US3 = S1 structural (execution pipeline + pin caching + MCP wiring), US4 = S2 static analysis gaps, US5 = S2 guardrail/trust gaps, US6 = S1/S2 safety + concurrent access, US7 = S3 minor fixes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Dependency and config fixes that unblock all subsequent work

- [x] T001 Replace `file:` protocol with npm registry reference `^1.1.0` for `@n8n-as-code/transformer` in `package.json` (also check `@n8n-as-code/skills` in optionalDependencies) and run `npm install` to verify resolution (S1-9, FR-014)
- [x] T002 Set `passWithNoTests: false` in `vitest.config.ts` (S3-3, FR-033)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Cross-cutting type-level refactors that touch many files and must complete before story work to avoid merge conflicts

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Change `WorkflowGraph` maps in `src/types/graph.ts` from `Map<string, ...>` to `Map<NodeIdentity, ...>` for `nodes`, `forward`, `backward`; change `displayNameIndex` to `Map<string, NodeIdentity>` (S1-1, FR-006)
- [x] T004 Update all ~30 consuming files to use `NodeIdentity` keys when accessing `WorkflowGraph` maps — remove all `as` casts at map access sites. Files include: `src/static-analysis/graph.ts`, `src/static-analysis/expressions.ts`, `src/static-analysis/data-loss.ts`, `src/static-analysis/schemas.ts`, `src/static-analysis/params.ts`, `src/static-analysis/classify.ts`, `src/trust/change.ts`, `src/trust/trust.ts`, `src/trust/hash.ts`, `src/orchestrator/interpret.ts`, `src/orchestrator/resolve.ts`, `src/orchestrator/path.ts`, `src/orchestrator/snapshots.ts`, `src/guardrails/evaluate.ts`, `src/guardrails/evidence.ts`, `src/guardrails/narrow.ts`, `src/guardrails/redirect.ts`, `src/diagnostics/synthesize.ts`, `src/diagnostics/annotations.ts`, `src/diagnostics/path.ts`, `src/surface.ts`, and corresponding test files (S1-1, FR-006)
- [x] T005 Add `retryOnFail`, `executeOnce`, `onError` fields to `SerializedGraphNode` in `src/orchestrator/types.ts` and update serialization in `src/orchestrator/snapshots.ts` to include execution settings during save and reconstruct them during deserialization (S1-2, FR-007)
- [x] T006 Use `NodeClassification` union type instead of `string` for `SerializedGraphNode.classification` in `src/orchestrator/types.ts` (S3-17, FR-041)

**Checkpoint**: Foundation ready — type-safe `WorkflowGraph`, correct snapshot serialization. User story implementation can now begin.

---

## Phase 3: User Story 1 - Agent Receives Correct Execution Diagnostics (Priority: P1)

**Goal**: Fix the broken execution-to-diagnostics pipeline so that validation requests with execution produce correct, non-undefined diagnostic fields with accurate error classification.

**Independent Test**: Run a validation request against a workflow with a known API node error. Verify the diagnostic summary correctly identifies the failing node, the error type, and the HTTP status code.

### Implementation for User Story 1

- [x] T007 [US1] Test REST API endpoints against live n8n at `localhost:5678`: (1) `POST /api/v1/workflows/:id/run` — verify response shape (flat `{ executionId }` vs `{ data: { executionId } }`), (2) `GET /api/v1/executions/:id?includeData=true` — verify response nesting. Document actual shapes in `specs/011-audit-remediations/research.md` R1 section. **Risk**: If shapes differ materially from both code and research predictions, create follow-up tasks before proceeding to T008-T009 (S0-2, FR-001a)
- [x] T008 [US1] Update `TriggerExecutionResponseSchema` in `src/execution/rest-client.ts` to match verified response shape from T007. Update the `executeBounded()` response read path accordingly (S0-2, FR-001a)
- [x] T009 [P] [US1] Update `ExecutionStatusResponseSchema` and `ExecutionDataResponseSchema` in `src/execution/rest-client.ts` to match verified GET response shape from T007. Update `getExecutionStatus()` and `getExecutionData()` read paths (S0-2, FR-001a)
- [x] T010 [P] [US1] Fix `GetExecutionResponseSchema` in `src/execution/mcp-client.ts`: move `data` from nested inside `execution` to a top-level sibling of `execution`. Update `getExecution()` to read `parsed.data?.resultData` instead of `parsed.execution?.data?.resultData` (R2 finding)
- [x] T011 [US1] Delete the diagnostics-local `ExecutionData` type and `NodeExecutionResult` from `src/diagnostics/types.ts`. Update all imports in `src/diagnostics/synthesize.ts`, `src/diagnostics/errors.ts`, `src/diagnostics/annotations.ts`, `src/diagnostics/status.ts`, `src/diagnostics/hints.ts`, `src/diagnostics/path.ts` to import from `src/execution/types.ts` instead (S0-1, FR-002)
- [x] T012 [US1] Update diagnostics code that assumed single `NodeExecutionResult` per node (non-array) to handle `NodeExecutionResult[]` arrays — iterate or select last result. Update `classifyApiError` in `src/diagnostics/errors.ts` to read `httpCode` from the correct nested location in `execution/types.ts` shape (context field path) (S0-1, FR-001)
- [x] T013 [US1] Wire `extractExecutionData()` from `src/execution/results.ts` into the orchestrator at the raw REST response cast site in `src/orchestrator/interpret.ts` — replace `rawData as ExecutionData | null` with `extractExecutionData(rawData)` (S0-1, FR-001)
- [x] T014 [US1] Update orchestrator test mocks in `test/orchestrator/interpret.test.ts` and `test/execution/rest-client.test.ts` to use realistic REST response payloads matching the verified shapes from T007 (FR-043)

**Checkpoint**: Execution pipeline produces correct diagnostics. Error classification is accurate. All existing tests pass with updated mocks.

---

## Phase 4: User Story 2 - Trust System Accurately Tracks Node Changes (Priority: P1)

**Goal**: Fix trust system to detect all change types (content hash, incoming edges, renames) and use portable workflow identity, so validation scope is correct.

**Independent Test**: Modify a node's incoming connection and verify the trust system flags it as changed. Modify node content for a previously trusted node and verify trust is revoked.

### Implementation for User Story 2

- [x] T015 [US2] Remove shadow `isTrusted` implementation in `src/orchestrator/resolve.ts`. Import canonical `isTrusted` from `src/trust/trust.ts` that performs content hash verification. Pass graph AST and `computeContentHash` into resolve for hash computation (S0-3, FR-003)
- [x] T016 [US2] Fix `persistTrustState` call in `src/orchestrator/interpret.ts` to pass `computeWorkflowHash(graph)` instead of `workflowId` (the current absolute file path). Import `computeWorkflowHash` from `src/trust/hash.ts` (S0-4, FR-004)
- [x] T017 [US2] Add backward edge comparison in `nodeEdgesChanged()` in `src/trust/change.ts`: also compare `graph.backward.get(nodeName)` alongside the existing `graph.forward.get(nodeName)` check (S0-5, FR-005)
- [x] T018 [US2] Add test in `test/trust/change.test.ts` that verifies: given a trusted node, when a new incoming edge is added, the node is flagged as changed in the `NodeChangeSet`
- [x] T055 [US2] Change `deriveWorkflowId` in `src/orchestrator/types.ts` to use project-relative path instead of absolute path for portable workflow identity — complements T016's content-hash approach (S2-10, FR-024)

**Checkpoint**: Trust system correctly detects all change types. Workflow identity is content-derived and portable.

---

## Phase 5: User Story 3 - Graceful Degradation When Execution Backend Unavailable (Priority: P2)

**Goal**: When the n8n REST API is unreachable, the system degrades to static-only analysis instead of crashing. Credential resolution uses the full 4-level cascade. Pin data caching is wired into the execution pipeline.

**Independent Test**: Run a validation request with no n8n credentials configured. Verify the system returns static analysis findings instead of an error.

### Implementation for User Story 3

- [x] T019 [US3] Delete local `resolveExecCredentials` helper in `src/orchestrator/interpret.ts`. Replace all call sites with `resolveCredentials()` imported from `src/execution/rest-client.ts` to use the full 4-level cascade (explicit → env → n8nac config → global) (S1-3, FR-008)
- [x] T020 [US3] Wrap `probeRest` call in `src/execution/capabilities.ts` in a try-catch that maps network/auth errors to `restAvailable: false` instead of throwing. Verify the `static-only` capability path in `detectCapabilities` becomes reachable when REST is unavailable (S1-6, FR-011)
- [x] T021 [US3] Add `McpToolCaller` field to `OrchestratorDeps` or `ValidationRequest` in `src/orchestrator/types.ts`. Wire `executeSmoke` path in `src/orchestrator/interpret.ts` so that when capability detection returns `mcpAvailable: true` and smoke test is requested, the orchestrator dispatches via MCP `test_workflow` tool. **NOTE**: MCP `test_workflow` is the **sole execution triggering path** per revised FR-009. The `executeBounded` REST execution paths and `destinationNode` dispatch logic still present in the orchestrator are deferred to phase-12 and will be removed in T050 (S1-4, FR-009)
- [x] T052 [P] [US3] Wire pin data caching: call `readCachedPinData()` before `constructPinData`, pass as `priorArtifacts`, call `writeCachedPinData()` after successful runs in `src/orchestrator/interpret.ts` and `src/execution/pin-data.ts` (S1-5, FR-010)

**Checkpoint**: System returns static analysis when MCP tools are unavailable. MCP `test_workflow` is wired as the sole execution trigger. Full credential cascade works. Pin data caching is operational. REST public API retained for read-only data retrieval only. Existing `executeBounded`/`destinationNode` code remains in codebase — stripping it is phase-12 scope (`docs/prd/phase-12-execution-backend-revision.md`).

---

## Phase 6: User Story 4 - Static Analysis Produces Accurate, Deduplicated Findings (Priority: P2)

**Goal**: Fix disabled node handling, Merge classification, expression pattern coverage, and finding deduplication so static analysis output is accurate and noise-free.

**Independent Test**: Analyze a workflow with a disabled node, a Merge in "combine" mode, and `$node.Name` expressions. Verify correct classification and no duplicates.

### Implementation for User Story 4

- [x] T022 [P] [US4] Read the `disabled` field from raw node data during graph construction in `src/static-analysis/graph.ts` instead of hardcoding `false`. Exclude disabled nodes from active analysis in `src/static-analysis/data-loss.ts`, `src/static-analysis/schemas.ts`, `src/static-analysis/params.ts` (S2-7, FR-021)
- [x] T023 [P] [US4] Make Merge node classification mode-aware in `src/static-analysis/node-sets.ts`: inspect the `mode` parameter and classify as `shape-augmenting` or `shape-replacing` based on mode, instead of blanket `shape-preserving` (S2-8, FR-022)
- [x] T024 [P] [US4] Expand expression pattern coverage in `src/static-analysis/expressions.ts`: add patterns for `$node.Name` (dot syntax), `$items("Name")`, `$binary` access, `itemMatching(n)` with literal arg. Fix module-level `/g` regex state bugs by using local regex instances or `matchAll` (S2-6, FR-020 + S3-2, FR-032)
- [x] T025 [US4] Deduplicate static findings by `(node, kind, message)` tuple after the multi-path analysis loop in `src/orchestrator/interpret.ts` (S2-13, FR-027)

**Checkpoint**: Static analysis correctly handles disabled nodes, mode-aware Merge classification, expanded expression syntax, and produces zero duplicate findings.

---

## Phase 7: User Story 5 - Guardrails and Trust-Boundary-Aware Validation (Priority: P2)

**Goal**: Node-targeted validation respects trust boundaries. Guardrails evaluate in STRATEGY.md order. Path scoring uses documented factors. Evidence assembly includes removed nodes. Renames invalidate trust.

**Independent Test**: Submit a node-targeted validation for a node surrounded by trusted neighbors. Verify propagation stops at trust boundaries.

### Implementation for User Story 5

- [x] T026 [US5] Pass `trustState` into `resolveNodes` and propagation helpers in `src/orchestrator/resolve.ts`. Add trust-boundary stopping logic so propagation halts at trusted nodes during node-targeted validation (S2-1, FR-015)
- [x] T027 [P] [US5] Reorder guardrail evaluation in `src/guardrails/evaluate.ts` to: redirect → narrow → warn → refuse (matching STRATEGY.md guardrail action order). Update corresponding test expectations in `test/guardrails/evaluate.test.ts` (S2-2, FR-016)
- [x] T028 [P] [US5] Replace 4 ad-hoc path scoring tiers in `src/orchestrator/path.ts` with STRATEGY.md-aligned scoring: changed opaque/shape-replacing nodes (high weight), untrusted boundaries (high weight), changed branching logic (medium weight), prior failures (medium weight), estimated execution cost (negative weight), overlap with already-validated coverage (negative weight). Use calibratable numeric defaults (e.g., high=3, medium=2, negative=-1) — exact values are product judgment per STRATEGY.md (S2-3, FR-017)
- [x] T029 [P] [US5] Add `changeSet.removed` iteration in `src/guardrails/evidence.ts`. Refactor evidence computation: compute once in `evaluate()` in `src/guardrails/evaluate.ts` and pass the result to `narrow()` in `src/guardrails/narrow.ts` instead of recomputing 3x per call (S2-4, FR-018)
- [x] T030 [US5] Change rename detection in `src/trust/change.ts` to invalidate trust for renamed nodes instead of transferring it. Update `src/trust/trust.ts` rename handling to propagate re-validation to referencing nodes (S2-5, FR-019)
- [ ] T056 [US5] **DEFERRED to phase-12** (`docs/prd/phase-12-execution-backend-revision.md`). Original S2-15 finding (rename `findFurthestDownstream`) is superseded — phase-12 removes the function along with the REST execution path. No 011 work needed.

**Checkpoint**: Trust boundaries limit propagation. Guardrails fire in correct order. Path scoring is aligned with STRATEGY.md. Renames break trust.

---

## Phase 8: User Story 6 - Concurrent Access and Edge Cases (Priority: P3)

**Goal**: Trust state writes are atomic and concurrent-safe. Execution lock has staleness protection. Path traversal is blocked. All domain errors map to specific MCP error codes.

**Independent Test**: Simulate concurrent trust writes — no corruption. Attempt path traversal — rejected before file access.

### Implementation for User Story 6

- [x] T031 [P] [US6] Implement atomic writes in `src/trust/persistence.ts`: write to a temp file in the same directory, then `renameSync` to target. Add advisory file locking (e.g., lockfile or `.lock` sentinel) for concurrent access (S1-7, FR-012)
- [x] T032 [P] [US6] Add timestamp and configurable expiry to execution lock in `src/execution/lock.ts`. Make the lock injectable for test isolation (accept lock state as parameter or via DI). If lock timestamp exceeds expiry, treat as stale and release (S1-8, FR-013)
- [x] T033 [P] [US6] Add path traversal validation in `src/mcp/server.ts` and `src/cli/index.ts`: validate that `workflowPath` resolves under `process.cwd()` or configured project root before passing to `ValidationRequest`. Reject with typed error if path escapes boundary (S2-11, FR-025)
- [x] T034 [US6] Add cases for `ExecutionInfrastructureError`, `TrustPersistenceError`, `SynthesisError`, `ExecutionPreconditionError` in `mapToMcpError()` in `src/errors.ts` per the contract in `specs/011-audit-remediations/contracts/mcp-contracts.md`. Inline `isEnoent` helper (called only once) (S2-16, FR-030 + S3-6)
- [x] T035 [US6] Replace flat `z.object` with `z.discriminatedUnion('kind', [...])` in MCP input validation in `src/mcp/server.ts` per the contract in `specs/011-audit-remediations/contracts/mcp-contracts.md` — enforce `nodes` required when `kind === 'nodes'` (S2-14, FR-028)
- [x] T053 [P] [US6] Narrow catch blocks in `src/trust/persistence.ts`, `src/execution/rest-client.ts`, `src/execution/pin-data.ts` to expected error codes (e.g., ENOENT) and re-throw unexpected errors (S2-9, FR-023)
- [x] T054 [P] [US6] Add TTY/NO_COLOR detection in `src/cli/format.ts`: check `process.env.NO_COLOR` or `!process.stdout.isTTY` and suppress ANSI codes when output is piped (S2-12, FR-026)

**Checkpoint**: Concurrent trust writes are safe. Stale locks auto-release. Path traversal blocked. All domain errors get specific MCP codes. Catch blocks are narrow. CLI respects NO_COLOR.

---

## Phase 9: User Story 7 - Codebase Quality and Minor Fixes (Priority: P3)

**Goal**: Resolve all S3 minor issues — async I/O, regex bugs, null handling, performance, floating promises, weak typing, lint errors.

**Independent Test**: `biome check` reports zero errors. All tests pass. `passWithNoTests` is `false`.

### Implementation for User Story 7

**Batch A — Type safety & correctness** (parallelizable):

- [x] T036 [P] [US7] Replace `readFileSync` with `readFile` from `node:fs/promises` in `src/static-analysis/graph.ts` (the `parseJsonFile` async function) (S3-1, FR-031)
- [x] T037 [US7] Add throw or diagnostic emit on duplicate `displayName` during graph construction in `src/static-analysis/graph.ts` — run after T036 (same file) (S3-5, FR-035)
- [x] T038 [P] [US7] Add explicit null check in `normalizePinData` in `src/execution/pin-data.ts` — reject `{ json: null }` instead of passing through (S3-9, FR-037)
- [x] T039 [P] [US7] Replace `string` types with `ValidationLayer` and `NodeIdentity` domain types in `src/types/surface.ts` (S3-19, FR-041)

**Batch B — Error handling & promises** (parallelizable):

- [x] T040 [P] [US7] Distinguish HTTP 404 from 5xx in REST client error classification in `src/execution/rest-client.ts` — not all non-OK responses should be `execution-not-found` (S3-7, FR-036)
- [x] T041 [P] [US7] Change `hashPinData` in `src/orchestrator/interpret.ts` to throw instead of returning `''` for non-serializable input (S3-8, FR-039)
- [x] T042 [P] [US7] Change `recordValidation` in `src/trust/trust.ts` to throw a typed domain error instead of bare `Error` (S3-11, FR-039)
- [x] T043 [P] [US7] Fix floating promises: prefix `main().then(...)` with `void` or add `.catch` in `src/cli/index.ts` (S3-15, FR-040) and `bin/n8n-vet` (S3-23, FR-040). Include parse error details in CLI `parseArgs` catch (S3-16)

**Batch C — Performance & config** (parallelizable):

- [x] T044 [P] [US7] Replace `Array.shift()` BFS with index-based queue in `src/trust/trust.ts` for O(n) instead of O(n^2) (S3-10, FR-038)
- [x] T045 [P] [US7] Cache `computeContentHash` results per graph instance in `src/trust/hash.ts` to avoid redundant recomputation in `computeWorkflowHash` (S3-13)
- [x] T046 [P] [US7] Fix poll timeout drift in `src/execution/poll.ts`: check elapsed time after sleep + API call combined, not just sleep duration (S3-14)
- [x] T047 [P] [US7] Use `tools/list` MCP method instead of calling tools with empty args for discovery in `src/execution/capabilities.ts` (S3-20)
- [x] T048 [P] [US7] Move `resolveSnapshotsDir()` environment read from inline `process.env` to config/DI layer in `src/orchestrator/snapshots.ts` (S3-22)

**Batch D — Diagnostics & remaining** (parallelizable):

- [x] T049 [P] [US7] Track whether static analysis actually ran (vs. skipped) in `evidenceBasis` in `src/diagnostics/synthesize.ts` — distinguish "no findings produced" from "analysis did not run" (S3-18, FR-042)
- [ ] T050 [P] [US7] **DEFERRED to phase-12** (`docs/prd/phase-12-execution-backend-revision.md`). Original S3-21 finding (extract shared executeBounded helper) is superseded — phase-12 removes executeBounded entirely. No 011 work needed.
- [x] T051 [P] [US7] Guard rename trust transfer against hash collisions (multiple matches) in `src/trust/trust.ts` (S3-12)

**Checkpoint**: All S3 issues resolved. Minor correctness, performance, and typing improvements across the codebase.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Test gaps, lint cleanup, and final verification

- [x] T057 [P] Add expression test for `$json['bracket']` syntax in `test/static-analysis/expressions.test.ts` (FR-044)
- [x] T058 [P] Add cyclic graph fixture test for `detectDataLoss` backward walk in `test/static-analysis/data-loss.test.ts` (FR-044)
- [x] T059 [P] Add unit tests for `extractPriorRunContext` and `checkDeFlaker` in new `test/guardrails/rerun.test.ts` (FR-044)
- [x] T060 [P] Add unit tests for `assembleEvidence` in new `test/guardrails/evidence.test.ts` (FR-044)
- [x] T061 [P] Add snapshot hash stability test in `test/trust/hash.test.ts`: save graph snapshot, load it, verify `computeContentHash` produces the same hash (FR-044)
- [x] T066 [P] Add test for MCP smoke test execution path: verify `executeSmoke` dispatches via `test_workflow` MCP tool when `mcpAvailable: true` in `test/orchestrator/interpret.test.ts` or `test/execution/mcp-client.test.ts` (FR-009, FR-044)
- [x] T062 Fix `cli-binary.test.ts` expected exit code in `test/plugin/cli-binary.test.ts` to match actual CLI exit code (S3-24)
- [x] T063 Gate integration tests in `npm test` pipeline: add vitest workspace config or script that includes `test/integration/` scenarios (FR-045)
- [x] T064 Run `npx biome check --write src/` to auto-fix lint errors, then audit remaining `!` (non-null assertion) usages manually (S3-4, FR-034)
- [x] T065 Full verification: `npm run build` (zero TS errors), `npm test` (all pass), `npx biome check src/` (zero lint errors), manual smoke test against live n8n workflow via MCP `test_workflow`, verify MCP execution is sole trigger path, verify static-only mode when MCP unavailable

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup (T001 npm install) — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — execution pipeline fixes
- **US2 (Phase 4)**: Depends on Foundational — trust system fixes (can run parallel with US1)
- **US3 (Phase 5)**: Depends on Foundational — credential/capability/pin-caching fixes (can run parallel with US1/US2)
- **US4 (Phase 6)**: Depends on Foundational — static analysis fixes (can run parallel with US1-US3)
- **US5 (Phase 7)**: Depends on Foundational + US2 (trust boundary stopping needs correct trust) — guardrail fixes
- **US6 (Phase 8)**: Depends on Foundational — safety fixes (can run parallel with US1-US4)
- **US7 (Phase 9)**: Depends on Foundational — S3 minor fixes only (can run parallel with US1-US6, but best done last to avoid conflicts). **Note**: US7 Batch A tasks on `src/static-analysis/graph.ts` (T036, T037) should not run parallel with US4 T022 which also modifies that file.
- **Polish (Phase 10)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: After Foundational — no dependency on other stories
- **US2 (P1)**: After Foundational — no dependency on other stories (T055 portable workflow ID added here)
- **US3 (P2)**: After Foundational — no dependency on other stories (T052 pin caching added here)
- **US4 (P2)**: After Foundational — no dependency on other stories
- **US5 (P2)**: After Foundational + US2 (needs correct trust system for boundary stopping) (T056 rename added here)
- **US6 (P3)**: After Foundational — no dependency on other stories (T053 narrow catches, T054 ANSI added here)
- **US7 (P3)**: After Foundational — S3 only, best done last to avoid merge conflicts with other stories

### Within Each User Story

- Tasks without [P] marker depend on prior tasks in that story
- Tasks with [P] marker can run in parallel within the same story phase

### Parallel Opportunities

- T001 and T002 in Setup can run in parallel
- T003-T006 in Foundational must be sequential (T003→T004 cascade, T005/T006 after T003)
- US1, US2, US3, US4, US6 can all start in parallel after Foundational
- Within US4: T022, T023, T024 are all [P] — can run in parallel
- Within US5: T027, T028, T029 are all [P] — can run in parallel
- Within US6: T031, T032, T033 are all [P] — can run in parallel. T053, T054 also [P] (different files from T031-T033)
- Within US7: All tasks in each batch (A/B/C/D) are [P] — can run in parallel, **except** T037 (same file as T036, must run after T036)
- Within Polish: T057-T061, T066 are all [P] — can run in parallel

---

## Parallel Example: User Story 4

```text
# Launch all parallel static analysis fixes together:
Task T022: "Read disabled field from raw node data in src/static-analysis/graph.ts"
Task T023: "Make Merge classification mode-aware in src/static-analysis/node-sets.ts"
Task T024: "Expand expression patterns in src/static-analysis/expressions.ts"

# Then sequential:
Task T025: "Deduplicate findings in src/orchestrator/interpret.ts" (depends on T022-T024)
```

## Parallel Example: User Story 7 Batch A

```text
# Launch all type safety fixes together:
Task T036: "Replace readFileSync in src/static-analysis/graph.ts"
Task T037: "Throw on duplicate displayName in src/static-analysis/graph.ts"
Task T038: "Null check in src/execution/pin-data.ts"
Task T039: "Domain types in src/types/surface.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T006) — CRITICAL
3. Complete Phase 3: US1 (T007-T014) — execution pipeline works correctly
4. **STOP and VALIDATE**: Test validation request against live n8n — correct diagnostics?
5. This alone fixes the most critical runtime bug (S0-1, S0-2)

### Incremental Delivery

1. Setup + Foundational → Type-safe foundation ready
2. Add US1 → Execution pipeline correct → **MVP!**
3. Add US2 → Trust system correct → Core product logic fixed
4. Add US3 → Graceful degradation → Robust agent experience
5. Add US4 → Accurate static analysis → High-confidence findings
6. Add US5 → Correct guardrails → Product differentiation restored
7. Add US6 → Safety hardened → Production-ready
8. Add US7 → Clean codebase → Tech debt resolved
9. Polish → Full test coverage, lint clean → Ship-ready

### Sequential Strategy (Single Developer)

Phase order follows severity: S0 first (US1→US2), then S1 structural (US3), then S2 gaps (US4→US5), then S3 minor (US6→US7→Polish).

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- T007 (live API verification) is the single highest-risk task — actual shapes may differ from both code and research predictions
- T004 (NodeIdentity cascade) is the single largest task — ~30 files, mechanical but extensive
- The total scope is large (66 tasks). Consider splitting into multiple PRs per user story priority tier.
- **Execution backend revision (2026-04-19)**: `POST /workflows/:id/run` is internal/editor-only (session auth). MCP `test_workflow` is the sole execution trigger. Stripping `executeBounded()`, `destinationNode`, `findFurthestDownstream`, and REST execution triggering code is **phase-12 scope** (`docs/prd/phase-12-execution-backend-revision.md`), not 011. T050 and T056 are deferred to phase-12. REST public API (`GET /executions/:id`) is still used for read-only data retrieval.
