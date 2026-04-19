# GPT Audit

## Scope

This review covers the shipped implementation only:

- `src/`
- `test/`
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `biome.json`

I intentionally excluded `docs/prd`, `docs/reference`, `docs/research`, and `specs` as requested.

## Verdict

The codebase has a solid subsystem-level foundation, and the local unit/fixture coverage is much stronger than average, but it is not release-ready yet. The main risk is not basic correctness inside individual modules; it is the set of cross-subsystem seams where execution, trust persistence, capability detection, and surface-layer behavior do not line up with each other.

## Verification Performed

- `npm run typecheck`: passed
- `npm test`: passed (`38` test files, `491` tests)
- `npm run lint`: failed

The green test and typecheck results do not clear the release path by themselves. Several of the most important gaps sit behind mocked seams or dead integration paths.

## Findings

### 1. Critical: the real execution-backed validation path is not wired end-to-end

The biggest release blocker is the execution path in the orchestrator.

- The orchestrator fetches execution data and then force-casts it directly into the diagnostics shape instead of converting it through the execution extraction pipeline: [src/orchestrator/interpret.ts#L233-L234](../src/orchestrator/interpret.ts#L233-L234).
- The REST client method it calls returns the raw REST payload shape, not synthesized execution diagnostics: [src/execution/rest-client.ts#L375](../src/execution/rest-client.ts#L375).
- The execution subsystem and diagnostics subsystem currently define incompatible `ExecutionData` models:
  [src/execution/types.ts#L105](../src/execution/types.ts#L105)
  [src/diagnostics/types.ts#L42](../src/diagnostics/types.ts#L42)
- The intended execution data conversion path exists, but the orchestrator never uses it: [src/execution/results.ts#L72](../src/execution/results.ts#L72).
- The polling path also exists but is not used by the orchestrator: [src/execution/poll.ts#L62](../src/execution/poll.ts#L62).
- The current orchestrator tests hide this by mocking `getExecutionData` with `{}` instead of exercising the real extraction boundary: [test/orchestrator/interpret.test.ts#L133-L135](../test/orchestrator/interpret.test.ts#L133-L135).

Why this matters:

- Real execution-backed validations are likely to fail in synthesis once `executionData` is non-null, because the diagnostics layer validates that `nodeResults` is a `Map`: [src/diagnostics/synthesize.ts#L30](../src/diagnostics/synthesize.ts#L30), [src/diagnostics/synthesize.ts#L91](../src/diagnostics/synthesize.ts#L91).
- Even if synthesis somehow received extracted data later, the duplicate execution models still disagree on per-node result shape and error shape, so path reconstruction, annotation assignment, hint collection, and error classification are not currently operating on the same contract.

This is the first thing I would fix before any release candidate.

### 2. High: the package is not currently releasable as a standalone artifact

The package metadata still points at sibling-repo file dependencies:

- [package.json#L34](../package.json#L34)
- [package.json#L39](../package.json#L39)

That means the current package cannot be installed or published independently in the form the project claims to target. This is a release blocker for any real package/plugin distribution outside the current local machine layout.

### 3. High: snapshot persistence drops AST fields that the trust hash depends on

The trust model is not fully stable across snapshot round-trips.

- Snapshot deserialization replaces the AST with an empty placeholder: [src/orchestrator/snapshots.ts#L121](../src/orchestrator/snapshots.ts#L121).
- Trust hashing explicitly includes execution settings pulled from the AST such as `retryOnFail`, `executeOnce`, and `onError`: [src/trust/hash.ts#L35-L37](../src/trust/hash.ts#L35-L37).

Why this matters:

- If a node uses those execution settings, a saved snapshot no longer contains the data needed to reproduce the original hash.
- That can produce false positives in `computeWorkflowHash` and `computeChangeSet`, which in turn destabilizes trust invalidation and “changed target” behavior.

The current snapshot tests do not cover this case because they use empty AST fixtures and only verify structural graph reconstruction, not hash equivalence across persisted snapshots: [test/orchestrator/snapshots.test.ts](../test/orchestrator/snapshots.test.ts).

### 4. High: capability detection does not actually degrade gracefully, and the MCP backend is unreachable from the production surfaces

The code claims reduced-mode behavior, but the current implementation does not fully deliver it.

- `buildGuardrailExplanation` always calls capability detection: [src/surface.ts#L77](../src/surface.ts#L77), [src/surface.ts#L139](../src/surface.ts#L139).
- `detectCapabilities` always starts by resolving REST credentials and throws when they are missing: [src/execution/rest-client.ts#L145-L176](../src/execution/rest-client.ts#L145-L176).
- MCP discovery only happens when a `callTool` function is supplied: [src/execution/capabilities.ts#L62](../src/execution/capabilities.ts#L62).
- The orchestrator calls `detectCapabilities()` with no options: [src/orchestrator/interpret.ts#L175](../src/orchestrator/interpret.ts#L175).
- `executeSmoke` is exported and injected, but there is no production path that actually invokes it: [src/execution/mcp-client.ts#L101](../src/execution/mcp-client.ts#L101), [src/deps.ts#L24-L48](../src/deps.ts#L24-L48).

Why this matters:

- The `explain` surface is effectively coupled to runtime credential availability even though it should be able to operate in a local/static mode.
- The MCP execution backend is effectively dead code today. In the current production wiring, `mcpAvailable` will never become true unless the dependency object is built in a custom way outside the shipped entrypoints.

This is a meaningful mismatch between the implementation and the product's stated local-first, capability-degrading behavior.

### 5. High: trusted-boundary execution reuse is only partially implemented

There is a visible gap between what the execution subsystem exports and what the orchestrator actually uses.

- The orchestrator calls `constructPinData`, but only passes explicit fixtures and never supplies prior artifacts: [src/orchestrator/interpret.ts#L183-L186](../src/orchestrator/interpret.ts#L183-L186).
- Tier-2 cache helpers exist but are not called anywhere in the codebase: [src/execution/pin-data.ts#L128-L151](../src/execution/pin-data.ts#L128-L151).
- The polling strategy needed for bounded execution completion also exists but is not called from orchestration: [src/execution/poll.ts#L62](../src/execution/poll.ts#L62).

Why this matters:

- Execution-backed validation does not currently reuse prior execution artifacts, despite the subsystem shape suggesting it should.
- Trusted-boundary reuse for execution is therefore much weaker in the actual runtime path than the code layout suggests.
- The code exports more execution machinery than the orchestrator has actually integrated.

This is not just an optimization gap. It affects whether execution-backed validation can stay local and cheap in repeated runs.

### 6. Medium: change-based targeting can silently miss real edits when trust exists but the snapshot is missing

The fallback path in `resolveChanged` is too optimistic.

- When no snapshot is available, the orchestrator falls back to `approximateChanges`: [src/orchestrator/resolve.ts#L118](../src/orchestrator/resolve.ts#L118), [src/orchestrator/resolve.ts#L176](../src/orchestrator/resolve.ts#L176).
- That logic only marks nodes as changed when they are absent from trust state, and explicitly does not recompute content hashes against current graph content: [src/orchestrator/resolve.ts#L181-L194](../src/orchestrator/resolve.ts#L181-L194).

Why this matters:

- If trust state survives but the snapshot file is missing, modified nodes that still have trust records can be treated as unchanged.
- In the worst case, `target.kind === 'changed'` resolves to no nodes and the guardrail layer refuses the run as a low-value no-op.

The fallback should be conservative. Right now it can be falsely reassuring.

### 7. Medium: public error handling collapses useful domain distinctions into generic orchestrator/internal failures

The code has a typed error model, but the public surfaces do not consistently preserve it.

- The orchestrator catches predictable failures and wraps them into a generic `OrchestratorError` with `classification: 'platform'`: [src/orchestrator/interpret.ts#L239-L242](../src/orchestrator/interpret.ts#L239-L242), [src/orchestrator/interpret.ts#L359-L363](../src/orchestrator/interpret.ts#L359-L363).
- `mapToMcpError` only special-cases `MalformedWorkflowError`, `ZodError`, `ConfigurationError`, and `ExecutionConfigError`: [src/errors.ts#L52-L72](../src/errors.ts#L52-L72).
- It does not map `ExecutionInfrastructureError`, `ExecutionPreconditionError`, `TrustPersistenceError`, or `SynthesisError` at all.

Why this matters:

- Tool consumers lose the distinction between configuration failures, unavailable capability, infrastructure failure, and internal defects.
- The agent-facing surface becomes less machine-usable exactly where the architecture says it should be strongest.

### 8. Medium: persisted trust metadata is internally inconsistent and partially dead

The trust persistence contract is only half-implemented.

- The persistence API expects a `workflowHash`: [src/trust/persistence.ts#L83](../src/trust/persistence.ts#L83).
- The orchestrator writes `workflowId` into that slot instead: [src/orchestrator/interpret.ts#L279](../src/orchestrator/interpret.ts#L279).
- The persisted `workflowHash` field is then never read back anywhere in the implementation.

Why this matters:

- The on-disk schema claims to persist workflow identity/versioning information that the runtime does not actually use.
- That kind of dead persisted field is a migration and debugging trap. It suggests a stronger consistency guarantee than the code really provides.

This is not as urgent as the execution-path issues, but it should be cleaned up before the persistence format hardens.

### 9. Medium: the tree is not lint-clean and currently violates its own coding rules

The repository's own lint script is failing right now.

- The script itself is defined here: [package.json#L18](../package.json#L18).
- Current failures include forbidden non-null assertions in production code:
  [src/diagnostics/annotations.ts#L52](../src/diagnostics/annotations.ts#L52)
  [src/diagnostics/annotations.ts#L65](../src/diagnostics/annotations.ts#L65)
  [src/execution/pin-data.ts#L55](../src/execution/pin-data.ts#L55)
  [src/execution/pin-data.ts#L62](../src/execution/pin-data.ts#L62)

I would treat this as more than cosmetic. The project explicitly positions itself as strict and publishable. Shipping while the repository's own policy gate is red sends the opposite signal.

### 10. Medium: there are still silent-degradation paths that conflict with the project's fail-fast stance

Several file/config/cache readers swallow errors and quietly return `undefined` instead of distinguishing “not found” from “broken”. Examples:

- project/global credential readers in [src/execution/rest-client.ts#L188-L226](../src/execution/rest-client.ts#L188-L226)
- pin-data cache reader in [src/execution/pin-data.ts#L128-L142](../src/execution/pin-data.ts#L128-L142)

Why this matters:

- Missing config is one thing; malformed config, permission errors, or corrupt cache artifacts are different failure modes.
- The codebase's own rules prefer explicit, typed failures over silent degradation.

I would tighten these before release, especially for configuration sources.

## Research Cross-Check

After the code-only review, I read the feasibility and capability research in:

- [research/FEASIBILITY.md](research/FEASIBILITY.md)
- [research/validation_surface_map.md](research/validation_surface_map.md)
- [research/execution_feasibility.md](research/execution_feasibility.md)
- [research/integration_and_failure_feasibility.md](research/integration_and_failure_feasibility.md)
- [research/graph_parsing_feasibility.md](research/graph_parsing_feasibility.md)
- [research/n8nac_capabilities.md](research/n8nac_capabilities.md)
- [research/n8n_platform_capabilities.md](research/n8n_platform_capabilities.md)
- [research/trust_and_change_detection_feasibility.md](research/trust_and_change_detection_feasibility.md)
- [research/static_analysis_feasibility.md](research/static_analysis_feasibility.md)
- [research/diagnostics_feasibility.md](research/diagnostics_feasibility.md)
- [research/testing_experiences.md](research/testing_experiences.md)

Those documents mostly reinforce the earlier audit, but they also surface a few additional compatibility issues.

### 11. High: rename handling in the trust subsystem conflicts with the research model

The trust/change research is explicit that node renames are trust-breaking because node names are connection keys and expression targets, so a rename should behave like remove+add, not like a cosmetic metadata change: [research/trust_and_change_detection_feasibility.md](research/trust_and_change_detection_feasibility.md).

The current implementation does the opposite:

- rename detection rewrites matching remove+add pairs into `metadata-only`: [src/trust/change.ts#L244-L274](../src/trust/change.ts#L244-L274)
- trust invalidation then explicitly transfers trust to the renamed node: [src/trust/trust.ts#L109-L126](../src/trust/trust.ts#L109-L126)

Why this matters:

- A node rename can invalidate `$('NodeName')` references even when the renamed node's own parameters are unchanged.
- Preserving trust across rename therefore overstates confidence and can hide graph breakage exactly where the research says the system must be conservative.

This is a real semantic mismatch, not just an implementation preference.

### 12. Medium: the expression parser under-covers the syntax surface documented in the research and already handled by n8n

The static-analysis research found that n8n already has a richer reference parser covering multiple legacy and modern access forms, including `$node["Name"]`, `$node.Name`, `$items("Name")`, `$input.item`, and literal `itemMatching(n)` forms: [research/static_analysis_feasibility.md](research/static_analysis_feasibility.md).

The current implementation intentionally supports only four patterns: [src/static-analysis/expressions.ts#L5-L9](../src/static-analysis/expressions.ts#L5-L9).

That means the current parser is narrower than the researched feasible surface and narrower than n8n's own parser. In particular, I do not see support here for:

- legacy `$node.Name` references
- legacy `$items("NodeName")` references
- explicit `$binary` field access
- `itemMatching` with the literal numeric argument form called out in the research

Why this matters:

- The research conclusion was not just that heuristic parsing is feasible; it was that existing platform logic already covers more of the syntax surface than the local implementation does.
- Under-coverage here directly weakens the value of the static-analysis layer and increases the chance of false negatives on real workflows.

I would prefer to reuse or more closely mirror the n8n parser behavior rather than maintain a narrower regex subset long-term.

### 13. Medium: MCP capability detection is not modeling workflow-level accessibility, only tool registration

The research adds an important nuance to the earlier MCP findings:

- workflow MCP access is gated per workflow via `settings.availableInMCP`
- that flag can disappear during push cycles in current n8nac workflows, which makes MCP availability opportunistic rather than stable: [research/validation_surface_map.md](research/validation_surface_map.md), [research/testing_experiences.md](research/testing_experiences.md), [research/integration_and_failure_feasibility.md](research/integration_and_failure_feasibility.md)

The current capability probe does not model that. It only discovers whether the MCP server exposes the tool names at all by calling them with empty args: [src/execution/capabilities.ts#L145-L156](../src/execution/capabilities.ts#L145-L156). The only resource-specific availability check it performs is a REST workflow existence check: [src/execution/capabilities.ts#L69](../src/execution/capabilities.ts#L69).

Why this matters:

- Even after the production surfaces start passing `callTool`, the capability model can still report MCP as available when the specific workflow is not accessible through MCP.
- That would produce false-positive capability reporting and route selection in exactly the scenario the research says is common during normal push/debug cycles.

This strengthens the earlier conclusion that MCP must be treated as opportunistic and explicitly workflow-scoped, not just process-scoped.

### 14. Medium: the implementation is not yet aligned with the researched execution split of REST for running and MCP for narrow inspection/schema discovery

The execution and validation-surface research is quite consistent:

- REST is the required path for bounded execution
- MCP is especially valuable for `get_execution` node filtering and `prepare_test_pin_data` schema discovery: [research/execution_feasibility.md](research/execution_feasibility.md), [research/validation_surface_map.md](research/validation_surface_map.md), [research/n8n_platform_capabilities.md](research/n8n_platform_capabilities.md)

The current code only implements the first half of that split:

- it has REST-triggered execution wired in
- it does not integrate `prepare_test_pin_data`
- it does not use MCP `get_execution` as the narrow inspection path
- it does not use the polling/inspection abstractions that were built for this purpose

This partly overlaps with findings 1, 4, and 5, but the research makes the compatibility issue sharper: the gap is not just “unfinished implementation.” It is a divergence from the architecture that the feasibility work already identified as the practical route through the underlying n8n and n8nac surfaces.

## Research Impact

The research did not overturn the original audit. It made three areas look worse:

1. Rename-based trust preservation is harder to justify than the code-only review suggested.
2. The expression parser is leaving reachable coverage on the table despite existing platform prior art.
3. MCP support is more fragile and more workflow-specific than the current capability model assumes.

## Strengths

The codebase is not far off. A few things are already strong and worth preserving:

- The subsystem boundaries are generally clear. `static-analysis`, `trust`, `guardrails`, `diagnostics`, `execution`, and `orchestrator` are separated in a way that is easy to reason about.
- The pure logic modules are well covered. The trust, guardrail, static-analysis, and diagnostics units have meaningful tests rather than trivial assertions.
- `strict` typechecking is enabled and currently passing.
- The package entry surface in [src/index.ts](../src/index.ts) is coherent and intentionally narrow.

## Recommended Release Gate

Before calling this release-ready, I would require at least the following:

1. Unify the execution and diagnostics data contracts, and wire the orchestrator through the real extraction/polling path.
2. Fix snapshot persistence so trust hashes remain stable across save/load cycles.
3. Decide whether capability detection is allowed to hard-fail without runtime config. If not, make `explain` and static-only flows truly offline-safe.
4. Remove or finish the dead execution paths: MCP backend, polling, and pin-data artifact reuse should either be integrated or explicitly cut.
5. Make the tree lint-clean.
6. Replace local `file:` dependencies before any standalone/package/plugin release.