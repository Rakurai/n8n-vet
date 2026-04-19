# Code Audit — Pre-Release Review

**Date:** 2026-04-19
**Scope:** Full codebase (`src/`, config files). Excludes `docs/prd/`, `docs/reference/`, `docs/research/`, `specs/`.
**Reference documents:** CODING.md, CONCEPTS.md, DESIGN.md, PRD.md, SCOPE.md, STRATEGY.md, TECH.md, VISION.md

---

## Severity Key

- **P0 — Correctness bug.** The code does not do what it claims. Must fix before release.
- **P1 — Structural defect.** Design flaw that will cause real problems under normal use. Fix before release.
- **P2 — Design smell.** Works today but creates risk, tech debt, or misalignment with core docs. Fix before 1.0.
- **P3 — Minor.** Inconsistency, style issue, or missing polish. Fix at convenience.

---

## P0 — Correctness Bugs

### P0-001: Orchestrator casts raw REST response to diagnostics ExecutionData — wrong shape entirely

**File:** `src/orchestrator/interpret.ts` (step 6b)

```typescript
const rawData = await deps.getExecutionData(execResult.executionId, creds);
executionData = rawData as ExecutionData | null;
```

`deps.getExecutionData` calls `rest-client.ts::getExecutionData`, which returns a Zod-validated REST API response with shape `{ data: { data: { resultData: { runData: ... } } } }`. The diagnostics `ExecutionData` type expects `{ status, lastNodeExecuted, error, nodeResults: Map<NodeIdentity, NodeExecutionResult> }`. These are structurally incompatible. The `as` cast silences the compiler but the fields will be `undefined` at runtime.

**Impact:** Any execution-backed validation that reaches this path will produce a corrupt `ExecutionData` object. `synthesize()` will either fail or produce wrong diagnostics. The entire execution → diagnostics pipeline is broken in the orchestrator.

**Fix:** Call `extractExecutionData()` from `execution/results.ts` to transform the raw REST response into the proper shape. But see P0-002 first — the target type itself is wrong.

---

### P0-002: Two incompatible ExecutionData type universes

**Files:** `src/diagnostics/types.ts` vs `src/execution/types.ts`

The diagnostics subsystem defines its own `ExecutionData`, `NodeExecutionResult`, and `ExecutionErrorData` types that are structurally incompatible with the execution subsystem's versions:

| Property | `diagnostics/types.ts` | `execution/types.ts` |
|---|---|---|
| `nodeResults` value type | `NodeExecutionResult` (single) | `NodeExecutionResult[]` (array) |
| `ExecutionErrorData.httpCode` | `httpCode?: number` (top-level) | `context: { httpCode: string }` (nested, string) |
| `status` | `'success' \| 'error' \| 'cancelled'` | `ExecutionStatus` (8 variants) |
| `NodeExecutionResult.source` | `{ previousNodeOutput: number \| null }` | `SourceInfo \| null` (3 fields) |

The diagnostics TODO comment says "temporary — move to src/execution/types.ts in Phase 5." This was never done. Every downstream consumer in the diagnostics subsystem (`errors.ts`, `hints.ts`, `annotations.ts`, `path.ts`, `status.ts`) operates on the wrong type.

**Impact:** Even after fixing P0-001 with `extractExecutionData()`, the result would be `execution/types.ts::ExecutionData` (array-valued nodeResults, different error shape). Passing that to `synthesize()` — which expects `diagnostics/types.ts::ExecutionData` (single-valued nodeResults, different error shape) — will still break.

**Fix:** Unify the types. Either:
- (A) Delete `diagnostics/types.ts::ExecutionData` and update all diagnostics code to consume `execution/types.ts::ExecutionData`, or
- (B) Write a proper adapter at the synthesis boundary.

Option A is cleaner and aligns with CODING.md: "No legacy adapters."

---

### P0-003: `classifyApiError` will never match HTTP codes due to type mismatch

**File:** `src/diagnostics/errors.ts`

```typescript
function classifyApiError(error: ExecutionErrorData & { contextKind: 'api' }): ErrorClassification {
  if (error.httpCode === undefined) return 'external-service';
  const code = error.httpCode;
  if (code === 401 || code === 403) return 'credentials';
```

The diagnostics `ExecutionErrorData` puts `httpCode` at the top level as `number | undefined`. The execution subsystem puts it inside `context.httpCode` as `string`. If execution data were ever properly wired through (after fixing P0-001/P0-002), the `httpCode` would be in the wrong location and/or wrong type. All API errors would classify as `'external-service'` regardless of HTTP status code.

**Impact:** Credential failures (401/403) misclassified. 4xx wiring errors misclassified. Error classification is unreliable for all API errors.

**Fix:** Resolves automatically when P0-002 is fixed (unified types).

---

### P0-004: `persistTrustState` called with workflowId instead of workflowHash

**File:** `src/orchestrator/interpret.ts` (step 8)

```typescript
deps.persistTrustState(updatedTrust, workflowId);
```

