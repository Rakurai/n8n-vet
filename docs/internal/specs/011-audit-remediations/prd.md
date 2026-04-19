# Audit Findings

Verified problems and recommended remediations, organized by severity.

---

## S0 — Broken at Runtime

### S0-1. Execution → diagnostics pipeline is broken

**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts#L233-L234), [src/diagnostics/types.ts](../src/diagnostics/types.ts), [src/execution/types.ts](../src/execution/types.ts), [src/diagnostics/errors.ts](../src/diagnostics/errors.ts)

The orchestrator casts the raw REST response directly to the diagnostics `ExecutionData` type (`rawData as ExecutionData | null`). The shapes are incompatible — REST returns nested `{ data: { data: { resultData: { runData } } } }`, diagnostics expects `{ status, lastNodeExecuted, error, nodeResults: Map }`. Fields are `undefined` at runtime.

Two separate `ExecutionData` types exist with incompatible structures: `diagnostics/types.ts` has single `NodeExecutionResult` per node with top-level `httpCode?: number`; `execution/types.ts` has `NodeExecutionResult[]` arrays with nested `context: { httpCode: string }`. `classifyApiError` reads the wrong location/type for HTTP codes — all API errors misclassify.

The extraction function `extractExecutionData()` exists in `execution/results.ts` but is never called.

**Remediation:** Delete diagnostics-local `ExecutionData`. Update all diagnostics code to consume `execution/types.ts::ExecutionData`. Wire `extractExecutionData()` into the orchestrator at the cast site.

---

### S0-2. REST API contract may not match actual n8n endpoints

**Files:** [src/execution/rest-client.ts](../src/execution/rest-client.ts)

`executeBounded` sends `{ destinationNode, pinData }` as top-level fields. Documented n8n `POST /workflows/:id/run` variants place data inside `runData`. `TriggerExecutionResponseSchema` expects `{ data: { executionId } }` but research notes suggest response is `{ executionId }` without wrapper.

**Remediation:** Test against a live n8n instance. No code review can confirm the actual API contract.

---

### S0-3. Shadow `isTrusted` in resolve.ts skips content hash verification

**Files:** [src/orchestrator/resolve.ts](../src/orchestrator/resolve.ts), [src/trust/trust.ts](../src/trust/trust.ts)

Local `isTrusted` checks only `trustState.nodes.has(nodeId)`. Canonical version requires content hash match. Nodes with changed content but existing trust records are treated as trusted — slice propagation stops too early, changed nodes excluded from targets.

**Remediation:** Import `isTrusted` from `src/trust/trust.ts`. Pass graph AST + `computeContentHash` into resolve for hash computation.

---

### S0-4. `persistTrustState` receives workflowId instead of workflowHash

**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts#L279), [src/trust/persistence.ts](../src/trust/persistence.ts#L83)

Calls `deps.persistTrustState(updatedTrust, workflowId)` where parameter is `workflowHash`. The `workflowHash` field in `trust-state.json` contains an absolute file path.

**Remediation:** Pass `computeWorkflowHash(graph)` instead of `workflowId`.

---

### S0-5. Change detection misses incoming edge changes

**Files:** [src/trust/change.ts](../src/trust/change.ts#L110-L111)

`nodeEdgesChanged` only compares `graph.forward.get(nodeName)` (outgoing). A node gaining a new upstream connection is not flagged as changed but has fundamentally different runtime behavior.

**Remediation:** Also compare `graph.backward.get(nodeName)`.

---

## S1 — Structural Defects

### S1-1. `WorkflowGraph` uses `string` keys — branded `NodeIdentity` provides no safety

**Files:** [src/types/graph.ts](../src/types/graph.ts), cascading to ~30 files

All graph maps use `Map<string, ...>`. Every other type uses `NodeIdentity`. Forces 50+ `as` casts across the codebase. CODING.md prohibits `as T`.

**Remediation:** Change `WorkflowGraph` maps to `NodeIdentity` keys. Dedicated refactoring pass — touches ~30 files.

---

### S1-2. Snapshot deserialization drops AST fields that trust hashing depends on

**Files:** [src/orchestrator/snapshots.ts](../src/orchestrator/snapshots.ts), [src/trust/hash.ts](../src/trust/hash.ts)

Deserialization replaces AST with `{ nodes: [], connections: [] }`. `computeContentHash` reads `retryOnFail`, `executeOnce`, `onError` from AST — always `undefined` for deserialized snapshots. Nodes with non-default execution settings produce false-positive changes every run.

**Remediation:** Include execution settings in `SerializedGraphNode`. Reconstruct during deserialization.

---

### S1-3. Orchestrator bypasses credential resolution cascade

**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts) (`resolveExecCredentials`), [src/execution/rest-client.ts](../src/execution/rest-client.ts) (`resolveCredentials`)

