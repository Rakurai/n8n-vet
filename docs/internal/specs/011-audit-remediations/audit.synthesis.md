# Synthesized Code Audit

**Date:** 2026-04-19 (updated after phase 9/10 merge)
**Source audits:** Copilot, GPT, Opus, Roast — all four reviewed independently, then cross-referenced and verified against source code.
**Scope:** `src/`, `test/`, config files. Excludes `docs/prd/`, `docs/reference/`, `docs/research/`, `specs/`.
**Baseline health:** TypeScript strict mode passes, 527 tests pass across 46 files (36 new tests from phases 9/10). 1 test failure in `test/plugin/cli-binary.test.ts` (exit code mismatch). Biome lint fails (118 warnings).

---

## Verification Method

Every finding below was verified against the actual source code — 58 of 60 spot-checked claims confirmed across all severity levels (the remaining 2 were phrasing inversions that actually confirmed the underlying issue). After phases 9 (plugin wrapper) and 10 (integration testing) merged, all findings were re-evaluated for changes. Confidence in this synthesis is high.

---

## Consensus Summary

All four audits agree on the overall picture:

1. **Subsystem-level architecture is solid.** Boundaries between static-analysis, trust, guardrails, diagnostics, execution, and orchestrator are clean. Dependency injection is consistent. The domain model maps well to CONCEPTS.md.
2. **The execution → diagnostics pipeline is broken.** This is the top finding across all four audits without exception.
3. **The `NodeIdentity` branded type provides no actual safety.** The graph uses `string` keys, forcing `as` casts everywhere.
4. **The orchestrator is a monolith.** A ~300-line function with numbered comments, not a composable pipeline.
5. **Tests are strong in isolation, with new integration tests narrowing the gap.** 527 unit/plugin tests pass across 46 files. Phase 10 added 8 integration test scenarios that wire real subsystems end-to-end against a live n8n instance (static-only, execution happy/failure, trust lifecycle, guardrail rerun, bounded execution, MCP tools round-trip, full pipeline). The cross-subsystem gap identified by all four audits is partially addressed — but the integration tests require a live n8n instance, so the execution→diagnostics type mismatch (S0-1) may still be masked in environments where n8n is unavailable.
6. **Several subsystem features are exported but never wired into orchestration.** Pin data caching, MCP execution, polling — all exist in isolation but are dead from the production path.

---

## Severity Key

- **S0 — Broken at runtime.** Code that will fail or produce wrong results when exercised. Must fix before any release.
- **S1 — Structural defect.** Design flaw that causes real problems under normal use. Fix before release.
- **S2 — Meaningful gap.** Works today but creates risk or misalignment with stated design. Fix before 1.0.
- **S3 — Minor.** Style, polish, or low-impact inconsistency.

---

## S0 — Broken at Runtime

### S0-1. Execution → diagnostics pipeline is entirely broken

