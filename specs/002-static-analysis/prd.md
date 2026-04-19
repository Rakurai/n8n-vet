# Phase 2 — Static Analysis

## Goal

Build the static analysis subsystem: a local, offline analysis layer that operates entirely on parsed workflow files without requiring a running n8n instance. It is the cheap, default evidence layer — invoked on every validation run, either standalone or as a pre-flight check before execution-backed validation.

Static analysis catches structural and data-flow problems: broken expression references, data loss through shape-replacing nodes, schema mismatches, missing parameters, and invalid expressions. It cannot catch runtime problems (Code node output shape, LLM response format, actual data values). Those require execution-backed validation.

## Context Files

- `docs/reference/INDEX.md` — shared type definitions (WorkflowGraph, GraphNode, Edge, NodeIdentity, NodeClassification)
- `docs/CODING.md` — TypeScript implementation rules
- `docs/CONCEPTS.md` — shared vocabulary
- `docs/STRATEGY.md` — validation strategy and named patterns

## Scope

This subsystem is a leaf subsystem with no internal subsystem dependencies. It produces three outputs consumed by later phases: the traversable `WorkflowGraph`, structured `StaticFinding[]` findings, and `ExpressionReference[]` extracted references.

External package dependencies:
- `@n8n-as-code/transformer` — `TypeScriptParser`, `JsonToAstParser`, `WorkflowAST`, `NodeAST`, `ConnectionAST`
- `@n8n-as-code/skills` — node type schema validation, `discoverOutputSchemaForNode()`

No dependency on `n8n-workflow`. No running n8n instance required.

## Inputs and Outputs

**Inputs:**
- `WorkflowAST` from n8nac transformer (TypeScript or JSON source)
- Target nodes or path to analyze (from request interpretation)
- Node type schemas from n8nac skills package (when available)

**Outputs:**
- `WorkflowGraph` — the traversable graph representation (shared type, defined in INDEX.md)
- `StaticFinding[]` — structured findings from analysis
- `ExpressionReference[]` — extracted expression references

## Internal Types

```typescript
interface StaticFindingBase {
  node: NodeIdentity;
  severity: 'error' | 'warning';
  message: string;
}

type StaticFinding =
  | (StaticFindingBase & { kind: 'data-loss'; context: { upstreamNode: NodeIdentity; fieldPath: string; parameter: string } })
  | (StaticFindingBase & { kind: 'broken-reference'; context: { referencedNode: string; parameter: string; expression: string } })
  | (StaticFindingBase & { kind: 'invalid-parameter'; context: { parameter: string; expected?: string } })
  | (StaticFindingBase & { kind: 'unresolvable-expression'; context: { parameter: string; expression: string } })
  | (StaticFindingBase & { kind: 'schema-mismatch'; context: { upstreamNode: NodeIdentity; fieldPath: string; parameter: string } })
  | (StaticFindingBase & { kind: 'missing-credentials'; context: { credentialType: string } })
  | (StaticFindingBase & { kind: 'opaque-boundary'; context: { opaqueNode: NodeIdentity } });

interface ExpressionReference {
  node: NodeIdentity;
  parameter: string;
  raw: string;
  referencedNode: NodeIdentity | null;
  fieldPath: string | null;
  resolved: boolean;
}
```

## Behavior

### 1. Graph construction

Input: `WorkflowAST` (from `TypeScriptParser.parseFile()` or `JsonToAstParser`)

Build a `WorkflowGraph` from the AST:

1. For each `NodeAST` in the AST, create a `GraphNode`:
   - Copy `name`, `type`, `typeVersion`, `parameters`, `credentials`, `disabled`
   - Compute `classification` (see node classification below)

2. For each `ConnectionAST` in the AST, create an `Edge`:
   - Map `from.node` to `from`, `from.output` to `fromOutput`, `from.isError` to `isError`
   - Map `to.node` to `to`, `to.input` to `toInput`

3. Build forward and backward adjacency maps from the edge list.

Invariants:
- Every node referenced in an edge must exist in the node map. If not, raise an error.
- Node names are unique. Duplicate names are a malformed workflow — raise an error.

### 2. Node classification

Every node is classified into one of four categories based on its type metadata. Classification is deterministic from node type and parameters.

**shape-preserving:** Forwards input items without modifying `$json`.

Detection: node type is in the shape-preserving set:
- `n8n-nodes-base.if`, `n8n-nodes-base.switch`, `n8n-nodes-base.merge` (most modes), `n8n-nodes-base.noOp`, `n8n-nodes-base.splitInBatches`, `n8n-nodes-base.wait`, `n8n-nodes-base.filter`, `n8n-nodes-base.removeDuplicates`, `n8n-nodes-base.sort`, `n8n-nodes-base.limit`
- Other routing/flow-control nodes that do not modify item data
- Maintained as a known set. Unknown nodes fall through to credential/type-based classification.

**shape-augmenting:** Adds fields to input items. Node type is `n8n-nodes-base.set`. Behavior depends on `options.include`:
- `'all'` (default): augmenting
- `'selected'`: partially replacing
- `'none'` or `'except'`: reclassify as shape-replacing

**shape-replacing:** Replaces `$json` entirely. Detection (any of):
- Non-empty `credentials` binding
- Type is `n8n-nodes-base.httpRequest`
- Trigger node (type name contains `Trigger` or matches known trigger types)
- Set node with `options.include` of `'none'` or `'except'`