Orchestrator reads only `process.env`, ignoring the 4-level cascade (explicit → env → n8nac config → global). Throws bare `Error` instead of `ExecutionConfigError`.

**Remediation:** Delete the local helper. Call `resolveCredentials()` from `rest-client.ts`.

---

### S1-4. MCP execution path is dead code

**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts), [src/execution/mcp-client.ts](../src/execution/mcp-client.ts)

MCP smoke test branch always falls through to REST. `executeSmoke` is never called. `ValidationRequest` has no field for `McpToolCaller`.

**Remediation:** Wire `McpToolCaller` through deps/request, or remove the dead branch.

---

### S1-5. Pin data artifact caching is exported but never used

**Files:** [src/execution/pin-data.ts](../src/execution/pin-data.ts), [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts)

`readCachedPinData()` and `writeCachedPinData()` never called. `constructPinData` called without `priorArtifacts`. Tier 2 pin data sourcing is dead.

**Remediation:** Read cached pin data before `constructPinData`, pass as `priorArtifacts`, write after successful runs.

---

### S1-6. `probeRest` failure prevents graceful degradation to static-only mode

**Files:** [src/execution/capabilities.ts](../src/execution/capabilities.ts)

`probeRest` throws on network/auth errors (the common cases). `detectCapabilities` has a `static-only` path for `restAvailable === false` but it's unreachable. `explain` surface is coupled to runtime credentials.

**Remediation:** Wrap `probeRest` call in try-catch mapping infrastructure errors to `restAvailable: false`.

---

### S1-7. No file locking or atomic writes for trust-state.json

**Files:** [src/trust/persistence.ts](../src/trust/persistence.ts)

`writeFileSync` directly to target path. Concurrent requests race. Mid-write interruption corrupts the file.

**Remediation:** Write to temp file, `renameSync` to target. Add advisory file locking for concurrent access.

---

### S1-8. Module-level mutable execution lock with no staleness protection

**Files:** [src/execution/lock.ts](../src/execution/lock.ts)

`let executionInFlight = false` at module scope. Crash leaves lock permanently held. No timeout, no external reset.

**Remediation:** Add timestamp + configurable expiry. Make injectable for test isolation.

---

### S1-9. `file:` dependencies make the package unpublishable

**Files:** [package.json](../package.json)

`"@n8n-as-code/transformer": "file:../n8n-as-code/packages/transformer"` requires exact sibling directory.

**Remediation:** Use workspace protocol, registry, or git URL dependency.

---

## S2 — Meaningful Gaps

### S2-1. Node-targeted validation ignores trust boundaries

**Files:** [src/orchestrator/resolve.ts](../src/orchestrator/resolve.ts)

`resolveNodes` doesn't pass `trustState` to propagation helpers. Always propagates to full graph boundary.

**Remediation:** Pass `trustState` with trust-boundary stopping logic.

---

### S2-2. Guardrail evaluation order deviates from STRATEGY.md

**Files:** [src/guardrails/evaluate.ts](../src/guardrails/evaluate.ts)

Implementation: bypass → refuse → redirect → narrow → warn → proceed. STRATEGY.md: redirect > narrow > warn > refuse.

**Remediation:** Update STRATEGY.md to document the exception, or reorder.

---

### S2-3. Path scoring diverges from STRATEGY.md specification

**Files:** [src/orchestrator/path.ts](../src/orchestrator/path.ts)

Uses 4 ad-hoc tiers. Missing: opaque node awareness, branching logic weight, prior failures, cost estimation, overlap penalty.

**Remediation:** Align implementation or update STRATEGY.md.

---

### S2-4. `assembleEvidence` ignores removed nodes and is computed redundantly

