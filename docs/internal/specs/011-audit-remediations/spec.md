# Feature Specification: Audit Findings Remediation

**Feature Branch**: `011-audit-remediations`  
**Created**: 2026-04-19  
**Status**: Draft  
**Input**: User description: "Remediate post-implementation audit findings across all severity levels (S0-S3) covering runtime bugs, structural defects, meaningful gaps, and minor issues"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent receives correct execution diagnostics (Priority: P1)

When an agent runs a validation request that triggers workflow execution, the system must transform raw execution data into the internal diagnostic format correctly so that findings accurately reflect what happened at runtime. Currently the execution-to-diagnostics pipeline is broken (S0-1), producing undefined fields and misclassified API errors.

**Why this priority**: Without correct execution data transformation, every execution-based validation produces garbage diagnostics. This is the most fundamental runtime bug — nothing downstream can be correct if input data is wrong.

**Independent Test**: Run a validation request against a workflow with a known API node error. Verify the diagnostic summary correctly identifies the failing node, the error type, and the HTTP status code.

**Acceptance Scenarios**:

1. **Given** a workflow with an HTTP node returning a 404 error, **When** validation runs with execution, **Then** the diagnostic summary identifies the node, classifies the error as "not-found", and includes the HTTP status code 404.
2. **Given** a workflow that executes successfully, **When** validation runs, **Then** the diagnostic summary contains correct node results with actual output data (not undefined fields).
3. **Given** the `extractExecutionData()` utility exists, **When** the orchestrator receives raw REST execution data, **Then** it uses `extractExecutionData()` to transform the response before passing to diagnostics.

---

### User Story 2 - Trust system accurately tracks node changes (Priority: P1)

When a node's content or connections change, the trust system must detect all forms of change — including incoming edge changes (S0-5), content hash verification (S0-3), and workflow identity (S0-4). Currently, shadow trust checks skip hash verification, incoming edge changes are missed, and workflow identity uses file paths instead of content hashes.

**Why this priority**: Trust boundaries are a core product concept. If trust incorrectly persists for changed nodes, validation skips nodes it should check — producing false confidence.

**Independent Test**: Modify a node's incoming connection and verify the trust system flags it as changed. Modify node content for a previously trusted node and verify trust is revoked.

**Acceptance Scenarios**:

1. **Given** a trusted node with unchanged content, **When** a new incoming edge is added to that node, **Then** the change detection system flags the node as changed.
2. **Given** a previously trusted node, **When** its content (parameters, settings) changes but its name stays the same, **Then** trust is revoked because the content hash no longer matches.
3. **Given** a workflow, **When** trust state is persisted, **Then** the workflow identifier is a content-derived hash, not an absolute file path.
4. **Given** trust state from one machine, **When** loaded on a different machine for the same project, **Then** trust records are recognized correctly (portable identity).

---

### User Story 3 - System degrades gracefully when execution backend is unavailable (Priority: P2)

When the n8n REST API is unreachable (network issues, missing credentials), the system should degrade to static-only analysis instead of crashing. Currently `probeRest` throws on infrastructure errors (S1-6), making the `static-only` capability path unreachable. The credential resolution also only reads `process.env` instead of the full cascade (S1-3).

**Why this priority**: Agents working without a running n8n instance should still get static analysis value. Crashing on missing credentials is a poor agent experience.

**Independent Test**: Run a validation request with no n8n credentials configured. Verify the system returns static analysis findings instead of an error.

**Acceptance Scenarios**:

1. **Given** no n8n REST API is reachable, **When** validation is requested, **Then** the system performs static-only analysis and returns findings with a typed capability result (not an error or silent degradation).
2. **Given** credentials configured at multiple levels (env, n8nac config, global), **When** the system resolves credentials, **Then** it follows the full 4-level cascade, not just `process.env`.
3. **Given** an `explain` request, **When** no runtime credentials exist, **Then** the system can still provide static analysis explanations.

---

### User Story 4 - Static analysis produces accurate, deduplicated findings (Priority: P2)