**Reported by:** All four audits (Copilot P0-001/P0-002/P0-003, GPT #1, Opus CR-2/CR-3, Roast #9)
**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts#L233-L234), [src/diagnostics/types.ts](../src/diagnostics/types.ts), [src/execution/types.ts](../src/execution/types.ts), [src/execution/results.ts](../src/execution/results.ts), [src/diagnostics/errors.ts](../src/diagnostics/errors.ts)
**Verified:** Yes — all structural claims confirmed in source.

Three compounding issues form a single broken pipeline:

**(a)** The orchestrator casts the raw REST response directly to the diagnostics `ExecutionData` type (`rawData as ExecutionData | null`). The REST response shape (`{ data: { data: { resultData: { runData: ... } } } }`) is structurally incompatible with the diagnostics type (`{ status, lastNodeExecuted, error, nodeResults: Map<...> }`). The `as` cast silences the compiler; fields are `undefined` at runtime. The extraction function `extractExecutionData()` exists in `execution/results.ts` but is never called.

**(b)** Two incompatible `ExecutionData` types exist — `diagnostics/types.ts` (single `NodeExecutionResult` per node, `httpCode?: number` top-level, 3-variant status) vs `execution/types.ts` (array of `NodeExecutionResult[]` per node, `context: { httpCode: string }` nested, 8-variant status). Even fixing (a) by calling `extractExecutionData()` would produce the execution type, which the diagnostics subsystem cannot consume.

**(c)** `classifyApiError` in diagnostics reads `error.httpCode` at the top level as a number. The execution type puts it in `context.httpCode` as a string. All API error classification is unreliable — credential failures (401/403) would be misclassified as `'external-service'`.

The test suite hides this by mocking `getExecutionData` with `{}` instead of realistic payloads.

**Remediation:** Unify the type universes. Delete the diagnostics-local `ExecutionData` and update all diagnostics code to consume `execution/types.ts::ExecutionData`. Then wire `extractExecutionData()` into the orchestrator at the cast site. This resolves (a), (b), and (c) together.

---

### S0-2. REST API contract may not match actual n8n endpoints

**Reported by:** Opus CR-2/CR-3, GPT #1 (partial)
**Files:** [src/execution/rest-client.ts](../src/execution/rest-client.ts)
**Verified:** Schema structure confirmed in source. Live behavior unverified.

Two concerns:

**(a)** `executeBounded` sends `{ destinationNode: { nodeName, mode }, pinData }` as a top-level payload. The documented n8n `POST /workflows/:id/run` variants all place data inside `runData`, not alongside `destinationNode`. If `pinData` must be inside `runData`, bounded execution with mocking is structurally wrong.

**(b)** `TriggerExecutionResponseSchema` expects `{ data: { executionId: string } }`. Research notes suggest the actual response is `{ executionId: string }` with no `data` wrapper. If correct, every execution trigger fails at Zod validation.

Together, these would make the entire REST execution path non-functional.

**Remediation:** Test against a live n8n instance. This is the highest-priority validation — no amount of code review can confirm the actual API contract.

---

### S0-3. Shadow `isTrusted` in resolve.ts skips content hash verification

**Reported by:** Copilot P0-005
**Files:** [src/orchestrator/resolve.ts](../src/orchestrator/resolve.ts) (local `isTrusted`), [src/trust/trust.ts](../src/trust/trust.ts) (canonical `isTrusted`)
**Verified:** Yes — local function checks only `trustState.nodes.has(nodeId)`, canonical requires `contentHash` match.

The resolve module defines its own `isTrusted` that only checks Map membership. The canonical version in `trust/trust.ts` requires the content hash to match. A node whose content has changed but still has a trust record is treated as trusted by the resolver, causing:
- Slice propagation stops too early at stale trust boundaries
- Changed nodes may be excluded from targets

**Remediation:** Import `isTrusted` from `src/trust/trust.ts`. This requires computing content hashes during resolve, which means `resolveTarget` needs access to the graph's AST and `computeContentHash`.

---

### S0-4. `persistTrustState` receives workflowId (file path) instead of workflowHash

**Reported by:** Copilot P0-004, GPT #8, Opus IM-6
**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts#L279), [src/trust/persistence.ts](../src/trust/persistence.ts#L83)
**Verified:** Yes — calls `deps.persistTrustState(updatedTrust, workflowId)` where the parameter is named `workflowHash`.

The `workflowHash` field in `trust-state.json` will contain an absolute file path, not a content hash. Any code consuming this field for quick-check optimization or cross-machine portability gets garbage.

**Remediation:** Pass `computeWorkflowHash(graph)` instead of `workflowId`.

---

### S0-5. Change detection misses incoming edge changes

**Reported by:** Opus CR-4
**Files:** [src/trust/change.ts](../src/trust/change.ts#L110-L111)
**Verified:** Yes — `nodeEdgesChanged` only compares `graph.forward.get(nodeName)`.

A node gaining a new upstream connection (incoming edge) is not flagged as changed. The change is only attributed to the source node's outgoing edges. A node receiving input from a new source has fundamentally different runtime behavior but retains trust.

**Remediation:** Also compare `graph.backward.get(nodeName)` for incoming edge changes.

---

## S1 — Structural Defects

### S1-1. `WorkflowGraph` uses `string` keys — branded `NodeIdentity` provides no safety

**Reported by:** All four audits (Copilot P2-001, GPT implicit, Opus CR-1, Roast #1)
**Files:** [src/types/graph.ts](../src/types/graph.ts), cascading to ~30 files
**Verified:** Yes — `Map<string, ...>` throughout, 50+ `as NodeIdentity`/`as string` casts across the codebase.

`WorkflowGraph.nodes`, `.forward`, `.backward`, `.displayNameIndex`, `Edge.from/to`, and `GraphNode.name` are all `string`. Every other type in the system uses `NodeIdentity`. This root mismatch forces `as` casts at every boundary and is the single largest source of type assertions in the codebase. CODING.md explicitly prohibits `as T`.

**Remediation:** Change `WorkflowGraph` maps to use `NodeIdentity` keys. This cascades through the codebase but eliminates the majority of `as` casts in one sweep. Do it during a dedicated refactoring pass — it touches ~30 files.

---

### S1-2. Snapshot deserialization drops AST fields that trust hashing depends on

**Reported by:** Copilot P1-001, GPT #3, Opus M-15
**Files:** [src/orchestrator/snapshots.ts](../src/orchestrator/snapshots.ts#L87), [src/trust/hash.ts](../src/trust/hash.ts)
**Verified:** Yes — `{ nodes: [], connections: [] } as unknown as WorkflowAST`.

Snapshot deserialization replaces the AST with an empty placeholder. Trust hashing via `computeContentHash` reads execution settings (`retryOnFail`, `executeOnce`, `onError`) from `ast.nodes.find(...)`, which always returns `undefined` for deserialized snapshots. Nodes with non-default execution settings produce false-positive changes on every run, undermining trust reuse.

**Remediation:** Include execution settings in `SerializedGraphNode` and reconstruct them during deserialization, so content hashes remain stable across save/load cycles.

---

### S1-3. Orchestrator bypasses the credential resolution cascade

**Reported by:** Copilot P1-002, GPT #4 (partial), Opus IM-25, Roast #4
**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts) (`resolveExecCredentials`), [src/execution/rest-client.ts](../src/execution/rest-client.ts) (`resolveCredentials`)
**Verified:** Yes — orchestrator reads only `process.env`, ignoring the 4-level cascade (explicit → env → n8nac config → global credentials).

Two duplicate credential resolution functions. The orchestrator's version is env-var-only and throws bare `Error` instead of `ExecutionConfigError`. Users relying on n8nac config files get unhelpful errors.

**Remediation:** Delete the local helper. Call `resolveCredentials()` from `rest-client.ts`.

---

### S1-4. MCP execution path is dead code

**Reported by:** Copilot P1-003, GPT #4, Opus IM-19, Roast #7
**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts), [src/execution/mcp-client.ts](../src/execution/mcp-client.ts)
**Verified:** Yes — the MCP smoke test branch always falls through to REST. `executeSmoke` is never called.

`ValidationRequest` has no field for a `McpToolCaller`. `OrchestratorDeps` declares `executeSmoke` in its interface but the orchestrator never invokes it. The entire MCP execution path is unreachable.

**Remediation:** Either wire `McpToolCaller` through `OrchestratorDeps` / `ValidationRequest`, or remove the dead branch and document MCP execution as not-yet-implemented. Don't ship dead branches that suggest working features.

---

### S1-5. Pin data artifact caching is exported but never used

**Reported by:** Copilot P1-004, GPT #5
**Files:** [src/execution/pin-data.ts](../src/execution/pin-data.ts), [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts)
**Verified:** Yes — `readCachedPinData()` and `writeCachedPinData()` never called. `constructPinData` called with 3 args instead of 4 (no `priorArtifacts`).

Tier 2 of pin data sourcing ("prior validation artifacts") is dead. The orchestrator never reads cached pin data before `constructPinData` and never writes it after successful execution. Trusted-boundary execution reuse is much weaker than the code layout suggests.

**Remediation:** Wire the cache: read cached pin data before calling `constructPinData`, pass as `priorArtifacts`, and write artifacts after successful runs.

---

### S1-6. `probeRest` failure prevents graceful degradation to static-only mode

**Reported by:** GPT #4, Opus IM-11
**Files:** [src/execution/capabilities.ts](../src/execution/capabilities.ts)
**Verified:** Partially — `probeRest` throws on network error and auth failure but can return `false` for 5xx. The common failure modes (unreachable, auth) all throw.

`detectCapabilities` has a `static-only` level for when `restAvailable === false`, but this path is unreachable for the common failure scenarios. The `explain` surface is effectively coupled to runtime credential availability even though it should operate in local/static mode.

**Remediation:** Wrap the `probeRest` call in a try-catch that maps infrastructure errors to `restAvailable: false` rather than propagating. The surface should degrade gracefully when n8n isn't running.

---

### S1-7. No file locking or atomic writes for trust-state.json

**Reported by:** Copilot P1-005, Opus IM-15
**Files:** [src/trust/persistence.ts](../src/trust/persistence.ts#L129-L130)
**Verified:** Yes — `writeFileSync` directly to target path, no temp-file + rename.

Concurrent MCP requests or CLI invocations can race on read-modify-write. Process interruption mid-write corrupts the file, losing all workflows' trust state.

**Remediation:** Write to a temp file then `renameSync` to the target (atomic on POSIX). For concurrent-access safety, add advisory file locking or serialize writes through the MCP server.

---

### S1-8. Module-level mutable execution lock with no staleness protection

**Reported by:** Copilot P1-006, Opus IM-13
**Files:** [src/execution/lock.ts](../src/execution/lock.ts)
**Verified:** Yes — `let executionInFlight = false` at module scope.

A crash during execution leaves the lock permanently held. No staleness timeout, no reset mechanism beyond test helpers. In a long-running MCP server, this is a permanent brick.

**Remediation:** Add a timestamp to the lock, expire after a configurable timeout (e.g., `POLL_TIMEOUT_MS`). Make the lock injectable for test isolation.

---

### S1-9. `file:` dependencies make the package unpublishable

**Reported by:** GPT #2, Roast #6
**Files:** [package.json](../package.json)
**Verified:** Yes — `"@n8n-as-code/transformer": "file:../n8n-as-code/packages/transformer"` and similar.

Anyone who clones the repo without the exact sibling directory structure gets a build failure on `npm install`. This is a release blocker for standalone distribution.

**Remediation:** Use a workspace protocol, publish to a registry (even a private one), or at minimum use a git URL dependency.

---

## S2 — Meaningful Gaps

### S2-1. Node-targeted validation ignores trust boundaries

**Reported by:** Opus IM-3
**Files:** [src/orchestrator/resolve.ts](../src/orchestrator/resolve.ts#L72-L78)
**Verified:** Yes — `resolveNodes` does not pass `trustState` to `propagateForward`/`propagateBackward`.

Node-targeted validation (`kind: 'nodes'`) always propagates to the full graph boundary, producing larger slices than necessary. Only `resolveChanged` (`kind: 'changed'`) uses trust boundaries. Violates the principle that trusted boundaries reduce work.

**Remediation:** Pass `trustState` to propagation helpers in `resolveNodes`, with the same trust-boundary stopping logic used in `resolveChanged`.

---

### S2-2. Guardrail evaluation order deviates from STRATEGY.md

**Reported by:** Opus IM-1
**Files:** [src/guardrails/evaluate.ts](../src/guardrails/evaluate.ts)
**Verified:** Yes — order is: bypass → refuse (empty) → refuse (identical rerun) → redirect → narrow → warn → proceed. STRATEGY.md says redirect > narrow > warn > refuse.

The refuse-before-redirect order is arguably reasonable (no point redirecting if nothing changed), but it's an undocumented deviation from the stated contract.

**Remediation:** Either update STRATEGY.md to document the exception, or reorder the implementation.

---

### S2-3. Path scoring diverges from STRATEGY.md specification

**Reported by:** Opus IM-2
**Files:** [src/orchestrator/path.ts](../src/orchestrator/path.ts)
**Verified:** Scoring uses 4 ad-hoc tiers. Missing from STRATEGY.md spec: opaque node awareness, branching logic weight, prior failures, cost estimation, overlap penalty.

**Remediation:** Either align the implementation or update STRATEGY.md with the actual heuristics and rationale.

---

### S2-4. `assembleEvidence` ignores removed nodes and is computed redundantly

**Reported by:** Opus IM-20/IM-21, Copilot P2-004
**Files:** [src/guardrails/evidence.ts](../src/guardrails/evidence.ts#L25-L36), [src/guardrails/evaluate.ts](../src/guardrails/evaluate.ts), [src/guardrails/narrow.ts](../src/guardrails/narrow.ts)
**Verified:** Yes on both counts — `changeSet.removed` is never iterated, and `assembleEvidence` is called 3 times per `evaluate()`.

Removed nodes that are in `targetNodes` represent trust-breaking changes but are invisible to the evidence. The redundant computation is a performance issue (3 calls instead of 1).

**Remediation:** Add `changeSet.removed` iteration. Compute evidence once in `evaluate()` and pass it down to subroutines.

---

### S2-5. Rename handling preserves trust when research says it shouldn't

**Reported by:** GPT #11
**Files:** [src/trust/change.ts](../src/trust/change.ts#L244-L274), [src/trust/trust.ts](../src/trust/trust.ts#L109-L126)
**Verified:** Yes — rename detection rewrites remove+add pairs into `metadata-only`, and trust is transferred to the renamed node.

Research explicitly documents that node renames are trust-breaking because node names are connection keys and expression targets (`$('NodeName')`). A rename can invalidate expression references even when the node's own parameters are unchanged. Preserving trust across rename overstates confidence.

**Remediation:** Treat renames as trust-invalidating. Remove the `metadata-only` rewrite for rename pairs, or at minimum propagate a re-validation requirement to nodes that reference the old name.

---

### S2-6. Expression parser narrower than n8n's own syntax surface

**Reported by:** GPT #12
**Files:** [src/static-analysis/expressions.ts](../src/static-analysis/expressions.ts)
**Verified:** Yes — 4 patterns supported: `$json.field`, `$json['field']`, `$('Name').json.field`, `$input.json.field`, `$node["Name"].json.field`. Missing: `$node.Name` (dot syntax), `$items("Name")`, `$binary` access, `itemMatching(n)` with literal arg.

Research noted that n8n's own parser covers more syntax forms. Under-coverage directly weakens static analysis value and increases false negatives.

**Remediation:** Expand pattern coverage to match the researched feasible surface, prioritizing the legacy forms most likely to appear in real workflows.

---

### S2-7. `disabled` field hardcoded to `false` — disabled nodes analyzed as active

**Reported by:** Opus IM-8
**Files:** [src/static-analysis/graph.ts](../src/static-analysis/graph.ts#L47-L48)
**Verified:** Yes — `disabled: false, // NodeAST has no disabled field`.

Disabled nodes are traced for expressions and data flow as if active. Produces false positives for data-loss and false negatives for broken-reference detection.

**Remediation:** If `NodeAST` doesn't expose the disabled field, check the underlying raw node data during graph construction.

---

### S2-8. `Merge` node blanket-classified as `shape-preserving`

**Reported by:** Opus IM-10
**Files:** [src/static-analysis/node-sets.ts](../src/static-analysis/node-sets.ts)
**Verified:** Yes — `n8n-nodes-base.merge` is in `SHAPE_PRESERVING_TYPES` set. Merge has multiple modes.

Merge in combining mode is shape-augmenting or shape-replacing. Blanket classification causes false negatives in data-loss detection.

**Remediation:** Make Merge classification mode-aware — inspect the node's `mode` parameter.

---

### S2-9. Broad catch blocks mask filesystem errors

**Reported by:** Copilot P2-005, GPT #10, Opus IM-14
**Files:** [src/trust/persistence.ts](../src/trust/persistence.ts), [src/execution/rest-client.ts](../src/execution/rest-client.ts), [src/execution/pin-data.ts](../src/execution/pin-data.ts)
**Verified:** Yes — multiple catch blocks return `undefined` or silently continue. Permission errors, disk failures indistinguishable from "file not found."

CODING.md: "Never mask or downgrade errors."

**Remediation:** Narrow catch blocks to `ENOENT` specifically. Re-throw unexpected errors. For the credential cascade, this is defensible as probe semantics but should at minimum log.

---

### S2-10. `deriveWorkflowId` produces non-portable absolute paths

**Reported by:** Copilot P1-007
**Files:** [src/orchestrator/types.ts](../src/orchestrator/types.ts)
**Verified:** Yes — `return resolve(workflowPath)` produces machine-specific absolute paths.

Trust state and snapshots are keyed by absolute path. Not portable across machines, CI environments, or different clones.

**Remediation:** Use a project-relative or content-derived identifier — e.g., path relative to the nearest `package.json` or `n8nac-config.json`.

---

### S2-11. No path traversal protection on `workflowPath`

**Reported by:** Copilot P2-007
**Files:** [src/mcp/server.ts](../src/mcp/server.ts), [src/cli/index.ts](../src/cli/index.ts)
**Verified:** Yes — MCP server passes `args.workflowPath` directly to `ValidationRequest` with zero validation. CLI similarly passes through.

An agent or compromised tool caller could pass paths outside the project root. Reads through `parseWorkflowFile` would succeed for any accessible `.ts` file.

**Remediation:** Validate that `workflowPath` resolves to a location under the current working directory or a configured project root. Reject paths with `..` traversal.

---

### S2-12. CLI doesn't respect `NO_COLOR` and always emits ANSI codes

**Reported by:** Copilot P2-008, Opus M-13
**Files:** [src/cli/format.ts](../src/cli/format.ts)
**Verified:** Yes — no `NO_COLOR` check, no TTY detection.

**Remediation:** Check `process.env.NO_COLOR` or `!process.stdout.isTTY` and suppress ANSI accordingly.

---

### S2-13. Static finding deduplication missing for multi-path analysis

**Reported by:** Copilot P2-003
**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts)
**Verified:** Yes — findings from shared nodes across multiple paths are pushed without dedup.

Violates CONCEPTS.md: "A diagnostic summary should not devolve into pass spam."

**Remediation:** Deduplicate findings by `(node, kind, message)` tuple after the path analysis loop.

---

### S2-14. MCP input schema weaker than internal validation

**Reported by:** Opus IM-24
**Files:** [src/mcp/server.ts](../src/mcp/server.ts)
**Verified:** Yes — flat `z.object` instead of `z.discriminatedUnion`.

The Zod schema doesn't enforce that `nodes` is required when `kind === 'nodes'`. Runtime compensates, but MCP clients get incorrect schema documentation.

**Remediation:** Use `z.discriminatedUnion` for the target schema.

---

### S2-15. `findFurthestDownstream` is misnamed — returns arbitrary exit point

**Reported by:** Opus IM-4, Roast #5
**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts)
**Verified:** Yes — returns `slice.exitPoints[0]!` with no topological consideration.

**Remediation:** Either rename to `getFirstExitPoint` or implement actual topological ordering.

---

### S2-16. Error classification collapses domain distinctions

**Reported by:** GPT #7
**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts), [src/errors.ts](../src/errors.ts)
**Verified:** Yes — `mapToMcpError` handles `MalformedWorkflowError`, `ZodError`, `ConfigurationError`, `ExecutionConfigError`, and generic `Error`. Misses `ExecutionInfrastructureError`, `TrustPersistenceError`, `SynthesisError` (all caught by generic `Error` fallback as `'internal_error'`).

Tool consumers lose the distinction between configuration failures, infrastructure issues, and internal defects.

**Remediation:** Expand `mapToMcpError` to cover all typed domain error classes.

---

## S3 — Minor Issues

| ID | Issue | Files | Source |
|----|-------|-------|--------|
| S3-1 | `readFileSync` in async `parseJsonFile` blocks event loop | `static-analysis/graph.ts` | Copilot, Opus |
| S3-2 | Module-level regex with `/g` flag requires manual `lastIndex` reset | `static-analysis/expressions.ts` | Opus |
| S3-3 | `passWithNoTests: true` in vitest config | `vitest.config.ts` | Roast |
| S3-4 | 118 biome lint errors (import ordering, non-null assertions) | Throughout | Opus |
| S3-5 | Duplicate `displayName` silently overwrites in graph construction | `static-analysis/graph.ts` | Opus |
| S3-6 | `isEnoent` helper called exactly once | `errors.ts` | Opus |
| S3-7 | `getExecutionData` classifies all non-ok as `execution-not-found` | `execution/rest-client.ts` | Opus |
| S3-8 | `hashPinData` returns empty string for non-serializable input | `orchestrator/interpret.ts` | Opus |
| S3-9 | `normalizePinData` passes `{ json: null }` through (`typeof null === 'object'`) | `execution/pin-data.ts` | Opus |
| S3-10 | BFS uses `Array.shift()` — O(n²) for large graphs | `trust/trust.ts` | Opus |
| S3-11 | `recordValidation` throws bare `Error` instead of typed domain error | `trust/trust.ts` | Opus |
| S3-12 | Rename trust transfer fragile to hash collisions (first match wins) | `trust/trust.ts` | Opus |
| S3-13 | `computeWorkflowHash` recomputes node hashes redundantly | `trust/hash.ts` | Copilot, Opus |
| S3-14 | Poll timeout drift — can exceed 5-minute limit | `execution/poll.ts` | Opus |
| S3-15 | CLI floating promise `main().then(...)` | `cli/index.ts` | Opus |
| S3-16 | CLI `parseArgs` catch discards error details | `cli/index.ts` | Opus |
| S3-17 | `SerializedGraphNode.classification` is `string` not union type | `orchestrator/types.ts` | Opus |
| S3-18 | Diagnostic `evidenceBasis` conflates "no findings" with "no analysis" | `diagnostics/synthesize.ts` | Opus |
| S3-19 | Surface types use `string` instead of domain types (`ValidationLayer`, `NodeIdentity`) | `types/surface.ts` | Opus |
| S3-20 | MCP discovery calls tools with empty args (side-effectful probes) | `execution/capabilities.ts` | Opus |
| S3-21 | Three near-identical `executeBounded` call blocks in orchestrator | `orchestrator/interpret.ts` | Opus, Roast |
| S3-22 | Snapshot `resolveSnapshotsDir()` reads `process.env.N8N_VET_DATA_DIR` inline (same pattern as S1-3) | `orchestrator/snapshots.ts` | Phase 9/10 review |
| S3-23 | `bin/n8n-vet` has same floating promise pattern as S3-15 (`main().then(...)`) | `bin/n8n-vet` | Phase 9/10 review |
| S3-24 | `cli-binary.test.ts` expects exit code 2, CLI returns 1 — test failure | `test/plugin/cli-binary.test.ts` | Phase 9/10 review |

---

## Test Coverage Gaps

The original four audits identified testing as the primary area where the codebase's ambition exceeded its proof. Phase 10 partially addresses the biggest gap (integration tests), and phase 9 adds plugin wrapper unit tests. Updated status:

| Gap | Source | Status after Phase 9/10 |
|-----|--------|-------------------------|
| No integration tests wiring actual subsystems end-to-end | GPT, Roast | **Partially addressed.** 8 scenarios added: static-only, execution happy/failure, trust lifecycle, guardrail rerun, bounded execution, MCP tools, full pipeline. These call `interpret()` and `buildTrustStatusReport()` with real deps against real workflow fixtures. However, they require a live n8n instance and are run via `npx tsx test/integration/run.ts`, not vitest — so they don't run in the normal `npm test` gate. |
| Orchestrator tests mock `getExecutionData` with `{}`, hiding the type mismatch | GPT, Copilot | **Still open.** Integration scenarios 02/03/06/08 exercise the execution path end-to-end against live n8n, which should surface S0-1 at runtime. But this only works when n8n is available. The unit-test-level mock gap remains. |
| No test for `$json['bracket']` expression syntax | Opus | **Still open.** |
| No test for cycle handling in `detectDataLoss` backward walk | Opus | **Still open.** |
| No unit tests for `rerun.ts` or `evidence.ts` | Opus | **Still open.** |
| Snapshot tests don't verify hash stability across save/load | GPT | **Partially addressed.** Phase 10 added snapshot round-trip tests (`test/orchestrator/snapshots.test.ts`) verifying node, edge, displayNameIndex reconstruction. But no test verifies that `computeContentHash` produces the same result before and after serialization — the core S1-2 claim about AST loss still applies. |
| `executeSmoke` path has no test coverage (dead code) | Opus | **Still open.** |
| Plugin wrapper unit tests absent | — | **Addressed.** 8 new test files under `test/plugin/` covering CLI binary, credentials resolution, hooks, manifest, MCP config, skill file, snapshot paths, and trust paths. 1 failure: `cli-binary.test.ts` expects exit code 2 but gets 1. |

---

## Research Cross-Check (from GPT audit)

The GPT audit cross-referenced findings against `docs/research/*.md`:

1. **Rename trust preservation conflicts with research model** — research explicitly says renames are trust-breaking because names are connection keys. Implementation does the opposite. (→ S2-5)
2. **Expression parser under-covers researched syntax surface** — n8n's own parser handles more forms. (→ S2-6)
3. **MCP capability detection doesn't model per-workflow availability** — `settings.availableInMCP` flag can disappear during push cycles. Current probe only checks tool registration, not workflow-level access.

---

## Acknowledged Strengths

All four audits converge on these positives:

- **Clean subsystem boundaries.** Static-analysis, trust, guardrails, diagnostics, execution, and orchestrator are well-separated and independently testable.
- **Consistent dependency injection.** `OrchestratorDeps` enables clean test isolation. `src/deps.ts` is a proper DI assembly point.
- **Strong domain modeling.** Discriminated unions for `AgentTarget`, `ValidationTarget`, `GuardrailDecision`, `DiagnosticError`. String unions over enums. No `any` in production code.
- **Thin surface layers.** MCP server and CLI are genuinely thin — no duplicated business logic.
- **Meaningful test suite.** 527 tests across 46 files that exercise behavioral contracts, not constructors. Guardrail evaluation order and trust state transitions are systematically tested. Phase 9 added 8 plugin wrapper test files. Phase 10 added 8 integration test scenarios and snapshot round-trip tests.
- **Integration test infrastructure.** Phase 10 added a proper integration test framework with prerequisite checks, fixture seeding via n8nac, per-scenario isolation (temp trust/snapshot dirs), typed assertion helpers, and an MCP test client that spawns and communicates with the real MCP server over stdio. This is a significant maturity step.
- **TypeScript strict mode** with `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`.

---

## Audit Disagreements and Reconciliation

| Topic | Disagreement | Resolution |
|-------|-------------|------------|
| `probeRest` behavior | Opus says "throws, never returns false." GPT says "doesn't degrade." | **Nuanced:** throws on network/auth (common), returns `false` on 5xx (rare). Net effect: static-only degradation is unreachable for practical failure modes. |
| Guardrail order | Opus flags as deviation from STRATEGY.md. Copilot doesn't mention it. | **Confirmed deviation.** Implementation is defensible but undocumented. |
| Monolith orchestrator | Roast calls it a "God Function." Opus calls it "functional but has design gaps." | **Both right.** It works but will resist refactoring. Not a release blocker but the numbered-step-comments are not a substitute for composable stages. |
| `findFurthestDownstream` | Opus flags as misnamed. Copilot doesn't mention explicitly. Roast mocks it. | **Confirmed.** Returns `[0]` not "furthest." Misname could cause incorrect bounded execution for multi-exit slices. |

---

## Summary by Release Impact

**Will fail at runtime if exercised:**
- S0-1 (execution→diagnostics pipeline)
- S0-2 (REST API contract — needs live verification)
- S0-3 (shadow isTrusted)
- S0-4 (workflowId vs workflowHash)
- S0-5 (incoming edge changes)

**Will cause problems under normal use:**
- S1-1 (NodeIdentity brand erosion)
- S1-2 (snapshot AST loss)
- S1-3 (credential cascade bypass)
- S1-4 through S1-8 (dead code, missing wiring, persistence safety)
- S1-9 (file: deps block distribution)

**Risk or misalignment with stated design:**
- S2-1 through S2-16

**Polish:**
- S3-1 through S3-21
