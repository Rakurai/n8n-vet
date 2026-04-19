# Implementation Plan

This plan implements the strategic principles, named patterns, and locked heuristics defined in `STRATEGY.md`, through the architecture described in `DESIGN.md`.

## Dependency tree

The subsystem dependency graph is acyclic. Static Analysis is the only leaf node. Request Interpretation is the orchestration hub. MCP Surface is the outermost shell.

```
Shared types (INDEX.md → src/types/)
│
└─ Static Analysis                         ← leaf, no internal deps
     │
     ├─ Trust & Change                     ← depends on WorkflowGraph
     │    │
     │    └─ Guardrails                    ← depends on TrustState, NodeChangeSet, WorkflowGraph
     │
     ├─ Execution                          ← depends on WorkflowGraph, trusted boundaries
     │
     └─ Diagnostics                        ← consumes types from all above; no runtime calls
          │
          └─ Request Interpretation        ← orchestrates all subsystems
               │
               └─ MCP Surface + CLI        ← thin interface layers
                    │
                    └─ Plugin wrapper       ← bundles MCP server, skills, hooks
```

**Reads bottom-up:** you cannot build a subsystem until everything it depends on exists. Siblings at the same level are independent: Trust & Change, Execution, and Diagnostics can all be built in parallel once Static Analysis exists. Guardrails depends on Trust & Change. Diagnostics receives output as arguments (no runtime calls to other subsystems), so it can be built and tested with fixture data as soon as the shared types are stable.

---

## Phases

Each phase (2–9) has a dedicated PRD in `docs/prd/` that is the single source of truth for that phase's scope, behavior, and acceptance criteria. The PRD is what the spec-writing agent works from. Original subsystem specs are preserved in `docs/reference/` as background material.

### Phase 0 — Project scaffolding

**Goal:** Runnable TypeScript project with no product code.

**Context files:**
- `docs/TECH.md` — locked technology decisions (TypeScript, Node.js, vitest, ESM)
- `docs/spec/PLAN.md` — directory structure and external dependencies table
- `docs/CODING.md` — TypeScript rules
- `.specify/memory/constitution.md` — engineering principles

**Work:**
- `package.json` with name, version, TypeScript/Node.js setup
- `tsconfig.json` — strict mode, ES modules, Node 20+ target
- Directory structure:

```
src/
  types/             ← shared types from INDEX.md
  static-analysis/   ← graph, expressions, node classification
  trust/             ← change detection, trust state, persistence
  guardrails/        ← evaluation, actions, evidence
  execution/         ← REST client, MCP client, pin data, polling
  diagnostics/       ← synthesis, error classification, annotations
  orchestrator/      ← request interpretation, routing
  mcp/               ← MCP server, tool registration
  cli/               ← CLI entry point, argument parsing, formatting
.claude-plugin/
  plugin.json        ← plugin manifest (name, version, userConfig)
skills/
  validate-workflow/
    SKILL.md         ← teaches agent when/how to use n8n-vet tools
hooks/
  hooks.json         ← SessionStart: install deps into CLAUDE_PLUGIN_DATA
.mcp.json            ← bundles MCP server for plugin auto-start
```

- Install external dependencies (see External Dependencies below)
- Test runner setup (vitest — fast, native TypeScript, ESM-friendly)
- Lint/format setup (biome or eslint+prettier — match n8nac conventions if possible)

**Deliverable:** `npm run build` succeeds, `npm test` runs (zero tests).

**Test:** Build passes, empty test suite passes.

---

### Phase 1 — Shared types

**Goal:** All cross-subsystem types from INDEX.md exist as TypeScript source, importable by every subsystem.

**Context files:**
- `docs/reference/INDEX.md` — canonical type definitions to transcribe (primary source)
- `docs/STRATEGY.md` — rationale behind type design decisions
- `docs/CODING.md` — TypeScript rules
- `.specify/memory/constitution.md` — engineering principles

**Work:**

