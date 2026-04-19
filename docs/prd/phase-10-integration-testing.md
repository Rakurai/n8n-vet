# Phase 10 — Integration Testing

## Goal

Integration test suite that verifies n8n-vet's full pipeline against a live n8n instance using real test artifacts. Not CI — requires a running n8n + n8nac setup. Proves that static analysis, trust tracking, execution, guardrails, diagnostics, and MCP tools work end-to-end on real workflows pushed to a real server.

## Context Files

| File | Role |
|------|------|
| `docs/research/testing_experiences.md` | Field evidence: what worked, what hurt, required workarounds |
| `docs/research/execution_feasibility.md` | Bounded execution, pin data tiers, polling strategy |
| `docs/research/n8nac_capabilities.md` | n8nac sync model, verify, test, execution inspection |
| `docs/spec/execution.md` | Execution subsystem spec — REST API, MCP tools, pin data |
| `docs/spec/mcp-surface.md` | MCP tools: validate, trust_status, explain |
| `test/fixtures/workflows/` | Existing unit test fixtures (reusable shapes) |

## Why Unit Tests Are Not Enough

Unit tests mock the n8n instance, the REST API, and the MCP client. They prove internal logic is correct. They cannot prove:

1. **n8nac push/pull actually works** — OCC conflicts, `availableInMCP` stripping, schema drift
2. **REST API bounded execution** — `destinationNode` behaves as documented
3. **MCP tool round-trips** — tool input schema accepted, response envelope parseable
4. **Pin data construction** — synthetic pin data accepted by n8n's execution engine
5. **Execution polling** — real timing, real status transitions
6. **Trust state persistence** — file I/O, state survives across invocations
7. **Diagnostic accuracy** — findings from static analysis match what execution reveals
8. **Guardrail behavior** — unchanged workflow correctly detected, rerun refused

## Architecture

```
test/integration/
├── README.md                     # Setup instructions, prerequisites
├── seed.ts                       # Creates test workflows on n8n, pulls as artifacts
├── fixtures/                     # Pulled n8nac artifacts (committed to repo)
│   ├── happy-path.ts             # Clean workflow, should pass everything
│   ├── broken-wiring.ts          # Disconnected node, static should catch
│   ├── data-loss-passthrough.ts  # Shape-narrowing node, static should warn
│   ├── expression-bug.ts         # Bad expression ref, static catches + execution fails
│   ├── credential-failure.ts     # Valid wiring but bad credentials, execution-only failure
│   ├── branching-coverage.ts     # If node with true/false paths, tests path selection
│   └── multi-node-change.ts      # Two nodes differ from trusted baseline, tests scope narrowing
├── scenarios/                    # Scenario scripts (TypeScript, runnable via tsx)
│   ├── 01-static-only.ts         # Push + static validate + check findings
│   ├── 02-execution-happy.ts     # Push + execute + check pass
│   ├── 03-execution-failure.ts   # Push + execute + check error classification
│   ├── 04-trust-lifecycle.ts     # Validate → trust → change → re-validate
│   ├── 05-guardrail-rerun.ts     # Validate twice → expect guardrail refusal
│   ├── 06-bounded-execution.ts   # destinationNode slice execution
│   ├── 07-mcp-tools.ts           # MCP tool round-trip via SDK client
│   └── 08-full-pipeline.ts       # End-to-end: edit → static → execute → diagnose
├── lib/                          # Shared test utilities
│   ├── setup.ts                  # n8n connection, n8nac config, cleanup
│   ├── push.ts                   # n8nac push with OCC conflict handling
│   ├── assertions.ts             # Typed assertion helpers for DiagnosticSummary
│   └── mcp-client.ts             # MCP client that talks to n8n-vet's MCP server
└── run.ts                        # Entry point: run all scenarios or pick one
```

## Test Fixtures

Each fixture is a real n8nac workflow artifact pulled from a live n8n instance. The seed script creates the workflows, and `n8nac pull` produces the canonical `.ts` files. These are committed to the repo so integration tests work without re-seeding.

### Fixture design principles

1. **One fixture, one primary signal.** Each workflow targets a specific validation behavior. A fixture that tests data loss should not also have broken credentials.
2. **Deterministic.** No randomness, no external API dependencies that could flake. Use Manual Trigger. HTTP Request nodes target `httpbin.org/anything` or require no external calls.
3. **Small.** 3–6 nodes. Just enough to exercise the signal, not so much that failure diagnosis is slow.
4. **Self-describing.** Node names encode intent: `"Add Fields (shape augmenting)"`, `"Bad Reference"`, `"Disconnected Node"`.
5. **Real server artifacts.** Fixtures are pulled from n8n, not hand-authored. They carry server-assigned IDs and server-normalized parameters.
6. **Prefixed names.** All workflow names start with `n8n-vet-test--` to avoid collision with real workflows on the test instance.