The function signature is `persistTrustState(state: TrustState, workflowHash: string)`. The second argument is stored as `workflowHash` in the JSON file. But the orchestrator passes `workflowId` (an absolute file path), not a content hash. This means:
- The `workflowHash` field in trust-state.json is an absolute path, not a hash
- Any future code that reads `workflowHash` expecting a content hash will get garbage
- The quick-check optimization in `computeChangeSet` (comparing workflow hashes) cannot use this value

**Fix:** Pass `computeWorkflowHash(graph)` instead of `workflowId`.

---

### P0-005: Shadow `isTrusted` in resolve.ts skips content hash verification

**File:** `src/orchestrator/resolve.ts` (bottom of file)

```typescript
function isTrusted(nodeId: NodeIdentity, trustState: TrustState): boolean {
  return trustState.nodes.has(nodeId);
}
```

The real `isTrusted` in `src/trust/trust.ts` requires `contentHash` to match:

```typescript
export function isTrusted(state: TrustState, node: NodeIdentity, currentHash: string): boolean {
  const record = state.nodes.get(node);
  return record !== undefined && record.contentHash === currentHash;
}
```

The resolve module's shadow version only checks Map membership. A node that has a trust record but whose content changed will still be treated as trusted by the resolve module, causing:
- Forward/backward propagation stops too early (at stale trust boundaries)
- Slices are computed too narrowly
- Changed nodes may be excluded from the target

**Impact:** Trust-boundary-aware slice computation is fundamentally incorrect. Slices may omit nodes that should be included because the resolver treats stale trust records as valid.

**Fix:** Import and use `isTrusted` from `src/trust/trust.ts`. This requires computing content hashes during resolve, which means `resolveTarget` needs access to the graph's AST.

---

## P1 — Structural Defects

### P1-001: Snapshot deserialization creates empty placeholder AST

**File:** `src/orchestrator/snapshots.ts`

```typescript
const ast = { nodes: [], connections: [] } as unknown as WorkflowAST;
return { nodes, forward, backward, displayNameIndex, ast };
```

`computeContentHash()` uses `ast.nodes.find(n => n.propertyName === node.name)` to extract execution settings (retryOnFail, executeOnce, onError). On a snapshot-derived graph, this always returns `undefined`, so these fields always default to `false`/`null`. If the current graph has non-default execution settings, `computeChangeSet` will detect a false change on every node with custom execution settings — even if nothing actually changed.

**Impact:** False positives in change detection for any node with `retryOnFail`, `executeOnce`, or `onError` set. These nodes will be reported as changed and have their trust invalidated on every run. Not catastrophic (validation still runs), but undermines the trust-reuse optimization.

**Fix:** Either:
- (A) Include execution settings in the serialized snapshot and reconstruct a minimal AST with those fields
- (B) Factor execution settings out of `computeContentHash` into the serialized `SerializedGraphNode`

---

### P1-002: Orchestrator bypasses credential resolution cascade

**File:** `src/orchestrator/interpret.ts`

```typescript
function resolveExecCredentials(): ResolvedCredentials {
  const host = process.env['N8N_HOST'];
  const apiKey = process.env['N8N_API_KEY'];
  if (!host) throw new Error('N8N_HOST environment variable is required for execution');
  if (!apiKey) throw new Error('N8N_API_KEY environment variable is required for execution');
  return { host, apiKey };
}
```

The execution subsystem implements a 4-level credential cascade in `rest-client.ts::resolveCredentials()`: explicit → env vars → n8nac project config → global credentials. The orchestrator ignores this entirely and hardcodes env-var-only resolution. Users relying on n8nac config files or explicit credentials will get unhelpful errors.

**Fix:** Call `resolveCredentials()` from `rest-client.ts` instead of the local helper.

---

### P1-003: MCP smoke test path is dead code

**File:** `src/orchestrator/interpret.ts` (step 6b)

The MCP smoke test branch:
```typescript
} else if (request.target.kind === 'workflow' && detected.mcpAvailable) {
  // MCP smoke test requires a callTool injected via deps.
  // Without MCP capability wired through deps, fall through to REST.
```

`executeSmoke` requires a `McpToolCaller`, but:
- `ValidationRequest` has no field for a tool caller
- `OrchestratorDeps` has `executeSmoke` in its signature but the orchestrator never calls it
- The entire MCP execution path falls through to the REST branch

The MCP execution path is unreachable.

**Fix:** Either wire `McpToolCaller` through `OrchestratorDeps` / `ValidationRequest`, or remove the dead branch and document MCP execution as not-yet-implemented.

---

### P1-004: Pin data artifact caching is unimplemented in orchestrator

**Files:** `src/execution/pin-data.ts`, `src/orchestrator/interpret.ts`

`readCachedPinData()` and `writeCachedPinData()` are exported from pin-data.ts but never called. The orchestrator:
- Never reads cached artifacts to supply as `priorArtifacts` to `constructPinData()`
- Never writes artifacts after successful execution

This means tier 2 of pin data sourcing ("prior validation artifacts") is dead. Only tier 1 (agent fixtures) works. Tier 3 (MCP prepare_test_pin_data) is also not wired.