1. **Shared types** (`src/types/`):
   - Transcribe all INDEX.md types into TypeScript source files
   - `WorkflowGraph`, `GraphNode`, `Edge`, `NodeIdentity`, `NodeClassification`
   - `SliceDefinition`, `PathDefinition`, `AgentTarget`, `ValidationTarget`, `ValidationLayer`
   - `TrustState`, `NodeTrustRecord`, `NodeChangeSet`, `NodeModification`, `ChangeKind`
   - `GuardrailDecision`, `GuardrailAction`, `GuardrailEvidence`
   - `DiagnosticSummary` and all sub-types
   - `ExecutionErrorDataBase`, `ExecutionErrorData` (discriminated union with `contextKind`)

**Deliverable:** All shared types compile. No runtime code yet.

**Test:** Build passes. Type-level tests (type assertions) confirm discriminated unions narrow correctly.

---

### Phase 2 — Static Analysis

**Goal:** Parse a workflow file and produce a `WorkflowGraph` with expression references, node classifications, and static findings.

**PRD:** [`docs/prd/phase-2-static-analysis.md`](../prd/phase-2-static-analysis.md)

**Work:**

1. **Graph construction** (`src/static-analysis/graph.ts`):
   - `buildGraph(ast: WorkflowAST): WorkflowGraph`
   - Node map from `NodeAST[]`, edge list from `ConnectionAST[]`
   - Forward and backward adjacency maps
   - Invariant checks: referenced nodes exist, names are unique

2. **Node classification** (`src/static-analysis/classify.ts`):
   - Shape-preserving set (If, Switch, Merge, NoOp, Filter, Sort, Limit, etc.)
   - Shape-replacing detection (credentials, httpRequest, triggers)
   - Shape-opaque set (Code, Function, FunctionItem, AI Transform)
   - Shape-augmenting for Set node (inspect `options.include`)

3. **Expression tracing** (`src/static-analysis/expressions.ts`):
   - Walk all parameter values recursively, find `={{ }}` patterns
   - Parse `$json.field`, `$('NodeName')...json.field`, `$input...`, `$node["Name"]...`
   - Record `ExpressionReference[]` with resolution status
   - **Key decision from spec:** port the ~200 lines from n8n's `extractReferencesInNodeExpressions()` rather than depending on `n8n-workflow`

4. **Data-loss detection** (`src/static-analysis/data-loss.ts`):
   - For each `$json.field` reference: walk upstream through shape-preserving nodes
   - If an intervening shape-replacing node is found (not a first data source): flag `data-loss`
   - First data source rule: triggers and initial API/credentialed nodes are not intervening

5. **Schema checking** (`src/static-analysis/schemas.ts`):
   - When output schemas are available via n8nac skills: check field existence
   - When not available: skip this check for that node (per-node, not per-run)

6. **Node parameter validation** (`src/static-analysis/params.ts`):
   - Validate parameters against n8nac skills type definitions
   - Check for missing required parameters, undefined credential types

**Deliverable:** Given a `.ts` or `.json` workflow file, produce a `WorkflowGraph` and `StaticFinding[]`.

**Test:** Unit tests with fixture workflow files (both TypeScript and JSON formats). Test each analysis capability independently. No n8n instance required.

**External dependency integration point:** This phase requires `@n8n-as-code/transformer` for parsing and `@n8n-as-code/skills` for schema validation. Both are required dependencies — if either is absent at initialization, raise a typed configuration error.

---

### Phase 3 — Trust & Change

**Goal:** Detect changes between workflow versions and maintain per-node trust records.

**PRD:** [`docs/prd/phase-3-trust-and-change.md`](../prd/phase-3-trust-and-change.md)

**Work:**

1. **Content hashing** (`src/trust/hash.ts`):
   - SHA-256 hash over canonically serialized trust-relevant properties
   - Include: `type`, `typeVersion`, `parameters`, `credentials`, execution settings (`disabled`, `retryOnFail`, `executeOnce`, `onError`)
   - Exclude: `position`, `name`, `notes`, `id`

2. **Change detection** (`src/trust/change.ts`):
   - `computeChangeSet(previous: WorkflowGraph, current: WorkflowGraph): NodeChangeSet`
   - Index by node name, compute added/removed/modified/unchanged
   - Classify modifications: parameter, expression, type-version, credential, execution-setting, connection
   - Rename detection: removed+added pair with identical content hash → rename

