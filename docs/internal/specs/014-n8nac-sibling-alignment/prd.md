# Phase 14 — n8nac Sibling Alignment

## Problem

n8n-vet was designed and documented as if it might wrap or subsume n8nac functionality. In practice, n8n-vet and n8nac are **sibling tools** orchestrated by the same agent. n8nac handles authoring and sync; n8n-vet handles validation. The only real dependency is the `@n8n-as-code/transformer` package for parsing `.ts` workflow files.

Three issues need correction:

1. **JSON parser is dead code.** `parseJsonFile()` in `graph.ts` handles `.json` n8n exports, but there is no non-n8nac use case. The canonical local format is `.ts`. n8nac `pull` produces `.ts` files. No path in the agent workflow produces a local `.json` file for n8n-vet to consume.

2. **workflowId conflation (bug).** `deriveWorkflowId()` returns a project-relative file path (e.g., `workflows/my-flow.ts`). This ID is used for trust state persistence (correct) and snapshot storage (correct), but it is also passed directly to `executeSmoke()` → MCP `test_workflow`, which expects an **n8n numeric/UUID workflow ID** (e.g., `"abc123-..."`). These are different values. Execution-layer calls will fail at runtime. The fix: extract the n8n workflow ID from `WorkflowAST.metadata.id` (populated by the `@workflow({ id: '...' })` decorator) and use that for MCP calls, while keeping the file-path-based ID for local persistence.

3. **Skill doesn't explain two-phase validation.** n8n-vet validates at two distinct points in the agent workflow: static analysis runs **before** `n8nac push` (local, cheap, no n8n instance needed), and execution validation runs **after** push (requires the workflow to be deployed on n8n). The skill file should make this explicit so the agent calls the right layer at the right time.

## Context files

| File | Role |
|------|------|
| `src/static-analysis/graph.ts` | `parseWorkflowFile()`, `parseJsonFile()`, `parseTypeScriptFile()` |
| `src/orchestrator/types.ts` | `deriveWorkflowId()` — file-path-based derivation |
| `src/orchestrator/interpret.ts` | Orchestration pipeline — passes `workflowId` to execution |
| `src/execution/mcp-client.ts` | `executeSmoke()`, `getExecution()` — sends `workflowId` to n8n MCP |
| `src/types/graph.ts` | `WorkflowGraph` — carries `ast: WorkflowAST` |
| `skills/validate-workflow/SKILL.md` | Agent-facing skill documentation |
| `node_modules/@n8n-as-code/transformer/dist/types.d.ts` | `WorkflowAST.metadata.id` — the n8n UUID |
| `docs/research/n8n_platform_capabilities.md` | MCP `test_workflow` expects n8n `workflowId` string |
| `docs/research/n8nac_capabilities.md` | n8nac `@workflow({ id })` decorator metadata |

## Scope

### B1. Remove JSON parser

Remove `parseJsonFile()` and the `.json` branch from `parseWorkflowFile()`. Only `.ts` files are supported. Attempting to parse a `.json` file should throw `MalformedWorkflowError` with a message directing to n8nac.

**Files changed:**
- `src/static-analysis/graph.ts` — remove `parseJsonFile()`, update `parseWorkflowFile()` to reject non-`.ts`
- Tests referencing JSON parsing — remove or update

### B2. Fix workflowId conflation

Introduce two distinct ID concepts:

| ID | Source | Used for |
|----|--------|----------|
| `workflowFileId` | `deriveWorkflowId(path)` — project-relative file path | Trust state key, snapshot key, pin data cache key |
| `n8nWorkflowId` | `WorkflowAST.metadata.id` — from `@workflow` decorator | MCP `test_workflow`, `get_execution`, `prepare_test_pin_data` |

**Changes:**

1. **`src/orchestrator/interpret.ts`** — After parsing the AST, extract `ast.metadata.id` as the n8n workflow ID. Pass this to execution calls instead of the file-path ID. Add a validation check: if `ast.metadata.id` is missing/empty and `layer` includes execution, return an error diagnostic (`"Workflow file missing metadata.id — cannot execute. Run n8nac push first to assign an n8n ID."`).

2. **`src/execution/mcp-client.ts`** — No API change needed. `workflowId` parameter already accepts a string; callers just need to pass the right value.

3. **`src/orchestrator/types.ts`** — `deriveWorkflowId()` remains as-is for persistence. Add a comment clarifying it is for local storage only, not for n8n API calls.

