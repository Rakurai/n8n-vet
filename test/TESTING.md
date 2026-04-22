# Testing Guide

Reference document for unit and integration testing in n8n-proctor.

## Running Tests

```sh
npm test                                          # Unit tests (vitest)
npm run test:watch                                # Watch mode
npx vitest run test/guardrails/evaluate.test.ts   # Single file
npx vitest run -t "pattern"                       # By name pattern

npm run test:integration                          # All integration scenarios
npm run test:integration -- --scenario 04         # Single scenario
npm run test:integration -- --verbose             # With diagnostic output
npm run test:integ:check                          # Check prerequisites only
npm run test:integ:seed                           # Reseed fixtures on n8n
```

Integration scripts use `dotenv-cli` to load `.env` automatically.

---

## Unit Tests

621 tests across 54 files (vitest reports type-test `.test-d.ts` files in both type-check and runtime passes). Every `src/` subsystem has a mirror in `test/`.

### Layout

| Directory | Covers | Key assertions |
|-----------|--------|----------------|
| `test/static-analysis/` | Graph parsing, expression tracing, data-loss detection, classification, params, schemas, disconnected node detection | Node connectivity, expression resolution, data-loss detection between shape-opaque and shape-sensitive nodes, disconnected/unreachable node identification |
| `test/trust/` | Hashing, change detection, trust state persistence, opportunistic trust harvesting | Content hash determinism, change-set identification, trust file read/write/update, execution-opportunistic evidence derivation |
| `test/guardrails/` | Evaluate, evidence, narrow, redirect, rerun | Guardrail action selection for all 4 actions (proceed/warn/narrow/refuse), evidence summarization, narrowing heuristics, redirect logic, identical-rerun detection |
| `test/execution/` | MCP client, capabilities, lock, pin data, results | MCP tool call arguments, capability detection (mcp vs static-only), execution locking, pin data construction from cache and tier-3, execution result mapping |
| `test/diagnostics/` | Annotations, errors, hints, path, status, synthesize, next-action | Node annotation assignment, error classification mapping, hint generation (including disconnected nodes), path reconstruction, status derivation, full synthesis from static + execution data, next-action recommendation derivation |
| `test/orchestrator/` | Interpret, path, pinning, resolve, snapshots | Request interpretation, path selection, pin data orchestration, target resolution, snapshot comparison |
| `test/mcp/` | MCP server | Tool registration, argument validation, error envelope mapping |
| `test/cli/` | Commands, format | CLI argument parsing, human-readable formatting of diagnostics |
| `test/plugin/` | CLI binary, hook, manifest, MCP config, skill, paths | n8nac plugin contract: hook.json, SKILL.md, MCP config, binary invocation, trust/snapshot path resolution |
| `test/types/` | Type narrowing, branded identity types | Compile-time type tests (`.test-d.ts` files) for discriminated unions and branded types |
| `test/errors.test.ts` | Error mapping | `mapToMcpError` for all domain error classes → MCP error envelope types |

### Writing Unit Tests

**Principle**: Confidence, not ceremony. No trivial tests, no redundant tests.

- **Happy-path tests are mandatory.** Correct inputs produce correct outputs. Should always pass and run fast.
- **Error-path tests are mandatory for public API boundaries.** If the public API defines typed errors, test that they are thrown under the documented conditions. Do not test internal error paths that consumers never see.
- **Edge/exhaustive tests are opt-in.** Boundary values, combinatorial coverage, and rare conditions are valuable but should be marked or separated so the default test run stays fast.
- **Test where the logic lives.** Framework plumbing is already tested by the framework. Do not retest it.
- **Assert behavior, not implementation.** Test through public interfaces, not private state.
- **Mock dependencies, not the code being tested.** Signs of over-mocking: the mock mirrors production logic; the test passes regardless of production changes. Mock at subsystem boundaries — execution tests mock the MCP client, orchestrator tests mock static analysis and execution, trust tests use temp directories.
- **No trivial tests.** Do not test that an enum has its value, that a constructor sets a field, or that a getter returns what was set. If the test would pass even with a broken implementation, it has no value.
- **No redundant tests.** If two tests verify the same contract through the same path, delete one. Each test must justify its existence by covering a distinct behavior.
- **Fail-fast assertions.** Use `expect(x).toBe(y)` — not `if (x !== y) ...`. Vitest gives better diagnostics. Avoid broad `catch` blocks, loose assertions, or tests that assert only "no exception was raised."
- If tests or code fail, fix the **implementation**, not by trivializing tests.
- **Type tests** use `.test-d.ts` suffix and `expectTypeOf()` from vitest.

