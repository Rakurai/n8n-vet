# Research: Static Analysis Subsystem

**Date**: 2026-04-18
**Feature**: 002-static-analysis

## R1: n8nac Transformer API Mapping

**Decision**: Use `TypeScriptParser.parseFile()` (async) for `.ts` files and `JsonToAstParser.parse()` (sync) for `.json` files. Both produce `WorkflowAST`.

**Rationale**: These are the only two parser entry points. `TypeScriptParser` uses ts-morph internally and is async. `JsonToAstParser` is synchronous. The public API should accept a file path and auto-detect format by extension.

**Alternatives considered**:
- `TypeScriptParser.parseCode()` — available for in-memory strings but not needed for file-based workflows.
- Direct JSON parsing without `JsonToAstParser` — rejected because the parser handles `propertyName` generation, AI dependency extraction, and connection mapping.

**Key findings**:
- `NodeAST.propertyName` is the stable graph key (matches `ConnectionAST.from.node` / `ConnectionAST.to.node`)
- `NodeAST.displayName` is the human-readable name used in n8n expressions
- `NodeAST.version` (not `typeVersion`) holds the schema version number
- `NodeAST.credentials` is `Record<string, CredentialReference> | undefined` (not `null`)
- `ConnectionAST.from.isError` is `boolean | undefined` (not guaranteed boolean)

## R2: NodeAST `disabled` Field Gap

**Decision**: `NodeAST` does not have a `disabled` field. Default `GraphNode.disabled` to `false` during graph construction.

**Rationale**: The n8nac transformer strips the `disabled` property during JSON→AST conversion. Since `disabled` is only used for execution skipping (not static analysis), defaulting to `false` is safe — static analysis should analyze all nodes regardless of disabled state. If a node is disabled, execution-backed validation (Phase 5) handles skipping it.

**Alternatives considered**:
- Patch the transformer to preserve `disabled` — rejected as it would require modifying an external dependency.
- Read raw JSON separately to extract `disabled` — rejected as over-engineering for a field not used in static analysis.

## R3: Expression Parser Porting Strategy

**Decision**: Port the 4 ACCESS_PATTERNS regex patterns from n8n's `node-reference-parser-utils.ts`. Build a ~100-150 line function. No dependency on `n8n-workflow`.

**Rationale**: The PRD and spec both mandate this approach. The relevant patterns are:
1. `$json.field` / `$json['field']` — implicit current input
2. `$('NodeName').first().json.field` / `.last()` / `.item` / `.all()` — explicit named reference
3. `$input.first().json.field` (and variants) — explicit current input
4. `$node["NodeName"].json.field` — legacy named reference

The expressions use display names (not property names), so resolution requires the `displayName → propertyName` index built during graph construction.

**Key implementation notes**:
- Walk all parameter values recursively (objects, arrays, strings)
- Expression strings start with `=` and contain `{{ }}` delimiters
- Within `{{ }}`, apply the 4 regex patterns
- Unresolvable patterns (dynamic keys, `$fromAI()`, computed names) → `resolved: false`
- Multiple expressions can appear in a single parameter value

## R4: Skills Package Integration

**Decision**: `@n8n-as-code/skills` is an optional dependency. Use `NodeSchemaProvider.getNodeSchema()` for parameter validation and `WorkflowValidator` as a secondary validation source. No `discoverOutputSchemaForNode()` exists.

**Rationale**: Research confirms that `@n8n-as-code/skills` provides input parameter schemas (via `IEnrichedNode.schema.properties`), not output schemas. The spec's FR-013/FR-015 references to `discoverOutputSchemaForNode()` need to be adapted:

- **Parameter validation (FR-017)**: Use `NodeSchemaProvider.getNodeSchema(nodeType)` to get `schema.properties`, then validate required params, enum values, and credential types against it.
- **Schema compatibility checking (FR-015/FR-016)**: Output schema discovery is NOT available from skills. Schema checking is limited to what can be inferred from parameter schemas and node type metadata. The spec's "skip when unavailable" behavior covers this — schema checking will skip for most nodes since output schemas are not discoverable.
- **Alternative for output schemas**: In future, prior execution results could provide output schema inference. For v1, schema checking is best-effort and degrades gracefully.

**Impact on spec**: FR-015 ("check referenced field paths against upstream node output schemas when schemas are available via `discoverOutputSchemaForNode()`") needs adjustment. The function doesn't exist. Schema checking should be scoped to what `NodeSchemaProvider` can provide, or deferred entirely to execution-backed validation.

**Alternatives considered**:
- Use `WorkflowValidator.validateWorkflow()` directly — it validates node types, versions, required params, and options. Could supplement or replace custom parameter validation. However, it operates on whole workflows, not individual nodes, and returns `ValidationResult` (errors/warnings), not our `StaticFinding[]` type. Best used as a cross-check, not the primary path.

## R5: DisplayName → PropertyName Index

**Decision**: Build the index during `buildGraph()` as a simple `Map<string, string>` (displayName → propertyName). Store it on the `WorkflowGraph` or pass it alongside.

**Rationale**: Expression references use display names (`$('Schedule Trigger')`), but the graph is keyed by property names. The index is needed by `traceExpressions()` and must be available wherever expression resolution happens.

**Key detail**: `WorkflowGraph` as defined in INDEX.md doesn't include this index. Two options:
1. Add a `displayNameIndex: Map<string, string>` field to `WorkflowGraph`
2. Return it as a separate artifact from `buildGraph()`

Option 1 is cleaner — the index is derived from graph data and logically belongs with the graph. However, modifying the shared type affects all consumers. Option 2 keeps the shared type clean but requires threading the index through call sites.

**Decision**: Add the index to `WorkflowGraph`. It's a computed property of the graph, not an external concern. Update `src/types/graph.ts` to include it.

## R6: AI Dependencies and Sub-Node Connections

**Decision**: AI sub-node connections (`NodeAST.aiDependencies`) are NOT represented as `ConnectionAST` entries. They live in a separate structure. For v1, treat AI agent nodes as shape-opaque.

**Rationale**: The transformer stores AI connections (language model, memory, tools, etc.) in `NodeAST.aiDependencies`, not in the `connections[]` array. The graph builder should include regular connections only. AI sub-nodes are not part of the main data flow graph.

**Impact**: No special handling needed in `buildGraph()`. AI dependencies are metadata on the node, not graph edges. Nodes that use AI dependencies (agent nodes, chain nodes) will be classified as shape-opaque due to their unpredictable output shape.
