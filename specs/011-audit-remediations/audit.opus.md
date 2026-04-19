# Pre-Release Code Audit

**Date:** 2026-04-19
**Scope:** Full codebase (`src/`, `test/`) — 60 source files, ~8000 LOC
**Reviewed against:** STRATEGY.md, CODING.md, CONCEPTS.md, SCOPE.md
**Baseline health:** TypeScript strict mode passes, 491 tests pass, 118 biome lint warnings (import ordering, non-null assertions)

---

## Executive Summary

The codebase is architecturally sound. The domain model aligns well with CONCEPTS.md, the subsystem boundaries are clean, dependency injection is consistently applied, and the test suite covers the important behavioral contracts. The major concerns are:

1. **Systemic `NodeIdentity` brand erosion** — the core graph type uses `string` keys, forcing `as` casts throughout the entire codebase and voiding the branded type's safety guarantees
2. **REST API contract uncertainty** — the execution payload shape and response schema may not match n8n's actual API, risking non-functional execution
3. **Strategy misalignments** — guardrail evaluation order, path scoring weights, and node-targeted trust propagation deviate from STRATEGY.md
4. **Pervasive `as T` assertions** — dozens of type assertion casts throughout, explicitly prohibited by CODING.md

The static analysis, trust, guardrails, and diagnostics subsystems are well-implemented. The orchestrator pipeline is functional but has several design gaps. The MCP and CLI layers are appropriately thin.

---

## Finding Severity Guide

- **Critical** — Correctness bug, data loss risk, or fundamental design flaw that must be fixed before release
- **Important** — Meaningful gap, spec violation, or code quality issue that should be fixed before release
- **Minor** — Style issue, documentation gap, or low-impact inconsistency worth addressing
- **Note** — Observation or positive acknowledgment, no action required

---

## Critical Findings

### CR-1. `WorkflowGraph` uses `string` keys instead of `NodeIdentity`

**Files:** `src/types/graph.ts:22-34`, cascading to ~30 files

`WorkflowGraph.nodes`, `.forward`, `.backward`, and `.displayNameIndex` are all `Map<string, ...>`. `Edge.from` and `Edge.to` are `string`. `GraphNode.name` is `string`. Every other type in the system (`SliceDefinition`, `TrustState`, `GuardrailEvidence`, `DiagnosticSummary`, etc.) uses `NodeIdentity`.

This root mismatch forces `as NodeIdentity` and `as string` casts at every boundary where graph data meets the rest of the system. Conservative count: **50+ type assertions** across `surface.ts`, `resolve.ts`, `path.ts`, `narrow.ts`, `evidence.ts`, `interpret.ts`, `trust.ts`, and others. CODING.md explicitly prohibits `as T` assertions.

The branded type provides zero protection when it's routinely cast away. This is the single highest-impact fix: making `WorkflowGraph` use `NodeIdentity` keys would cascade through the codebase, eliminating most `as` casts and restoring the brand's safety guarantee.

### CR-2. REST API payload shape may not match n8n's actual POST endpoint

**File:** `src/execution/rest-client.ts:272-275`

`executeBounded` sends `{ destinationNode: { nodeName, mode }, pinData }`. The three documented n8n payload variants for `POST /workflows/:id/run` are:

1. `{ runData, destinationNode, dirtyNodeNames }` — partial execution with existing run data
2. `{ destinationNode }` — full execution from unknown trigger
3. `{ triggerToStartFrom, destinationNode? }` — full execution from known trigger

None accept a top-level `pinData` field alongside `destinationNode`. If pin data needs to be inside `runData`, the payload construction is fundamentally wrong and bounded execution with mocking is non-functional.

### CR-3. REST API response schema may not match actual n8n response

**File:** `src/execution/rest-client.ts:41-45`

`TriggerExecutionResponseSchema` expects `{ data: { executionId: string } }`. Research docs say `POST /workflows/:id/run` returns `{ executionId: string }` — no `data` wrapper. If the actual API doesn't wrap in `data`, every execution trigger fails at Zod parsing. This and CR-2 together mean execution may be entirely non-functional.

**Recommendation for CR-2 and CR-3:** Test against a live n8n instance. These are the highest-priority items.

### CR-4. Change detection misses incoming edge changes

**File:** `src/trust/change.ts:105-135`

`nodeEdgesChanged` only compares `graph.forward.get(nodeName)` (outgoing edges). A node that gains or loses an incoming edge (new upstream wired to it) is not flagged as changed. The change is only attributed to the *source* node, not the receiving node.