**Impact:** Pin data construction fails whenever the agent doesn't explicitly provide fixtures for every trusted boundary node, even if valid data was produced by a prior run. This undermines the trust-reuse story significantly.

**Fix:** The orchestrator should read cached pin data before calling `constructPinData` and write it after successful runs.

---

### P1-005: No file locking on trust-state.json or snapshot files

**Files:** `src/trust/persistence.ts`, `src/orchestrator/snapshots.ts`

Both files use read-modify-write patterns with `readFileSync`/`writeFileSync`. Concurrent CLI invocations or MCP requests can race:
1. Process A reads trust-state.json
2. Process B reads trust-state.json
3. Process A writes (adds workflow X trust)
4. Process B writes (adds workflow Y trust) — overwrites A's changes

**Impact:** Trust state corruption under concurrent use. The MCP server is long-running and may handle concurrent requests.

**Fix:** Use advisory file locking (`proper-lockfile` or similar), or atomic write with rename.

---

### P1-006: Module-level mutable state in execution lock

**File:** `src/execution/lock.ts`

```typescript
let executionInFlight = false;
```

- A crash during execution (unhandled rejection, OOM) leaves the lock permanently held — all subsequent executions fail with 'execution-in-flight'
- No staleness timeout
- No way to reset from outside the module
- Module-level state is shared across the entire process lifetime

**Fix:** Add a timestamp to the lock and expire it after a configurable timeout (e.g., POLL_TIMEOUT_MS). Provide a `resetExecutionLock()` for testing.

---

### P1-007: `deriveWorkflowId` produces non-portable absolute paths

**File:** `src/orchestrator/types.ts`

```typescript
export function deriveWorkflowId(workflowPath: string): string {
  return resolve(workflowPath);
}
```

Trust state and snapshot files are keyed by absolute path. This means:
- Trust state is not portable across machines (different home dirs, different mount points)
- `encodeURIComponent` on a long absolute path produces very long filenames
- CI environments with different working directories cannot reuse trust state

TECH.md says "local workflow artifacts are authoritative." Keying by absolute path ties the trust state to the machine, not the artifact.

**Fix:** Use a content-derived or project-relative identifier. For example, the workflow path relative to the nearest `n8nac-config.json` or `package.json`, or a hash of the workflow file's content.

---

## P2 — Design Smells

### P2-001: Pervasive `as NodeIdentity` casts bypass the branded type

Throughout the codebase, NodeIdentity is created via direct casting rather than the `nodeIdentity()` factory:

- `src/orchestrator/resolve.ts`: `name as NodeIdentity` (9+ occurrences)
- `src/orchestrator/path.ts`: `current as NodeIdentity` (5+ occurrences)
- `src/trust/change.ts`: `name as NodeIdentity` (8+ occurrences)
- `src/surface.ts`: `name as NodeIdentity`, `[...graph.nodes.keys()] as NodeIdentity[]`
- `src/orchestrator/interpret.ts`: implicit casts via generics

CODING.md: "Do not use type assertions (`as T`) to silence the compiler. If the compiler disagrees, fix the types."

The branded type exists to prevent mixing display names, property names, and arbitrary strings. Bypassing `nodeIdentity()` eliminates that safety. A display name accidentally cast to `NodeIdentity` would not be caught.

**Fix:** Establish a pattern where graph construction (buildGraph) and deserialization (snapshots) create NodeIdentity values through the factory. Change detection and resolve should receive `NodeIdentity[]` from their inputs, not cast internally.

---

### P2-002: `parseJsonFile` uses synchronous `readFileSync` in async function

**File:** `src/static-analysis/graph.ts`

```typescript
async function parseJsonFile(filePath: string): Promise<WorkflowAST> {
  // ...
  const raw = readFileSync(filePath, 'utf-8');
```

`parseTypeScriptFile` is properly async. `parseJsonFile` blocks the event loop unnecessarily. In a long-running MCP server, this blocks all other requests during file reads.

**Fix:** Use `readFile` from `node:fs/promises`.

---

### P2-003: Static finding deduplication missing for multi-path analysis

**File:** `src/orchestrator/interpret.ts` (step 6a)

```typescript
for (const path of paths) {
  const pathNodes = path.nodes;
  const refs = deps.traceExpressions(graph, pathNodes);
  const dataLossFindings = deps.detectDataLoss(graph, refs, pathNodes);
  // ...
  staticFindings.push(...dataLossFindings, ...schemaFindings, ...paramFindings);
}
```

When multiple paths share nodes (which is common — paths through the same slice usually share the initial and final segments), the same finding is emitted multiple times. The final `DiagnosticSummary.errors` array will contain duplicates.

**Impact:** Agent sees the same error multiple times. Violates CONCEPTS.md: "A diagnostic summary should not devolve into pass spam."

**Fix:** Deduplicate findings by `(node, kind, message)` tuple after the loop.

---

### P2-004: Evidence assembly computed redundantly

**File:** `src/guardrails/evaluate.ts`, `src/guardrails/narrow.ts`

