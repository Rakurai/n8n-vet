# 1.4 Local Graph Parsing and Traversal — Feasibility Research

## Summary

n8n-vet needs to parse n8n workflow definitions and traverse the resulting graph to identify slices, paths, and trusted boundaries. This research examines three sources of graph-parsing capability: the n8nac transformer package, the n8n-workflow package, and raw workflow JSON. The recommendation is **Approach B: n8nac transformer for TS-to-JSON + own lightweight graph walker**, with the JSON type definitions borrowed from n8nac.

---

## 1. n8nac Transformer Package

**Location:** `/packages/transformer/` in n8n-as-code  
**Version:** 1.1.0  
**Dependencies:** `ts-morph`, `reflect-metadata`, `prettier`, `uuid`

### How It Parses TypeScript Workflow Files

The `TypeScriptParser` class (in `src/compiler/typescript-parser.ts`) uses **ts-morph** (a TypeScript compiler wrapper) to:

1. Create a ts-morph `Project` with `experimentalDecorators: true`
2. Parse the `.ts` file into a `SourceFile`
3. Find the class decorated with `@workflow`
4. Extract workflow metadata from the `@workflow` decorator argument (AST-only, no eval)
5. Extract nodes from `@node`-decorated properties
6. Extract connections from the `@links`-decorated method body via regex matching on statement text
7. Extract AI dependencies from `.uses()` calls

The parser is intentionally static — it treats TypeScript as notation, not a runtime. It uses `extractValueFromASTNode()` to walk AST nodes for literal values only (strings, numbers, booleans, arrays, plain objects). Dynamic expressions throw errors.

### Data Structures Produced

The transformer produces a clean intermediate representation:

```typescript
interface WorkflowAST {
    metadata: WorkflowMetadata;  // id, name, active, tags, settings
    nodes: NodeAST[];            // propertyName, displayName, type, version, position, parameters, aiDependencies
    connections: ConnectionAST[]; // from: {node, output, isError?}, to: {node, input}
}
```

The `WorkflowBuilder` class converts `WorkflowAST` into `N8nWorkflow` (the n8n JSON format), and `JsonToAstParser` does the reverse. Full round-trip is supported.

The `N8nWorkflow`, `N8nNode`, and `N8nConnections` types in `src/types.ts` mirror the n8n JSON schema precisely. They are standalone — no dependency on the `n8n-workflow` npm package.

### Public API Surface

Exported from `src/index.ts`:

| Export | Kind | Purpose |
|--------|------|---------|
| `TypeScriptParser` | Class | `.parseFile(path)` / `.parseCode(string)` -> `WorkflowAST` |
| `WorkflowBuilder` | Class | `.build(ast, options)` -> `N8nWorkflow` |
| `JsonToAstParser` | Class | JSON -> `WorkflowAST` |
| `AstToTypeScriptGenerator` | Class | AST -> TypeScript string |
| `WorkflowAST`, `NodeAST`, `ConnectionAST` | Types | Intermediate representation |
| `N8nWorkflow`, `N8nNode`, `N8nConnections` | Types | n8n JSON schema types |
| `ValidationResult`, `ValidationError` | Types | Validation output types |
| `workflow`, `node`, `links` | Decorators | For authoring workflow .ts files (not relevant for n8n-vet) |

### Stability Assessment

- The package is at 1.1.0 and published to npm with `publishConfig.access: "public"`.
- The exported API is well-factored: parsing, building, and type definitions are separate concerns.
- Tests exist in `/packages/transformer/tests/` covering integration, JSON-to-TS, TS-to-JSON, AI connections, CJK support, and AST extraction. This indicates an actively maintained surface.
- **Risk:** ts-morph is a heavy dependency (~20MB installed). It is only needed for the TS-to-AST direction, not for JSON parsing.

### What n8n-vet Needs From It

n8n-vet's source of truth is n8nac TypeScript files, so:

1. **`TypeScriptParser`** — to convert `.ts` workflow files into `WorkflowAST`
2. **`WorkflowBuilder`** — to convert `WorkflowAST` into `N8nWorkflow` JSON (needed if sending to n8n API for execution)
3. **`N8nWorkflow`, `N8nNode`, `N8nConnections` types** — for working with workflow JSON