A node receiving input from a new source has fundamentally different runtime behavior. The current code could mark such a node as `unchanged`, allowing it to retain trust incorrectly.

**Fix:** Also compare `graph.backward.get(nodeName)` for incoming edge changes.

---

## Important Findings

### Architecture & Strategy Alignment

#### IM-1. Guardrail evaluation order deviates from STRATEGY.md

**File:** `src/guardrails/evaluate.ts`

STRATEGY.md specifies: **redirect > narrow > warn > refuse** ("Refusal is last because it should be rare"). The implementation places refuse (identical rerun, step 3) *before* redirect (step 4) and narrow (step 5). This is arguably reasonable (no point redirecting if nothing changed), but it's an undocumented deviation from the stated contract.

**Action:** Either update STRATEGY.md to document the exception, or move the rerun check after redirect/narrow.

#### IM-2. Path scoring does not match STRATEGY.md weight specification

**File:** `src/orchestrator/path.ts:204-234`

STRATEGY.md specifies: high weight for changed opaque/shape-replacing nodes, high for untrusted boundaries, medium for branching logic, medium for prior failures, negative for cost, negative for overlap. The implementation uses 4 tiers: (1) non-error path, (2) all output 0, (3) changed nodes covered, (4) untrusted boundaries. Missing: opaque node awareness, branching logic, prior failures, cost estimation, overlap penalty. Tiers 1-2 are not in STRATEGY.md at all.

#### IM-3. Node-targeted validation ignores trust boundaries

**File:** `src/orchestrator/resolve.ts:72-78`

`resolveNodes` (for `kind: 'nodes'`) calls `propagateForward` and `propagateBackward` without passing `trustState`. Only `resolveChanged` (for `kind: 'changed'`) passes trust state. This means node-targeted validation always propagates to the full graph boundary, producing larger slices than necessary and violating the principle that trusted boundaries reduce work.

#### IM-4. `findFurthestDownstream` is misnamed — returns first exit point arbitrarily

**File:** `src/orchestrator/interpret.ts:322-329`

Returns `slice.exitPoints[0]` with no topological consideration. In graphs with multiple exit points, this picks an arbitrary node, not the "furthest downstream." For bounded execution, this could mean the execution doesn't cover the intended slice.

#### IM-5. Execution code path has three near-identical blocks

**File:** `src/orchestrator/interpret.ts:191-227`

Three branches call `executeBounded` with `findFurthestDownstream`, differing only in preconditions. This violates DRY and will diverge when one is updated without the others.

### Type System & Code Quality

#### IM-6. `persistTrustState` parameter naming mismatch

**Files:** `src/orchestrator/types.ts:84`, `src/orchestrator/interpret.ts:279`

Interface declares `persistTrustState(state, workflowHash)` but the call site passes `workflowId` (a file path). The `workflowHash` parameter is stored as metadata in the persisted file. Semantically wrong — the field stores a path, not a hash. Either rename the parameter or pass an actual hash.

#### IM-7. Pervasive `as T` type assertions

**Files:** Throughout codebase

Beyond the `NodeIdentity` casts (CR-1), there are `as` casts on:
- `src/errors.ts:42,56` — error narrowing
- `src/static-analysis/classify.ts:67-69` — untrusted parameters
- `src/static-analysis/graph.ts:130` — raw JSON.parse to `N8nWorkflow`
- `src/execution/rest-client.ts:315,434,439` — `ExecutionStatus`, `RawResultData`, `NodeIdentity[]`
- `src/surface.ts:39,71,90,98,101,103,111,117` — 8 casts between `string` and `NodeIdentity`

CODING.md: "Do not use type assertions (`as T`) to silence the compiler."

#### IM-8. `disabled` field hardcoded to `false` on all nodes

**File:** `src/static-analysis/graph.ts:48`

Comment acknowledges the gap ("NodeAST has no disabled field"). Disabled nodes should be excluded from data-flow analysis. The current implementation traces expressions through disabled nodes as if active, producing false positives for data-loss and false negatives for broken references (data flow is actually interrupted).

#### IM-9. Duplicate `displayName` silently overwrites in graph construction

**File:** `src/static-analysis/graph.ts:52`

Duplicate `propertyName` throws `MalformedWorkflowError`, but duplicate `displayName` is silently overwritten. n8n allows duplicate display names. If two nodes share a display name, expression resolution via `$('DisplayName')` silently resolves to the last-processed node.

