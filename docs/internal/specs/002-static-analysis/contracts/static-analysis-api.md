# API Contract: Static Analysis Subsystem

**Date**: 2026-04-18
**Feature**: 002-static-analysis

## Public API Surface

The static analysis subsystem exposes five public functions, matching the cross-subsystem contract defined in INDEX.md. All functions are synchronous except `parseWorkflowFile()` which delegates to the async `TypeScriptParser`.

---

### `parseWorkflowFile(filePath: string): Promise<WorkflowAST>`

Parses a workflow file into a `WorkflowAST`. Auto-detects format by file extension.

**Input**: Absolute or relative path to a `.ts` or `.json` workflow file.
**Output**: `WorkflowAST` from `@n8n-as-code/transformer`.
**Errors**:
- `ConfigurationError` — `@n8n-as-code/transformer` not available
- `MalformedWorkflowError` — file cannot be parsed (not valid TS/JSON, not a workflow)
- Standard filesystem errors for missing/unreadable files

**Notes**: This is a convenience wrapper. Callers with an existing `WorkflowAST` can skip this and call `buildGraph()` directly.

---

### `buildGraph(ast: WorkflowAST): WorkflowGraph`

Constructs a traversable graph from a parsed workflow AST.

**Input**: `WorkflowAST` (from transformer).
**Output**: `WorkflowGraph` with:
- `nodes`: `Map<string, GraphNode>` keyed by property name
- `forward`: `Map<string, Edge[]>` (source → outgoing edges)
- `backward`: `Map<string, Edge[]>` (destination → incoming edges)
- `displayNameIndex`: `Map<string, string>` (display name → property name)
- `ast`: original AST (retained)

Each `GraphNode` includes a `classification` computed by the internal `classifyNode()` function.

**Errors**:
- `MalformedWorkflowError` — edge references non-existent node, or duplicate node names

**Invariants enforced**:
- Every node referenced in a connection exists in the node map
- Node property names are unique
- displayNameIndex has an entry for every node

---

### `traceExpressions(graph: WorkflowGraph, nodes: NodeIdentity[]): ExpressionReference[]`

Extracts expression references from the parameters of the specified nodes.

**Input**:
- `graph`: `WorkflowGraph` (for display name resolution and upstream node lookup)
- `nodes`: `NodeIdentity[]` — target nodes to analyze (scoped analysis)

**Output**: `ExpressionReference[]` — one entry per detected reference in the target nodes' parameters.

**Behavior**:
- Recursively walks all parameter values looking for expression strings (`={{ }}`)
- Parses 4 reference patterns: `$json.field`, `$('DisplayName')...`, `$input...`, `$node["DisplayName"]...`
- Resolves display names to property names via `graph.displayNameIndex`
- Records unresolvable references with `resolved: false`

**Errors**: None — unresolvable expressions are recorded, not thrown.

---

### `detectDataLoss(graph: WorkflowGraph, references: ExpressionReference[], targetNodes: NodeIdentity[]): StaticFinding[]`

Detects data-loss-through-replacement patterns for expression references in the target scope.

**Input**:
- `graph`: `WorkflowGraph`
- `references`: `ExpressionReference[]` from `traceExpressions()` (pre-filtered to target scope)
- `targetNodes`: `NodeIdentity[]` — nodes in scope for analysis

**Output**: `StaticFinding[]` containing `data-loss`, `broken-reference`, and `opaque-boundary` findings.

**Behavior**:
- For `$json.field` references: walks upstream through shape-preserving nodes until reaching a shape-replacing, shape-opaque, or entry node
- First data source rule: triggers and initial API nodes (no upstream data-producing predecessors on ALL backward paths) are NOT flagged
- Shape-opaque upstream: emits `opaque-boundary` warning instead of `data-loss` error
- Explicit `$('NodeName')` references: verifies named node exists and is upstream; bypasses data-loss check (paired-item tracking)
- Schema downgrade: if shape-replacing node has known output schema containing the referenced field, downgrade from `error` to `warning`

**Errors**: None — all findings are returned as `StaticFinding[]`.

---

### `checkSchemas(graph: WorkflowGraph, references: ExpressionReference[], schemaProvider?: NodeSchemaProvider): StaticFinding[]`

Checks referenced field paths against upstream node output schemas when available.

**Input**:
- `graph`: `WorkflowGraph`
- `references`: `ExpressionReference[]`
- `schemaProvider`: Optional `NodeSchemaProvider` from `@n8n-as-code/skills`. When absent, returns empty findings.

**Output**: `StaticFinding[]` containing `schema-mismatch` findings.

**Behavior**:
- For each resolved reference: looks up upstream node type schema via `schemaProvider.getNodeSchema()`
- Since output schemas are not available from skills (only input parameter schemas), schema checking is limited in v1
- Skips per-node when schema is not discoverable — never fails the whole run

**Notes**: This function is intentionally limited in v1. True output schema checking requires execution history inference (future work). The function exists to satisfy the contract and will become more useful as schema sources expand.

---

### `validateNodeParams(graph: WorkflowGraph, nodes: NodeIdentity[], schemaProvider?: NodeSchemaProvider): StaticFinding[]`

Validates node parameters against type definitions from n8nac skills.

**Input**:
- `graph`: `WorkflowGraph`
- `nodes`: `NodeIdentity[]` — target nodes to validate
- `schemaProvider`: Optional `NodeSchemaProvider`. When absent, returns empty findings.

**Output**: `StaticFinding[]` containing `invalid-parameter` and `missing-credentials` findings.

**Behavior**:
- For each target node: looks up `IEnrichedNode` via `schemaProvider.getNodeSchema(nodeType)`
- Checks required parameters present in `schema.properties`
- Checks credential bindings reference valid credential types
- Skips nodes with no schema available

---

## Error Types

### `MalformedWorkflowError`

Raised when the workflow structure is invalid (not parseable, broken connections, duplicate names). This is a tool-level failure, not a workflow finding.

```
class MalformedWorkflowError extends Error {
  readonly name = 'MalformedWorkflowError'
  readonly detail: string  // specific problem description
}
```

### `ConfigurationError`

Raised when required dependencies are unavailable at initialization time.

```
class ConfigurationError extends Error {
  readonly name = 'ConfigurationError'
  readonly dependency: string  // which dependency is missing
}
```

## Contract Notes

- All functions are pure transforms: same input produces same output, no side effects
- `schemaProvider` parameters are optional to support environments where `@n8n-as-code/skills` is not installed
- The subsystem does not persist any state — all state lives in the inputs
- `NodeIdentity` branded type is used throughout — callers must use `nodeIdentity()` to create values
- **Signature distinction from INDEX.md**: The INDEX.md cross-subsystem contract defines orchestrator-facing signatures (e.g., `detectDataLoss(graph, path): StaticFinding[]`). The signatures in this document are the actual implementation API, which is more flexible (e.g., `detectDataLoss(graph, references, targetNodes)`). The orchestrator (Phase 7) will adapt between the two — calling `traceExpressions()` first, then passing references to `detectDataLoss()`. Both represent the same subsystem capability at different abstraction levels.