The `WorkflowAST` intermediate form (especially `ConnectionAST[]`) is a flat edge list — much easier to traverse than n8n's deeply nested `IConnections` format.

---

## 2. n8n-workflow Package

**Location:** `/packages/workflow/` in n8n monorepo  
**Version:** 2.17.0  
**Dependencies:** 20 runtime dependencies including `luxon`, `lodash`, `ast-types`, `esprima-next`, `recast`, `jmespath`, `xml2js`, `zod`, `jssha`, `transliteration` — plus workspace dependencies `@n8n/errors`, `@n8n/expression-runtime`, `@n8n/tournament`

### Workflow Class

The `Workflow` class (`src/workflow.ts`, 925 lines) is the central graph representation. Key characteristics:

**Constructor requires `INodeTypes`:** The constructor calls `this.nodeTypes.getByNameAndVersion(node.type, node.typeVersion)` for every node to resolve defaults from node type descriptions. This means instantiating a `Workflow` object requires a full node type registry — a significant coupling to the n8n server runtime.

```typescript
constructor(parameters: WorkflowParameters) {
    this.nodeTypes = parameters.nodeTypes;  // Required
    for (const node of parameters.nodes) {
        nodeType = this.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);
        const nodeParameters = NodeHelpers.getNodeParameters(
            nodeType.description.properties, node.parameters, ...);
        node.parameters = nodeParameters;  // Mutates input
    }
    this.setNodes(parameters.nodes);
    this.setConnections(parameters.connections);
}
```

**Graph storage:** Connections are stored in two mirrored `IConnections` dictionaries — `connectionsBySourceNode` and `connectionsByDestinationNode`. The `mapConnectionsByDestination()` function inverts the source-keyed format to enable backward traversal.

### Graph Traversal Methods

Available on the `Workflow` class:

| Method | Behavior |
|--------|----------|
| `getParentNodes(nodeName, type?, depth?)` | Returns string[] of ancestor node names via BFS |
| `getChildNodes(nodeName, type?, depth?)` | Returns string[] of descendant node names via BFS |
| `getStartNode(destinationNode?)` | Finds highest-priority trigger/start node |
| `getTriggerNodes()` | Returns trigger nodes (requires `INodeTypes` for type metadata) |
| `getConnectedNodes(nodeName, type?, depth?)` | Bidirectional traversal |
| `getParentNodesByDepth(nodeName, depth?)` | BFS with depth tracking |

**Critical observation:** `getParentNodes` and `getChildNodes` delegate to standalone functions in `src/common/`:

```typescript
// src/common/get-parent-nodes.ts
export function getParentNodes(
    connectionsByDestinationNode: IConnections,  // Just a plain dict
    nodeName: string,
    type: NodeConnectionType | 'ALL' | 'ALL_NON_MAIN' = NodeConnectionTypes.Main,
    depth = -1,
): string[] {
    return getConnectedNodes(connectionsByDestinationNode, nodeName, type, depth);
}
```

These functions in `n8n-workflow/common` operate on raw `IConnections` data — they do not require a `Workflow` instance. This is the **only** part of n8n-workflow whose graph traversal logic is usable without the full `INodeTypes` dependency.

### DirectedGraph Class (n8n-core)

Located in `packages/core/src/execution-engine/partial-execution-utils/directed-graph.ts`, this is a clean adjacency-list graph with rich traversal:

| Method | Purpose |
|--------|---------|
| `getDirectChildConnections(node)` | Outgoing edges |
| `getDirectParentConnections(node)` | Incoming edges |
| `getChildren(node)` | Recursive descendants (cycle-safe) |
| `getParentConnections(node)` | Recursive ancestors (cycle-safe) |
| `getStronglyConnectedComponents()` | Tarjan's SCC algorithm |
| `depthFirstSearch({from, fn})` | DFS with predicate |
| `removeNode(node, {reconnectConnections})` | Graph surgery with rewiring |
| `findSubgraph({graph, destination, trigger})` | Extract trigger-to-destination subgraph |
| `findStartNodes({graph, trigger, destination, pinData, runData})` | Find earliest dirty nodes per branch |

**However:** `DirectedGraph` operates on `INode` references (object identity, not names), and `fromWorkflow()` requires a `Workflow` instance. `fromNodesAndConnections()` is available but still uses `INode` objects.