When the system analyzes workflows statically, it must handle disabled nodes (S2-7), Merge node modes (S2-8), expanded expression patterns (S2-6), and deduplicate findings across overlapping paths (S2-13). Currently disabled nodes are treated as active, Merge is blanket-classified, expression coverage is narrow, and multi-path findings duplicate.

**Why this priority**: Static analysis is the first line of validation and runs on every request. Inaccurate findings erode agent trust in the tool.

**Independent Test**: Analyze a workflow containing a disabled node, a Merge node in "combine" mode, and `$node.Name` expressions. Verify: disabled node is excluded from active analysis, Merge classification is mode-aware, expression references are traced, and duplicate findings across paths are collapsed.

**Acceptance Scenarios**:

1. **Given** a workflow with a disabled node, **When** static analysis runs, **Then** the disabled node is not flagged for data-loss or treated as an active participant.
2. **Given** a Merge node in "combine" mode, **When** classification runs, **Then** it is classified as shape-augmenting, not shape-preserving.
3. **Given** expressions using `$node.Name.data`, `$items("NodeName")`, or `$binary` syntax, **When** expression analysis runs, **Then** these references are traced to their source nodes.
4. **Given** two overlapping validation paths sharing nodes, **When** both paths produce findings for the same node with the same kind and message, **Then** only one finding appears in the final output.

---

### User Story 5 - Guardrails and trust-boundary-aware validation work as designed (Priority: P2)

Node-targeted validation must respect trust boundaries (S2-1) instead of always propagating to the full graph. Guardrail evaluation order must match the documented strategy (S2-2). Path scoring must incorporate the documented factors (S2-3). Evidence assembly must account for removed nodes (S2-4). Rename handling must invalidate trust (S2-5).

**Why this priority**: These are the product behaviors that differentiate n8n-vet from a simple linter. Without correct guardrails and trust-aware scoping, the tool loses its core value proposition of bounded, efficient validation.

**Independent Test**: Submit a node-targeted validation for a node surrounded by trusted neighbors. Verify propagation stops at trust boundaries rather than expanding to the full graph.

**Acceptance Scenarios**:

1. **Given** a node-targeted validation request with trusted neighboring nodes, **When** slice resolution runs, **Then** propagation stops at trust boundaries instead of reaching the full graph edge.
2. **Given** a validation request that triggers guardrail evaluation, **When** guardrails fire, **Then** they evaluate in the order documented in STRATEGY.md.
3. **Given** a workflow with removed nodes, **When** evidence is assembled, **Then** removed nodes are included in the evidence basis.
4. **Given** a node that was renamed, **When** change detection runs, **Then** trust is invalidated for that node (not transferred).

---

### User Story 6 - System handles concurrent access and edge cases safely (Priority: P3)

Trust state file writes must be atomic and handle concurrent access (S1-7). The execution lock must have staleness protection (S1-8). Error classification must cover all domain error types (S2-16). Path validation must prevent traversal attacks (S2-11).

**Why this priority**: These are safety and robustness concerns. While less likely to cause immediate incorrect output, they can cause data corruption, security issues, or confusing error messages under real-world conditions.

**Independent Test**: Simulate two concurrent validation requests writing trust state. Verify neither corrupts the file. Attempt path traversal in a workflow path input and verify it is rejected.

**Acceptance Scenarios**:

1. **Given** two concurrent validation requests completing simultaneously, **When** both attempt to persist trust state, **Then** neither corrupts `trust-state.json` and both writes succeed.
2. **Given** an execution lock held by a process that crashed, **When** a new validation request arrives after the lock's expiry timeout, **Then** the stale lock is released and the new request proceeds.
3. **Given** a workflow path containing `../` traversal, **When** submitted via MCP or CLI, **Then** the system rejects it with an appropriate error before any file access occurs.
4. **Given** a `TrustPersistenceError` thrown during validation, **When** mapped to MCP error format, **Then** it receives a specific error code (not generic `internal_error`).

---

### User Story 7 - Codebase quality and minor correctness issues resolved (Priority: P3)

Minor issues across the codebase: synchronous file reads in async contexts (S3-1), regex state bugs (S3-2), permissive test config (S3-3), lint errors (S3-4), silent data overwrites (S3-5), imprecise error classification (S3-7), null data propagation (S3-9), performance issues (S3-10, S3-13, S3-14), floating promises (S3-15, S3-23), weak typing (S3-17, S3-19), and other minor defects.