`assembleEvidence()` is called at the top of `evaluate()`. Then `computeNarrowedTarget()` (step 5) calls `assembleEvidence()` again internally. And `assessEscalationTriggers()` (step 4) also calls `assembleEvidence()`. That's 3 calls for a single evaluation.

**Fix:** Pass the already-assembled evidence to `computeNarrowedTarget` and `assessEscalationTriggers` instead of recomputing.

---

### P2-005: Empty `catch {}` blocks in persistence and config reading

**Files:**
- `src/trust/persistence.ts` line ~107: `catch { // JSON parse failure — start fresh }` in `persistTrustState`
- `src/execution/rest-client.ts`: `readProjectConfig` and `readGlobalCredentials`
- `src/execution/capabilities.ts`: `discoverMcpTools`

CODING.md: "No silent catches. No broad `catch (e)` without re-throwing."

The credential cascade and MCP discovery catches are defensible (probe semantics). The trust persistence catch swallows a corrupt file error and silently starts fresh, which could mask filesystem permission issues or disk corruption.

**Fix:** At minimum, the trust persistence catch should log a warning or emit a diagnostic hint.

---

### P2-006: Guardrail decisions array only ever has one entry

**File:** `src/orchestrator/interpret.ts`

```typescript
const guardrailDecisions: GuardrailDecision[] = [guardrailDecision];
```

DESIGN.md says the diagnostic summary should make "every guardrail action, trust decision, and scope adjustment visible." But the orchestrator only runs `evaluate()` once and captures a single decision. If the guardrail narrows and then the narrowed target triggers a broad-target warning, only the narrow action is captured.

**Impact:** The agent gets an incomplete picture of what guardrails did. Specifically, when narrowing occurs, the `warn` decision that might have applied to the original scope is lost.

**Fix:** If the pipeline can produce multiple sequential guardrail decisions, accumulate them all.

---

### P2-007: No path traversal protection on workflowPath

**Files:** `src/mcp/server.ts`, `src/cli/index.ts`

The MCP server accepts `workflowPath` as a string and passes it directly to `parseWorkflowFile`, `loadTrustState`, `loadSnapshot`, etc. There's no validation that the path points to a reasonable location. An agent (or compromised tool caller) could pass `../../../etc/passwd.ts` — which would fail to parse, but paths like `../sensitive-project/workflow.ts` would succeed.

Trust state and snapshot writes use `workflowPath` (via `deriveWorkflowId`) to construct file paths under `.n8n-vet/`, which is safer since the output location is fixed. But the read side is unrestricted.

**Fix:** Validate that `workflowPath` is under the current working directory or a configured project root.

---

### P2-008: CLI always emits ANSI escape codes

**File:** `src/cli/format.ts`

CLAUDE.md: "Use `--no-color` / `--color=never` flags where available."

The CLI has no `--no-color` flag. All format functions unconditionally include ANSI escape codes. Piping output to a file or another tool produces garbled text.

**Fix:** Check `process.env.NO_COLOR` or add a `--no-color` flag. Disable ANSI when stdout is not a TTY.

---

### P2-009: `errorDiagnostic` bypasses `synthesize()` validation

**File:** `src/orchestrator/interpret.ts`

```typescript
function errorDiagnostic(message: string, runId: string, startTime: number): DiagnosticSummary {
  return {
    // ...
    target: { description: 'N/A', nodes: [], automatic: false },
```

`synthesize()` validates that `resolvedTarget.nodes` is non-empty. The `errorDiagnostic` helper constructs a `DiagnosticSummary` directly with `nodes: []`, bypassing synthesis entirely. This creates two code paths that produce `DiagnosticSummary` — one validated, one not.

Similarly, `skippedDiagnostic` constructs its own summary.

**Fix:** Either route these through `synthesize()` (relaxing the non-empty validation for error/skipped status), or extract shared validation logic to ensure both paths produce valid output.

---

### P2-010: `resolveTarget` for `kind: 'changed'` with empty changeSet returns ok with empty nodes

**File:** `src/orchestrator/resolve.ts`

When no changes are detected, `resolveChanged` returns `{ ok: true, target: { nodes: [] } }`. The orchestrator then proceeds to step 5 (guardrails) with an empty target. The guardrail evaluator catches this with `targetNodes.size === 0 → refuse`. This works but is a roundabout path — the resolver knows there's nothing to do but doesn't say so directly.

**Fix:** Minor — could be a `{ ok: false }` result instead, but the current behavior is correct via the guardrail refuse path.

---

## P3 — Minor Issues

### P3-001: `surface.ts` type erasure on changedSinceLastValidation

```typescript
changedSinceLastValidation: changedSinceLastValidation as string[],
```

Casts `NodeIdentity[]` to `string[]`, erasing the branded type at the surface boundary. Since this is a surface type (going to JSON), the cast is semantically correct but should use an explicit mapping for clarity.

---

### P3-002: `computeChangeSet` recomputes workflow hash twice

**File:** `src/trust/change.ts`

```typescript
if (computeWorkflowHash(previous) === computeWorkflowHash(current)) {
```

