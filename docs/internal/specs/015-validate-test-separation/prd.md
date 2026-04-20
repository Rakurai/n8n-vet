# Phase 15 — Validate / Test Separation

## Problem

The current tool surface exposes a single `validate` tool with a `layer` parameter (`static`, `execution`, `both`) that conflates two fundamentally different operations:

1. **Validation** — pure, local, read-only structural analysis of a workflow file. No n8n instance. No side effects. Milliseconds.
2. **Testing** — execution of a deployed workflow on a live n8n instance. Side effects. Seconds. Real resource cost.

These are not two modes of the same operation. They are different operations with different inputs, different prerequisites, different costs, different timing, and different side effects. Combining them behind a shared tool name with a modal parameter undermines the strategic architecture that the entire project was designed to enforce.

---

## Why this matters

The project's strategic thesis (`STRATEGY.md`) is:

> **Run less, but select and explain better.**

The project's vision (`VISION.md`) is explicit:

> execution-backed validation is expensive enough that it should not be treated as a trivial inner loop action

The strategy document (`STRATEGY.md` §5) calls execution "a **compile+test step**, not a cheap default loop."

The intended development workflow is:

```
code → validate → code → validate → ... → push → test
```

This mirrors compiled-language development:
- **validate** is the IDE's syntax checker / linter — fast, local, runs after every edit
- **push** is compilation — deploys to n8n, assigns a workflow ID
- **test** is running the compiled program — live execution, real side effects

The current `layer` parameter collapses this into a single tool call. An agent can request `layer: 'both'` and skip the push step entirely in its mental model. Worse, the tool *internally* decides whether to redirect `execution→static`, which means the tool is making strategic development decisions that should belong to the agent's workflow discipline.

### The naming problem

Tool names are not just labels. For an agent consumer, the name of a tool shapes how the agent reasons about when to use it. A tool called `validate` with `layer: 'execution'` tells the agent "execution is a kind of validation." That framing actively works against the strategic principle that execution is expensive and should be deliberate.

A tool called `test` tells the agent "this is a different kind of action." The name itself creates a reasoning boundary. The agent must consciously decide to cross from validation into testing, rather than selecting a parameter value.

**The tool name is a guardrail.** It is the cheapest, most reliable guardrail available, because it operates at the level of intent formation rather than request evaluation.

### The coupling problem

The current design couples operations that belong at different points in the development lifecycle:

| Concern | validate | test |
|---------|----------|------|
| Input | Local `.workflow.ts` file | Deployed n8n workflow (by ID) |
| Prerequisite | File exists | File pushed, workflow has `metadata.id` |
| n8n required | No | Yes |
| Side effects | None | Triggers workflow execution |
| Cost | ~10ms | Seconds + n8n resources |
| When | After every code change | After push, when runtime evidence is needed |
| Trust produced | Static trust | Execution trust |

The `push` step sits **between** these operations. It is not an implementation detail — it is a fundamental lifecycle boundary. The current tool surface treats it as invisible.

---

## Design

### New tool surface

| Tool | Purpose | Input | Requires n8n |
|------|---------|-------|-------------|
| **`validate`** | Structural analysis of a local workflow file | `workflowPath`, `target` | No |
| **`test`** | Execution-backed smoke test of a deployed workflow | `workflowPath`, `target`, `pinData` | Yes |
| `trust_status` | Inspect trust state | `workflowPath` | No |
| `explain` | Dry-run guardrail evaluation | `workflowPath`, `target` | No |

### What changes

**`validate` loses the `layer` parameter.** It is always static. The parameter is removed, not defaulted — its absence communicates that validation is one thing, not a spectrum.

**`test` is a new tool.** It accepts a workflow path (to load the graph and resolve the target), requires `metadata.id` in the file (evidence of a prior push), connects to n8n via MCP, and executes the workflow with appropriate pin data.

**`explain` loses the `layer` parameter.** Guardrail dry-run evaluation applies to whichever tool the agent is considering. The `layer` field was only needed because the redirect guardrail decided between layers — that decision no longer belongs to a guardrail.

**`both` is eliminated.** There is no combined mode. The agent calls `validate`, then `test`. Each call produces its own diagnostic summary. If the agent wants both, it makes two calls at the appropriate points in its workflow.

### What does NOT change