### Fixtures

Unit test fixtures live in `test/fixtures/workflows/` — static `.ts` and `.json` workflow files used by graph parsing, expression tracing, and data-loss tests. These are **not** deployed to n8n.

---

## Integration Tests

15 scenarios testing the full pipeline against a live n8n instance: parse → graph → trust → target → guardrails → analysis → execution → diagnostics. Plus 1 local-only scenario (16) that doesn't require MCP.

### Prerequisites

1. **n8n instance running** — `curl http://localhost:5678/api/v1/workflows` returns 200
2. **n8n API key** — set `N8N_API_KEY` env var (Settings → API → Create API Key)
3. **n8n MCP token** — set `N8N_MCP_TOKEN` env var (Settings → MCP Server → Generate Token, audience `mcp-server-api`)
4. **n8nac CLI configured** — `n8nac instance list --json` shows active instance
5. **Project built** — `npm run build`
6. **Fixtures seeded** — `npm run test:integ:seed`

Copy `.env.example` to `.env` and fill in values (gitignored).

| Variable | Required | Description |
|----------|----------|-------------|
| `N8N_HOST` | Yes | n8n instance URL (default: `http://localhost:5678`) |
| `N8N_API_KEY` | Yes | REST API key — seeding and `availableInMCP` workaround only |
| `N8N_MCP_URL` | No | MCP server URL (default: `${N8N_HOST}/mcp-server/http`) |
| `N8N_MCP_TOKEN` | Yes | MCP server bearer token (audience `mcp-server-api`) |

### Scenario Inventory

| # | Name | Requires MCP | What it proves |
|---|------|-------------|----------------|
| 01 | static-only | No | Static analysis finds wiring error, produces correct classification, node annotations, hints, disconnected-node warning, coverage, nextAction |
| 02 | execution-happy | Yes | Execution succeeds, path contains expected nodes in order, annotations for each node |
| 03 | execution-failure | Yes (static fallback without) | External-service error classified correctly; static fallback works without MCP |
| 04 | trust-lifecycle | No | Trust builds from validate, invalidates on edit, re-validate targets only changed + downstream |
| 05 | guardrail-rerun | No | Broad-target warn fires on 100% coverage, explanation is meaningful, `buildGuardrailExplanation` matches |
| 06 | branching-execution | Yes | Branch coverage — executes correct path through If node |
| 07 | mcp-tools | Yes | All 4 MCP tools (validate, test, trust_status, explain) through transport layer, error envelopes |
| 08 | full-pipeline | No | End-to-end: broken fixture → fail, happy fixture → pass |
| 09 | nodes-target | No | `target: { kind: 'nodes', names: [...] }` scopes validation to named subset |
| 10 | test-refusal | No | Guardrail refuses test on structurally-analyzable workflow, force bypasses it |
| 11 | independent-trust | Yes | Validate and test independently produce correct trust state (separate deps) |
| 12 | error-envelope-types | Yes | MCP error type strings match contract (workflow_not_found, parse_error, precondition_error), plus `mapToMcpError` for configuration/infrastructure/trust errors |
| 13 | pin-data | Yes | Explicit `pinData` parameter works, execution succeeds with mock upstream data |
| 14 | expression-classification | Yes | **SKIP (SP3)** — n8n v2.16 expression engine too lenient; see Known Gaps |
| 15 | validate-test-lifecycle | Yes | Trust carries across validate → test with shared deps; tier-3 pin data sourcing works |
| 16 | next-action | No | `nextAction` recommendation: fix-errors on fail, continue-building on pass, force-revalidate on skip, review-warnings on pass+warnings |
| 17 | opportunistic-harvest | Yes | Execution on narrow target records `execution-opportunistic` trust for out-of-scope nodes that ran successfully |

