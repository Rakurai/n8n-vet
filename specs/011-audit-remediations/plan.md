# Implementation Plan: Audit Findings Remediation

**Branch**: `011-audit-remediations` | **Date**: 2026-04-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-audit-remediations/spec.md`

## Summary

Remediate 55+ audit findings across S0 (runtime bugs), S1 (structural defects), S2 (meaningful gaps), and S3 (minor issues). The work is organized into 7 implementation phases ordered by severity and dependency: API contract verification first (S0-2), then execution pipeline fixes (S0-1), trust system fixes (S0-3/4/5), structural refactors (S1), gap closures (S2), minor fixes (S3), and test gap closure last.

## Technical Context

**Language/Version**: TypeScript (strict mode, ESM) on Node.js 20+
**Primary Dependencies**: `@modelcontextprotocol/sdk@^1.12.1`, `@n8n-as-code/transformer@^1.1.0` (currently `file:`, changing to npm), `zod@^3.24.0`, `json-stable-stringify@^1.3.0`
**Storage**: `.n8n-vet/trust-state.json` (trust persistence), `.n8n-vet/snapshots/` (workflow graph snapshots)
**Testing**: vitest with typecheck, biome for linting
**Target Platform**: Node.js 20+ (Linux/macOS)
**Project Type**: Library + MCP server + CLI
**Constraints**: ~30-file cascade for WorkflowGraph key type change (S1-1). All changes must preserve existing test suite (with updated mocks). **Execution backend is MCP-only for triggering** — REST public API used only for read-only operations (execution data retrieval, health probing). `executeBounded()`, `destinationNode`, and REST-based execution triggering are deferred to phase-12 (see spec.md FR-001a, FR-009, FR-011 revisions).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Pre-Phase 0 | Post-Phase 1 |
|-----------|-------------|--------------|
| I. Fail-Fast, No Fallbacks | PASS — FR-011 (static-only mode) is explicit capability degradation with typed result, not a silent fallback | PASS |
| II. Contract-Driven Boundaries | PASS — FR-028 (discriminated union), FR-002 (single type), FR-023 (narrow catches) all strengthen boundaries | PASS |
| III. No Over-Engineering | PASS — All changes driven by concrete audit findings | PASS |
| IV. Honest Code Only | PASS — FR-009 (wire MCP path) eliminates phantom dead code | PASS |
| V. Minimal, Meaningful Tests | PASS — Test additions target identified gaps, not ceremony | PASS |

No violations. No complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/011-audit-remediations/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research findings
├── data-model.md        # Entity/type changes
├── quickstart.md        # Build/test/verify guide
├── contracts/
│   └── mcp-contracts.md # MCP schema and error code contracts
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── cli/                  # S2-12, S3-15, S3-16
│   ├── format.ts         # TTY/NO_COLOR detection
│   └── index.ts          # Floating promise, parse error details
├── types/
│   ├── graph.ts          # S1-1: NodeIdentity keys (~30-file cascade)
│   ├── surface.ts        # S3-19: domain types
│   └── identity.ts       # (unchanged, already correct)
├── static-analysis/
│   ├── graph.ts          # S2-7: disabled field, S3-1: async I/O, S3-5: duplicate displayName
│   ├── expressions.ts    # S2-6: expanded patterns, S3-2: regex /g fix
│   ├── node-sets.ts      # S2-8: Merge mode-aware classification
│   └── ...
├── trust/
│   ├── change.ts         # S0-5: backward edges, S2-5: rename invalidation
│   ├── trust.ts          # S0-3: canonical isTrusted, S3-10: BFS queue, S3-11: typed error
│   ├── persistence.ts    # S0-4: workflow hash, S1-7: atomic writes, S2-9: narrow catches
│   └── hash.ts           # S3-13: cache per graph instance
├── execution/
│   ├── rest-client.ts    # S0-2: API contract, S1-3: credential cascade, S3-7: error classification
│   ├── mcp-client.ts     # R2: get_execution schema fix
│   ├── pin-data.ts       # S1-5: wire caching, S3-9: null check, S2-9: narrow catches
│   ├── capabilities.ts   # S1-6: probeRest graceful, S3-20: tools/list
│   ├── lock.ts           # S1-8: staleness timeout, injectable
│   ├── results.ts        # (wire into orchestrator for S0-1)
│   ├── poll.ts           # S3-14: timeout drift
│   └── types.ts          # S0-1: canonical ExecutionData
├── diagnostics/
│   ├── types.ts          # S0-1: DELETE this ExecutionData, point to execution/types.ts
│   ├── errors.ts         # S0-1: fix httpCode reading path
│   ├── synthesize.ts     # S3-18: evidenceBasis tracking
│   └── ...
├── guardrails/
│   ├── evaluate.ts       # S2-2: reorder to redirect→narrow→warn→refuse
│   ├── evidence.ts       # S2-4: removed nodes, compute once
│   ├── narrow.ts         # S2-4: accept pre-computed evidence
│   └── ...
├── orchestrator/
│   ├── interpret.ts      # S0-1: wire extractExecutionData, S1-3: use resolveCredentials,
│   │                     #   S1-5: wire pin cache, S2-13: dedup findings, S3-8: hashPinData throw,
│   │                     #   S3-21: DEFERRED to phase-12, S2-15: DEFERRED to phase-12
│   ├── resolve.ts        # S0-3: import canonical isTrusted, S2-1: trust boundary stopping
│   ├── path.ts           # S2-3: STRATEGY.md-aligned scoring
│   ├── snapshots.ts      # S1-2: serialize execution settings, S3-22: config for snapshots dir
│   └── types.ts          # S2-10: portable workflowId, S3-17: NodeClassification union type
├── mcp/
│   └── server.ts         # S2-11: path traversal validation, S2-14: discriminated union
├── errors.ts             # S2-16: all domain error cases, S3-6: inline isEnoent
└── index.ts              # (barrel, unchanged)

test/
├── execution/            # FR-043: realistic REST mock payloads
├── orchestrator/         # FR-043: realistic mocks
├── static-analysis/      # FR-044: bracket notation, cycle handling
├── guardrails/           # FR-044: evidence.ts unit tests
├── trust/                # FR-044: snapshot hash stability
├── integration/          # FR-045: gate in npm test
└── ...
```

