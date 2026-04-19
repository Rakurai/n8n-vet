# TODO — Future Work

---

## v0.1.0 Release (human tasks)

- **Claude plugin install test** — Test plugin install from git URL in clean Claude Code session. Final acceptance gate.
- **`npm pack` verification** — Inspect tarball contents to verify no test/, docs/internal/, .scratch/ leak.

---

## v0.2.0 — Unblocked

Work that can start immediately after v0.1.0 ships. No external blockers.

### Opportunistic Trust Harvesting (headline feature)

When MCP `test_workflow` executes the whole workflow, nodes outside the target slice may also execute successfully. That execution data is legitimate trust evidence.

- After execution, call `get_execution` for all non-pinned nodes (not just slice nodes)
- For nodes outside the target slice that show `executionStatus: 'success'`, record trust evidence
- Turns whole-workflow execution into a trust-coverage advantage: every execution produces more trust coverage than requested

Depends on confirming whole-workflow execution as the permanent model. Design in specs/012-execution-backend-revision/prd.md lines 43-51.

### Static Analysis — Disconnected Node Detection

`broken-wiring.ts` fixture passes static analysis because orphaned/disconnected node detection is not implemented. The integration test (scenario 01) documents this explicitly. Scope: add a graph-connectivity check in `src/static-analysis/` that flags nodes with no path from a trigger. (test/integration/scenarios/01-static-only.ts lines 6, 40)

### Test Coverage Gaps

- **Pin data construction / caching** — No integration scenario exercises `prepare_test_pin_data` or pin data cache persistence. Add a scenario that pins upstream data and validates the agent node receives it.

- **Expression error classification** — No scenario exercises the expression-error diagnostic path end-to-end. The `expression-bug` fixture exists but only tests static analysis. Add a scenario that triggers execution with expression errors and validates the diagnostic classifies them correctly.

- **Guardrail narrowing** — No scenario specifically tests the guardrail *narrowing* behavior where a `both` request is redirected to `static` because changes are structurally analyzable. Currently bypassed with `force: true` in execution scenarios.

- **Node annotations validation** — No scenario tests the `annotations` static check. Low priority — primarily cosmetic.

### Distribution

- **GitHub Copilot agent support** — Needs separate config files and marketplace listing. Same MCP core works.

- **npm registry publishing** — Currently distributed as a git URL (sufficient for Claude plugin). Consider publishing to npm for standalone MCP server users.

---

## Maybe Blocked

Items that might be unblocked with some investigation, or have soft dependencies on external changes.

- **Delegate change detection to n8nac** — n8nac already ignores position/layout-only changes and tracks workflow-level diffs. Currently n8n-vet does its own node-level change detection (`src/trust/change.ts`). A hybrid approach — n8nac tells us *which* workflows changed, we do node-level diffing only on those — may be optimal. Gap: n8nac is workflow-level only, we need node-level granularity. Needs investigation into what n8nac exposes.

- **Remove `availableInMCP` REST API workaround** — Older n8nac versions strip `availableInMCP` on push. The integration test setup re-enables it via REST API (`test/integration/lib/enable-mcp-access.ts`). Remove when the minimum supported n8nac version preserves the flag. May already be fixed in recent n8nac releases — needs testing.

- **Execution backend capability detection** — `detectCapabilities()` calls `tools/list` which we intercept and map to `client.listTools()`. Workaround because `tools/list` is not an actual MCP tool name. May be unblocked if the MCP SDK adds a standard tool-listing method.

---

## Definitely Blocked

Items with hard external dependencies that cannot be resolved by this project alone.

- **Bounded execution (`destinationNode`)** — True bounded execution is not available from any public n8n surface. Three options for future investigation: (1) n8n feature request to expose `destinationNode` on MCP `test_workflow`, (2) internal API with session auth (fragile, undocumented), (3) import `@n8n/core` directly (heavy, brittle). None suitable until n8n acts. (specs/012-execution-backend-revision/prd.md lines 35-41)

- **Credential type validation** — Deferred because it requires a credential type registry not available from `NodeSchemaProvider` in v1. Currently a no-op in `src/static-analysis/params.ts:52`. Needs either a bundled registry or a way to query n8n for credential type schemas. (audit finding PH-001)

- **MCP transport abstraction** — `test/integration/lib/n8n-mcp-client.ts` uses `StreamableHTTPClientTransport` directly. Only relevant if n8n ever supports other transports (stdio, SSE). No indication this is coming.