`computeWorkflowHash` internally calls `computeContentHash` for every node and `computeConnectionsHash`. This is the "quick check" optimization, but if it fails (hashes differ), the function then recomputes individual content hashes for each node in the diffing loop. The previous graph's content hashes are computed twice. For large workflows this is measurable.

**Fix:** Cache the per-node hashes from the workflow hash computation.

---

### P3-003: `selectPaths` DFS can record the same path multiple times

**File:** `src/orchestrator/path.ts`

When a node is both an exit point AND has outgoing edges within the slice, the DFS records the path at the exit point and then continues exploring. If exploration leads to another exit point, a longer path is also recorded containing the same prefix. This is by design (the code comments say so), but it means the candidate list can contain paths where one is a strict prefix of another.

The quickFilter and scoring handle this gracefully, so it's not a bug — just unnecessary work.

---

### P3-004: `classifyChanges` returns `['parameter']` as catch-all

**File:** `src/trust/change.ts`

```typescript
if (changes.length === 0) {
  changes.push('parameter');
}
```

When the content hash differs but none of the specific classifiers trigger, the function defaults to `'parameter'`. This is a conservative fallback but could mask actual change kinds that aren't covered by the classifier (e.g., changes to `notes` or other fields that affect the hash).

---

### P3-005: `vitest.config.ts` has `passWithNoTests: true`

For a pre-release codebase, this is acceptable. For a published package, consider removing this — a test run with no tests should be a signal, not a silent pass.

---

### P3-006: Inconsistent error class patterns

Most error classes use `override readonly name = 'ClassName' as const`. But `NodeIdentityError` in `src/types/identity.ts` follows the same pattern, while errors in `src/execution/errors.ts` have a `reason` field. The patterns are individually fine but the lack of a shared base class means error handling in `mapToMcpError` requires checking each type separately.

---

## Alignment with Core Documents

### CODING.md Compliance

| Rule | Status | Notes |
|---|---|---|
| `strict: true` in tsconfig | ✅ | Verified |
| No `any` in production | ✅ | Biome enforces `noExplicitAny: "error"` |
| No type assertions | ❌ | Pervasive `as` casts (P2-001) |
| No silent catches | ⚠️ | 3 empty catch blocks (P2-005) |
| No fallbacks | ⚠️ | Credential cascade is intentional design, not a fallback. Trust persistence catch is a silent fallback. |
| Validate at boundaries, trust internally | ✅ | Zod at REST, MCP, trust persistence, orchestrator entry |
| One clear responsibility per file | ✅ | Clean separation |
| No over-engineering | ✅ | No abstract bases, no unnecessary generics |
| Module-level doc comments | ✅ | Present on all files |

### STRATEGY.md Compliance

| Principle | Status | Notes |
|---|---|---|
| Change-based validation default | ✅ | `kind: 'changed'` is the default target |
| Static before execution | ✅ | Static runs first in `both` mode; redirect guardrail enforces this |
| Bounded execution preferred | ✅ | `destinationNode` + REST API |
| Trusted boundary reuse | ⚠️ | Trust derivation works; trust checking is broken in resolve (P0-005) |
| Compact diagnostics | ✅ | DiagnosticSummary is well-structured |
| Guardrails as product identity | ✅ | Full pipeline: refuse, narrow, redirect, warn, proceed |
| Happy-path bias | ✅ | 4-tier path scoring prefers non-error, output-0 paths |

### DESIGN.md Subsystem Alignment

| Subsystem | Implemented | Quality | Issues |
|---|---|---|---|
| Static analysis | ✅ | Good | Minor (P2-002 sync read, P2-003 dedup) |
| Trust & change | ✅ | Mostly good | P0-005 shadow isTrusted, P1-001 snapshot AST |
| Guardrails | ✅ | Good | P2-004 redundant evidence, P2-006 single decision |
| Execution | ✅ | Structurally sound | P0-001/P0-002 type mismatch, P1-002 credential bypass, P1-003 dead MCP path |
| Diagnostics | ✅ | Good in isolation | P0-002 type universe split |
| Request interpretation | ✅ | Good | P0-005 trust check |
| Agent-facing surface (MCP) | ✅ | Functional | P2-007 no path validation |
| CLI | ✅ | Functional | P2-008 no --no-color |

---

## Summary

### Must fix before release (P0)

1. **P0-001 + P0-002:** Unify ExecutionData types and fix the orchestrator's execution data pipeline. The execution → diagnostics bridge is fundamentally broken.
2. **P0-003:** Resolves with P0-002.
3. **P0-004:** Pass workflow hash, not workflow ID, to `persistTrustState`.
4. **P0-005:** Replace shadow `isTrusted` in resolve.ts with the real one from trust/trust.ts.

### Must fix before release (P1)

5. **P1-001:** Fix snapshot AST placeholder so content hashing doesn't produce false changes.
6. **P1-002:** Use the real credential cascade in the orchestrator.
7. **P1-003:** Wire MCP execution or remove dead code.
8. **P1-004:** Wire pin data caching in orchestrator.
9. **P1-005:** Add file locking for concurrent access.
10. **P1-006:** Add staleness timeout to execution lock.
11. **P1-007:** Make workflow ID portable.