### Fixture catalog

| Fixture | Nodes | Static signal | Execution signal |
|---------|-------|---------------|------------------|
| `happy-path.ts` | Trigger → Set → NoOp | No findings | Pass |
| `broken-wiring.ts` | Trigger → Set, orphaned HTTP | Disconnected node warning | N/A (static-only) |
| `data-loss-passthrough.ts` | Trigger → HTTP → Set (narrowing) → Set (refs lost field) | Data-loss finding | Execution sees empty field |
| `expression-bug.ts` | Trigger → Set referencing `$json.nonexistent` | Unresolvable expression | Execution returns null/empty |
| `credential-failure.ts` | Trigger → HTTP (bad creds) → Set | No static findings | Execution error (credentials) |
| `branching-coverage.ts` | Trigger → If → True path / False path | No findings (valid wiring) | Pass on both branches |
| `multi-node-change.ts` | Trigger → A → B → C → D | Used across scenarios | Validates scope narrowing |

## Seed Script

`test/integration/seed.ts` creates the test workflows on a live n8n instance and pulls them back as n8nac artifacts. The pulled `.ts` files are the committed fixtures. This is a bootstrapping step — run once to generate artifacts, commit them, then the script becomes optional. Re-run anytime to rebuild fresh fixtures against a new n8n instance.

### Usage

```bash
# Build all test workflows on n8n and pull as artifacts
npx tsx test/integration/seed.ts

# Rebuild a single fixture
npx tsx test/integration/seed.ts --fixture happy-path

# List what would be created (dry run)
npx tsx test/integration/seed.ts --dry-run
```

### What the seed script does

For each fixture in the catalog:

1. **Create the workflow on n8n via REST API.** `POST /api/v1/workflows` with the workflow JSON. Each fixture's JSON is defined inline in the seed script — node types, parameters, connections, and settings. This is the source of truth for what each test workflow looks like.

2. **Record the server-assigned workflow ID.** n8n assigns real IDs on creation. The seed script writes a manifest (`test/integration/fixtures/manifest.json`) mapping fixture names to their n8n workflow IDs.

3. **Pull via n8nac.** `n8nac pull <workflowId>` for each created workflow. This produces the canonical `.ts` artifact with the n8nac decorator syntax, real IDs, and server-normalized parameters.

4. **Move pulled files to fixtures directory.** n8nac pulls to its configured directory. The seed script copies each pulled `.ts` file to `test/integration/fixtures/<fixture-name>.ts`.

5. **Verify round-trip.** For each fixture, run `n8nac verify <workflowId>` to confirm the pulled artifact is schema-valid.

### Why create via REST then pull, instead of authoring .ts files directly?

- **Real server IDs.** Hand-authored `.ts` files use synthetic IDs. Pushed workflows may get different IDs assigned by the server, creating a mismatch. Creating via REST lets n8n assign the IDs, and the pull captures them.
- **Server-normalized parameters.** n8n normalizes node parameters on save (adds defaults, reorders fields, coerces types). A hand-authored file may not match what n8n actually stores. The pull captures the normalized form.
- **Round-trip proven.** The fixture has already survived a create → pull cycle. When the integration test pushes it back, it's a known-good n8nac artifact, not an untested hand-authored approximation.
- **Node type version drift.** If n8n updates a node's parameter schema between versions, the seed script creates against the current instance and the pull captures the current schema. Hand-authored files may contain stale parameter shapes.

### Fixture JSON definitions

The seed script contains the n8n workflow JSON for each fixture as a typed constant. Example structure for `happy-path`:

```typescript
const FIXTURES: Record<string, WorkflowCreatePayload> = {
  'happy-path': {
    name: 'n8n-vet-test--happy-path',
    nodes: [
      { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1, position: [100, 200], parameters: {} },
      { name: 'Set Fields',     type: 'n8n-nodes-base.set',
        typeVersion: 3, position: [300, 200],
        parameters: { assignments: { assignments: [
          { name: 'result', value: 'ok', type: 'string' }
        ] } } },
      { name: 'Done',           type: 'n8n-nodes-base.noOp',
        typeVersion: 1, position: [500, 200], parameters: {} },
    ],
    connections: {
      'Manual Trigger': { main: [[{ node: 'Set Fields', type: 'main', index: 0 }]] },
      'Set Fields':     { main: [[{ node: 'Done',       type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
    active: false,
  },
  // ... other fixtures
};
```

