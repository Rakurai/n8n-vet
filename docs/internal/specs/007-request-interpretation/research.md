# Research: Request Interpretation

**Phase**: 0 — Outline & Research
**Date**: 2026-04-19

## R1: Snapshot Storage Format

**Decision**: Serialize `WorkflowGraph` snapshots as JSON files in `.n8n-vet/snapshots/`, keyed by workflow ID.

**Rationale**: The orchestrator needs the previous `WorkflowGraph` to compute a precise `NodeChangeSet` via `computeChangeSet(previous, current)`. Storing the full AST (which is already part of `WorkflowGraph`) allows re-building the graph on load. However, storing the full AST is large. Instead, store the serialized `WorkflowGraph` nodes (with content hashes) — enough for change detection without the full AST.

Approach: store a lightweight snapshot containing each node's `name`, `type`, `typeVersion`, `parameters`, `credentials`, `disabled`, and `classification`. On load, reconstruct enough of a `WorkflowGraph` to feed to `computeChangeSet`. The trust subsystem's `computeChangeSet` compares nodes by identity and content hash — it needs the full `GraphNode` data, not just hashes.

**Alternatives considered**:
- Full AST serialization: Too large, unnecessary. The snapshot only needs enough to diff nodes.
- Content hash only (per trust state): Already used for approximate detection (FR-005). Full snapshot enables precise node-level diff (FR-004).
- Git-based diffing: Requires git integration, over-engineered for this use case.

**Final approach**: Serialize `WorkflowGraph` via `JSON.stringify` on the graph's `nodes` Map and `forward`/`backward` adjacency. Exclude the raw `ast` field. On load, reconstruct the Map structures. File path: `.n8n-vet/snapshots/{workflowId}.json`.

## R2: Workflow ID Derivation

**Decision**: Derive workflow ID from the workflow file path (normalized, absolute). The n8nac AST does not carry a stable workflow ID — n8n's numeric IDs are assigned server-side and not present in local `.ts` files.

**Rationale**: Trust state and snapshots are keyed by workflow ID. Using the file path (resolved to absolute, normalized) provides a stable, unique key for local workflows. This matches how the trust subsystem already keys entries (`workflowId: string`).

**Alternatives considered**:
- n8n workflow ID (numeric): Not available in local `.ts` files. Only present after push to n8n.
- Content hash of full workflow: Changes on every edit, useless as stable ID.
- User-provided ID: Adds friction, not aligned with "agent is the user" principle.

## R3: `interpret()` Function Signature and Dependency Injection

**Decision**: The `interpret()` function takes a `ValidationRequest` and a `Dependencies` object containing all subsystem interfaces. This makes the orchestrator testable with mocked subsystems without requiring a DI framework.

**Rationale**: Per CODING.md, "Declare dependencies in constructors or factory parameters. No hidden globals." The orchestrator calls 5 subsystems plus file I/O. Passing a dependencies object makes testing straightforward: mock any subsystem by replacing its entry.

```typescript
interface OrchestratorDeps {
  parseWorkflowFile: (path: string) => Promise<WorkflowAST>;
  buildGraph: (ast: WorkflowAST) => WorkflowGraph;
  loadTrustState: (workflowId: string) => TrustState;
  persistTrustState: (state: TrustState, workflowHash: string) => void;
  computeChangeSet: (previous: WorkflowGraph, current: WorkflowGraph) => NodeChangeSet;
  invalidateTrust: (state: TrustState, changeSet: NodeChangeSet, graph: WorkflowGraph) => TrustState;
  recordValidation: (...args) => TrustState;
  evaluate: (input: EvaluationInput) => GuardrailDecision;
  traceExpressions: (graph: WorkflowGraph, nodes: NodeIdentity[]) => ExpressionReference[];
  detectDataLoss: (...args) => StaticFinding[];
  checkSchemas: (...args) => StaticFinding[];
  validateNodeParams: (...args) => StaticFinding[];
  executeBounded: (...args) => Promise<ExecutionResult>;
  executeSmoke: (...args) => Promise<ExecutionResult>;
  getExecutionData: (...args) => Promise<ExecutionData>;
  constructPinData: (...args) => PinDataResult;
  synthesize: (input: SynthesisInput) => DiagnosticSummary;
  loadSnapshot: (workflowId: string) => WorkflowGraph | null;
  saveSnapshot: (workflowId: string, graph: WorkflowGraph) => void;
  detectCapabilities: (...args) => Promise<DetectedCapabilities>;
}
```

**Alternatives considered**:
- Global imports (direct function calls): Untestable. Prohibited by CODING.md.
- Class-based DI with constructor injection: Over-engineering for a single function. Prohibited by constitution (no single-implementor interfaces).
- Partial application / currying: Adds indirection without benefit.

## R4: Path Enumeration Strategy

**Decision**: DFS-based path enumeration from slice entry points to exit points, with visited-set cycle detection and the 20-candidate cap applied early via quick heuristic.

**Rationale**: Workflow graphs are DAGs in practice (cycles are rare and would indicate a misconfigured workflow). DFS from entry points to exit points naturally produces paths. The 20-candidate cap prevents combinatorial explosion. Quick heuristic (fewest error outputs, then fewest total nodes) pre-filters before full 4-tier ranking.

**Alternatives considered**:
- BFS: Produces shortest paths first, but path length is not a selection criterion. DFS is simpler.
- Full enumeration with post-hoc filtering: Risky on large branching workflows. Cap-first is safer.
- Sampling: Non-deterministic, violates SC-004.

## R5: "Meaningful New Coverage" Threshold for Additional-Greedy

**Decision**: An additional path is selected if it covers at least 1 changed node OR 1 untrusted boundary not already covered by previously selected paths. This is the simplest threshold that ensures every selected path adds new validation value.

**Rationale**: The additional-greedy algorithm re-ranks after each selection by newly covered elements. "Meaningful" means at least one new element — if a path covers nothing new, it's redundant. Using a threshold of 1 (rather than a percentage) is consistent with the product principle that even a single uncovered changed node justifies validation.

**Alternatives considered**:
- Percentage threshold (e.g., >10% new coverage): Over-complicated for v1. Hard to calibrate without real data.
- Fixed minimum (e.g., 3 new nodes): Arbitrary, could skip paths that cover 1 critical changed node.

## R6: Default `layer` Behavior

**Decision**: No default — `layer` is a required field in `ValidationRequest`. The MCP/CLI surface (Phase 8) decides the default, not the orchestrator.

**Rationale**: The orchestrator is a library function, not an end-user tool. It should not assume defaults — the caller (MCP tool or CLI) is responsible for providing all required fields. This follows contract-driven boundaries (constitution principle II).

## R7: Error vs. Diagnostic Return Strategy

**Decision**: The orchestrator returns `DiagnosticSummary` for ALL outcomes — including errors. Infrastructure errors (workflow not found, parse failure, execution startup failure) produce diagnostics with `status: 'error'`. Only internal bugs (assertion failures, unexpected exceptions) propagate as thrown errors.

**Rationale**: The agent (consumer) should always receive a structured response it can parse. Thrown exceptions require the MCP/CLI layer to construct an error diagnostic — pushing orchestration logic into the surface. By returning diagnostics for all foreseeable failures, the surface layer is kept thin.

The one exception: if static analysis throws (a programming bug, not a data issue), the error propagates. This is the fail-fast principle — a broken subsystem is not a user-facing error, it's a defect.