**Why this priority**: These individually have low impact but collectively represent technical debt. Addressing them improves reliability, maintainability, and correctness at the margins.

**Independent Test**: Run the full lint suite after fixes and verify zero errors. Run the test suite and verify all tests pass. Verify `passWithNoTests` is set to `false` in vitest config.

**Acceptance Scenarios**:

1. **Given** the codebase after remediation, **When** `biome check` runs, **Then** zero lint errors are reported.
2. **Given** the vitest configuration, **When** inspected, **Then** `passWithNoTests` is `false`.
3. **Given** async contexts that read files, **When** they execute, **Then** they use async file I/O (not `readFileSync`).
4. **Given** CLI output piped to a file, **When** inspected, **Then** no ANSI escape codes are present.

---

### Edge Cases

- What happens when trust-state.json is corrupted mid-write? System should detect corruption on next read and treat as empty/missing trust state.
- What happens when a workflow references a node name that doesn't exist (stale expression reference)? Static analysis should flag this as a finding.
- What happens when the execution backend returns an unexpected response shape? The transformation layer should throw a typed error, not silently produce undefined fields.
- What happens when multiple rename operations occur in a single change set? Each rename should be independently detected and trust invalidated for each.
- What happens when snapshot deserialization encounters a node with execution settings not present in the serialized format? The system should use safe defaults and flag the node as potentially changed.

## Requirements *(mandatory)*

### Functional Requirements

**S0 — Runtime Fixes (must-fix)**

- **FR-001**: System MUST use the canonical `extractExecutionData()` function to transform raw REST responses into the internal `ExecutionData` format in the orchestrator pipeline.
- **FR-001a**: ~~REVISED~~ System MUST verify the n8n MCP tool contracts (`test_workflow`, `get_execution`, `prepare_test_pin_data`) against the live n8n instance and n8n source code. The original REST execution endpoint (`POST /workflows/:id/run`) is an internal/editor-only API requiring session auth — it is not accessible via public API key. Execution triggering moves to MCP `test_workflow` exclusively. REST public API (`GET /executions/:id`) remains valid for execution data retrieval and health probing.
- **FR-002**: System MUST have a single `ExecutionData` type definition (in `execution/types.ts`), with all consumers referencing that single source of truth.
- **FR-003**: System MUST use the canonical `isTrusted` function from `trust/trust.ts` (with content hash verification) for all trust checks, with no shadow implementations.
- **FR-004**: System MUST pass a content-derived workflow hash (not file path) to `persistTrustState`.
- **FR-005**: System MUST detect incoming edge changes (backward graph edges) during change detection, not only outgoing edges.

**S1 — Structural Fixes**

- **FR-006**: System MUST use `NodeIdentity` branded type as keys in all `WorkflowGraph` maps, eliminating bare `string` keys and `as` casts.
- **FR-007**: System MUST include node execution settings (retryOnFail, executeOnce, onError) in serialized snapshots and reconstruct them during deserialization.
- **FR-008**: System MUST resolve execution credentials using the full 4-level cascade (explicit, env, n8nac config, global), not just `process.env`.
- **FR-009**: ~~REVISED~~ System MUST wire MCP `test_workflow` as the **sole execution triggering path**, replacing all `executeBounded` REST calls. The orchestrator dispatches all execution (both targeted and smoke) via `executeSmoke` with pin data placement controlling scope. `McpToolCaller` must be plumbed through deps/request. The `executeBounded()` function, `destinationNode` request field, and REST-based execution triggering are extracted to a separate phase (phase-12).
- **FR-010**: System MUST use cached pin data in the execution pipeline (read before constructPinData, write after successful runs).
- **FR-011**: ~~REVISED~~ System MUST degrade to static-only analysis when no execution backend (MCP) is available, returning a typed capability result (not throwing). Capability detection checks MCP tool availability as the primary gate. REST reachability is checked only for data retrieval (execution status/results via public API). This is explicit capability detection, not a silent fallback.
- **FR-012**: System MUST write trust-state.json atomically (write-to-temp then rename) and handle concurrent access.
- **FR-013**: System MUST protect the execution lock against staleness with a configurable timeout and make the lock injectable for testing.
- **FR-014**: System MUST use a publishable dependency reference for `@n8n-as-code/transformer` (not `file:` protocol).