3. **Trust derivation and invalidation** (`src/trust/trust.ts`):
   - `recordValidation()` — create trust records from validation results
   - `invalidateTrust()` — forward-only propagation through downstream nodes
   - Trust queries: `isTrusted()`, `getTrustedBoundaries()`, `getUntrustedNodes()`, `getRerunAssessment()`

4. **Persistence** (`src/trust/persistence.ts`):
   - Read/write `.n8n-vet/trust-state.json`
   - Handle missing/corrupt file (start with empty trust)
   - Workflow-level quick check: compare full workflow hash before node-level diff

**Deliverable:** Given two workflow graphs, produce a `NodeChangeSet`. Given a change set and existing trust, produce an updated `TrustState`.

**Test:** Unit tests with graph fixtures. Test hash stability, change classification, invalidation propagation, rename detection, persistence round-trip. No n8n instance required.

---

### Phase 4 — Guardrails

**Goal:** Evaluate a validation request and decide: proceed, warn, narrow, redirect, or refuse.

**PRD:** [`docs/prd/phase-4-guardrails.md`](../prd/phase-4-guardrails.md)

**Work:**

1. **Evaluation pipeline** (`src/guardrails/evaluate.ts`):
   - Two-tier evaluation: precondition checks (force, empty target, identical rerun) then guardrail actions following STRATEGY.md order (redirect → narrow → warn → refuse)
   - `evaluate(request, trustState, changeSet): GuardrailDecision`

2. **Narrowing** (`src/guardrails/narrow.ts`):
   - When target is `workflow` and only a subset of nodes changed: narrow to changed nodes + downstream
   - Threshold: 5-node minimum for narrowing
   - Change ratio: narrow when <20% of nodes changed

3. **Redirect** (`src/guardrails/redirect.ts`):
   - When execution is requested but static analysis would suffice: redirect to static-only
   - Expanded conditions from STRATEGY.md escalation heuristic: check node classification, sub-workflow boundaries, LLM validation requests

4. **DeFlaker-style rerun check** (`src/guardrails/rerun.ts`):
   - When a prior run failed and the failing path did not touch the changed slice: warn that the rerun may be low-value
   - Breadth warning: flag when target covers >70% of workflow nodes

5. **Evidence** (`src/guardrails/evidence.ts`):
   - Assemble `GuardrailEvidence` for each decision
   - Include trust coverage, change ratio, scope breadth, rerun assessment

**Deliverable:** Given a `ValidationRequest`, `TrustState`, and `NodeChangeSet`, produce a `GuardrailDecision`.

**Test:** Unit tests with various request shapes and trust states. Test the evaluation order pipeline with scenarios that exercise each guardrail rule in context. Avoid testing each rule independently if the pipeline tests already cover it — each test must verify a distinct behavior not covered by another test. No n8n instance required.

---

### Phase 5 — Execution

**Goal:** Execute workflows (or subgraphs) against a running n8n instance and retrieve per-node results.

**PRD:** [`docs/prd/phase-5-execution.md`](../prd/phase-5-execution.md)

**Work:**

1. **Pin data construction** (`src/execution/pin-data.ts`):
   - Four-tier sourcing: agent fixtures → cached artifacts → execution history inference → error (no empty stubs — raise identifying which nodes need pin data)
   - `constructPinData(graph, trustedBoundaries): PinData`
   - `normalizePinData()` for flat objects missing `json` wrapper

2. **REST API client** (`src/execution/rest-client.ts`):
   - `POST /workflows/:id/run` — fresh bounded execution with `destinationNode`
   - `GET /executions/:id` — result retrieval with `nodeNames` filtering and `truncateData`
   - Authentication from n8nac config cascade

3. **MCP client** (`src/execution/mcp-client.ts`):
   - `test_workflow` for whole-workflow smoke tests
   - `get_execution` for result retrieval
   - `prepare_test_pin_data` for schema-based pin data
   - MCP provides supplementary operations (`test_workflow`, `prepare_test_pin_data`); REST API is the required execution surface