### Fixtures

Integration fixtures live in `test/integration/fixtures/`. They are real n8n workflows seeded onto the instance by `seed.ts`. The seeded `.ts` files and `manifest.json` are gitignored — run `npm run test:integ:seed` to regenerate them locally.

| Fixture | Nodes | Purpose |
|---------|-------|---------|
| `happy-path.ts` | ManualTrigger → Set → Noop | Clean workflow, the baseline for pass scenarios |
| `broken-wiring.ts` | ManualTrigger → Set + OrphanedHttp (disconnected) | Disconnected node detection — OrphanedHttp is not connected to any trigger |
| `credential-failure.ts` | ManualTrigger → HTTP Request | HTTP node hits unreachable endpoint → external-service error |
| `data-loss-passthrough.ts` | ManualTrigger → Code → Set | Code node is shape-opaque → data-loss hint on downstream Set |
| `expression-bug.ts` | ManualTrigger → Set (bad expr) | Expression references non-existent node — currently untriggerable at runtime |
| `multi-node-change.ts` | Trigger → A → B → C → D | Linear chain for trust lifecycle testing |
| `branching-coverage.ts` | ManualTrigger → If → SetTrue / SetFalse → Merge | Branch coverage testing through If node |
| `no-id.ts` | (no metadata.id) | Precondition error — test before push |

### Assertion Helpers

All in `test/integration/lib/assertions.ts`. Use these — don't inline checks in scenarios.

| Helper | Asserts |
|--------|---------|
| `assertStatus(summary, expected)` | `summary.status` matches, with diagnostic context on failure |
| `assertEvidenceBasis(summary, expected)` | `summary.evidenceBasis` matches |
| `assertFindingPresent(summary, classification)` | At least one error with that classification exists |
| `assertFindingOnNode(summary, classification, node)` | Classification + node attribution |
| `assertNoFindings(summary)` | Zero errors |
| `assertExecutedPathContains(summary, names)` | All named nodes appear in executedPath |
| `assertExecutedPathOrder(summary, orderedNames)` | Named nodes appear in order |
| `assertTrusted(status, nodeName)` | Node is in `trustedNodes` |
| `assertTrustedWith(status, nodeName, evidence)` | Trusted + validated with specific evidence |
| `assertUntrusted(status, nodeName)` | Node is in `untrustedNodes` |
| `assertGuardrailAction(summary, kind)` | Guardrail with that action exists |
| `assertGuardrailExplanationContains(summary, kind, substring)` | Action exists + explanation contains substring |
| `assertMcpErrorType(response, expectedType)` | MCP error envelope has expected type string |
| `assertNodeAnnotation(summary, nodeName, status)` | Node has annotation with expected status |
| `assertAnnotationCount(summary, expected)` | Total annotation count matches |
| `assertHintPresent(summary, severity, substring?)` | Hint with severity exists, optionally containing text |
| `assertHintCount(summary, expected)` | Total hint count matches |
| `assertCoverage(summary, checks)` | `coverage.analyzableRatio`, `totalInScope`, or `shape-opaque` count matches |
| `assertNextAction(summary, expectedType)` | `nextAction.type` matches expected action type |

### Writing Integration Scenarios

Integration tests prove the product works as promised to agents. Every scenario must be **honest** — testing what matters, not just that something ran.

**Read before writing a new scenario:** `skills/validate-workflow/SKILL.md` (agent contract), `src/types/diagnostic.ts` (DiagnosticSummary shape), `src/types/guardrail.ts` (GuardrailDecision shape), `src/errors.ts` (MCP error envelope types).