**S2 — Gap Closures**

- **FR-015**: System MUST pass trust state to slice resolution so that propagation stops at trust boundaries during node-targeted validation.
- **FR-016**: System MUST evaluate guardrails in the order specified in STRATEGY.md: redirect, narrow, warn, refuse.
- **FR-017**: System MUST score paths using the factors defined in STRATEGY.md: changed opaque/shape-replacing nodes, untrusted boundaries, changed branching logic, prior failures, estimated execution cost (negative), overlap with already-validated coverage (negative).
- **FR-018**: System MUST include removed nodes when assembling evidence, and compute evidence only once per evaluation (not redundantly).
- **FR-019**: System MUST treat node renames as trust-invalidating events.
- **FR-020**: System MUST recognize `$node.Name` (dot syntax), `$items("Name")`, `$binary` access, and `itemMatching(n)` expression patterns.
- **FR-021**: System MUST check the disabled field from raw node data during graph construction and exclude disabled nodes from active analysis.
- **FR-022**: System MUST classify Merge nodes based on their mode parameter (not blanket shape-preserving).
- **FR-023**: System MUST narrow catch blocks to expected error codes (e.g., ENOENT) and re-throw unexpected errors.
- **FR-024**: System MUST derive workflow identifiers that are portable across machines (project-relative or content-derived). Complements FR-004 — both should use the same content-hashing approach.
- **FR-025**: System MUST validate that workflow paths resolve under the current working directory or configured project root.
- **FR-026**: System MUST detect TTY/NO_COLOR and suppress ANSI codes when output is piped.
- **FR-027**: System MUST deduplicate static findings by (node, kind, message) tuple across multi-path analysis.
- **FR-028**: System MUST use discriminated union schema for MCP input validation to enforce field requirements per request kind.
- **FR-029**: System MUST rename `findFurthestDownstream` to accurately reflect its behavior, or implement actual topological ordering.
- **FR-030**: System MUST map all typed domain error classes to specific MCP error codes (not generic `internal_error`).

**S3 — Minor Fixes**

- **FR-031**: System MUST use async file I/O in async contexts (no `readFileSync` in async functions).
- **FR-032**: System MUST avoid module-level `/g` regex state bugs (use local instances or `matchAll`).
- **FR-033**: System MUST set `passWithNoTests: false` in vitest configuration.
- **FR-034**: System MUST resolve all biome lint errors.
- **FR-035**: System MUST throw or emit a diagnostic on duplicate `displayName` during graph construction.
- **FR-036**: System MUST distinguish HTTP 404 from 5xx errors in REST client responses.
- **FR-037**: System MUST reject `null` values in pin data normalization explicitly.
- **FR-038**: System MUST use efficient data structures for BFS traversal (index-based queue, not Array.shift).
- **FR-039**: System MUST use typed domain errors consistently (no bare `Error` throws).
- **FR-040**: System MUST handle all floating promises (prefix with `void` or add `.catch`).
- **FR-041**: System MUST use precise union types for serialized fields (`NodeClassification` union in `SerializedGraphNode`) and domain types (`ValidationLayer`, `NodeIdentity` in surface types).
- **FR-042**: System MUST distinguish "no findings produced" from "analysis did not run" in evidence basis tracking.

**Test Gaps**

- **FR-043**: System MUST include realistic mock payloads matching actual REST response shapes in orchestrator tests.
- **FR-044**: System MUST have test coverage for bracket-notation expression syntax, cycle handling in backward walks, `rerun.ts`, `evidence.ts`, and snapshot hash stability.
- **FR-045**: System MUST gate integration tests in the standard `npm test` pipeline.

### Key Entities