**shape-opaque:** Output shape unknowable statically. Detection:
- `n8n-nodes-base.code`, `n8n-nodes-base.function`, `n8n-nodes-base.functionItem`, `n8n-nodes-base.aiTransform`
- Any community/custom node type not recognized defaults to shape-opaque

### 3. Expression reference tracing

For each node in target scope, walk all parameter values recursively. Identify expression strings (values starting with `=` containing `{{ }}`). Parse references:

| Pattern | Resolution |
|---------|------------|
| `$json.field` | Immediate upstream node's output |
| `$json.field.nested` | Same, with dotted path |
| `$('NodeName').first().json.field` | Named node |
| `$('NodeName').last().json.field` | Named node |
| `$('NodeName').item.json.field` | Named node (paired item) |
| `$input.first().json.field` | Immediate upstream node |
| `$node["NodeName"].json.field` | Named node (legacy) |

Unparseable references (dynamic key access, computed node names, `$fromAI()`) recorded with `resolved: false`.

Implementation: Port the 4 ACCESS_PATTERNS regex patterns from n8n's `node-reference-parser-utils.ts`. Build ~100-150 line function. No dependency on `n8n-workflow`.

### 4. Data-loss-through-replacement detection

For each expression reference in target scope:

1. If `$json.field` (implicit current input):
   a. Find immediate upstream node.
   b. If upstream is shape-replacing:
      - If it's the first data source (trigger, or first credentialed/API node with no upstream data-producing predecessor): NOT data loss. "No upstream data-producing predecessor" means: walking backward from the node, every path reaches either a trigger node or the workflow entry without passing through another shape-augmenting or shape-replacing node. In branching graphs, ALL backward paths must satisfy this condition for the node to qualify as a first data source.
      - Otherwise (intervening): flag as `data-loss` with severity `error`.
   c. If upstream is shape-opaque: flag as `opaque-boundary` with severity `warning`.
   d. If upstream is shape-preserving: walk further upstream through shape-preserving nodes, apply same logic.

2. If `$('NodeName').*.json.field` (explicit reference):
   a. Verify named node exists and is upstream.
   b. If not reachable: flag as `broken-reference` with severity `error`.
   c. Explicit references bypass data-loss check (paired-item tracking).

3. If shape-replacing node has known output schema and referenced field exists: downgrade from `error` to `warning`.

First data source = no upstream shape-replacing or shape-augmenting predecessors in path. Triggers are always first data sources.

### 5. Schema compatibility checking

When upstream node has output schema:
1. Extract referenced field path
2. Check if field exists in schema
3. If not: flag as `schema-mismatch` with severity `warning`

Schema sources: n8nac skills `discoverOutputSchemaForNode()`, then prior execution inference, then skip.

### 6. Node parameter validation

For each node in target scope:
1. Retrieve type schema from n8nac skills
2. Validate parameters against schema
3. Check for missing required parameters
4. Check for undefined credential types

### 7. Opaque boundary handling

1. Emit `opaque-boundary` warning for each opaque node in path
2. Downstream `$json.field` references flagged with reduced confidence
3. Report which nodes are opaque boundaries
4. Recommend execution-backed validation when changed slice depends on evidence beyond opaque boundary

## Error Conditions

| Condition | Behavior |
|-----------|----------|
| Workflow file cannot be parsed | Raise error. Tool failure, not workflow failure. |
| Node referenced in connection doesn't exist | Raise error. Malformed workflow. |
| Duplicate node names | Raise error. Malformed workflow. |
| `@n8n-as-code/transformer` unavailable | Raise typed configuration error. Required dependency. |
| `@n8n-as-code/skills` unavailable | Raise typed configuration error. Required dependency. |
| Expression cannot be parsed | Record as `unresolvable-expression` with `resolved: false`. Continue. |
| Output schema not available for node | Skip schema check for that node. Continue. |

## Acceptance Criteria

- Given a `.ts` or `.json` workflow file, produce a `WorkflowGraph` and `StaticFinding[]`
- Graph construction handles both TypeScript and JSON workflow formats
- Node classification correctly categorizes shape-preserving, shape-augmenting, shape-replacing, and shape-opaque nodes
- Expression tracing extracts `$json.field`, `$('NodeName')...`, `$input...`, and `$node["Name"]...` patterns
- Data-loss detection flags intervening shape-replacing nodes but NOT first data sources (triggers, initial API nodes)
- Schema checking runs when schemas available, skips gracefully per-node when not
- `@n8n-as-code/transformer` and `@n8n-as-code/skills` are required — raise typed config error if absent
- Unit tests with fixture workflow files (TypeScript and JSON formats)
- No n8n instance required

## Decisions

1. **Expression parser:** Port 4 ACCESS_PATTERNS regex from n8n's `node-reference-parser-utils.ts`, build own ~100-150 line function. No `n8n-workflow` dependency.
2. **Shape-preserving set:** Maintain as static set, unknown nodes fall through to shape-opaque. Manual maintenance acceptable.
3. **Merge node modes:** Treat as shape-preserving for v1.
4. **Multi-output nodes:** `Edge.fromOutput` tracks output edges. Handled by existing design.
5. **Sub-workflow nodes:** Shape-opaque for v1. Cross-workflow validation deferred.