**Files:** [src/guardrails/evidence.ts](../src/guardrails/evidence.ts), [src/guardrails/evaluate.ts](../src/guardrails/evaluate.ts), [src/guardrails/narrow.ts](../src/guardrails/narrow.ts)

`changeSet.removed` never iterated. Evidence computed 3x per `evaluate()` call.

**Remediation:** Add `changeSet.removed` iteration. Compute once, pass down.

---

### S2-5. Rename handling preserves trust when research says it shouldn't

**Files:** [src/trust/change.ts](../src/trust/change.ts), [src/trust/trust.ts](../src/trust/trust.ts)

Rename detection rewrites remove+add pairs to `metadata-only` and transfers trust. Research says renames are trust-breaking (names are connection keys and expression targets).

**Remediation:** Treat renames as trust-invalidating, or propagate re-validation to referencing nodes.

---

### S2-6. Expression parser narrower than n8n's own syntax surface

**Files:** [src/static-analysis/expressions.ts](../src/static-analysis/expressions.ts)

4 patterns. Missing: `$node.Name` (dot syntax), `$items("Name")`, `$binary` access, `itemMatching(n)` with literal arg.

**Remediation:** Expand pattern coverage, prioritizing legacy forms in real workflows.

---

### S2-7. `disabled` field hardcoded to `false`

**Files:** [src/static-analysis/graph.ts](../src/static-analysis/graph.ts)

Disabled nodes analyzed as active. False positives for data-loss, false negatives for broken references.

**Remediation:** Check underlying raw node data during graph construction.

---

### S2-8. `Merge` node blanket-classified as `shape-preserving`

**Files:** [src/static-analysis/node-sets.ts](../src/static-analysis/node-sets.ts)

Merge in combining mode is shape-augmenting/replacing. Blanket classification causes false negatives.

**Remediation:** Make classification mode-aware — inspect `mode` parameter.

---

### S2-9. Broad catch blocks mask filesystem errors

**Files:** [src/trust/persistence.ts](../src/trust/persistence.ts), [src/execution/rest-client.ts](../src/execution/rest-client.ts), [src/execution/pin-data.ts](../src/execution/pin-data.ts)

Multiple catch blocks return `undefined` or silently continue. Permission errors indistinguishable from "file not found."

**Remediation:** Narrow catches to `ENOENT`. Re-throw unexpected errors.

---

### S2-10. `deriveWorkflowId` produces non-portable absolute paths

**Files:** [src/orchestrator/types.ts](../src/orchestrator/types.ts)

`resolve(workflowPath)` produces machine-specific paths. Trust state not portable across machines/CI.

**Remediation:** Use project-relative or content-derived identifier.

---

### S2-11. No path traversal protection on `workflowPath`

**Files:** [src/mcp/server.ts](../src/mcp/server.ts), [src/cli/index.ts](../src/cli/index.ts)

`workflowPath` passed directly to `ValidationRequest` with zero validation.

**Remediation:** Validate path resolves under CWD or configured project root.

---

### S2-12. CLI always emits ANSI codes

**Files:** [src/cli/format.ts](../src/cli/format.ts)

No `NO_COLOR` check, no TTY detection. Garbled output when piped.

**Remediation:** Check `process.env.NO_COLOR` or `!process.stdout.isTTY`.

---

### S2-13. Static finding deduplication missing for multi-path analysis

**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts)

Findings from shared nodes across paths pushed without dedup. Agent sees duplicates.

**Remediation:** Deduplicate by `(node, kind, message)` tuple after the loop.

---

### S2-14. MCP input schema weaker than internal validation

**Files:** [src/mcp/server.ts](../src/mcp/server.ts)

Flat `z.object` instead of `z.discriminatedUnion`. Doesn't enforce `nodes` required when `kind === 'nodes'`.

**Remediation:** Use `z.discriminatedUnion`.

---

### S2-15. `findFurthestDownstream` is misnamed

**Files:** [src/orchestrator/interpret.ts](../src/orchestrator/interpret.ts)

Returns `slice.exitPoints[0]` with no topological consideration.

**Remediation:** Rename to `getFirstExitPoint` or implement topological ordering.

---

### S2-16. Error classification collapses domain distinctions

**Files:** [src/errors.ts](../src/errors.ts)