**Structure Decision**: Existing structure preserved. No new directories. Changes are exclusively modifications to existing files, with one deletion (`diagnostics/types.ts` ExecutionData).

## Implementation Phases

### Phase 1: API Contract Verification & Execution Pipeline (S0-1, S0-2)

**Rationale**: Everything downstream depends on correct data from the execution pipeline. Verify the actual API contract first, then fix the data transformation.

**Files**: `src/execution/rest-client.ts`, `src/execution/mcp-client.ts`, `src/execution/results.ts`, `src/diagnostics/types.ts`, `src/diagnostics/errors.ts`, `src/orchestrator/interpret.ts`

**Steps**:
1. Test REST endpoints against `localhost:5678` to verify actual response shapes
2. **REVISED**: `POST /workflows/:id/run` is internal/editor-only (session auth) — not accessible via API key. Schema fix for `TriggerExecutionResponseSchema` is deferred; endpoint is not used for execution triggering. MCP `test_workflow` is the sole execution trigger.
3. Update `ExecutionStatusResponseSchema`, `ExecutionDataResponseSchema` to match verified GET shapes (public API — still used for read-only data retrieval)
4. Update `GetExecutionResponseSchema` in mcp-client.ts (fix: `data` is top-level sibling of `execution`, not nested)
5. Delete diagnostics-local `ExecutionData` type from `diagnostics/types.ts`
6. Update all diagnostics code to consume `execution/types.ts::ExecutionData`
7. Wire `extractExecutionData()` into orchestrator at the cast site in `interpret.ts`
8. Fix `classifyApiError` in `diagnostics/errors.ts` to read httpCode from correct location
9. Update orchestrator test mocks to use realistic REST response shapes (FR-043)

**Dependencies**: Live n8n instance at localhost:5678.
**Risk**: If actual API shapes differ from both current code AND research predictions, may require deeper refactoring.

### Phase 2: Trust System Fixes (S0-3, S0-4, S0-5)

**Rationale**: Trust is the second critical subsystem — incorrect trust means wrong validation scope.

**Files**: `src/orchestrator/resolve.ts`, `src/trust/trust.ts`, `src/trust/change.ts`, `src/trust/persistence.ts`, `src/trust/hash.ts`

**Steps**:
1. Import canonical `isTrusted` from `trust/trust.ts` in `resolve.ts`, remove shadow implementation (S0-3)
2. Pass graph AST + `computeContentHash` into resolve for hash computation
3. Fix `persistTrustState` call to pass `computeWorkflowHash(graph)` instead of `workflowId` (S0-4)
4. Add backward edge comparison in `nodeEdgesChanged()` in `change.ts` (S0-5)
5. Update tests to verify incoming edge changes are detected

**Dependencies**: Phase 1 (clean ExecutionData type needed for trust integration).

### Phase 3: Structural Fixes (S1)

**Rationale**: These are the larger refactoring tasks that touch multiple files.

**Sub-phase 3a: WorkflowGraph NodeIdentity keys (S1-1, FR-006)**
- Change all `Map<string, ...>` to `Map<NodeIdentity, ...>` in `WorkflowGraph`
- Update ~30 consuming files to use `NodeIdentity` keys
- Remove `as` casts at map access sites
- This is a mechanical refactor — no behavioral change