#### IM-10. `Merge` node blanket-classified as `shape-preserving`

**File:** `src/static-analysis/node-sets.ts:10`

The Merge node has multiple modes (Append, Combine by Fields, Choose Branch, etc.). Several modes are `shape-augmenting` or `shape-replacing`. The blanket `shape-preserving` classification causes false negatives in data-loss detection when Merge is used in combining mode.

### Execution Subsystem

#### IM-11. `probeRest` throws instead of returning `false` — `static-only` level unreachable

**File:** `src/execution/capabilities.ts:109-135`

`probeRest` throws on both network failure and auth failure, never returns `false`. The `detectCapabilities` function has a `level = 'static-only'` path for `restAvailable === false`, but this path is unreachable. If REST is unavailable, `detectCapabilities` throws instead of gracefully degrading.

#### IM-12. `discoverMcpTools` actually calls MCP tools with empty args as discovery

**File:** `src/execution/capabilities.ts:145-158`

Calls each tool with `{}` to detect availability. A side-effectful probe — `test_workflow({})` could trigger unintended behavior. Standard MCP tool discovery (`tools/list`) should be used instead.

#### IM-13. Module-global mutable execution lock

**File:** `src/execution/lock.ts:11`

`let executionInFlight = false` is process-global singleton state. Test suites must manually call `releaseExecutionLock()` in `afterEach` for isolation. Should be injectable for proper test containment.

#### IM-14. Broad catch blocks swallow non-ENOENT filesystem errors

**Files:** `src/execution/rest-client.ts:195-228` (config readers), `src/execution/pin-data.ts:131-143` (cached pin data), `src/trust/persistence.ts:112` (trust write)

Multiple locations catch all errors and return `undefined` or silently continue. Permission errors, disk failures, etc. are indistinguishable from "file not found." Per CODING.md: "Never mask or downgrade errors."

#### IM-15. Trust persistence write is not atomic

**File:** `src/trust/persistence.ts:130`

`writeFileSync` directly to the target file. Process interruption mid-write corrupts the file, losing all workflows' trust state. Should write to a temp file and `renameSync`.

### Test Coverage Gaps

#### IM-16. No test for `$json['bracket']` expression syntax

Expression tracing implements bracket notation (`$json['field']`) but no test exercises it. False positive or negative in the bracket pattern would go undetected.

#### IM-17. No test for cycle handling in `detectDataLoss` backward walk

`walkBackward` has a `visited` set for cycle prevention, but no test verifies `detectDataLoss` terminates correctly on cyclic graphs.

#### IM-18. No unit tests for `rerun.ts` or `evidence.ts`

**Files:** `test/guardrails/`

`extractPriorRunContext`, `checkDeFlaker`, and `assembleEvidence` are only tested indirectly through the evaluate pipeline. Given their centrality to guardrail decisions, direct unit tests are warranted.

#### IM-19. `executeSmoke` path in orchestrator is dead code

**File:** `src/orchestrator/interpret.ts:198-199`

The MCP smoke test branch always falls through to REST. `deps.executeSmoke` is never exercised in any test. This path is unreachable under current logic.

#### IM-20. Evidence assembled 3-4 times per `evaluate()` call

**Files:** `src/guardrails/evaluate.ts:34`, `src/guardrails/narrow.ts:29`, `src/guardrails/redirect.ts:31`

`evaluate()` calls `assembleEvidence(input)`, then passes `input` to `computeNarrowedTarget` and `assessEscalationTriggers`, both of which call `assembleEvidence` again internally. Should compute once and pass down.

#### IM-21. `assembleEvidence` ignores `changeSet.removed` nodes

**File:** `src/guardrails/evidence.ts:25-36`

Iterates `changeSet.added` and `changeSet.modified` but never `changeSet.removed`. Removed nodes could be in `targetNodes` and represent trust-breaking changes.

### Surface Layer & Entry Points

#### IM-22. Surface types use `string` instead of domain types

**File:** `src/types/surface.ts`

- `TrustedNodeInfo.validationLayer` is `string` instead of `ValidationLayer`
- `TargetResolutionInfo.resolvedNodes` and `selectedPath` are `string[]` instead of `NodeIdentity[]`
- `TrustStatusReport.changedSinceLastValidation` is `string[]` instead of `NodeIdentity[]`