- `validate` input schema (`kind`, `workflowPath`, `nodes`, `force`) — unchanged except `layer` is removed
- `trust_status` — unchanged
- Response envelope (`McpResponse<DiagnosticSummary>`) — unchanged
- Static analysis internals — unchanged
- Trust persistence format — unchanged
- CLI commands — `validate` and `trust` unchanged, new `test` command added

### `validate` tool

Structural analysis of a local workflow file. Pure, read-only, no side effects.

**Parameters:**

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `kind` | `'changed' \| 'nodes' \| 'workflow'` | yes | — | What to validate |
| `workflowPath` | string | yes | — | Path to `.workflow.ts` file |
| `nodes` | string[] | when `kind: 'nodes'` | — | Node names to validate |
| `force` | boolean | no | `false` | Override guardrail decisions |

**Produces:** `DiagnosticSummary` with `evidenceBasis: 'static'`.

**Guardrails apply:** target narrowing, broad-target warnings, identical-rerun refusal. No redirect — there is nothing to redirect to.

### `test` tool

Execution-backed smoke test of a deployed workflow. Has side effects. Requires n8n.

**Parameters:**

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `kind` | `'changed' \| 'nodes' \| 'workflow'` | yes | — | What to test |
| `workflowPath` | string | yes | — | Path to `.workflow.ts` file (must contain `metadata.id`) |
| `nodes` | string[] | when `kind: 'nodes'` | — | Node names to test |
| `force` | boolean | no | `false` | Override guardrail decisions |
| `pinData` | `Record<string, {json: object}[]>` | no | — | Mock data for upstream nodes |

**Produces:** `DiagnosticSummary` with `evidenceBasis: 'execution'`.

**Preconditions:**
- Workflow file must contain `metadata.id` (assigned by `n8nac push`)
- n8n MCP connection must be available
- Workflow must have `availableInMCP: true` on the n8n server. When `n8n_api_key` is configured, `test` runs a pre-flight REST API call to ensure this flag is set (workaround for older n8nac versions that strip it on push). This logic currently lives in `interpret.ts` alongside `executeSmoke` — when the tools separate, it moves to the `test` path only. `validate` (static-only) never needs it.

**Error when preconditions unmet:**
- Missing `metadata.id`: `{ type: 'precondition_error', message: 'Workflow has no metadata.id — push with n8nac first.' }`
- No MCP connection: `{ type: 'configuration_error', message: 'n8n MCP connection not available — configure n8n_host and n8n_mcp_token.' }`

**Guardrails apply:** target narrowing, broad-target warnings, identical-rerun refusal (using execution-layer trust). The escalation-trigger redirect is removed — the agent's choice to call `test` is itself the escalation decision.

### Guardrail changes

**Replace the redirect guardrail with a test-refusal guardrail.** The current redirect guardrail (`evaluate.ts` Step 3) silently downgrades `execution→static` when "all changes are structurally analyzable." The silent redirect was wrong — the tool was making a strategic decision and hiding it. But the *intent* — discouraging unnecessary execution — is core to the product identity.

In the new model, when the agent calls `test` and the escalation triggers indicate that all changes are structurally analyzable, the guardrail **refuses with explanation**: "All changes are structurally analyzable — use validate instead." The agent can override with `force: true` if it genuinely needs runtime evidence.

This is a stronger guardrail than the redirect. A redirect silently changes the operation. A refusal forces the agent to consciously decide whether execution is warranted. Agents cannot be relied upon to make good strategic decisions consistently — they will fall into patterns of "I usually test after pushing, I'll keep doing that." The guardrail breaks that pattern by requiring justification.

**The escalation trigger logic is preserved.** The 6 triggers in `redirect.ts` (`assessEscalationTriggers`) are the same checks — they still evaluate whether execution evidence is needed. The difference is what happens when none fire:
- **Before:** silently redirect to static (wrong — hides the decision)
- **After:** refuse with explanation (right — makes the decision visible and overridable)

