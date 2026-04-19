# TODO — Future Work

Tracked items for future development. Organized by area.

Items marked with a target version indicate when they were originally scoped. Items without a version are unversioned future work.

---

## Documentation

- ~~**CONTRIBUTING.md**~~ ✅ Done

- ~~**README.md cleanup**~~ ✅ Done

---

## v0.2.0 — Opportunistic Trust Harvesting

The headline feature for the next release. When MCP `test_workflow` executes the whole workflow, nodes outside the target slice may also execute successfully. That execution data is legitimate trust evidence.

- **Harvest trust from non-target nodes** — After execution, call `get_execution` for all non-pinned nodes (not just slice nodes). For nodes outside the target slice that show `executionStatus: 'success'`, record trust evidence. Turns whole-workflow execution into a trust-coverage advantage. Depends on confirming whole-workflow execution as the permanent model. (specs/012-execution-backend-revision/prd.md lines 43-51)

---

## Bounded Execution (Future — No Public API Available)

True bounded execution (`destinationNode`) is not available from any public n8n surface. Three options for future investigation:

1. **n8n feature request** — Ask the n8n team to expose `destinationNode` support on MCP `test_workflow` or a new MCP tool. Cleanest path.
2. **Internal API with session auth** — Technically possible but fragile; requires undocumented session cookie.
3. **n8n package API** — Import `@n8n/core` and call `WorkflowExecute.runPartialWorkflow2()` directly. Heavy and brittle.

None suitable until n8n exposes bounded execution on a public surface. (specs/012-execution-backend-revision/prd.md lines 35-41)

---

## Static Analysis Gaps

- **Disconnected node detection** — `broken-wiring.ts` fixture passes static analysis because orphaned/disconnected node detection is not implemented. The integration test (scenario 01) documents this explicitly. Scope: add a graph-connectivity check in `src/static-analysis/` that flags nodes with no path from a trigger. (test/integration/scenarios/01-static-only.ts lines 6, 40)

- **Credential type validation** — Deferred because it requires a credential type registry not available from `NodeSchemaProvider` in v1. Currently a no-op in `src/static-analysis/params.ts:52`. Scope: needs either a bundled registry or a way to query n8n for credential type schemas. (audit finding PH-001)

---

## n8nac Integration

- **Remove `availableInMCP` REST API workaround** — Older n8nac versions strip `availableInMCP` on push, even though the committed fixture `.ts` files have it set to `true`. The setup samples one workflow to detect whether the flag was preserved; if not, it re-enables it via REST API (`test/integration/lib/enable-mcp-access.ts`). Remove this workaround when the minimum supported n8nac version preserves the flag. This is the **only** acceptable use of the n8n REST API in n8n-vet.

- **Delegate change detection to n8nac** — n8nac already ignores position/layout-only changes and tracks workflow-level diffs. Currently n8n-vet does its own node-level change detection (`src/trust/change.ts`). Investigate whether n8nac's change detection output (file hashes, sync status) can replace or supplement ours. The gap: n8nac is workflow-level only, we need node-level granularity. A hybrid approach — n8nac tells us *which* workflows changed, we do node-level diffing only on those — may be optimal.

---

## Test Coverage Gaps

- **Pin data construction / caching tests** — No integration scenario exercises `prepare_test_pin_data` or pin data cache persistence. Add a scenario that pins upstream data and validates the agent node receives it.

- **Expression error classification** — No scenario exercises the expression-error diagnostic path end-to-end. The `expression-bug` fixture exists but only tests static analysis. Add a scenario that triggers execution with expression errors and validates the diagnostic output classifies them correctly.

- **Node annotations validation** — No scenario tests the `annotations` static check (e.g. `@node({ notes: '...' })` metadata validation). Low priority since this is primarily cosmetic.

- **Guardrail narrowing** — No scenario specifically tests the guardrail *narrowing* behavior where a `both` request is redirected to `static` because changes are structurally analyzable. Currently we bypass this with `force: true` in execution scenarios. Consider a dedicated scenario that validates the narrowing decision and its explanation.

---

## Distribution & Platform

- **GitHub Copilot agent support** — Needs separate config files and marketplace listing. Same MCP core works. Deferred post-v0.1.0.

- **npm registry publishing** — Currently distributed as a git URL (sufficient for Claude plugin). Consider publishing to npm for standalone MCP server users.

- **LICENSE file** — MIT license file not yet added to the repo.

---

## Architecture

- **MCP transport abstraction** — `test/integration/lib/n8n-mcp-client.ts` uses `StreamableHTTPClientTransport` directly. If n8n ever supports other transports (stdio, SSE), the client should abstract over them. Low priority.

- **Execution backend capability detection** — `detectCapabilities()` calls `tools/list` which we intercept and map to `client.listTools()`. This is a workaround because `tools/list` is not an actual MCP tool name. If the MCP SDK provides a standard way to list tools, use that instead.

---

## Release (v0.1.0)

- **Claude plugin install test** — Test plugin install from git URL in clean Claude Code session.
- **`npm pack` verification** — Inspect tarball contents to verify no test/, docs/internal/, .scratch/ leak.