1. **Assert on data, not just status.** `assertStatus(result, 'pass')` proves nothing about correctness. After checking status, assert the *content*: error classifications, node names in executed paths, guardrail action types, error messages. A regression that returns the right status but garbled data must fail.
2. **Test the product contract.** `SKILL.md` is the contract with agent users. Each promise needs at least one integration test — error classifications, lifecycle sequences, guardrail actions, error envelope types, `pinData` parameter.
3. **Don't bypass what you're testing.** Every execution scenario using `force: true` bypasses guardrails. That's necessary for some tests, but at least one execution scenario must run without force to prove guardrails work in the execution path.
4. **Test the handoffs.** The product's value is in subsystem integration, not individual subsystem correctness (unit tests cover that). Focus on: trust carrying from validate into test, guardrail decisions affecting execution scope, static and execution findings combining in diagnostics.
5. **Gate on MCP.** If a scenario needs MCP, check `ctx.callTool` and return early (or test a static fallback) without it. Never let a missing n8n instance cause a false failure.
6. **Use assertion helpers.** They provide diagnostic-rich error messages. Inline `if/throw` makes failures harder to debug.

### Non-goals

- Don't add tests for edge cases already covered by unit tests (trust expiry, concurrent access, file permissions).
- Don't test n8n itself (credential validation, webhook behavior, expression engine quirks).
- Don't add tests for features not yet promised in `SKILL.md`.
- Don't refactor the test runner or assertion framework beyond adding helpers needed for a specific scenario.

### Adding a New Fixture

1. Add the workflow to `FIXTURES` in `test/integration/seed.ts`
2. Run `npm run test:integ:seed -- --fixture <name>`
3. Verify `availableInMCP: true` in the pulled `.ts` file's settings
4. Commit the fixture file and updated `manifest.json`

### Refreshing Fixtures

Re-run when n8n upgrades or adding new fixtures:

```sh
npm run test:integ:seed
git diff test/integration/fixtures/
```

### Debugging Failures

1. Run failing scenario in isolation: `npm run test:integration -- --scenario 03 --verbose`
2. Check workflow on n8n (names start with `n8n-proctor-test--`)
3. Check execution history: `n8nac execution list --workflow-id <id>`
4. Failure messages include fixture name, expected outcome, and actual outcome

### The `availableInMCP` Workaround

n8n requires `availableInMCP: true` in workflow settings for MCP tool calls to work. Older n8nac versions strip this flag on push. The test setup re-enables it via REST API if needed, caching the result in `.local-state.json` (gitignored). This is the **only** use of the n8n REST API in n8n-proctor.

---

## Lessons Learned

Hard-won knowledge from building the test suite.

### Noop/NoOp name mismatch

n8nac names the No-Op node `'Noop'` (PascalCase) in the workflow graph. n8n's execution data uses `'NoOp'`. This means annotation matching against execution results shows `'skipped'` instead of `'validated'` for that node. Not a bug in n8n-proctor — it's a naming inconsistency between the two tools. Scenario 02 documents this with an explicit assertion.

### Guardrail evaluation order matters

Scenario 05 expected `'refuse'` (identical-rerun) but gets `'warn'` (broad-target). The guardrail pipeline evaluates broad-target (step 6) before identical-rerun (step 7). With a 3-node workflow at 100% trusted coverage, the broad-target heuristic fires first. This is correct behavior — it means the guardrail pipeline short-circuits at the most informative action.

### `interpret()` catches missing metadata.id internally

`ExecutionPreconditionError` was originally unreachable because `interpret()` caught the missing-ID case and returned a diagnostic error. We fixed this (A1): `interpret()` now throws the error, and the MCP server / CLI catch blocks map it to `precondition_error` via `mapToMcpError()`.

### Pin data and trust boundaries