**Sub-phase 3b: Snapshot serialization (S1-2, FR-007)**
- Add `retryOnFail`, `executeOnce`, `onError` to `SerializedGraphNode`
- Reconstruct during deserialization
- Add snapshot hash stability test (FR-044)

**Sub-phase 3c: Credential resolution (S1-3, FR-008)**
- Delete local `resolveExecCredentials` helper in orchestrator
- Call `resolveCredentials()` from `rest-client.ts` instead

**Sub-phase 3d: MCP execution wiring (S1-4/FR-009) — REVISED**
- MCP `test_workflow` is the **sole execution triggering path** (not alongside REST)
- Add `McpToolCaller` to `ValidationRequest` or `OrchestratorDeps`
- Wire `executeSmoke` path in orchestrator as the only execution dispatch
- Pin data at trusted boundaries controls execution scope (pinned nodes don't re-execute)
- The existing `executeBounded` REST paths and `findFurthestDownstream` remain in the codebase but are inert — **stripping them out is phase-12 scope** (`docs/prd/phase-12-execution-backend-revision.md`)
- `destinationNode` request field remains in the type but is not dispatched in the orchestrator
- Test MCP smoke execution end-to-end

**Sub-phase 3e: Pin data caching (S1-5, FR-010)**
- Call `readCachedPinData()` before `constructPinData`
- Pass as `priorArtifacts`
- Call `writeCachedPinData()` after successful runs

**Sub-phase 3f: Graceful degradation (S1-6, FR-011) — REVISED**
- MCP tool availability is the **primary gate** for execution capability
- Wrap `probeRest` in try-catch mapping infrastructure errors to `restAvailable: false` (REST still needed for read-only data retrieval)
- When MCP is unavailable, degrade to static-only analysis with typed capability result (explicit detection, not a fallback)
- Verify `static-only` capability path becomes reachable

**Sub-phase 3g: Atomic trust writes (S1-7, FR-012)**
- Write to temp file, `renameSync` to target
- Add advisory file locking for concurrent access

**Sub-phase 3h: Execution lock (S1-8, FR-013)**
- Add timestamp + configurable expiry to execution lock
- Make injectable for test isolation

**Sub-phase 3i: Dependency fix (S1-9, FR-014)**
- Replace `file:../n8n-as-code/packages/transformer` with `^1.1.0` in package.json
- Run `npm install` to verify resolution

**Dependencies**: Phase 2 complete. Sub-phase 3a should go first (other sub-phases benefit from correct types).

### Phase 4: Gap Closures (S2)

**Rationale**: These fix behavioral gaps where the implementation doesn't match the designed behavior.

**Sub-phase 4a: Trust-boundary-aware validation (S2-1, FR-015)**
- Pass `trustState` into `resolveNodes` and propagation helpers
- Add trust-boundary stopping logic

**Sub-phase 4b: Guardrail evaluation order (S2-2, FR-016)**
- Reorder `evaluate.ts` to: redirect → narrow → warn → refuse
- Update tests to verify order

**Sub-phase 4c: Path scoring (S2-3, FR-017)**
- Replace 4 ad-hoc tiers with STRATEGY.md-aligned scoring
- Add: opaque node awareness, branching weight, prior failures, cost estimation, overlap penalty

**Sub-phase 4d: Evidence assembly (S2-4, FR-018)**
- Add `changeSet.removed` iteration in `evidence.ts`
- Compute evidence once in `evaluate()`, pass to `narrow()` instead of recomputing

**Sub-phase 4e: Rename trust invalidation (S2-5, FR-019)**
- Change rename detection to invalidate trust instead of transferring it
- Propagate re-validation to referencing nodes

**Sub-phase 4f: Expression patterns (S2-6, FR-020)**
- Add patterns: `$node.Name` (dot syntax), `$items("Name")`, `$binary` access, `itemMatching(n)`
- Add tests for bracket notation (FR-044)

**Sub-phase 4g: Disabled nodes (S2-7, FR-021)**
- Read `disabled` from raw node data in graph construction
- Exclude disabled nodes from active analysis

**Sub-phase 4h: Merge classification (S2-8, FR-022)**
- Inspect `mode` parameter for Merge nodes
- Classify as shape-augmenting/replacing based on mode

**Sub-phase 4i: Narrow catches (S2-9, FR-023)**
- In `persistence.ts`, `rest-client.ts`, `pin-data.ts`: narrow catches to ENOENT
- Re-throw unexpected errors

**Sub-phase 4j: Portable workflow ID (S2-10, FR-024)**
- Change `deriveWorkflowId` to use project-relative path or content hash

**Sub-phase 4k: Path traversal protection (S2-11, FR-025)**
- Validate `workflowPath` resolves under CWD or configured root in MCP server and CLI

**Sub-phase 4l: CLI ANSI suppression (S2-12, FR-026)**
- Check `process.env.NO_COLOR` or `!process.stdout.isTTY` in `format.ts`

**Sub-phase 4m: Finding deduplication (S2-13, FR-027)**
- Deduplicate by `(node, kind, message)` tuple after multi-path loop in `interpret.ts`

**Sub-phase 4n: MCP discriminated union (S2-14, FR-028)**
- Replace flat `z.object` with `z.discriminatedUnion` in `server.ts`

**Sub-phase 4o: Rename function (S2-15, FR-029)**
- Rename `findFurthestDownstream` to `getFirstExitPoint` (or implement topological ordering)

**Sub-phase 4p: Error classification (S2-16, FR-030)**
- Add cases for `ExecutionInfrastructureError`, `TrustPersistenceError`, `SynthesisError`, `ExecutionPreconditionError`

**Dependencies**: Phases 1-3 complete. Sub-phases 4a-4p are largely independent.

### Phase 5: Minor Fixes (S3)

**Rationale**: Low-risk mechanical fixes that can be batched.

**Batch A — Type safety & correctness**:
- S3-1: `readFileSync` → `readFile` in `static-analysis/graph.ts`
- S3-2: Module-level regex → local instances or `matchAll` in `expressions.ts`
- S3-5: Throw on duplicate `displayName` in `graph.ts`
- S3-9: Null check in `normalizePinData` in `pin-data.ts`
- S3-17: `SerializedGraphNode.classification` → `NodeClassification` union type
- S3-19: Surface types use `ValidationLayer`, `NodeIdentity` instead of `string`

**Batch B — Error handling & promises**:
- S3-7: Distinguish 404 from 5xx in `rest-client.ts`
- S3-8: `hashPinData` throw instead of returning `''`
- S3-11: `recordValidation` uses typed domain error
- S3-15: CLI floating promise `main().then(...)` → `void` or `.catch`
- S3-16: CLI `parseArgs` catch includes error details
- S3-23: `bin/n8n-vet` floating promise fix

**Batch C — Performance & config**:
- S3-3: `passWithNoTests: false` in vitest config
- S3-6: Inline `isEnoent` helper
- S3-10: BFS uses index-based queue in `trust.ts`
- S3-13: Cache `computeContentHash` per graph instance in `hash.ts`
- S3-14: Check elapsed time after sleep+API call in `poll.ts`
- S3-20: Use `tools/list` instead of empty-args tool calls in `capabilities.ts`
- S3-22: Move `resolveSnapshotsDir()` env read to config/DI

**Batch D — Diagnostics & lint**:
- S3-18: Track whether static analysis ran in `evidenceBasis`
- S3-21: **DEFERRED to phase-12** (`docs/prd/phase-12-execution-backend-revision.md`). Original finding (extract shared executeBounded helper) superseded — phase-12 removes executeBounded entirely.
- S3-4: Run `biome check --write src/`, audit `!` usages
- S3-12: Guard rename trust transfer against hash collisions

**Dependencies**: Phase 4 complete. Batches A-D can be parallelized.

### Phase 6: Test Gap Closure

**Files**: `test/**/*.test.ts`, `vitest.config.ts`

**Steps**:
1. Update orchestrator test mocks with realistic REST payloads (FR-043, if not already done in Phase 1)
2. Add expression test for `$json['bracket']` syntax (FR-044)
3. Add cyclic graph fixture test for `detectDataLoss` (FR-044)
4. Add unit tests for `rerun.ts` and `evidence.ts` (FR-044)
5. Add snapshot hash stability test (save → load → hash comparison) (FR-044)
6. Fix `cli-binary.test.ts` expected exit code (S3-24)
7. Gate integration tests in `npm test` (FR-045) — add vitest config or CI step
8. Verify `passWithNoTests: false` catches any remaining untested modules

**Dependencies**: All prior phases complete.

### Phase 7: Verification

**Steps**:
1. `npm run build` — zero TypeScript errors
2. `npm test` — all tests pass (including new integration gate)
3. `npx biome check src/` — zero lint errors
4. Manual smoke test: run validation against live n8n workflow via MCP `test_workflow`
5. Verify MCP execution path works end-to-end (sole execution trigger)
6. Verify static-only mode works when MCP tools are unavailable
7. Verify REST read-only path works for execution data retrieval (`GET /executions/:id`)

**Dependencies**: All prior phases complete.

**Note**: Stripping out `executeBounded`/`destinationNode` code is phase-12 scope (`docs/prd/phase-12-execution-backend-revision.md`). This phase only verifies the fixes applied in 011.