### Dependency Weight

Importing `n8n-workflow` pulls in a heavy tree:
- **Direct:** luxon, lodash, esprima-next, recast, ast-types, jmespath, xml2js, zod, jssha, md5, transliteration, uuid, form-data, js-base64
- **Workspace:** `@n8n/errors`, `@n8n/expression-runtime`, `@n8n/tournament`
- These workspace deps mean n8n-workflow cannot be used as an npm dependency — it requires the full n8n monorepo build

### Stability Assessment

- Version 2.17.0, actively maintained, part of n8n core
- The `IConnections`, `INode`, `IWorkflowBase` interfaces are stable public types
- The `common/` sub-path export (`n8n-workflow/common`) exposes standalone graph utility functions
- The `Workflow` class API is tied to n8n's runtime assumptions (requires node type registry)
- `DirectedGraph` is internal to `@n8n/core`, not exported as a stable public API

---

## 3. Workflow JSON Structure

### Core Types

```typescript
// A node
interface INode {
    id: string;
    name: string;           // Display name, used as key everywhere
    type: string;           // e.g. "n8n-nodes-base.httpRequest"
    typeVersion: number;
    position: [number, number];
    parameters: INodeParameters;
    credentials?: INodeCredentials;
    disabled?: boolean;
    onError?: OnError;
    // ... execution settings
}

// Connections: deeply nested, source-node-keyed
interface IConnections {
    [sourceNodeName: string]: INodeConnections;
}
interface INodeConnections {
    [connectionType: string]: NodeInputConnections;  // "main", "ai_tool", etc.
}
type NodeInputConnections = Array<IConnection[] | null>;
interface IConnection {
    node: string;       // Target node display name
    type: string;       // Connection type
    index: number;      // Input index on target
}

// Full workflow
interface IWorkflowBase {
    id: string;
    name: string;
    active: boolean;
    nodes: INode[];
    connections: IConnections;
    settings?: IWorkflowSettings;
    // ...
}
```

### Could n8n-vet Parse JSON Directly?

Yes. The JSON format is straightforward:
- `nodes` is a flat array of `INode` objects
- `connections` is a nested dict: `sourceName -> connectionType -> outputIndex -> [{node, type, index}]`

The nested connections format is awkward but well-documented and stable. Parsing it into an adjacency list is ~50 lines of code (see `mapConnectionsByDestination` in n8n-workflow — 48 lines, zero dependencies).

### What Would Be Lost Without n8n-workflow Utilities?