The remaining guardrails continue to apply to both tools:
- **Force bypass** (Step 1) — unchanged, overrides all guardrails including the new test-refusal
- **Fixture-change warn** (Step 2) — unchanged
- **Test-refusal** (Step 3, formerly redirect) — applies only to `test` tool; refuses when no escalation triggers fire
- **Broad-change narrowing** (Step 4) — unchanged for both tools
- **Trust-based narrowing** (Step 5) — unchanged for both tools
- **Broad-target warning** (Step 6) — unchanged for both tools
- **Identical-rerun refusal** (Step 7) — unchanged, but trust layer check uses the appropriate trust type
- **Proceed** (Step 8) — unchanged

**Replace `redirect` action with `refuse` in test-refusal.** The `GuardrailDecision` union loses the `redirect` variant (with `redirectedLayer`) since there is no layer to redirect to. The test-refusal guardrail uses the existing `refuse` action with an explanation that names the cheaper alternative: "Use validate instead."

**`redirectedLayer` is removed from `GuardrailDecision`.** The `redirect` action variant is removed from the discriminated union. Guardrails can `proceed`, `warn`, `narrow`, or `refuse` — they do not redirect between tools.

### Trust model changes

**`ValidationLayer` type is removed.** Replace with `ValidationEvidence`:

```typescript
/** What kind of evidence confirmed a validation result. */
export type ValidationEvidence = 'static' | 'execution';
```

The `'both'` value is eliminated. A trust record is produced by one tool or the other, never both simultaneously. If the agent validates then tests, two trust updates occur at different times — each with its own evidence type, timestamp, and run ID.

**`NodeTrustRecord.validationLayer` → `NodeTrustRecord.validatedWith`.** Renamed for clarity. Values: `'static'` or `'execution'`.

**Trust querying remains evidence-agnostic.** `isTrusted()` checks content hash only. The evidence type is informational (for diagnostics and audit), not functional (for trust decisions). This is unchanged behavior, but the separation makes it explicit.

### Diagnostics changes

**`DiagnosticSummary.evidenceBasis` stays.** Values narrow from `'static' | 'execution' | 'both'` to `'static' | 'execution'`. Each summary comes from one tool invocation and carries one evidence type.

**No merged results.** The current `synthesize()` logic that combines static findings and execution data into one summary is simplified — each tool produces its own findings and its own summary. The agent sees two separate results if it calls both tools.

### `explain` tool changes

**Remove `layer` parameter.** The explain tool shows what guardrails would decide for a `validate` or `test` call. Since guardrails no longer redirect between layers, the layer parameter serves no purpose.

Add a `tool` parameter instead:

| Param | Type | Required | Default |
|-------|------|----------|---------|
| `workflowPath` | string | yes | — |
| `tool` | `'validate' \| 'test'` | no | `'validate'` |
| `kind` | `'changed' \| 'nodes' \| 'workflow'` | no | `'changed'` |
| `nodes` | string[] | no | — |

This lets the agent ask "what would happen if I validate?" vs "what would happen if I test?" — the guardrail context differs (e.g., test checks for `metadata.id` and MCP availability).

---

## Documentation updates

This phase includes documentation updates as deliverables. The language in these documents shapes how agents reason about the tool. Incorrect or legacy framing will cause agents to conflate validation and testing regardless of the tool surface change.

### CONCEPTS.md

**Update "Validation run" definition.** The current text says "a validation run may involve static inspection, execution-backed validation, or both." This must be rewritten to distinguish validation runs from test runs as separate concepts.

**Add "Test run" definition.** A test run is a deliberate execution of a deployed workflow to observe runtime behavior. It is not a mode of validation — it is a separate, costlier operation that occurs after deployment.

**Update "Validation locality" section.** Remove any implication that execution is a layer of validation. Execution is a separate development step.

### STRATEGY.md

**Update §5 (Execution-backed validation is deliberate).** Rename to "Testing is deliberate" or "Execution is a separate step." Update language to refer to testing as a distinct tool, not a validation layer.

**Remove or rephrase "escalate to execution" framing.** The current language ("escalate to execution only when runtime evidence is needed") implies execution is a level on a validation dial. Replace with language that positions testing as a conscious step change, not an escalation.

### SKILL.md

**Rewrite the "Two-phase validation" section.** Rename to "Development workflow" or "Validate → Push → Test." Make the three-step lifecycle explicit. Remove `layer` parameter from all examples. Show `validate` and `test` as separate tool calls at different lifecycle points.

**Update the "When to validate" table.** Split into "When to validate" and "When to test" tables. The current table mixes both under `validate` with different `layer` values.