This forces casting in `surface.ts` and defeats the type system.

#### IM-23. CLI floating promise in auto-run block

**File:** `src/cli/index.ts:198-200`

`main().then(...)` is neither `await`ed nor `void`-annotated. If `main()` rejects, the rejection is unhandled. Per CODING.md, floating promises are prohibited.

#### IM-24. MCP input schema weaker than internal validation

**File:** `src/mcp/server.ts:22-25`

MCP `TargetSchema` uses flat `z.object` instead of `z.discriminatedUnion`, losing the constraint that `nodes` is required when `kind === 'nodes'`. The runtime `resolveTarget` compensates, but the Zod schema exposed to MCP clients doesn't communicate the correct constraints.

#### IM-25. `resolveExecCredentials` reads `process.env` in library code

**File:** `src/orchestrator/interpret.ts:313-319`

Direct environment variable access in orchestrator library code. Per CODING.md, configuration should be validated at initialization, not scattered in business logic. Makes the function untestable without mutating `process.env`.

---

## Minor Findings

### M-1. `readFileSync` in async function

**File:** `src/static-analysis/graph.ts:128` — `parseJsonFile` is `async` but uses `readFileSync`. Should use `readFile` from `node:fs/promises`.

### M-2. Module-level regex with `/g` flag is fragile

**File:** `src/static-analysis/expressions.ts:54-68` — All regex patterns are module-level constants with `/g`. Each function manually resets `lastIndex`. If any future caller forgets, stale position bugs.

### M-3. Silent skip on missing nodes in multiple locations

**Files:** `src/static-analysis/expressions.ts:34`, `src/static-analysis/params.ts:25` — `if (!graphNode) continue` silently skips. Defensive checks against input that should already be validated. Should either throw or document.

### M-4. `isEnoent` is a one-call helper

**File:** `src/errors.ts:38` — Called exactly once. CODING.md prohibits "helper functions called from exactly one site."

### M-5. `getExecutionData` uses `execution-not-found` for all non-ok responses

**File:** `src/execution/rest-client.ts:395-398` — A 500 server error is classified as `execution-not-found`. Should distinguish 404 from other errors.

### M-6. `hashPinData` returns empty string for non-serializable input

**File:** `src/orchestrator/interpret.ts:309` — If `json-stable-stringify` returns `undefined`, hash is `''`. Silent collision for all non-serializable inputs. Should throw.

### M-7. `normalizePinData` passes `{ json: null }` through as "already wrapped"

**File:** `src/execution/pin-data.ts:107-114` — `typeof null === 'object'` passes the `isWrappedItem` check. Edge case unlikely in practice.

### M-8. Poll timeout drift

**File:** `src/execution/poll.ts:71-85` — Timeout check happens before sleep, but after sleeping the API call isn't re-checked. Execution could run slightly past the 5-minute limit.

### M-9. `recordValidation` throws untyped `Error` for missing node

**File:** `src/trust/trust.ts:39` — Throws bare `Error` instead of a typed domain error. Public API error path that should use a typed error class.

### M-10. Rename trust transfer fragile to hash collisions

**File:** `src/trust/trust.ts:109-126` — Searches all stale records for matching hash. If two different old nodes had the same content hash, trust transfers from the wrong one.

### M-11. `computeWorkflowHash` recomputes every node hash on every call

**File:** `src/trust/hash.ts:84-99` — For the common "something changed" path, every node is hashed three times (twice in `computeWorkflowHash`, once in diff). Should cache per graph instance.

### M-12. BFS uses `Array.shift()` which is O(n)

**File:** `src/trust/trust.ts:88` — Makes BFS O(n²). Use index-based approach or proper queue for large graphs.

### M-13. CLI doesn't respect `NO_COLOR` convention

**File:** `src/cli/format.ts:16-21` — ANSI color codes always emitted. Produces garbled output when piped.

### M-14. CLI `parseArgs` catch discards error details

**File:** `src/cli/index.ts:92-95` — Unknown flags show only generic usage, not what was wrong.

### M-15. Deserialized snapshot has dummy AST

**File:** `src/orchestrator/snapshots.ts:121` — Placeholder `{ nodes: [], connections: [] }` works for `computeChangeSet`, but if any code attempts to use the AST from a snapshot-loaded graph for content hashing, it produces incorrect hashes. Latent correctness risk.

### M-16. `SerializedGraphNode.classification` is `string` instead of `NodeClassification`