### Positive observations

- **Type system is well-designed** (branded NodeIdentity, discriminated unions everywhere, Zod at all boundaries). The core type architecture is strong.
- **Subsystem separation is clean.** Each module has a clear responsibility. The DI pattern in OrchestratorDeps is well-executed.
- **Guardrail pipeline is the standout feature.** The evaluation order, evidence assembly, narrowing algorithm, redirect logic, and DeFlaker checks are thoughtful and well-implemented.
- **Static analysis is solid.** Expression tracing, data-loss detection, classification — all well-structured with clean discriminated unions.
- **Trust derivation and invalidation logic is correct** (the forward BFS invalidation, rename detection, trust-preserving change kinds).
- **Path selection algorithm is well-designed.** 4-tier lexicographic scoring with additional-greedy multi-path selection is a good algorithm for the problem.
- **Error hierarchy is clean.** Domain errors at each subsystem boundary, unified via `mapToMcpError` at the surface.

### Root cause of the worst bugs

P0-001 through P0-003 all stem from one decision: the diagnostics subsystem defined its own type universe instead of consuming execution types. The fix is straightforward — unify the types and properly transform execution results before passing them to synthesis. This is the single highest-impact fix for the codebase.

---

## Section 5 — Research Document Compatibility Findings

Cross-reference of `docs/research/*.md` (platform capability research gathered from `../n8n`, `../n8n-docs`, and `../n8n-as-code`) against the implemented codebase. Findings are ordered by impact.

### RC-P0: n8nac config schema mismatch — credential resolution will fail

**Files:** `src/execution/rest-client.ts` (lines 113–120), `docs/research/n8nac_capabilities.md` §5, `docs/research/integration_and_failure_feasibility.md` §6.3

The code defines `N8nacProjectConfigSchema` as:
```typescript
z.object({
  activeInstance: z.string().optional(),
  instances: z.record(z.object({ host, apiKey })).optional(),
})
```

But the **actual** n8nac v2 config format (documented in the research and confirmed from the n8nac source) is:
```json
{
  "version": 2,
  "activeInstanceId": "uuid",
  "instances": [
    { "id": "uuid", "name": "...", "host": "...", ... }
  ]
}
```

Three breakages:
1. The field is `activeInstanceId`, not `activeInstance`.
2. `instances` is an **array** of objects (each with an `id`), not a Record/object indexed by name.
3. API keys are NOT stored in `n8nac-config.json`. They are stored separately in a global `conf` store at `~/.config/n8nac/credentials.json`, keyed by both host URL and instance ID (via the `ConfigService.getApiKey(host, instanceId)` method). The code's schema expects `apiKey` inline.

**Impact:** `readProjectConfig()` will Zod-parse-fail on every real n8nac config and silently return `undefined`, falling through to the global credentials reader, which is also wrong (reads flat entries, not the `conf`-store nested keys). Config cascade layer 3 and 4 are both non-functional.

### RC-P0: REST API path uses public v1 API, but `POST /workflows/:id/run` is an internal endpoint

**Files:** `src/execution/rest-client.ts` (line 263), `docs/research/n8n_platform_capabilities.md` §4, `docs/research/execution_feasibility.md` §2.1

The code calls:
```
POST /api/v1/workflows/${workflowId}/run
```

But per the research, the n8n public API v1 endpoints listed at `/api/v1/` do NOT include a `/run` endpoint. The workflow run endpoint (`POST /workflows/:workflowId/run`) is an **internal** endpoint used by the n8n editor frontend (handled by `WorkflowsController`, not the public API controller). The actual public API endpoints are for CRUD operations on workflows and executions.

The internal editor endpoint:
- Requires a different auth model (session/cookie-based, not API key)
- Is not versioned under `/api/v1/`
- Uses `ManualRunPayload` types that are editor-internal
- May or may not accept `X-N8N-API-KEY` depending on n8n configuration

The code currently sends `X-N8N-API-KEY` to a URL path that may be wrong and may require different auth. This needs field verification — it might work in some n8n configurations but is not guaranteed.

### RC-P1: MCP `get_execution` response schema mismatch

**Files:** `src/execution/mcp-client.ts` (lines 48–70), `docs/research/n8n_platform_capabilities.md` §3

The `GetExecutionResponseSchema` expects execution data nested under `execution.data.resultData`. But per the research, the MCP `get_execution` tool returns:
```typescript
{
  execution: { id, workflowId, mode, status, startedAt, stoppedAt, ... } | null,
  data?: unknown,   // full IRunExecutionData — only when includeData: true
  error?: string
}
```

Key mismatches:
- The actual tool returns `data` as a **sibling** of `execution`, not nested inside `execution.data`. The code's schema nests it under `execution.data.resultData`.
- The `nodeNames` filter is a feature of the MCP tool, but the code's schema doesn't reflect the flat `data` field at the top level.

**Impact:** Zod validation will likely reject valid MCP responses, making `get_execution` data retrieval fail.

