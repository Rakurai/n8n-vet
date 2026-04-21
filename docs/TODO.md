# TODO — Future Work

---

## v0.2.0 (current)

Audit remediation release. All items complete:

- Boundary hardening: explicit degraded bootstrap, error sanitization, test typecheck
- Slice semantics consolidation: shared traversal primitives, unified boundary classification
- Orchestrator decompression: phase helpers (validate, synthesize, persist)
- Execution ownership: preparation moved to `execution/prepare.ts`, grouped deps
- Dependency contract reshape: 7 named subsystem interfaces

---

## v0.3.0 — Unblocked

Work that can start immediately. No external blockers.

### Field-Testing Feedback (2026-04-20)

Issues surfaced during real-agent field testing. See `docs/internal/n8n-proctor-testing.md` for full context.

#### MCP tool descriptions too minimal

The one-liner descriptions for `explain` and `trust_status` don't explain guardrails or trust concepts. Agents without the companion skill can't understand when to use the tools. Each description should be 2-3 sentences explaining purpose and when to use it. Simple string edits in `src/mcp/server.ts`.

#### Coverage qualifier on diagnostic summary

A "pass" on a 57-node workflow where 55 nodes are opaque is misleading. Add a `coverage` field to `DiagnosticSummary` (e.g., `{ analyzed: 2, opaque: 55, trusted: 0 }`) so consumers can judge confidence. Affects `src/diagnostics/synthesize.ts` and `src/types/diagnostic.ts`.

#### Compact mode for `validate` and `trust_status`

80%+ of response tokens are "skipped — opaque" annotations that carry no actionable information. A `compact` option that omits skipped annotations would cut context costs dramatically. For `trust_status`, counts-by-reason instead of per-node listing would reduce a 4,500-token response to ~200 tokens.

#### Validate node params against node schemas

The `outputColumns: 'string'` vs `string[]` bug affected 5 nodes across 3 workflows and was invisible to the validator. The n8n MCP's `get_node_types` provides correct type definitions. Cross-referencing parameter values against these schemas would catch type mismatches, invalid enum values, and missing required fields. Highest-value single improvement for catching real bugs. Requires sourcing node schemas at validation time — non-trivial.

#### Extend static analysis into Postgres/OpenAI nodes

Postgres SELECT queries have deterministic column lists that could infer output shapes. OpenAI structured output schemas define the output shape. These are currently marked "opaque to analysis" but have analyzable contracts. Distinguish "opaque-by-nature" (Code nodes) from "potentially-analyzable" (Postgres, OpenAI).

#### Document the `changed` heuristic in the skill

The skill docs say "auto-detect what changed" but don't explain the baseline/diff mechanism. Add a paragraph to `skills/validate-workflow/SKILL.md` explaining when `changed` means "everything" vs "nothing" and why.

### Opportunistic Trust Harvesting (headline feature)

When MCP `test_workflow` executes the whole workflow, nodes outside the target slice may also execute successfully. That execution data is legitimate trust evidence.

- After execution, call `get_execution` for all non-pinned nodes (not just slice nodes)
- For nodes outside the target slice that show `executionStatus: 'success'`, record trust evidence
- Turns whole-workflow execution into a trust-coverage advantage: every execution produces more trust coverage than requested

### Static Analysis — Disconnected Node Detection

`broken-wiring.ts` fixture passes static analysis because orphaned/disconnected node detection is not implemented. The integration test (scenario 01) documents this explicitly. Scope: add a graph-connectivity check in `src/static-analysis/` that flags nodes with no path from a trigger. (test/integration/scenarios/01-static-only.ts lines 6, 40)

### Distribution

- **GitHub Copilot agent support** — Needs separate config files and marketplace listing. Same MCP core works.

- **npm registry publishing** — Currently distributed as a git URL (sufficient for Claude plugin). Consider publishing to npm for standalone MCP server users.

### Lifecycle Guardrail Opportunities (post-separation, if field-testing supports)

These ideas came up during the validate/test separation design (phase 15). They reinforce the `validate → push → test` lifecycle, but we haven't encountered the failure modes yet. Add if real-world agent behavior demonstrates the need.

- **Test-before-validate refusal** — When `test` is called and changed nodes have no static trust record (never validated or trust is stale), refuse: "Changed nodes have not been validated — run validate first." Hard lifecycle enforcement, analogous to a compiler refusing to run tests on uncompiled code. Override with `force: true`.

- **Runtime-sensitive hint after validate** — When `validate` passes but escalation triggers fire (opaque nodes changed, LLM nodes, sub-workflow calls), include an advisory in the diagnostic summary: "Static validation passed. Runtime-sensitive changes detected — test after push." Nudge, not enforcement.

- **Explicit `nextStep` in diagnostic output** — A single-sentence field in every `DiagnosticSummary` that names the next action: "Push with n8nac, then test" / "Fix errors, then validate again" / "Done — validated and tested." Cheap guidance that reinforces lifecycle in every response.

### Agent Decision Surface (external reviewer feedback)

External review identified the gap between the current explainer-level output and a full "controller layer" that drives agent convergence. The core insight: we return diagnostics and guardrail decisions, but the agent still infers policy from them. See `docs/internal/n8n-proctor-testing.md` for field context.