**File:** `src/orchestrator/types.ts:169` — Unvalidated string-to-union-type boundary on deserialization.

### M-17. Diagnostic `evidenceBasis` returns `'execution'` when static ran but found nothing

**File:** `src/diagnostics/synthesize.ts:128-135` — Conflates "no static findings" with "no static analysis was run."

### M-18. 118 biome lint errors (import ordering, non-null assertions)

Import organization violations and non-null assertion usage (`!`) throughout. Run `biome check --write src/` for import ordering. Audit `!` usages for safety.

---

## Notes (Positive Observations)

### Domain Modeling
- The type system accurately models CONCEPTS.md: `SliceDefinition` = workflow slice, `PathDefinition` = workflow path, `TrustState` + `NodeTrustRecord` = trusted boundary, `GuardrailDecision` (discriminated union) = guardrail, `DiagnosticSummary` = diagnostic summary.
- Discriminated unions used correctly for `AgentTarget`, `ValidationTarget`, `GuardrailDecision`, `DiagnosticError`.
- String union types used consistently over enums, per CODING.md.

### Architecture
- `OrchestratorDeps` dependency injection is consistently applied, enabling clean test isolation.
- `src/deps.ts` is a clean DI assembly point with no hidden globals.
- MCP server and CLI are genuinely thin layers — no duplicated business logic.
- The package entry point (`src/index.ts`) is the only barrel file, per CODING.md exception.

### Test Quality
- 491 tests, all passing. No trivial tests (no constructor/getter assertions).
- Integration tests use real workflow fixtures through the full pipeline.
- Diagnostic compactness tests enforce the "compact diagnostics" product requirement.
- Guardrail evaluation order is systematically tested (each step wins over subsequent steps).
- Trust state machine tests cover all important transitions.

### Code Discipline
- No `any` usage found in production code.
- No `console.log` in library code.
- No legacy adapters or compatibility shims.
- Fail-fast error handling at boundaries (Zod validation, typed domain errors).
- `strict: true` in tsconfig, with `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`.

---

## Priority Recommendations

### Must fix before release

1. **CR-2, CR-3:** Verify REST API payload and response shapes against a live n8n instance. These could mean execution is entirely non-functional.
2. **CR-4:** Add incoming edge comparison to `nodeEdgesChanged`.
3. **CR-1:** Make `WorkflowGraph` use `NodeIdentity` keys. This eliminates 50+ `as` casts.

### Should fix before release

4. **IM-3:** Pass `trustState` to propagation helpers in `resolveNodes`.
5. **IM-11:** Make `probeRest` return `false` on failure so `static-only` degradation works.
6. **IM-14:** Narrow catch blocks to `ENOENT` specifically.
7. **IM-15:** Use atomic write (temp file + rename) for trust persistence.
8. **IM-1:** Reconcile guardrail evaluation order with STRATEGY.md.
9. **IM-8:** Handle disabled nodes (either detect from AST or skip in analysis).
10. **IM-25:** Move credential resolution to DI layer.

### Should address in first patch

11. **IM-2:** Align path scoring with STRATEGY.md or document deviation.
12. **IM-9, IM-10:** Fix duplicate displayName handling and Merge classification.
13. **IM-16–IM-19:** Close test coverage gaps.
14. **IM-22:** Tighten surface types to use domain types.
15. **M-18:** Fix biome lint errors.

---

## Research Compatibility Review

Cross-reference of `docs/research/*.md` findings against the implementation. These documents catalog the actual behavior of n8n, n8n-docs, and n8n-as-code as observed in their source repositories, and serve as the ground truth for API contracts, data structures, and platform capabilities.

### Findings

#### RC-1. REST API response shape mismatch — confirms CR-3 (Critical)

**Research source:** `execution_feasibility.md` §2.1, `n8n_platform_capabilities.md` §4

Both documents agree: `POST /workflows/:id/run` returns `{ executionId: string }` — a flat object, no `data` wrapper. The implementation's `TriggerExecutionResponseSchema` at `src/execution/rest-client.ts` expects `{ data: { executionId: string } }`. This confirms CR-3: the Zod schema will reject valid n8n responses.

#### RC-2. REST payload shape — partially validates CR-2 (Important, revised)

**Research source:** `execution_feasibility.md` §2.1

The research documents three typed `ManualRunPayload` variants:

1. `{ runData, destinationNode, dirtyNodeNames }` — partial with run data
2. `{ destinationNode }` — full from unknown trigger
3. `{ triggerToStartFrom, destinationNode? }` — full from known trigger