Workflow names are prefixed with `n8n-vet-test--` so they're immediately identifiable on the n8n instance and won't collide with real workflows.

### Manifest file

`test/integration/fixtures/manifest.json` maps fixture names to n8n workflow IDs:

```json
{
  "happy-path": "wf-abc123",
  "broken-wiring": "wf-def456",
  "data-loss-passthrough": "wf-ghi789"
}
```

The integration test runner reads this manifest to know the workflow IDs when pushing or executing. The manifest is committed alongside the `.ts` artifacts.

### Idempotency

The seed script is safe to re-run:
- If a workflow named `n8n-vet-test--<fixture>` already exists on n8n, the script updates it (`PUT`) rather than creating a duplicate.
- The manifest is overwritten with current IDs.
- Pulled `.ts` files overwrite the previous versions.

### Credential handling for `credential-failure` fixture

The `credential-failure` fixture needs an HTTP node with intentionally invalid credentials. The seed script:
1. Creates the workflow with the HTTP node configured but **no credential attached**.
2. The integration test for this scenario expects the execution to fail with a credential/auth error — which it will, because the node has no valid credential.

No real credentials are created or stored by the seed script.

## Scenarios

Each scenario is a self-contained test that can run independently. Scenarios use the n8n-vet library API directly (not the MCP server) unless explicitly testing the MCP surface.

### Scenario 01 — Static Analysis Only

**Proves:** Static analysis catches known issues without touching n8n.

```
Given: broken-wiring.ts and data-loss-passthrough.ts pushed to n8n
When:  validate(workflowPath, { layer: 'static' })
Then:
  - broken-wiring: findings include disconnected-node warning
  - data-loss: findings include data-loss-risk with the lost field name
  - Neither workflow touched the execution engine
```

### Scenario 02 — Execution Happy Path

**Proves:** Clean workflow pushes, executes, and returns pass.

```
Given: happy-path.ts pushed to n8n
When:  validate(workflowPath, { layer: 'both' })
Then:
  - Static: no findings
  - Execution: status 'success'
  - Diagnostic summary: status 'pass'
  - Trust state updated: all nodes now trusted
```

### Scenario 03 — Execution Failure Classification

**Proves:** Execution errors are correctly classified in diagnostics.

```
Given: credential-failure.ts pushed to n8n (with intentionally bad/missing creds)
When:  validate(workflowPath, { layer: 'execution' })
Then:
  - Execution: status 'error'
  - Error classification: 'credentials'
  - Error node identified by name
  - Diagnostic summary: status 'fail'
```

### Scenario 04 — Trust Lifecycle

**Proves:** Trust builds on successful validation and narrows scope on re-validation.

```
Given: multi-node-change.ts pushed to n8n
Step 1: validate(workflowPath, { layer: 'static' })
  → Expect: all nodes validated, trust state written
Step 2: trust_status(workflowPath)
  → Expect: all nodes trusted, no changes
Step 3: Edit node B in the workflow file (change a parameter value)
Step 4: trust_status(workflowPath)
  → Expect: node B untrusted, A/C/D still trusted
Step 5: validate(workflowPath)
  → Expect: only node B (and its downstream) validated, not A
```

### Scenario 05 — Guardrail Rerun Refusal

**Proves:** Guardrails detect and refuse low-value reruns.

```
Given: happy-path.ts, already validated in scenario 02 (trust current)
When:  validate(workflowPath, { layer: 'static' })
Then:
  - Guardrail decision: refuse or redirect (identical rerun, all nodes trusted)
  - Diagnostic summary: status 'skipped' with guardrailActions explaining why
When:  explain(workflowPath, { layer: 'static' })
Then:
  - Reports what the guardrail would do and why
  - Does NOT modify trust state
```

### Scenario 06 — Bounded Execution

**Proves:** `destinationNode` slices execution to a subgraph.

```
Given: multi-node-change.ts pushed to n8n, pin data provided for trigger
When:  validate(workflowPath, {
         layer: 'execution',
         target: { kind: 'nodes', nodes: ['B'] },
         destinationNode: 'B',
         destinationMode: 'inclusive',
         pinData: { 'Trigger': [{ json: { input: 'test' } }] }
       })
Then:
  - Only trigger → A → B executed (not C, D)
  - ExecutionResult.partial === true
  - Node B has execution results
  - Nodes C, D have no execution results
```