### RC-P1: MCP tool availability is per-workflow and silently stripped by n8nac push

**Files:** `src/execution/mcp-client.ts`, `docs/research/validation_surface_map.md` §1, `docs/research/n8nac_capabilities.md` §5, `docs/research/testing_experiences.md` §5

The research documents a known n8nac bug: `n8nac push` strips the `availableInMCP` workflow setting because its internal `WorkflowSettings` interface uses a closed allowlist. Every push disables MCP access, requiring manual re-enablement in the GUI.

The codebase has no detection or warning for MCP unavailability per-workflow. `McpClient.smokeTest()` will fail with a `WorkflowAccessError` (reason: `no_permission` or MCP-not-enabled) with no guidance to the user about what happened. The capability detection in `src/execution/capabilities.ts` doesn't check this.

**Recommendation:** The validation surface map recommends treating MCP as "opportunistic, not assumed" and falling back to REST API. The code should detect MCP tool failures with this error class and degrade gracefully.

### RC-P1: Missing expression patterns — `$input` without `.json` accessor and `$parents[n]`

**Files:** `src/static-analysis/expressions.ts` (lines 52–56), `docs/research/static_analysis_feasibility.md` §1.1, `docs/research/validation_surface_map.md` §2

The research documents two expression patterns the code doesn't handle:
1. `$parents[0].json.fieldName` — parent node by index (documented in validation surface map §2)
2. `$input.all()[n].json.field` — array-index access after `.all()`

The code handles `$input.first().json.field` via `INPUT_PATTERN` but `$parents` is entirely unhandled. The research rates `$parents` as "harder" but "also relevant." While low-frequency, this is a false-negative gap in expression coverage.

### RC-P1: Node classification misses `n8n-nodes-base.aiTransform` type string

**Files:** `src/static-analysis/node-sets.ts` (line 24), `docs/research/static_analysis_feasibility.md` §1.1

The `SHAPE_OPAQUE_TYPES` set lists `'@n8n/n8n-nodes-langchain.aiTransform'`. But the research documents `SCRIPTING_NODE_TYPES` from `packages/workflow/src/constants.ts` as:
```typescript
const SCRIPTING_NODE_TYPES = [
    'n8n-nodes-base.function',
    'n8n-nodes-base.functionItem',
    'n8n-nodes-base.code',
    'n8n-nodes-base.aiTransform',  // <-- different package prefix
];
```

The n8n source uses `n8n-nodes-base.aiTransform`, not `@n8n/n8n-nodes-langchain.aiTransform`. If the actual node type in workflows uses the `n8n-nodes-base` prefix, the classification will miss it and fall through to rule 7 (default: shape-opaque), which happens to be correct. But if the langchain prefix is the actual type, the n8n source constant is wrong. This needs field verification to confirm which type string appears in real workflows.

### RC-P1: `executeBounded()` doesn't send `triggerToStartFrom` — partial execution needs it

**Files:** `src/execution/rest-client.ts` (lines 260–275), `docs/research/execution_feasibility.md` §2.1, `docs/research/n8n_platform_capabilities.md` §4

The research documents three `ManualRunPayload` variants for `POST /workflows/:id/run`:

1. Partial: `{ runData, destinationNode, dirtyNodeNames }`
2. Full from known trigger: `{ triggerToStartFrom, destinationNode? }`
3. Full from unknown trigger: `{ destinationNode }`

The code sends only `{ destinationNode, pinData }`, which is variant 3 (auto-trigger-selection). But the research specifically notes that partial execution requires `runData` and that "workflows without triggers cannot use partial execution." The code also omits `triggerToStartFrom` which the research says is needed to control which trigger the execution starts from, especially for multi-trigger workflows.

For first-run validation (no prior `runData` available), variant 3 may work, but the absence of `triggerToStartFrom` means the code can't control trigger selection. If a workflow has multiple triggers, n8n picks one, which may not be the one with pin data.

### RC-P2: Pin data binary limitation undocumented in code

**Files:** `src/execution/types.ts` (lines 23–24), `docs/research/n8n_platform_capabilities.md` §2

The `PinDataItem` type includes `binary?: Record<string, unknown>`, matching n8n's `INodeExecutionData`. However, the research notes that while binary pin data is technically possible via the API, it is "untested" and "n8n-vet should focus on JSON pin data and treat binary-output nodes as requiring execution rather than mocking."

The code has no validation or guidance around binary pin data. If an agent passes binary pin data, it will be sent but behavior is unpredictable.

### RC-P2: `needsPinData()` classification not replicated — pin data authoring relies on agent guessing

**Files:** `src/execution/pin-data.ts` (if it exists), `docs/research/execution_feasibility.md` §2.2

The research documents a clear `needsPinData()` heuristic from n8n:
- Trigger nodes → need pin data
- Nodes with credentials → need pin data
- HTTP Request nodes → need pin data
- Everything else → executes normally