Design constraint: all additions must respect the compactness principle. The field tester's #1 complaint was response size. New fields should be compact-by-default with detail available on demand — not added verbosity on every response.

#### `nextAction` recommendation in diagnostic response

Add a top-level field to `DiagnosticSummary` that names the highest-value next move. Types: `edit_workflow`, `validate_again`, `test_nodes`, `request_user_input`, `stop`. Include target nodes and blocking flag. This is the operational form of STRATEGY.md principle 8 ("diagnostics should optimize for next action") and principle 9 ("guardrails should optimize information gain"). Infrastructure already exists in guardrail decisions and resolved targets — this serializes the last mile.

#### Causal slice trace

Expose the propagation path from trigger through changed nodes to failure site. The slice computation internally IS a causal trace (forward propagation from changed nodes through the graph) — it just isn't serialized. A compact array of `{ node, role: 'trusted_boundary' | 'changed' | 'consumer', status }` entries would help agents distinguish local edit bugs from upstream assumption failures crossing boundaries. Maps directly onto existing `resolveChanged()` + `buildSlice()` data structures.

#### Scope and execution rationale in every response

`explain` already computes why a target was narrowed and why execution was/wasn't recommended. Promote that reasoning into the main validate/test response as structured fields (`scopeDecision`, `executionDecision`) rather than requiring a separate `explain` call. Teaches the agent the testing philosophy at every interaction rather than hiding it in docs.

#### Categorical confidence per annotation

Replace the binary `validated` / `skipped (opaque)` / `trusted` with categorical confidence: `high` (statically proven), `medium` (partial analysis), `low` (heuristic only), `unknown` (opaque). Don't use numeric confidence — we don't have calibration data to back it. Helps agents weight findings appropriately.

#### Layered response envelope

Prerequisite for the above without violating compactness. Default response is compact (decision + summary + nextAction + coverage). Detail (causal trace, scope rationale, per-node annotations) available via a `verbose` or `detail` flag. Aligns with the compact mode TODO from field testing.

### Future Exploration

#### Anti-thrash attempt memory

Extend trust persistence to track recent failed repair patterns across validation runs. Detect when the agent is cycling (e.g., "expression edited 3 times, upstream shape still incompatible") and emit a redirect. Architecturally heavier than it looks — requires correlating multiple runs and classifying edit diffs between them. Different subsystem from trust persistence. Worth exploring once the controller layer basics are in place.

#### Canonical issue codes

Stable, reusable labels for issue types (e.g., `expr.ref.missing_upstream_field`, `boundary.untrusted_after_edit`). Not natural language — just identifiers the agent can look up or pattern-match on for durable behavior anchors. Build organically as the detection surface grows rather than pre-designing a taxonomy.

#### Pin-data guidance as planning primitive

Surface pin-data recommendations proactively in test planning: which nodes to pin, from what source, and why. The infrastructure exists (4-tier pin data sourcing) but isn't exposed in the response. Would make `test` calls more purposeful — "run this execution because it resolves this ambiguity" rather than "run test because maybe runtime matters."

---

## Maybe Blocked

Items that might be unblocked with some investigation, or have soft dependencies on external changes.

- **Delegate change detection to n8nac** — n8nac already ignores position/layout-only changes and tracks workflow-level diffs. Currently n8n-proctor does its own node-level change detection (`src/trust/change.ts`). A hybrid approach — n8nac tells us *which* workflows changed, we do node-level diffing only on those — may be optimal. Gap: n8nac is workflow-level only, we need node-level granularity. Needs investigation into what n8nac exposes.

- **Remove `availableInMCP` REST API workaround** — Older n8nac versions strip `availableInMCP` on push. The integration test setup re-enables it via REST API (`test/integration/lib/enable-mcp-access.ts`). Remove when the minimum supported n8nac version preserves the flag. May already be fixed in recent n8nac releases — needs testing.

- **Execution backend capability detection** — `detectCapabilities()` calls `tools/list` which we intercept and map to `client.listTools()`. Workaround because `tools/list` is not an actual MCP tool name. May be unblocked if the MCP SDK adds a standard tool-listing method.

---

## Definitely Blocked

Items with hard external dependencies that cannot be resolved by this project alone.

- **Bounded execution (`destinationNode`)** — True bounded execution is not available from any public n8n surface. Three options for future investigation: (1) n8n feature request to expose `destinationNode` on MCP `test_workflow`, (2) internal API with session auth (fragile, undocumented), (3) import `@n8n/core` directly (heavy, brittle). None suitable until n8n acts.

- **Credential type validation** — Deferred because it requires a credential type registry not available from `NodeSchemaProvider` in v1. Currently a no-op in `src/static-analysis/params.ts:52`. Needs either a bundled registry or a way to query n8n for credential type schemas. (audit finding PH-001)

- **MCP transport abstraction** — `test/integration/lib/n8n-mcp-client.ts` uses `StreamableHTTPClientTransport` directly. Only relevant if n8n ever supports other transports (stdio, SSE). No indication this is coming.