### Scenario 07 — MCP Tool Round-Trip

**Proves:** MCP server accepts tool calls and returns well-formed responses.

```
Given: n8n-vet MCP server running (stdio transport)
       happy-path.ts and broken-wiring.ts available as files

For each tool [validate, trust_status, explain]:
  When:  Send tool call via MCP SDK client
  Then:
    - Response is valid JSON matching { success: boolean, data|error: ... }
    - validate returns DiagnosticSummary shape
    - trust_status returns trusted/untrusted node lists
    - explain returns guardrail decision + explanation
    - Error cases (missing file) return { success: false, error: { type: 'workflow_not_found' } }
```

### Scenario 08 — Full Pipeline

**Proves:** The complete edit → validate → diagnose cycle works end-to-end.

```
Given: expression-bug.ts pushed to n8n
Step 1: validate(path, { layer: 'static' })
  → Static finds unresolvable expression reference
Step 2: validate(path, { layer: 'execution' })
  → Execution confirms: node outputs null/empty for the bad ref
Step 3: Fix the expression (edit .ts file to correct the ref)
Step 4: validate(path, { layer: 'both' })
  → Static: no findings
  → Execution: pass
  → Trust updated for changed node
Step 5: validate(path) again without changes
  → Guardrail: redirect or refuse (nothing changed)
```

## Shared Test Utilities

### `lib/setup.ts`

Handles prerequisites:
- Verify n8n is reachable (health check `GET /api/v1/workflows`)
- Verify n8nac is available (`n8nac --version`)
- Verify API key is configured
- Create a temporary trust state directory for test isolation
- Return a context object with connection details

```typescript
interface IntegrationContext {
  n8nBaseUrl: string;
  apiKey: string;
  trustDir: string;       // isolated per test run
  fixturesDir: string;    // path to test/integration/fixtures/
  cleanup: () => Promise<void>;
}
```

### `lib/push.ts`

Wraps n8nac push with the known OCC conflict workaround:
1. `n8nac push <file>`
2. If OCC conflict → retry with `--mode keep-current`
3. If second push fails → throw (real error, not OCC)
4. Verify push succeeded by comparing local vs remote hash

### `lib/assertions.ts`

Typed helpers that produce clear failure messages:

```typescript
function assertStatus(summary: DiagnosticSummary, expected: 'pass' | 'fail' | 'error' | 'skipped'): void;
function assertFindingPresent(summary: DiagnosticSummary, classification: ErrorClassification): void;
function assertNoFindings(summary: DiagnosticSummary): void;
function assertTrusted(status: TrustStatusResult, nodeName: string): void;
function assertUntrusted(status: TrustStatusResult, nodeName: string): void;
function assertGuardrailAction(summary: DiagnosticSummary, kind: GuardrailAction['kind']): void;
```

### `lib/mcp-client.ts`

Spawns the n8n-vet MCP server as a child process (stdio transport) and provides a typed client:

```typescript
interface McpTestClient {
  validate(input: ValidateInput): Promise<McpResponse>;
  trustStatus(input: TrustStatusInput): Promise<McpResponse>;
  explain(input: ExplainInput): Promise<McpResponse>;
  close(): Promise<void>;
}
```

Uses `@modelcontextprotocol/sdk` Client class. Connects once, reuses across tool calls within a scenario.

## Test Runner

**Not vitest.** These are not unit tests. They have external dependencies, take real time (execution polling), and modify live n8n state. A simple sequential runner with console output is appropriate. Each scenario is a function that receives `IntegrationContext` and throws on failure.

```typescript
type Scenario = {
  name: string;
  run: (ctx: IntegrationContext) => Promise<void>;
};
```

The runner:
1. Calls `setup()` to get context (fails fast if n8n is unreachable)
2. Pushes all fixtures once (shared setup, OCC handled)
3. Runs scenarios sequentially
4. Reports pass/fail per scenario
5. Calls `cleanup()` (removes trust state dir; does NOT delete workflows from n8n)

## Prerequisites

| Prerequisite | How to verify |
|-------------|---------------|
| n8n instance running | `curl http://localhost:5678/api/v1/workflows` returns 200 |
| n8n API key configured | `N8N_API_KEY` env var or n8nac config |
| n8nac CLI available | `n8nac --version` succeeds |
| n8nac pointed at the n8n instance | `n8nac config` shows correct host |
| Node.js 20+ | `node --version` |
| Project built | `npm run build` succeeds |
| tsx available | `npx tsx --version` (dev dependency) |