The `classifyNode()` in `src/static-analysis/classify.ts` captures similar logic (credential-based → shape-replacing), but this classification is used for data-loss detection, not for pin data guidance. There's no function that tells the agent "these are the nodes you need to provide pin data for." The `prepare_test_pin_data` MCP tool exists on the n8n side, but the code doesn't provide an equivalent local recommendation.

### RC-P2: 5-minute MCP execution timeout not surfaced in error handling

**Files:** `src/execution/mcp-client.ts`, `docs/research/n8n_platform_capabilities.md` §3, `docs/research/integration_and_failure_feasibility.md` §7.1

The research documents a hard 5-minute timeout on `test_workflow` (`WORKFLOW_EXECUTION_TIMEOUT_MS = 5 * Time.minutes.toMilliseconds`). The error type is `McpExecutionTimeoutError`. The code doesn't detect or classify this timeout specially — it will be treated as a generic infrastructure error rather than a "your workflow took too long, try bounding execution to a smaller slice" diagnostic.

### RC-P2: Set node version handling gap

**Files:** `src/static-analysis/classify.ts` (lines 65–74), `docs/research/static_analysis_feasibility.md` §1.2

The `classifySetNode()` reads `parameters.options.include` to determine whether the Set node preserves or replaces shape. The research documents that this is the `composeReturnItem()` function's behavior with `INCLUDE.ALL` / `INCLUDE.SELECTED` / `INCLUDE.NONE` / `INCLUDE.EXCEPT`.

However, the Set node's parameter structure varies by version. In v2, the `include` parameter is under `options.include`. In v1, it had a different parameter structure. The code doesn't check `node.version` before reading `options.include`. If there are v1 Set nodes in the wild, the classification could be wrong.

### RC-P2: `SplitInBatches` loop cycle handling gap

**Files:** `src/static-analysis/node-sets.ts` (line 10), `docs/research/execution_feasibility.md` §2.1

The research documents that `SplitInBatches` gets **special treatment** in n8n's partial execution pipeline — if its "done" output has no data on the last run, the loop wasn't completed and becomes a start node. The code classifies `SplitInBatches` as `shape-preserving` for static analysis purposes, which is correct. But there's no handling of the loop/cycle behavior in either the graph walker or the execution planning. When validating a path through a `SplitInBatches` loop, the graph walker doesn't account for the cycle.

### RC-P3: Missing validation for credential existence pre-execution

**Files:** `src/execution/`, `docs/research/n8nac_capabilities.md` §7

The research documents `n8nac workflow credential-required <workflowId>` which checks if all required credentials exist before execution. The code has no pre-flight credential check. If credentials are missing, the execution will fail at runtime with a generic n8n error rather than a clear pre-execution diagnostic.

### RC-P3: Expression pattern `$('NodeName').item.json.field` variant not covered

**Files:** `src/static-analysis/expressions.ts` (line 54)

The `EXPLICIT_REF_PATTERN` handles `.first()`, `.last()`, `.all()`, `.itemMatching()`, and `.item`. The research confirms these are the primary patterns. However, the regex makes `.json` after the accessor mandatory, while `.json` is sometimes omitted in shorthand expressions. The research's `extractReferencesInNodeExpressions()` also handles the `DATA_ACCESSORS` list which includes `json` and `binary`. The code only handles `.json`, missing the `.binary` accessor path. Low priority since binary data flow analysis is explicitly out of scope, but worth noting.

### RC-P3: Trust persistence path uses `.n8n-vet/trust-state.json` but snapshots use `.n8n-vet/snapshots/`

**Files:** `src/orchestrator/snapshots.ts`, `src/trust/persistence.ts`

This is consistent with the CLAUDE.md note about active technologies. No compatibility issue — just confirming the research's recommendation that `.n8n-vet/` as a data directory is appropriate.

### Summary of research compatibility findings

| ID | Severity | Category | Finding |
|---|---|---|---|
| RC-P0 | Critical | Config | n8nac config schema completely wrong (field names, structure, API key location) |
| RC-P0 | Critical | Execution | REST API `/run` endpoint may be internal-only, not public API |
| RC-P1 | High | MCP | `get_execution` response schema mismatch (data nesting) |
| RC-P1 | High | MCP | MCP availability silently stripped by n8nac push — no detection |
| RC-P1 | High | Static | Missing `$parents[n]` expression pattern |
| RC-P1 | High | Static | `aiTransform` type string may use wrong package prefix |
| RC-P1 | High | Execution | Missing `triggerToStartFrom` in bounded execution payload |
| RC-P2 | Medium | Execution | Binary pin data untested — no validation or guidance |
| RC-P2 | Medium | Execution | No local `needsPinData()` recommendation for agents |
| RC-P2 | Medium | Execution | 5-minute MCP timeout not surfaced as diagnostic |
| RC-P2 | Medium | Static | Set node version-dependent parameter structure |
| RC-P2 | Medium | Static | SplitInBatches cycle behavior not modeled |
| RC-P3 | Low | Execution | No pre-flight credential existence check |
| RC-P3 | Low | Static | Missing `.binary` accessor path in expressions |
| RC-P3 | Low | Config | Trust/snapshot paths consistent — no issue |
