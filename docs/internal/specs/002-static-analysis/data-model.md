# Data Model: Static Analysis Subsystem

**Date**: 2026-04-18
**Feature**: 002-static-analysis

## Shared Types (already exist in `src/types/`)

These types are defined in Phase 1 and consumed by static analysis. Listed here for reference — not redefined.

| Type | File | Role in Static Analysis |
|------|------|------------------------|
| `NodeIdentity` | `identity.ts` | Branded string for graph node keys |
| `WorkflowGraph` | `graph.ts` | Primary output of `buildGraph()` |
| `GraphNode` | `graph.ts` | Node in the graph with classification |
| `Edge` | `graph.ts` | Directed connection between nodes |
| `NodeClassification` | `graph.ts` | `shape-preserving` / `shape-augmenting` / `shape-replacing` / `shape-opaque` |

### Modification Required: WorkflowGraph

Add `displayNameIndex` field to `WorkflowGraph` in `src/types/graph.ts`:

```
displayNameIndex: Map<string, string>
```

Maps display names (used in expressions like `$('Schedule Trigger')`) to property names (graph keys). Built during graph construction.

## Internal Types (new, defined in `src/static-analysis/`)

### StaticFinding

Structured diagnostic finding. Discriminated union on `kind`.

| Field | Type | Description |
|-------|------|-------------|
| `node` | `NodeIdentity` | Node that has the finding |
| `severity` | `'error' \| 'warning'` | Finding severity |
| `message` | `string` | Human-readable description |
| `kind` | discriminant | One of 7 finding kinds (see below) |
| `context` | varies by kind | Kind-specific context |

**Finding kinds and context shapes:**

| Kind | Context Fields | Severity |
|------|---------------|----------|
| `data-loss` | `upstreamNode: NodeIdentity`, `fieldPath: string`, `parameter: string` | error (warning if schema confirms field exists) |
| `broken-reference` | `referencedNode: string`, `parameter: string`, `expression: string` | error |
| `invalid-parameter` | `parameter: string`, `expected?: string` | warning |
| `unresolvable-expression` | `parameter: string`, `expression: string` | warning |
| `schema-mismatch` | `upstreamNode: NodeIdentity`, `fieldPath: string`, `parameter: string` | warning |
| `missing-credentials` | `credentialType: string` | warning |
| `opaque-boundary` | `opaqueNode: NodeIdentity` | warning |

### ExpressionReference

Parsed reference extracted from a node parameter expression.

| Field | Type | Description |
|-------|------|-------------|
| `node` | `NodeIdentity` | Node containing the expression |
| `parameter` | `string` | Parameter path (dot-separated for nested params) |
| `raw` | `string` | Raw expression string |
| `referencedNode` | `NodeIdentity \| null` | Resolved upstream node, or null if unresolvable |
| `fieldPath` | `string \| null` | Dot-separated field path (e.g. `name.first`), or null |
| `resolved` | `boolean` | Whether the reference was successfully resolved |

### StaticAnalysisResult

Top-level output combining all analysis outputs.

| Field | Type | Description |
|-------|------|-------------|
| `graph` | `WorkflowGraph` | The constructed graph |
| `findings` | `StaticFinding[]` | All findings from all analysis passes |
| `references` | `ExpressionReference[]` | All extracted expression references |

## Entity Relationships

```
WorkflowAST (input, from transformer)
    │
    ▼
WorkflowGraph (output of buildGraph)
    ├── nodes: Map<string, GraphNode>
    │       └── classification: NodeClassification (from classifyNode)
    ├── forward/backward: Map<string, Edge[]>
    └── displayNameIndex: Map<string, string>
    │
    ▼
ExpressionReference[] (output of traceExpressions)
    │   references GraphNode via referencedNode
    │
    ▼
StaticFinding[] (output of detectDataLoss, checkSchemas, validateNodeParams)
        references GraphNode via node, upstreamNode
```

## Node Classification Decision Table

| Condition | Classification |
|-----------|---------------|
| Type in shape-preserving set (If, Switch, Merge, NoOp, Wait, Filter, Sort, Limit, SplitInBatches, RemoveDuplicates) | `shape-preserving` |
| Type is `n8n-nodes-base.set` AND `options.include` is `'all'` or absent | `shape-augmenting` |
| Type is `n8n-nodes-base.set` AND `options.include` is `'selected'` | `shape-replacing` |
| Type is `n8n-nodes-base.set` AND `options.include` is `'none'` or `'except'` | `shape-replacing` |
| Non-empty `credentials` binding | `shape-replacing` |
| Type is `n8n-nodes-base.httpRequest` | `shape-replacing` |
| Type name contains `Trigger` or is a known trigger type | `shape-replacing` |
| Type is Code, Function, FunctionItem, or AI Transform | `shape-opaque` |
| Unrecognized/community node type | `shape-opaque` |

**Classification priority** (first match wins):
1. Explicit opaque set (Code, Function, FunctionItem, AI Transform)
2. Set node special handling (check `options.include`)
3. Explicit shape-preserving set
4. Trigger detection (type name contains `Trigger`)
5. HTTP Request detection
6. Credential-based detection (non-empty credentials → shape-replacing)
7. Default: shape-opaque (unknown node type)

## Validation Rules

- Graph invariant: every node name referenced in an edge must exist in the node map
- Graph invariant: node names (property names) must be unique
- Expression references to non-existent display names → `broken-reference` finding
- `$json.field` through intervening shape-replacing node (not first data source) → `data-loss` finding
- First data source rule: ALL backward paths must reach trigger/entry without passing through shape-augmenting or shape-replacing nodes
- Missing required parameters (from skills schema) → `invalid-parameter` finding
- Undefined credential type → `missing-credentials` finding