The implementation sends `{ destinationNode, pinData }` which matches variant 2 plus pinData. The research's §4 statement "All paths accept `pinData` for mocking" is stated at the REST API section level (§4 of `n8n_platform_capabilities.md`), not at the typed payload level. Cross-referencing with the n8n source: `pinData` is accepted by the workflow execution controller and passed through to `WorkflowExecute.run()` via `IWorkflowExecutionDataProcess`. It is **not** part of the `ManualRunPayload` type union — it is added at the execution service layer.

**Revised assessment:** The implementation's payload shape `{ destinationNode, pinData }` is likely functional because the controller accepts both fields, even though `pinData` is not part of the typed `ManualRunPayload`. CR-2 should be downgraded from "may not match" to "works via controller-level acceptance but is not type-safe against the documented payload variants." The `runData` and `dirtyNodeNames` fields (absent from the implementation) are only needed for variant 1 (partial execution with prior run data), which n8n-vet does not use.

#### RC-3. MCP `test_workflow` does not support `destinationNode` — implementation correct (Note)

**Research source:** `execution_feasibility.md` §2.3

"Neither [MCP tool] supports `destinationNode`. Both run the full workflow from trigger to end." The implementation correctly uses REST API for bounded execution (`executeBounded`) and MCP for smoke tests (`executeSmoke`). This split aligns with the research recommendation.

#### RC-4. Expression parsing coverage matches research corpus (Note)

**Research source:** `static_analysis_feasibility.md` §1.1

Research found 83.8% of expressions use `$json.field` (53.8%) or `$('NodeName').first().json.field` (30%). The implementation's `traceExpressions` in `src/static-analysis/expressions.ts` handles these two dominant patterns plus `$input.first()` and `$node["Name"]`, covering the same pattern set. The implementation also detects unresolvable patterns (`$fromAI()`, dynamic bracket access) and flags them rather than attempting analysis. This aligns well with the research finding that ~5% of expressions are non-tractable.

#### RC-5. Node classification aligns with research but adds `shape-opaque` (Note, positive)

**Research source:** `static_analysis_feasibility.md` §1.2–1.3

Research recommended classifying nodes as shape-preserving, shape-augmenting, or shape-replacing using `needsPinData()` + `SCRIPTING_NODE_TYPES`. The implementation in `src/static-analysis/classify.ts` uses these exact three categories plus a fourth (`shape-opaque`) for Code/Function/AI nodes. The detection logic checks: scripting types → Set node `include` parameter → preserving set → triggers → HTTP Request → credential presence → default opaque. This is more nuanced than the research's proposed `needsPinData()` heuristic and correctly handles Set node behavior modes (augmenting vs. replacing depending on `include` setting).

#### RC-6. Content hash exclusion set matches research recommendations (Note, positive)

**Research source:** `trust_and_change_detection_feasibility.md` §4.1, §4.2

Research recommended excluding position and metadata (notes, description) from trust-relevant hashing while including parameters, expressions, connections, type, typeVersion, credentials, and execution settings. The implementation's `computeContentHash` in `src/trust/hash.ts` excludes `position`, `name`, `displayName`, `notes`, `id`, `classification` — matching the research's safe-list categories. The implementation also correctly excludes `classification` (an n8n-vet-internal field) which the research did not address.

#### RC-7. Missing `WorkflowValidator` integration from n8nac skills package (Important)

**Research source:** `integration_and_failure_feasibility.md` §6.1, `n8nac_capabilities.md` §3, `validation_surface_map.md` §2

Multiple research documents identify `@n8n-as-code/skills` `WorkflowValidator` as a directly usable validation primitive that checks node type existence, typeVersion, required parameters, parameter types, option values, resource/operation cross-validation, and connection integrity. The research explicitly recommends: "n8n-vet does not need to reimplement this."

The implementation's static analysis subsystem (`graph.ts`, `params.ts`, `schemas.ts`) builds its own parameter validation from scratch. There is no import of `@n8n-as-code/skills` anywhere in the codebase. `package.json` lists only `@n8n-as-code/transformer` as a dependency.

**Impact:** The implementation duplicates validation logic that already exists in a tested, maintained package. More critically, the implementation's `validateNodeParams` and `checkSchemas` may not cover the same edge cases (displayOptions awareness, community node detection, resource/operation cross-validation) that `WorkflowValidator` handles. This is not a correctness bug but a missed integration opportunity that could improve validation quality and reduce maintenance burden.