| Capability | Without n8n-workflow | Difficulty to reimplement |
|-----------|---------------------|-------------------------|
| BFS parent/child traversal | Must implement | Low (~40 lines, see `getConnectedNodes`) |
| `mapConnectionsByDestination` | Must implement | Low (~48 lines) |
| `getTriggerNodes()` | Must use heuristic (check node type name) | Low |
| Node parameter defaults | Not available | Not needed for graph structure |
| Expression evaluation | Not available | Not needed for static analysis |
| SCC detection | Must implement | Medium (~60 lines, Tarjan's) |
| Subgraph extraction | Must implement | Medium (~50 lines, see `findSubgraph`) |

The graph operations are all implementable as pure functions over `IConnections` + `INode[]`. The hard parts of n8n-workflow (expression evaluation, node type resolution) are not needed for graph parsing and traversal.

---

## 4. Approach Comparison

### Approach A: n8nac transformer for TS-to-JSON + n8n-workflow for graph ops

**How it works:** Use `TypeScriptParser` to get `WorkflowAST`, convert to `N8nWorkflow` via `WorkflowBuilder`, then use `n8n-workflow` `Workflow` class and `DirectedGraph` for traversal.

| Dimension | Assessment |
|-----------|-----------|
| Dependency weight | Very heavy. Requires n8n monorepo workspace deps (`@n8n/errors`, `@n8n/expression-runtime`, `@n8n/tournament`). Cannot be installed as npm package. |
| API coupling | High. `Workflow` constructor requires `INodeTypes` registry. Must mock or stub it. |
| Graph capabilities | Rich. SCC detection, subgraph extraction, dirty-node finding all built-in. |
| Maintenance burden | Low for graph ops, high for dependency management. |
| Feasibility | **Impractical.** n8n-workflow is not designed for standalone consumption. |

### Approach B: n8nac transformer for TS-to-JSON + own lightweight graph walker

**How it works:** Use `TypeScriptParser` to get `WorkflowAST`. Use its `ConnectionAST[]` flat edge list directly for graph operations with a custom lightweight graph implementation.

| Dimension | Assessment |
|-----------|-----------|
| Dependency weight | Moderate. ts-morph (~20MB) comes with n8nac, but only needed for TS parsing. JSON parsing path is dependency-free. |
| API coupling | Low. Depends only on n8nac's stable exported types and parser. |
| Graph capabilities | Must build. But `ConnectionAST[]` is already a clean edge list — much easier to work with than n8n's nested `IConnections`. |
| Maintenance burden | Medium. Own graph code (~150-250 lines) but simple algorithms. |
| Feasibility | **Strong.** Clean dependency boundary, stable input format. |

### Approach C: JSON-only, own everything

**How it works:** Parse workflow JSON directly using own types. Build own graph walker. Skip n8nac entirely.

| Dimension | Assessment |
|-----------|-----------|
| Dependency weight | Minimal. Zero external deps for graph parsing. |
| API coupling | None. |
| Graph capabilities | Must build everything, including JSON connection parsing. |
| Maintenance burden | High. Must maintain JSON schema types and keep them in sync with n8n updates. Must handle the awkward `IConnections` nesting. |
| Feasibility | **Possible but wasteful.** The n8nac transformer already does the hard work of TS parsing and provides clean types. Not using it means duplicating tested code for no benefit. |

---

## 5. Key Technical Details for Implementation

### WorkflowAST ConnectionAST is ideal for graph building

The n8nac `ConnectionAST` format is a flat edge list with named endpoints:

```typescript
interface ConnectionAST {
    from: { node: string; output: number; isError?: boolean; };
    to:   { node: string; input: number; };
}
```

Building an adjacency list from this is trivial:

```typescript
// Pseudocode for the lightweight graph n8n-vet would build
const forward = new Map<string, ConnectionAST[]>();  // node -> outgoing edges
const backward = new Map<string, ConnectionAST[]>(); // node -> incoming edges
for (const conn of ast.connections) {
    (forward.get(conn.from.node) ?? forward.set(conn.from.node, []).get(conn.from.node)!).push(conn);
    (backward.get(conn.to.node) ?? backward.set(conn.to.node, []).get(conn.to.node)!).push(conn);
}
```

This is dramatically simpler than parsing n8n's `IConnections` format, which requires triple-nested iteration (see `mapConnectionsByDestination`).

### What graph operations n8n-vet actually needs

Based on the project concepts (slices, paths, trusted boundaries):

1. **Ancestor/descendant traversal** — identify what is upstream/downstream of a changed node (for slice computation)
2. **Path enumeration** — find concrete execution routes through a slice (for path-based validation)
3. **Trigger identification** — find workflow entry points (by node type name heuristic, no registry needed)
4. **Subgraph extraction** — isolate the relevant portion of the graph between a trigger and a target node
5. **Change detection** — compare two versions of a graph to identify what changed (for trusted boundary computation)
6. **Cycle detection** — handle loops in the graph (for path enumeration safety)

All of these are standard graph algorithms operating on the flat `ConnectionAST[]` + `NodeAST[]` data. None require n8n's runtime type system.

### ts-morph weight consideration

ts-morph is heavy (~20MB installed) but is unavoidable if n8n-vet needs to read `.ts` workflow files, which it does (n8nac TypeScript files are the source of truth). The cost is already paid by depending on `@n8n-as-code/transformer`. If a JSON-only code path is also needed (e.g., for direct API workflow JSON), the `JsonToAstParser` from n8nac handles that without ts-morph.

---

## 6. Recommendation

**Use Approach B: n8nac transformer for TS-to-JSON + own lightweight graph walker.**

Concrete dependency plan:

1. **`@n8n-as-code/transformer`** — Use `TypeScriptParser` for `.ts` -> `WorkflowAST`, `JsonToAstParser` for `.json` -> `WorkflowAST`, and the exported type definitions (`WorkflowAST`, `NodeAST`, `ConnectionAST`, `N8nWorkflow`, etc.)

2. **Own `WorkflowGraph` class** (~150-250 lines) operating on `WorkflowAST`:
   - Build forward/backward adjacency maps from `ConnectionAST[]`
   - Implement `getAncestors(nodeName)`, `getDescendants(nodeName)` via BFS
   - Implement `getTriggerNodes()` via node type name pattern matching
   - Implement `getSlice(changedNodes)` to extract the minimal relevant subgraph
   - Implement `enumeratePaths(from, to)` for path-based validation
   - Implement `detectCycles()` if needed (Tarjan's SCC or simple DFS)

3. **Do not depend on `n8n-workflow` or `@n8n/core`** — their graph utilities are either too coupled (require `INodeTypes`) or internal (not a stable public API). The algorithms are straightforward to reimplement.

### Rationale

- n8nac's `WorkflowAST` is a cleaner graph representation than n8n's `IConnections`. Working directly with it avoids an unnecessary format conversion.
- n8n-workflow's graph utilities are pure functions over `IConnections` dicts (see `src/common/`), but importing even just the types pulls in the full package with its 20 runtime dependencies and workspace coupling.
- The `DirectedGraph` in n8n-core is well-designed but internal, and its `findSubgraph`/`findStartNodes` are oriented toward partial execution concerns (pin data, run data, dirty detection) rather than static validation.
- The total graph code needed is small and benefits from being purpose-built for n8n-vet's specific operations (slice computation, path enumeration, boundary detection) rather than adapted from n8n's execution-oriented utilities.

### Verified (spike completed 2026-04-18)

1. **`@n8n-as-code/transformer` installs standalone.** Confirmed. `npm install @n8n-as-code/transformer@1.2.0` pulls 36 packages (reflect-metadata, ts-morph, prettier, uuid). No workspace dependencies. Clean install.

2. **`WorkflowAST` is sufficient for all static analysis.** Confirmed. `NodeAST.parameters` contains the full parameter object including expression strings (e.g., `={{ $json.data.name }}`). `ConnectionAST` maps cleanly to graph edges. Credentials, execution settings, and node type metadata are all available.

3. **`JsonToAstParser` handles n8n JSON directly.** Confirmed. JSON workflows parse into the same `WorkflowAST` structure. No need to bypass n8nac.

**Additional finding:** `ConnectionAST` node references use `propertyName` (camelCase identifier), not `displayName` (n8n's human-readable name). Expression references like `$('Schedule Trigger')` use `displayName`. The graph must maintain a `displayName → propertyName` lookup for expression resolution. See INDEX.md NodeIdentity section for details.

**Additional finding:** The TS parser does not populate `displayName` when the `@node` decorator uses `displayName:` instead of `name:` as the key. The correct decorator key is `name` per `NodeDecoratorMetadata`.

---

## References

| File | What it contains |
|------|------------------|
| `n8n-as-code/packages/transformer/src/index.ts` | Public API exports |
| `n8n-as-code/packages/transformer/src/types.ts` | `WorkflowAST`, `NodeAST`, `ConnectionAST`, `N8nWorkflow`, `N8nNode`, `N8nConnections` |
| `n8n-as-code/packages/transformer/src/compiler/typescript-parser.ts` | TS -> WorkflowAST using ts-morph |
| `n8n-as-code/packages/transformer/src/compiler/workflow-builder.ts` | WorkflowAST -> N8nWorkflow JSON |
| `n8n/packages/workflow/src/workflow.ts` | `Workflow` class (925 lines, requires `INodeTypes`) |
| `n8n/packages/workflow/src/common/get-connected-nodes.ts` | Standalone BFS traversal over `IConnections` (~98 lines) |
| `n8n/packages/workflow/src/common/map-connections-by-destination.ts` | Connection dict inversion (~48 lines) |
| `n8n/packages/workflow/src/interfaces.ts` | `INode`, `IConnections`, `IWorkflowBase` type definitions |
| `n8n/packages/core/src/execution-engine/partial-execution-utils/directed-graph.ts` | `DirectedGraph` adjacency list class (~566 lines) |
| `n8n/packages/core/src/execution-engine/partial-execution-utils/find-subgraph.ts` | Trigger-to-destination subgraph extraction |
| `n8n/packages/core/src/execution-engine/partial-execution-utils/find-start-nodes.ts` | Dirty-node detection for partial execution |
