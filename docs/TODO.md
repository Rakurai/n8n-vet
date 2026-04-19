# TODO — Future Work

Tracked items for future development. Organized by area.

## Documentation

- ~~**CONTRIBUTING.md** — specific instructions for setting up the repository, configuring MCP and REST API access, running integration tests, seeding new artifacts for integration tests if needed (for new workflows), etc.~~ ✅ Done

- ~~**README.md cleanup** — streamline with simple instructions: make sure `n8n-mcp` and `n8nac` MCP servers are available in Claude or VS Code. No dev-only setup in the main README.~~ ✅ Done

## n8nac Integration

- **Remove `availableInMCP` REST API workaround** — Older n8nac versions strip `availableInMCP` on push, even though the committed fixture `.ts` files have it set to `true`. The setup samples one workflow to detect whether the flag was preserved; if not, it re-enables it via REST API (`test/integration/lib/enable-mcp-access.ts`). Remove this workaround when the minimum supported n8nac version preserves the flag. This is the **only** acceptable use of the n8n REST API in n8n-vet.

- **Delegate change detection to n8nac** — n8nac already ignores position/layout-only changes and tracks workflow-level diffs. Currently n8n-vet does its own node-level change detection (`src/trust/change.ts`). Investigate whether n8nac's change detection output (file hashes, sync status) can replace or supplement ours. The gap: n8nac is workflow-level only, we need node-level granularity. A hybrid approach — n8nac tells us *which* workflows changed, we do node-level diffing only on those — may be optimal.

## Test Coverage Gaps

- **Pin data construction / caching tests** — no integration scenario exercises `prepare_test_pin_data` or pin data cache persistence. Add a scenario that pins upstream data and validates the agent node receives it.

- **Expression error classification** — no scenario exercises the expression-error diagnostic path end-to-end. The `expression-bug` fixture exists but only tests static analysis. Add a scenario that triggers execution with expression errors and validates the diagnostic output classifies them correctly.

- **Node annotations validation** — no scenario tests the `annotations` static check (e.g. `@node({ notes: '...' })` metadata validation). Low priority since this is primarily cosmetic.

- **Guardrail narrowing** — no scenario specifically tests the guardrail *narrowing* behavior where a `both` request is redirected to `static` because changes are structurally analyzable. Currently we bypass this with `force: true` in execution scenarios. Consider a dedicated scenario that validates the narrowing decision and its explanation.

## Architecture

- **MCP transport abstraction** — `test/integration/lib/n8n-mcp-client.ts` uses `StreamableHTTPClientTransport` directly. If n8n ever supports other transports (stdio, SSE), the client should abstract over them. Low priority.

- **Execution backend capability detection** — `detectCapabilities()` calls `tools/list` which we intercept and map to `client.listTools()`. This is a workaround because `tools/list` is not an actual MCP tool name. If the MCP SDK provides a standard way to list tools, use that instead.