#### RC-8. Capability detection does not implement the recommended strategy interface (Important)

**Research source:** `integration_and_failure_feasibility.md` §6.2, `validation_surface_map.md` §1

Research recommends: "Design the execution backend with a strategy interface" and explicitly warns that MCP should be "opportunistic, not assumed" due to the `availableInMCP` flag being stripped on push. The research also notes the n8nac `push` bug that silently drops MCP access.

The implementation's `detectCapabilities` in `src/execution/capabilities.ts` is a flat probe function that throws on REST failure (making `static-only` degradation unreachable, as noted in IM-11). There is no strategy pattern, no fallback cascade, and no awareness of the `availableInMCP` stripping issue. If REST probing fails, the error propagates unhandled rather than degrading to static-only mode.

This compounds IM-11: the implementation cannot gracefully degrade to static-only analysis when no n8n instance is reachable, which is explicitly a required capability per the research ("Static-first architecture is validated. [...] Never fail hard when remote access is unavailable — degrade to static analysis").

#### RC-9. No timeout discipline on REST API calls (Important)

**Research source:** `integration_and_failure_feasibility.md` §7.2

Research is emphatic: "Every external call must have an explicit timeout. The n8nac codebase demonstrates what happens without them (only one timeout is set across the entire API client)." Recommended timeouts: REST API 15s per request, execution polling 3 minutes, overall validation 5 minutes.

The implementation's `executeBounded` in `src/execution/rest-client.ts` uses `fetch()` with no timeout option. The polling loop in `src/execution/poll.ts` has a 5-minute overall timeout (matching the MCP `test_workflow` timeout) but individual REST calls within the poll have no per-request timeout. If n8n hangs on a single response, the entire validation blocks indefinitely.

#### RC-10. Config discovery does not reuse n8nac `ConfigService` (Minor)

**Research source:** `integration_and_failure_feasibility.md` §6.3, `n8nac_capabilities.md` §10

Research recommends a cascade: "explicit path > n8nac config > environment variables > static-only mode" and specifically recommends importing `ConfigService` from `n8nac` for host/API key discovery. The implementation's `resolveExecCredentials` in `src/orchestrator/interpret.ts` reads `process.env` directly (`N8N_HOST`, `N8N_API_KEY`). It does not attempt to discover credentials from `n8nac-config.json`, which is the authoritative config source in n8nac-managed projects. This was already noted as IM-25 in the original audit.

#### RC-11. Graph construction approach matches research recommendation (Note, positive)

**Research source:** `graph_parsing_feasibility.md` §5, §6

Research recommended "Approach B: n8nac transformer for TS-to-JSON + own lightweight graph walker." The implementation does exactly this: `parseWorkflowFile` uses `TypeScriptParser` for `.ts` and `JsonToAstParser` for `.json` files from `@n8n-as-code/transformer`, then `buildGraph` constructs its own bidirectional adjacency maps from the AST. The research estimated ~150-250 lines for the graph walker; the implementation's graph construction in `graph.ts` is within this range.

#### RC-12. `NodeIdentity` uses `name` not `propertyName` — research flag (Important)

**Research source:** `graph_parsing_feasibility.md` §5 "Additional finding"

Research notes: "ConnectionAST node references use `propertyName` (camelCase identifier), not `displayName` (n8n's human-readable name). Expression references like `$('Schedule Trigger')` use `displayName`. The graph must maintain a `displayName → propertyName` lookup for expression resolution."

The implementation's `WorkflowGraph` has a `displayNameIndex` map that maps display names to graph node names. This addresses the research concern. However, the graph's primary key (`NodeIdentity`) is the `propertyName` from the AST, while trust state, expressions, and execution data all use `displayName`. This is a further dimension of the CR-1 identity confusion — not just `string` vs `NodeIdentity`, but which string (propertyName vs displayName) is canonical in each context.

#### RC-13. Error classification matches research hierarchy but misses `WorkflowAccessError` (Minor)

**Research source:** `diagnostics_feasibility.md` §3, `integration_and_failure_feasibility.md` §7.1

Research documents a detailed error classification with three categories: workflow-logic, environment/infrastructure, and access/configuration. The implementation's `mapToMcpError` in `src/errors.ts` handles the common cases but the diagnostics subsystem's error classification does not account for `WorkflowAccessError` (with reasons like `no_permission`, `not_available_in_mcp`, `workflow_archived`, `unsupported_trigger`) — a newer error type from n8n's MCP layer. These would currently be classified as `unknown`.