When all target nodes are trusted from static validation, execution used to fail with "Pin data unavailable" because `constructPinData` had no cached data for the boundary nodes. Resolution: skip pinning entirely when all targets are trusted (execute normally), and wire tier-3 MCP `prepare_test_pin_data` for partial-trust cases. Scenario 15 proves the validate → test lifecycle works with shared deps.

### n8n expression engine is lenient

n8n v2.16's expression engine swallows errors in Set node contexts. `JSON.parse("{invalid")`, `$json.nonexistent.deep.path`, `$("NonExistentNode").item.json.value` — all evaluate without error. This makes the `expression` error classification untriggerable from integration fixtures. The classification logic is correct and unit-tested; the gap is in n8n's runtime behavior.

### Static fallbacks increase scenario value

Several MCP-gated scenarios (03, 07) were originally empty without MCP. Adding static-only fallback paths (validate the fixture statically, assert evidence basis and annotations) means those scenarios contribute value even when n8n isn't running.

---

## Coverage Inventory

What's tested vs. what's not.

### Error Classifications (SKILL.md contract)

| Classification | Unit | Integration | Notes |
|----------------|------|-------------|-------|
| `wiring` | Yes | Yes (01) | Classification + node attribution |
| `expression` | Yes | **Skip (14)** | n8n v2.16 too lenient; unit-tested in `diagnostics/errors.test.ts` |
| `credentials` | Yes | **No** | Static detection needs credential type registry; execution needs 401/403 from external endpoint |
| `external-service` | Yes | Yes (03) | Classification + node attribution |
| `data-loss` | Yes | Partial (01) | Info hint only; warning-severity needs `shape-opaque` upstream in a failing path |
| `platform` | Yes | **No** | Hard to trigger synthetically |
| `cancelled` | Yes | **No** | Hard to trigger synthetically |
| `unknown` | Yes | **No** | Catch-all; low value to test directly |

### Error Envelope Types (MCP contract)

| Type | Unit | Integration | Where |
|------|------|-------------|-------|
| `workflow_not_found` | Yes | Yes | Scenarios 07, 12 |
| `parse_error` | Yes | Yes | Scenarios 07, 12 |
| `precondition_error` | Yes | Yes | Scenarios 07 (test 8), 12 |
| `configuration_error` | Yes | Yes | Scenario 12 (via `mapToMcpError`) |
| `infrastructure_error` | Yes | Yes | Scenario 12 (via `mapToMcpError`) |
| `trust_error` | Yes | Yes | Scenario 12 (via `mapToMcpError`) |
| `internal_error` | Yes | **No** | Catch-all; would require provoking an unhandled throw |

### Guardrail Actions

| Action | Unit | Integration | Where |
|--------|------|-------------|-------|
| `proceed` | Yes | Implicit | Most passing scenarios |
| `warn` | Yes | Yes (05) | Broad-target warn + explanation content |
| `narrow` | Yes | **No** | Needs > 5 node fixture with < 20% changed |
| `refuse` | Yes | Yes (10) | Action, explanation, force bypass |

### DiagnosticSummary Fields

| Field | Unit | Integration | Where |
|-------|------|-------------|-------|
| `status` | Yes | Yes | All scenarios |
| `evidenceBasis` | Yes | Yes | 01, 02, 03, 06, 07, 11, 13, 15 |
| `executedPath` | Yes | Yes | 01 (null), 02 (order), 06, 13 |
| `errors[]` | Yes | Yes | 01, 03 — classification + node |
| `guardrailActions[]` | Yes | Yes | 05, 10, 16 |
| `hints[]` | Yes | Yes | 01 (info + warning severity, disconnected nodes) |
| `nodeAnnotations[]` | Yes | Yes | 01, 02, 03 |
| `capabilities` | Yes | Yes | 01, 02, 03 |
| `coverage` | Yes | Yes | 01 (analyzableRatio, totalInScope explicitly asserted) |
| `nextAction` | Yes | Yes | 01, 16 (all 4 action types: fix-errors, continue-building, force-revalidate, review-warnings) |
| `meta.executionId` | Yes | Yes | 02, 06, 11, 13 |