4. **Polling and timeout** (`src/execution/poll.ts`):
   - Exponential backoff: 1s, 2s, 4s, 8s, up to 15s intervals (tunable constants)
   - 5-minute timeout (tunable, should match MCP transport timeout)
   - Status check via metadata-only `get_execution`

5. **Result extraction** (`src/execution/results.ts`):
   - Transform raw execution data into `ExecutionData`
   - Per-node `NodeExecutionResult[]` with status, timing, errors, hints, source info
   - Do NOT extract raw output data (large, not needed for diagnostics)

6. **Capability detection** (`src/execution/capabilities.ts`):
   - Probe n8n instance reachability, API auth, MCP availability
   - Report capability level: full, REST-only, static-only
   - Workflow existence check (report stale/missing as precondition failure)

**Deliverable:** Given a workflow ID, destination node, and pin data, execute against n8n and return `ExecutionData`.

**Test:** Unit tests for pin data construction, result extraction, and polling logic (mock HTTP). Integration tests require a running n8n instance — these should be opt-in, not part of the default test suite. Gate behind an env var like `N8N_TEST_HOST`.

---

### Phase 6 — Diagnostics

**Goal:** Synthesize all evidence into a `DiagnosticSummary`.

**PRD:** [`docs/prd/phase-6-diagnostics.md`](../prd/phase-6-diagnostics.md)

**Work:**

1. **Status determination** (`src/diagnostics/status.ts`):
   - `pass`: no errors in any evidence source
   - `fail`: at least one error-severity finding or execution error
   - `error`: tool/infrastructure failure
   - `skipped`: guardrail refused or no target resolved

2. **Error extraction and classification** (`src/diagnostics/errors.ts`):
   - Map static findings to `DiagnosticError[]`
   - Map execution errors to `DiagnosticError[]`
   - Classify: wiring, expression, credentials, external-service, platform, cancelled, unknown

3. **Node annotations** (`src/diagnostics/annotations.ts`):
   - Annotate each node in scope: validated, trusted, mocked, skipped
   - Include per-node status, execution timing, hints

4. **Path reconstruction** (`src/diagnostics/path.ts`):
   - Build executed path from execution source data
   - Include execution order index, node classification, annotation

5. **Synthesis** (`src/diagnostics/synthesize.ts`):
   - `synthesize(staticFindings, executionData, trustState, guardrailDecisions, resolvedTarget): DiagnosticSummary`
   - Assemble all sub-components into the canonical output
   - Apply compact representation: target count limits, truncated error messages

**Deliverable:** Given evidence from all subsystems, produce a complete `DiagnosticSummary`.

**Test:** Unit tests with fixture evidence data. Test status determination, error classification, annotation generation. No n8n instance required.

---

### Phase 7 — Request Interpretation

**Goal:** The orchestrator that takes a `ValidationRequest` and coordinates all subsystems to produce a `DiagnosticSummary`.

**PRD:** [`docs/prd/phase-7-request-interpretation.md`](../prd/phase-7-request-interpretation.md)

**Work:**

1. **Target resolution** (`src/orchestrator/resolve.ts`):
   - `nodes` → compute slice from named nodes + upstream/downstream
   - `changed` → load previous snapshot, compute change set, build slice from changed nodes
   - `workflow` → target all nodes (guardrails will likely narrow)

2. **Path selection** (`src/orchestrator/path.ts`):
   - Slice → enumerate possible paths → score → select using additional-greedy prioritization
   - Tiered lexicographic preference per spec: (1) prefer non-error paths, (2) prefer output-index-0 on branching nodes, (3) break ties by changed-node coverage, (4) break ties by untrusted-boundary coverage
   - Multi-path: additional-greedy — select best, update covered elements, repeat if justified

3. **Orchestration pipeline** (`src/orchestrator/interpret.ts`):
   - 10-step pipeline from spec:
     1. Parse and load workflow via n8nac transformer
     2. Build graph via static analysis
     3. Load trust state
     4. Compute change set (if previous snapshot available)
     5. Resolve target into concrete nodes
     6. Consult guardrails
     7. Run static analysis on resolved target
     8. If execution requested and not redirected: construct pin data, execute, retrieve results
     9. Synthesize diagnostic summary
     10. Update trust state, save snapshot