#### RC-14. Pin data format matches research specification (Note, positive)

**Research source:** `execution_feasibility.md` §2.2, `n8n_platform_capabilities.md` §2

Research confirms pin data format is `Record<string, INodeExecutionData[]>` where items must have `{ json: {...} }` wrappers. The implementation's `constructPinData` in `src/execution/pin-data.ts` produces this exact format. The `normalizePinData` utility in n8n handles the common mistake of sending flat objects — the implementation correctly pre-wraps items to avoid this.

#### RC-15. 5-minute MCP timeout not surfaced to guardrails (Minor)

**Research source:** `integration_and_failure_feasibility.md` §7.2, `execution_feasibility.md` §2.3

Research documents a hardcoded 5-minute timeout on `test_workflow` and recommends n8n-vet set its own execution polling timeout at 3 minutes (shorter than MCP's 5 minutes) to maintain control. The implementation's polling timeout in `src/execution/poll.ts` is 5 minutes — matching rather than undercutting the MCP timeout. The guardrail system has no awareness of execution time budgets and cannot warn agents that a large slice may exceed timeout limits.

#### RC-16. Sub-workflow boundaries not modeled in trust system (Minor)

**Research source:** `n8n_platform_capabilities.md` §11, `trust_and_change_detection_feasibility.md` §4.1, `validation_surface_map.md` §6

Research identifies sub-workflows as "the most natural candidates for trusted boundaries" with explicit inputs (sometimes typed) and clear output points. The implementation's trust model operates at individual node granularity — there is no concept of sub-workflow boundaries as composite trust units. `Execute Sub-workflow` nodes are treated like any other node. This is acceptable for v1 but is a missed optimization that the research specifically called out.

### Summary

| Finding | Severity | Status |
|---------|----------|--------|
| RC-1. REST response shape mismatch | Critical | Confirms CR-3 |
| RC-2. REST payload shape | Important | Revises CR-2 (downgrade) |
| RC-3. MCP bounded execution | Note | Implementation correct |
| RC-4. Expression pattern coverage | Note | Aligns with research |
| RC-5. Node classification | Note | Exceeds research recommendations |
| RC-6. Content hash exclusions | Note | Matches research |
| RC-7. Missing WorkflowValidator integration | Important | New finding |
| RC-8. No strategy interface for capabilities | Important | Compounds IM-11 |
| RC-9. No REST timeout discipline | Important | New finding |
| RC-10. No n8nac config reuse | Minor | Extends IM-25 |
| RC-11. Graph construction approach | Note | Matches research |
| RC-12. NodeIdentity name ambiguity | Important | Extends CR-1 |
| RC-13. Missing WorkflowAccessError handling | Minor | New finding |
| RC-14. Pin data format | Note | Correct |
| RC-15. Polling timeout not conservative | Minor | New finding |
| RC-16. Sub-workflow trust boundaries | Minor | Future enhancement |

**New issues found:** 4 Important (RC-7, RC-8, RC-9, RC-12), 4 Minor (RC-10, RC-13, RC-15, RC-16)
**Existing issues confirmed:** CR-3 confirmed, CR-2 revised (likely functional), IM-11 compounded, IM-25 extended
**Positive findings:** 6 areas where implementation aligns with or exceeds research recommendations (RC-3, RC-4, RC-5, RC-6, RC-11, RC-14)

---

## Audit Methodology

Six parallel review agents examined individual subsystems against STRATEGY.md, CODING.md, CONCEPTS.md, and SCOPE.md:

1. **Shared types, surface layer, index, errors, deps** — type system integrity, barrel file compliance, domain modeling
2. **Static analysis** — graph construction, expression tracing, data-loss detection, classification accuracy
3. **Trust** — hashing determinism, change detection, trust derivation/invalidation, persistence
4. **Execution** — REST/MCP clients, polling, pin data, capabilities, API contract verification
5. **Guardrails + Diagnostics** — evaluation pipeline, narrowing, redirect, evidence, diagnostic synthesis
6. **Orchestrator, MCP, CLI** — pipeline correctness, target resolution, path selection, surface layers

Each agent read all source and test files in its scope. Findings were cross-referenced, deduplicated, and severity-calibrated against the design documents and CODING.md standards.