### MCP Tools via Transport

| Tool | Tested via MCP server | Where |
|------|----------------------|-------|
| `validate` | Yes | Scenario 07 |
| `test` | Yes | Scenario 07 (test 7) |
| `trust_status` | Yes | Scenario 07 |
| `explain` | Yes | Scenario 07 |

---

## Known Gaps

Issues that are understood but not yet resolved. Each includes what would unblock it.

### 1. `expression` classification (SP3)

**Gap:** No integration test triggers the `expression` error classification at runtime.
**Blocked by:** n8n v2.16's expression engine swallows all errors in Set node contexts.
**Unblock path:** Find a node type that surfaces `ExpressionError` (e.g., a node with stricter expression evaluation), or wait for n8n to tighten its expression engine.
**Current mitigation:** Unit-tested in `test/diagnostics/errors.test.ts`. Scenario 14 is a documented skip.

### 2. `credentials` classification

**Gap:** No integration test verifies the `credentials` error classification.
**Blocked by:** Static detection needs a credential type registry to know which credential types are invalid. Execution-based detection needs a 401/403 from an external endpoint, which is environment-dependent.
**Unblock path:** Introduce a credential type registry for static detection, or create a fixture with a known-invalid credential reference against a local mock server.
**Current mitigation:** Unit-tested in `test/diagnostics/errors.test.ts`.

### 3. `narrow` guardrail action

**Gap:** No integration test exercises the `narrow` guardrail action.
**Blocked by:** Narrowing requires `NARROW_MIN_TARGET_NODES > 5` and `NARROW_MAX_CHANGED_RATIO < 0.2`. No existing fixture has enough nodes.
**Unblock path:** Create a 6+ node fixture where only 1 node is changed.
**Current mitigation:** Unit-tested in `test/guardrails/narrow.test.ts`.

### 4. `data-loss` warning-severity hints

**Gap:** Only info-severity data-loss hints are integration-tested (scenario 01). Warning severity requires a `shape-opaque` node (e.g., Code node) upstream of a `shape-sensitive` node in a failing execution path.
**Unblock path:** Use the existing `data-loss-passthrough.ts` fixture in a scenario that asserts the warning hint.
**Current mitigation:** Unit-tested in `test/diagnostics/hints.test.ts`.

### 5. Concurrent trust access

**Gap:** No test verifies trust state consistency under parallel validate calls.
**Unblock path:** Write a scenario that runs 2+ `interpret()` calls concurrently on the same workflow and asserts trust state is consistent afterward.

### 6. Large workflow performance

**Gap:** No test verifies that a 50+ node workflow completes within a time budget.
**Unblock path:** Create a large fixture and add a timed assertion. Useful for detecting algorithmic regressions in graph traversal or trust computation.

---

## Structural Decisions

Resolved architectural problems that shaped the test suite.

### SP1: Validate→test lifecycle pin data handoff

Static validation doesn't produce cached pin data. When all target nodes are trusted from static, `constructPinData` had no data for the boundary nodes → "Pin data unavailable" error.

**Resolution:** Tier-3 MCP `prepare_test_pin_data` sourcing. When all target nodes are trusted, skip pinning entirely. Scenario 15 proves the lifecycle end-to-end with shared deps.

### SP2: `precondition_error` was unreachable

`interpret()` caught missing `metadata.id` internally and returned a diagnostic with `status: 'error'`. `ExecutionPreconditionError` was never thrown, so the MCP envelope type was dead code.

**Resolution:** `interpret()` now throws `ExecutionPreconditionError`. MCP server and CLI map it via `mapToMcpError()`. Scenario 07 test 8 asserts the envelope.

### SP3: Expression classification not integration-testable

n8n v2.16's expression engine swallows all expression errors in Set node contexts. No fixture can trigger `ExpressionError`.

**Resolution:** Scenario 14 is a documented skip. Classification logic is unit-tested. Revisit when n8n upgrades.