4. **Trust and snapshot persistence** — No change. These correctly use the file-path ID, which is stable across n8n instance changes.

### S1. Update skill for two-phase validation

Rewrite `skills/validate-workflow/SKILL.md` to clearly describe:

1. **Static validation (before push):** Agent edits `.ts` file → calls `validate` with `layer: 'static'` → n8n-vet parses the local file, runs static analysis (expression tracing, data-loss detection, schema/param validation) → returns diagnostic. No n8n instance required. This is the first gate — catch wiring errors before spending time on push + execution.

2. **Push (n8nac, not n8n-vet):** Agent calls `n8nac push` to deploy the workflow to n8n. This is n8nac's responsibility, not n8n-vet's.

3. **Execution validation (after push):** Agent calls `validate` with `layer: 'execution'` or `layer: 'both'` → n8n-vet uses the same local file for static analysis AND calls MCP `test_workflow` using the n8n workflow ID from `@workflow({ id })` metadata → returns diagnostic with runtime evidence.

The skill should also explain the persistence model: trust state and snapshots survive across calls, so the second validation benefits from the first (static trust is already recorded, change set is empty).

### D1. Doc corrections

The documentation currently describes n8nac as a wrapped dependency with three integration points (transformer, skills, ConfigService). Only the transformer is real. This creates confusion about what n8n-vet is, how it relates to n8nac, and what an operator needs to set up.

Update documentation to be unambiguous:

**`docs/DESIGN.md`:**
- Replace the architecture diagram's n8nac dependency box with a sibling-tool diagram: agent orchestrates both n8nac (authoring/sync) and n8n-vet (validation) independently
- Remove the "n8nac (dependency, always available)" section claiming transformer + skills + ConfigService
- Add a clear section: "Relationship to n8nac" — sibling tools, only shared artifact is the `.ts` workflow file, only package dependency is `@n8n-as-code/transformer` for parsing

**`docs/TECH.md`:**
- Remove `@n8n-as-code/skills` from locked technology decisions (never integrated)
- Remove ConfigService references
- Clarify that `@n8n-as-code/transformer` is used exclusively for `.ts` file parsing, not for any runtime operations

**`docs/prd/PLAN.md`:**
- Update phase descriptions that reference n8nac integration to reflect sibling model
- Remove any milestones referencing skills package wiring or ConfigService integration

**`docs/SCOPE.md`:**
- Add explicit non-goal: "n8n-vet does not wrap, proxy, or orchestrate n8nac. The agent coordinates both tools independently."
- Clarify that workflow push/pull/sync is n8nac's domain, not n8n-vet's

**`docs/CONCEPTS.md`:**
- If it references n8nac as a dependency, correct to sibling
- Ensure the two-phase validation concept (static before push, execution after push) is defined here as shared vocabulary

### D2. Setup documentation

There is no clear setup guide. The README shows MCP config and CLI usage but not the prerequisite steps. A developer or agent operator cloning the repo for the first time needs to know:

1. **Prerequisites:** Node >= 20, a running n8n instance, n8nac installed and configured (it's a sibling, not bundled)
2. **Environment:** `N8N_HOST` and `N8N_API_KEY` env vars for execution-layer validation. `.env.example` exists but isn't referenced from the README.
3. **n8nac setup:** Transformer must be importable. For plugin distribution this is handled by `npm install` (transformer is a registry dependency). For development, `npm install` in the repo root is sufficient.
4. **Two-phase awareness:** Static validation works immediately on any `.ts` file. Execution validation requires the workflow to be pushed to n8n first (`n8nac push`).

**Changes:**

**`README.md`:**
- Add a "Prerequisites" section before Quick Start: Node >= 20, n8n instance (for execution), n8nac (for workflow authoring/push)
- Add a "Setup" section: clone, `npm install`, `npm run build`, copy `.env.example` → `.env`, fill in credentials
- Update "Built on" section: describe n8nac as a sibling tool (agent uses both), not a dependency
- Fix the pipeline description: "TypeScript or JSON via n8n-as-code" → "TypeScript via n8n-as-code" (after B1)
- Reference `.env.example` for credential configuration

**`.env.example`:**
- Verify it exists and documents all required/optional env vars: `N8N_HOST`, `N8N_API_KEY`, `N8N_VET_DATA_DIR` (optional)

### P1. Fresh-clone provisions

A clean `git clone` → `npm install` → `npm run build` → `npm test` must succeed without any external setup beyond Node >= 20. This is already close to working (the `file:` dependency was replaced with registry versions), but needs verification and any remaining fixes.

**Checks and fixes:**

1. **`package.json` dependencies** — Verify all dependencies resolve from npm registry. No `file:` or `link:` references. Current state: `@n8n-as-code/transformer@^1.2.0` (registry) ✓, `@n8n-as-code/skills@^1.9.0` (optional, registry) — should be removed entirely after confirming it's unused (see D1).

2. **`@n8n-as-code/skills` removal from `package.json`** — It's in `optionalDependencies` but never imported. Remove it. This eliminates a confusing install-time message and aligns with the sibling model.

3. **Build pipeline** — `npm run build` (tsc) must complete with zero errors on a fresh clone. No implicit dependency on prior state.

4. **Test pipeline** — `npm test` must pass with zero errors on a fresh clone. Tests that require an n8n instance (integration tests) are separate (`npm run test:integration`) and documented as requiring setup.

5. **`.gitignore`** — Verify `.n8n-vet/` (trust state, snapshots, pin data cache) and `.env` are gitignored. `.env.example` is committed.

6. **`hooks/hooks.json`** — Verify the SessionStart hook works when `CLAUDE_PLUGIN_DATA` is empty (first run). Current implementation handles this (diffs against missing file, runs install).

## Dependencies

- Phase 12 (committed) — MCP-only execution backend is assumed
- No external dependencies

## Order of operations

1. **B1** (JSON parser removal) — no dependencies, standalone
2. **B2** (workflowId fix) — no dependencies, standalone
3. **P1** (fresh-clone provisions) — includes removing skills from package.json
4. **D1** (doc corrections) — can reference B1/B2/P1 changes as evidence
5. **D2** (setup documentation) — depends on D1 for correct sibling framing
6. **S1** (skill rewrite) — should be written last, after code and docs reflect the correct model

## Verification

### B1 verification
- `parseWorkflowFile('foo.json')` throws `MalformedWorkflowError`
- `parseWorkflowFile('foo.ts')` works as before
- No `.json` parsing code remains in `graph.ts`

### B2 verification
- `executeSmoke` receives `ast.metadata.id` (UUID), not a file path
- Trust state is still keyed by file path
- Missing `metadata.id` + execution layer → error diagnostic with clear message
- Existing tests that mock `executeSmoke` pass the correct ID type

### S1 verification
- Skill file explains static (before push) and execution (after push) as distinct phases
- Skill file mentions `n8nac push` as the agent's responsibility between phases
- Skill file describes trust persistence across calls

### D1 verification
- `docs/DESIGN.md` describes n8nac as a sibling tool, not a dependency
- No mention of `@n8n-as-code/skills` as an integrated or planned dependency in any doc
- No mention of ConfigService in any doc
- `docs/SCOPE.md` explicitly lists n8nac wrapping as a non-goal
- `docs/CONCEPTS.md` defines two-phase validation (static before push, execution after push)
- Grep for `skills.*integration|ConfigService|n8nac.*dependency` across `docs/` returns zero false claims

### D2 verification
- README has a Prerequisites section listing Node >= 20, n8n instance, n8nac as sibling
- README has a Setup section with clone → install → build → env steps
- README no longer says "TypeScript or JSON"
- `.env.example` exists and documents all env vars

### P1 verification
- `git clone <url> && cd n8n-vet && npm install && npm run build && npm test` succeeds on a clean machine with Node >= 20
- No `file:` or `link:` references in `package.json`
- `@n8n-as-code/skills` is not in `package.json` (neither dependencies nor optionalDependencies)
- `.n8n-vet/` and `.env` are in `.gitignore`
- `npm run test:integration` is documented as requiring a running n8n instance

## Success criteria

1. Zero `.json` parsing code in `src/`
2. MCP execution calls use `WorkflowAST.metadata.id`, not file paths
3. Skill clearly describes the two-phase validation flow
4. Documentation unambiguously describes n8nac as a sibling tool with transformer as the only package dependency
5. README has clear setup instructions for fresh clone
6. Fresh `git clone` → `npm install` → `npm run build` → `npm test` passes with zero errors
7. `@n8n-as-code/skills` removed from `package.json`
8. `npm run typecheck && npm test && npm run lint` all pass at zero errors