4. **Snapshot management** (`src/orchestrator/snapshots.ts`):
   - Save current graph after each successful validation
   - Load previous snapshot for change detection
   - Store in `.n8n-vet/` alongside trust state

**Deliverable:** Given a `ValidationRequest`, produce a `DiagnosticSummary` by coordinating all subsystems.

**Test:** Integration tests that wire all subsystems together. Test with static-only requests (no n8n needed) and mock the execution subsystem for execution-backed tests.

---

### Phase 8 — MCP Surface + CLI

**Goal:** Agent-facing MCP server and developer-facing CLI.

**PRD:** [`docs/prd/phase-8-mcp-surface.md`](../prd/phase-8-mcp-surface.md)

**Work:**

1. **MCP server** (`src/mcp/server.ts`):
   - Register 3 tools: `validate`, `trust_status`, `explain`
   - Input validation per JSON schemas from mcp-surface.md spec
   - Response envelope: `{ success: true, data }` or `{ success: false, error }`
   - Delegate to request interpretation for `validate`
   - Direct trust queries for `trust_status`
   - Dry-run guardrail evaluation for `explain`

2. **CLI** (`src/cli/index.ts`):
   - Commands: `n8n-vet validate`, `n8n-vet trust`, `n8n-vet explain`
   - Options mirror MCP tool inputs
   - `--json` outputs raw JSON (identical to MCP output)
   - Default output: human-readable formatted summary with color-coded status

**Deliverable:** A running MCP server that agents can call, and a CLI for development/debugging.

**Test:** MCP tool invocation tests (mock the orchestrator). CLI integration tests. End-to-end test with a real workflow file.

---

### Phase 9 — Plugin wrapper

**Goal:** Claude Code plugin that bundles the MCP server and provides skills, hooks, and user configuration.

**PRD:** [`docs/prd/phase-9-plugin-wrapper.md`](../prd/phase-9-plugin-wrapper.md)

**Work:**

1. **Plugin manifest** (`.claude-plugin/plugin.json`):
   - `name`: `n8n-vet`
   - `version`: synced with `package.json`
   - `userConfig`: `n8n_host` (non-sensitive), `n8n_api_key` (sensitive — stored in keychain)
   - `description`, `author`, `repository`, `keywords`

2. **MCP server config** (`.mcp.json`):
   - stdio transport: `node ${CLAUDE_PLUGIN_ROOT}/dist/mcp/serve.js`
   - Pass `N8N_HOST` and `N8N_API_KEY` from `userConfig` via env

3. **Dependency installation hook** (`hooks/hooks.json`):
   - `SessionStart` hook: diff `package.json` against `${CLAUDE_PLUGIN_DATA}/package.json`, run `npm install` into `${CLAUDE_PLUGIN_DATA}` if changed
   - MCP server uses `NODE_PATH=${CLAUDE_PLUGIN_DATA}/node_modules` for runtime deps

4. **Validation skill** (`skills/validate-workflow/SKILL.md`):
   - Teaches the agent when and how to call `validate`, `trust_status`, `explain`
   - Encodes the product's validation philosophy: bounded targets, static-first, trust reuse
   - Guides common patterns: "I changed X, validate it", "run a smoke test", "check trust"

5. **Trust state storage**:
   - When running as plugin: trust state stored in `${CLAUDE_PLUGIN_DATA}/trust/`
   - When running standalone: trust state stored in `.n8n-vet/` in project root
   - MCP server detects environment via `CLAUDE_PLUGIN_DATA` env var presence

6. **CLI binary** (`bin/n8n-vet`):
   - Symlink or wrapper that invokes `dist/cli/index.js`
   - Available as bare command in Claude Code's Bash tool when plugin is active

**Deliverable:** `claude --plugin-dir .` loads the plugin, MCP tools appear, skills are discoverable.

**Test:** Plugin loads without errors. MCP tools respond. Skill appears in `/help`. `SessionStart` hook installs deps. Trust state persists in `${CLAUDE_PLUGIN_DATA}`. Standalone `npx n8n-vet` still works.

---

## External dependencies