**Update tool parameter tables.** Remove `layer` from `validate`. Add `test` tool with its own parameter table.

### PRD.md (§8.0.2)

**Update "Validation layers" section.** The current text treats static and execution as two layers of one operation. Rewrite to describe validation and testing as separate operations with separate tools, separate cost profiles, and a deployment boundary between them.

---

## Scope

### In scope

- New `test` MCP tool and CLI command
- Remove `layer` parameter from `validate`, `explain`
- Remove `'both'` from `ValidationLayer` → replace with `ValidationEvidence`
- Remove redirect guardrail (Step 3 in `evaluate.ts`)
- Remove `redirect` action from `GuardrailDecision`
- Rename `validationLayer` → `validatedWith` in `NodeTrustRecord`
- Simplify `synthesize()` — no merged static+execution results
- Simplify `interpret()` — no layer routing, no combined codepath
- Update SKILL.md, CONCEPTS.md, STRATEGY.md, PRD.md
- Update all tests

### Out of scope

- Changes to static analysis internals
- Changes to trust persistence format (beyond the field rename)
- Changes to the response envelope
- New guardrail types
- Changes to how `n8nac` is invoked or coordinated

---

## Migration

### Breaking changes

This is a breaking change to the MCP tool surface:
- `validate` no longer accepts `layer`
- `explain` no longer accepts `layer`
- New `test` tool appears
- `DiagnosticSummary.evidenceBasis` no longer returns `'both'`
- `NodeAnnotation` and trust reports no longer reference `'both'` as a layer

### Agent impact

Agents using the current SKILL.md will need to be re-taught. The SKILL.md update is the primary re-teaching mechanism. Since agents re-read skills per session, the transition is immediate once the skill file is updated.

### CLI impact

- `n8n-vet validate` loses `--layer`
- `n8n-vet test <path> [options]` is added
- `n8n-vet explain` loses `--layer`, gains `--tool`

---

## Acceptance criteria

1. `validate` tool accepts no `layer` parameter. Passing `layer` produces a clear error, not silent acceptance.
2. `test` tool exists, requires `metadata.id`, requires MCP connection, executes workflow.
3. `explain` tool accepts `tool` parameter instead of `layer`.
4. No `'both'` value exists in any type, parameter, or output.
5. Redirect guardrail is replaced by test-refusal. When `test` is called and no escalation triggers fire, the guardrail refuses with "All changes are structurally analyzable — use validate instead." `force: true` overrides.
6. `GuardrailDecision` has no `'redirect'` action variant. The `redirect` action and `redirectedLayer` field are removed.
6. `NodeTrustRecord` field is `validatedWith: 'static' | 'execution'`.
7. Each tool invocation produces exactly one `DiagnosticSummary` with one `evidenceBasis`.
8. SKILL.md presents a three-step lifecycle: validate → push → test.
9. SKILL.md tool tables show `validate` and `test` as separate tools with separate parameter tables.
10. CONCEPTS.md defines "validation run" and "test run" as separate concepts.
11. STRATEGY.md §5 refers to testing as a separate step, not a validation layer.
12. All existing tests updated. No test references `'both'` or `redirectedLayer`.

---

## Decisions

1. **Two tools, not one with a mode.** The tool boundary reinforces the strategic principle. Names are guardrails.
2. **No `'both'` mode, no combined results.** The agent composes separate calls. Composition is the agent's explicit decision, not an implicit tool behavior.
3. **Replace redirect with test-refusal.** The escalation trigger logic is preserved, but instead of silently switching layers, the guardrail refuses the `test` call and tells the agent to validate instead. `force: true` overrides. This is a stronger guardrail — a visible refusal that requires conscious override is more effective than a silent redirect that the agent never notices.
4. **`test` reads the workflow file.** Even though `test` executes against n8n, it still reads the local `.workflow.ts` to build the graph, resolve targets, compute trust, and construct pin data. The file is the source of truth for what the workflow should look like.
5. **Trust records use separate evidence types.** A node validated statically and tested via execution gets two separate trust records (at different times, after different operations). No combined `'both'` evidence.
6. **Documentation updates are deliverables.** The language in SKILL.md, CONCEPTS.md, and STRATEGY.md is as important as the code. Agents reason from documentation, not from type signatures.