**Docker shortcut (optional):** A `docker-compose.yml` that starts n8n with a known API key would eliminate setup friction. Not required for the initial implementation but worth adding later.

## Running

```bash
# --- First time only (or to refresh fixtures) ---

# Seed: create test workflows on n8n, pull as artifacts
npx tsx test/integration/seed.ts

# Commit the pulled artifacts
git add test/integration/fixtures/

# --- Every time ---

# Check prerequisites (n8n reachable, n8nac available)
npx tsx test/integration/run.ts --check

# Build first — integration tests import from built library
npm run build

# Run all scenarios
npx tsx test/integration/run.ts

# Run one scenario
npx tsx test/integration/run.ts --scenario 04

# Verbose (print diagnostic summaries)
npx tsx test/integration/run.ts --verbose
```

On failure: the error message identifies the fixture, expected outcome, and actual outcome. Inspect the workflow on n8n or check execution history with `n8nac execution list`. Re-run a single scenario with `--scenario N --verbose`.

## Fixture Lifecycle

Fixtures follow a two-phase lifecycle:

**Phase A — Seed (run once, or to refresh):**
1. `npx tsx test/integration/seed.ts` creates workflows on n8n via REST API.
2. `n8nac pull` produces `.ts` artifacts with real server IDs and normalized params.
3. Artifacts + manifest are written to `test/integration/fixtures/`.
4. Commit the artifacts. The seed script is now optional until fixtures need refreshing.

**Phase B — Test (run repeatedly):**
1. Runner reads committed fixtures and manifest.
2. Pushes fixtures to n8n (handles OCC conflicts).
3. Runs scenarios against the pushed workflows.
4. Trust state is isolated per run — fresh temp directory, no cross-contamination.

**Re-seeding triggers:**
- n8n version upgrade (node parameter schemas may have changed)
- Adding a new fixture to the catalog
- Investigating a fixture that no longer round-trips cleanly

**File edits are local.** Scenarios that test "edit → re-validate" copy the fixture to a temp directory and modify the copy. The committed fixture is never modified by tests.

## What This Does NOT Cover

- **Performance testing.** This suite proves correctness, not speed.
- **Multi-workflow interactions.** Each scenario tests one workflow at a time.
- **Credential rotation.** The credential-failure scenario uses intentionally bad creds, not real credential lifecycle.
- **Concurrent access.** Scenarios run sequentially. No parallel execution of tools.
- **Plugin integration.** This tests the library and MCP server, not the Claude Code plugin shell. Plugin testing is done manually with `claude --plugin-dir .`.

## Acceptance Criteria

- Seed script creates all 7 fixtures on a live n8n instance and pulls valid `.ts` artifacts
- Seed script is idempotent — re-running updates existing workflows, does not duplicate
- Pulled artifacts compile and pass `n8nac verify`
- Manifest maps fixture names to real workflow IDs
- All 8 scenarios pass against a fresh n8n instance with fixtures pushed
- Scenarios are independent: any single scenario can run in isolation
- Test runner produces clear pass/fail output with scenario names
- Failures include: fixture name, expected outcome, actual outcome, diagnostic summary
- `--check` flag validates prerequisites without running tests
- Trust state is fully isolated between runs (no cross-contamination)
- Fixtures can be re-pushed safely (idempotent via manifest IDs)

## Decisions

1. **Seed script creates via REST, pulls via n8nac.** Not hand-authored. Produces artifacts with real server IDs and server-normalized parameters. Round-trip is proven by construction.
2. **Committed artifacts.** Fixtures are committed to the repo after seeding. Running the seed script is a bootstrapping step, not a test dependency. Tests work offline (against a pre-seeded n8n instance) using committed files.
3. **tsx, not vitest.** Integration tests have live dependencies, real latency, and side effects. They don't belong in the unit test runner. A simple sequential script is appropriate.
4. **Library API, not CLI.** Most scenarios call n8n-vet's TypeScript API directly. Only scenario 07 tests the MCP surface. This gives precise programmatic assertions rather than parsing CLI output.
5. **No auto-cleanup of remote workflows.** Fixtures persist on n8n. Simpler, and useful for manual debugging. Stable IDs prevent duplication.
6. **OCC handling in push utility.** The OCC conflict on every second push is a known n8nac issue. The test utility handles it so scenarios don't need to care.
7. **No Docker requirement.** The suite assumes a running n8n instance but doesn't mandate how it's run. Docker compose is a convenience, not a dependency.