| Package | Used by | Purpose | Risk |
|---------|---------|---------|------|
| `@n8n-as-code/transformer` | Static Analysis | Parse `.ts`/`.json` workflows into AST | Core dependency — without it, nothing works. Pin version. |
| `@n8n-as-code/skills` | Static Analysis, Execution | Node type schemas, output schema discovery | Required — core static analysis depends on it. Pin version. |
| n8nac `ConfigService` | Execution | n8n host/credential resolution | Import or replicate config cascade logic. |
| `@modelcontextprotocol/sdk` | MCP Surface | MCP server framework | Standard SDK. Low risk. |
| `vitest` | All | Test runner | Dev dependency only. |
| n8n REST API | Execution | Bounded execution, result retrieval | External service. Version-pin tested API endpoints. |
| n8n MCP tools | Execution | Whole-workflow smoke tests | Supplementary — MCP-specific operations are unavailable when MCP is not accessible. REST is the required surface. |

**Expression parser:** Port ~200 lines from n8n's `extractReferencesInNodeExpressions()` in `node-reference-parser-utils.ts`. Do not depend on the full `n8n-workflow` package — it pulls in heavy transitive dependencies.

---

## Testing strategy

| Phase | Unit tests | Integration tests | n8n required |
|-------|-----------|-------------------|-------------|
| 0 | — | Build passes | No |
| 1 | — | Type assertions compile | No |
| 2 | Graph construction, classification, expression parsing, data-loss detection | Parse real workflow fixtures | No |
| 3 | Hashing, change detection, trust propagation, persistence | Round-trip trust state to disk | No |
| 4 | Each guardrail rule, evaluation order | Full evaluation with realistic scenarios | No |
| 5 | Pin data construction, result extraction, polling | REST/MCP calls against n8n | **Yes** (opt-in) |
| 6 | Status determination, error classification, annotations | Full synthesis from fixture data | No |
| 7 | Target resolution, path selection | Full pipeline (static-only) | No |
| 8 | MCP tool registration, CLI parsing | End-to-end validation | Partial |

**Test fixtures:** Create a `test/fixtures/` directory with representative workflow files:
- Simple linear workflow (trigger → API → Set → output)
- Branching workflow (If/Switch with multiple paths)
- Workflow with data-loss bug pattern
- Workflow with Code node (opaque boundary)
- Workflow with explicit `$('NodeName')` references

---

## Parallel work opportunities

Some phases can overlap:

- **Phase 3 (Trust & Change), Phase 4 (Guardrails after Trust), Phase 5 (Execution), and Phase 6 (Diagnostics)** — Trust, Execution, and Diagnostics are independent siblings that can start once Phase 2 is done. Guardrails must wait for Trust. All four can overlap.
- **Phase 8 (MCP/CLI)** surface work can start early using stub implementations of the orchestrator.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `@n8n-as-code/transformer` API changes | Blocks Phase 2 | Pin version, isolate behind an adapter layer |
| Expression parser edge cases | False positives/negatives in data-loss detection | Port from n8n source, test against real workflow corpus |
| n8n REST API changes | Breaks execution | Use n8n's v1 API (stable, no deprecation markers), version-pin |
| MCP `availableInMCP` stripped by n8nac push | MCP smoke tests unavailable | MCP-specific operations are unavailable for that run; bounded execution via REST is unaffected |
| Shape-preserving set goes stale | Reduced analysis coverage for new node types | Conservative default (unknown → opaque), maintain set as config |
| Trust state file corruption | Lose trust history | Start with empty trust (safe degradation, spec defines this) |

---

## Definition of done

The system is shippable when:

1. `n8n-vet validate <workflow.ts>` produces a correct `DiagnosticSummary` for static analysis
2. `n8n-vet validate <workflow.ts> --layer both` executes against n8n and includes execution evidence
3. Trust state persists across runs — second validation of an unchanged workflow reuses trust
4. Guardrails narrow a `workflow`-scoped request to the changed slice
5. MCP server registers 3 tools and responds correctly to agent calls
6. Data-loss detection catches the canonical bug pattern (shape-replacing node between data source and `$json.field` consumer) without false-flagging trigger output