- **ExecutionData**: The canonical representation of a workflow execution result. Must have a single definition consumed by all subsystems.
- **TrustState**: Records which nodes have been previously validated. Keyed by content-derived identifiers, not file paths.
- **WorkflowGraph**: The in-memory graph representation with `NodeIdentity`-typed keys for type safety.
- **ChangeSet**: The diff between current and prior workflow state, including added, removed, modified, and renamed nodes — with incoming edge changes.
- **DiagnosticSummary**: Compact validation output with deduplicated findings across paths.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All validation requests that involve execution produce correct, non-undefined diagnostic fields — 100% of execution results are accurately transformed and classified.
- **SC-002**: Trust revocation correctly detects all change types (content, incoming edges, renames) — zero false-positive trust retention for changed nodes.
- **SC-003**: System returns useful static analysis results when no execution backend is available — zero crashes from missing credentials or unreachable API.
- **SC-004**: Static analysis recognizes all documented n8n expression syntaxes and produces zero duplicate findings across overlapping paths.
- **SC-005**: Node-targeted validation scopes to trust boundaries — validation work scales with change size, not workflow size.
- **SC-006**: Zero data corruption from concurrent trust state writes under simultaneous validation requests.
- **SC-007**: All lint errors resolved — `biome check` reports zero violations.
- **SC-008**: Test suite covers all identified gaps — no test file has zero coverage for exported functions, and integration tests run as part of the standard test gate.
- **SC-009**: Workflow path inputs containing traversal patterns are rejected before any file system access occurs.
- **SC-010**: The package can be installed from a registry without requiring specific sibling directory layouts.

## Clarifications

### Session 2026-04-19 (initial)

- Q: Should S0-2 (REST API contract verification against live n8n) be in scope or deferred? → A: In scope — live n8n instance available at localhost:5678, n8n source at `../n8n`, n8n docs at `../n8n-docs`. Verify actual API contract and correct mismatches.
- Q: FR-009 — Wire MCP smoke test path or remove dead code? → A: Wire it. The locked design assigns smoke tests to MCP (`test_workflow` tool). Complete the MCP smoke test execution path end-to-end.
- Q: FR-016/FR-017 — Align code to STRATEGY.md or update docs? → A: Code aligns to STRATEGY.md. Fix guardrail evaluation order and path scoring to match the documented, research-backed design.

### Session 2026-04-19 (execution backend revision)

- Q: `POST /workflows/:id/run` is not a public API endpoint — it uses session/cookie auth (editor-internal). Can we use it? → A: **No.** Internal API is fragile and undocumented. Ruled out.
- Q: What replaces bounded execution (`executeBounded` + `destinationNode`)? → A: MCP `test_workflow` with pin data placement. Pin data at trusted boundaries achieves equivalent scope control — pinned nodes don't execute, so the "slice" is effectively the unpinned region. True bounded execution (`destinationNode`) is deferred to future investigation (possible n8n feature request or internal API hacking).
- Q: Does n8nac provide execution triggering? → A: Only via webhook endpoints (`POST /webhook-test/:path`), which requires HTTP-triggered workflows and doesn't support pin data. Not suitable.
- Q: Should we harvest trust evidence from nodes outside the target slice that happen to execute? → A: Deferred to v0.2.0. For v0.1.0, only nodes in the target slice produce diagnostic/trust results.
- Q: FR-001a, FR-009, FR-011 — how do these change? → A: Revised in-place above. REST execution triggering removed from scope. MCP becomes sole execution backend. REST public API retained for read-only operations (execution data retrieval, health probe).

## Assumptions

- A live n8n instance is available at `localhost:5678` for MCP tool contract verification and integration testing. The n8n source code is at `../n8n` and documentation at `../n8n-docs` for reference.
- The audit findings document (`docs/audit/audit.findings.md`) is the authoritative and complete list of issues to remediate.
- STRATEGY.md represents the intended design. Where implementation diverges, code will be updated to match STRATEGY.md (confirmed for guardrail order and path scoring).
- **Execution backend is MCP-only for triggering.** `test_workflow` is the sole execution trigger. REST public API is used only for read-only operations (execution data retrieval, health checks). `executeBounded()` and `destinationNode` are extracted to phase-12.
- `@n8n-as-code/transformer` is published on npm (v1.2.0 available). Use `^1.2.0` from the npm registry (already done).
- Existing tests should continue to pass after remediation, with updated mocks where the current mocks are unrealistic.