`mapToMcpError` misses `ExecutionInfrastructureError`, `TrustPersistenceError`, `SynthesisError`. All fall to generic `'internal_error'`.

**Remediation:** Add cases for all typed domain error classes.

---

## S3 — Minor Issues

| ID | Issue | Files | Remediation |
|----|-------|-------|-------------|
| S3-1 | `readFileSync` in async `parseJsonFile` blocks event loop | `static-analysis/graph.ts` | Use `readFile` from `node:fs/promises` |
| S3-2 | Module-level regex `/g` requires manual `lastIndex` reset | `static-analysis/expressions.ts` | Use local regex instances or `matchAll` |
| S3-3 | `passWithNoTests: true` in vitest config | `vitest.config.ts` | Set to `false` |
| S3-4 | 118 biome lint errors | Throughout | Run `biome check --write src/`, audit `!` usages |
| S3-5 | Duplicate `displayName` silently overwrites | `static-analysis/graph.ts` | Throw or emit a diagnostic |
| S3-6 | `isEnoent` helper called exactly once | `errors.ts` | Inline it |
| S3-7 | All non-ok responses classified `execution-not-found` | `execution/rest-client.ts` | Distinguish 404 from 5xx |
| S3-8 | `hashPinData` returns `''` for non-serializable input | `orchestrator/interpret.ts` | Throw instead |
| S3-9 | `normalizePinData` passes `{ json: null }` through | `execution/pin-data.ts` | Add explicit null check |
| S3-10 | BFS uses `Array.shift()` — O(n²) | `trust/trust.ts` | Use index-based queue |
| S3-11 | `recordValidation` throws bare `Error` | `trust/trust.ts` | Use typed domain error |
| S3-12 | Rename trust transfer fragile to hash collisions | `trust/trust.ts` | Guard against multiple matches |
| S3-13 | `computeWorkflowHash` recomputes node hashes redundantly | `trust/hash.ts` | Cache per graph instance |
| S3-14 | Poll timeout drift past 5-minute limit | `execution/poll.ts` | Check elapsed after sleep + API call |
| S3-15 | CLI floating promise `main().then(...)` | `cli/index.ts` | Prefix with `void` or add `.catch` |
| S3-16 | CLI `parseArgs` catch discards error details | `cli/index.ts` | Include parse error in message |
| S3-17 | `SerializedGraphNode.classification` is `string` not union | `orchestrator/types.ts` | Use `NodeClassification` type |
| S3-18 | `evidenceBasis` conflates "no findings" with "no analysis" | `diagnostics/synthesize.ts` | Track whether static ran separately |
| S3-19 | Surface types use `string` instead of domain types | `types/surface.ts` | Use `ValidationLayer`, `NodeIdentity` |
| S3-20 | MCP discovery calls tools with empty args | `execution/capabilities.ts` | Use `tools/list` instead |
| S3-21 | Three near-identical `executeBounded` blocks | `orchestrator/interpret.ts` | Extract shared helper |
| S3-22 | `resolveSnapshotsDir()` reads `process.env` inline | `orchestrator/snapshots.ts` | Move to config/DI layer |
| S3-23 | `bin/n8n-vet` floating promise | `bin/n8n-vet` | Prefix with `void` or add `.catch` |
| S3-24 | `cli-binary.test.ts` expects exit code 2, gets 1 | `test/plugin/cli-binary.test.ts` | Fix expected code or CLI exit code |

---

## Test Gaps

| Gap | Remediation |
|-----|-------------|
| Orchestrator tests mock `getExecutionData` with `{}`, hiding S0-1 | Use realistic mock payload matching actual REST response shape |
| No test for `$json['bracket']` expression syntax | Add expression tracing test with bracket notation |
| No test for cycle handling in `detectDataLoss` backward walk | Add cyclic graph fixture test |
| No unit tests for `rerun.ts` or `evidence.ts` | Add direct unit tests for `extractPriorRunContext`, `checkDeFlaker`, `assembleEvidence` |
| Snapshot hash stability not verified across save/load | Test that `computeContentHash` produces same value before and after serialization |
| `executeSmoke` path has no test coverage | Either test or remove dead code (see S1-4) |
| Integration tests not in `npm test` gate | Add vitest config or CI step for integration scenarios |
