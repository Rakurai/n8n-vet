# Static Analysis Feasibility Research

Research artifact covering FEASIBILITY.md questions 1.1, 1.2, and 1.3.

Based on source code analysis of:
- `/Users/QTE2333/repos/n8n` (n8n platform, primary source)
- `/Users/QTE2333/repos/n8n-as-code` (n8nac tool)

---

## 1.1 Expression Reference Coverage

### Question

What percentage of real expression references fall into analyzable patterns, and how often do workflows use patterns that are NOT statically tractable?

### How expressions work in n8n

n8n expressions are strings prefixed with `=` that contain JavaScript within `{{ }}` delimiters. The `WorkflowDataProxy` class (`packages/workflow/src/workflow-data-proxy.ts`) creates a JavaScript execution context with these well-defined proxy objects:

| Proxy variable | Purpose | Statically analyzable? |
|---|---|---|
| `$json` | Current item's JSON data (shorthand) | Yes -- direct field access |
| `$('NodeName')` | Reference to another node's output | Yes -- node name + accessor pattern |
| `$input` | Current node's input data | Yes -- accessor pattern |
| `$node["NodeName"]` | Legacy node reference | Yes -- same as `$()` |
| `$binary` | Binary data access | Partially -- field names accessible |
| `$now`, `$today` | DateTime values | N/A -- no data flow |
| `$env` | Environment variables | N/A -- no data flow |
| `$parameter` | Current node parameters | N/A -- metadata |
| `$workflow` | Workflow metadata | N/A -- metadata |
| `$fromAI` | AI agent tool input | No -- runtime-only |
| `$prevNode` | Previous node metadata | N/A -- metadata |
| `$itemIndex`, `$runIndex` | Execution indices | N/A -- metadata |

The `$('NodeName')` proxy (line 1114-1381 of `workflow-data-proxy.ts`) exposes these accessor methods:
- `.first()` / `.last()` / `.all()` -- returns execution data
- `.item` / `.pairedItem()` / `.itemMatching(n)` -- paired item resolution
- `.isExecuted` -- boolean check
- `.context` / `.params` -- metadata

All of these ultimately access `.json.fieldName`, which is the analyzable part.

### Existing expression parser in n8n

n8n already has a robust expression reference parser at `packages/workflow/src/node-reference-parser-utils.ts`. The `extractReferencesInNodeExpressions` function (line 518) parses these patterns:

```
ACCESS_PATTERNS (line 78-102):
- $('NodeName')     -- primary modern syntax
- $node["NodeName"] -- legacy bracket syntax  
- $node.NodeName    -- legacy dot syntax
- $items("NodeName") -- legacy function syntax
```

For each matched node reference, it recognizes these accessor chains (line 40-54):
```
ITEM_TO_DATA_ACCESSORS:
- first()
- last()
- all()
- itemMatching(\d+)  -- only literal numeric arguments
- item

ITEM_ACCESSORS (metadata):
- params
- isExecuted

DATA_ACCESSORS:
- json
- binary
```

The parser extracts dot-notation field paths after `.json.` and converts them to flat variable names (e.g., `$("A").item.json.myField.nestedField` becomes `myField_nestedField`). It also handles `$json.field` references for the direct-input shorthand.

### Corpus analysis: AI workflow builder reference workflows

Analysis of 10 reference workflows from the n8n AI workflow builder (`packages/@n8n/ai-workflow-builder.ee/evaluations/fixtures/reference-workflows/`):

| Pattern | Count | Percentage |
|---|---|---|
| `$json.field` (direct field access) | 70 | 53.8% |
| `$('NodeName').first().json.field` | 39 | 30.0% |
| `$now`/`$today` (datetime, no data flow) | 8 | 6.2% |
| Complex JS (string concatenation, `.map()`, ternary, `new Date()`) | 7 | 5.4% |
| `$fromAI()` (AI agent input) | 4 | 3.1% |
| `$binary.field` | 2 | 1.5% |
| **Total** | **130** | **100%** |

**Statically analyzable patterns: 83.8%** (`$json.field` + `$('NodeName').first().json.field`)

The "complex JS" category (5.4%) includes patterns like:
- `$json.validationErrors.map(err => '<li>' + err + '</li>').join("")` -- field reference IS extractable even though the JS around it is not
- `$json.message?.content || $json.text` -- both field references extractable
- `'Summarize: ' + $json.title + '\n\n' + $json.description` -- field references extractable via concatenation
- `new Date($json.sys.sunset * 1000).toLocaleTimeString()` -- field reference extractable

Even within "complex JS" expressions, the field references (`$json.sys.sunset`, `$json.title`, etc.) are extractable. The surrounding JS just applies transforms to the accessed values. This means the effective coverage for detecting which fields are referenced is closer to **90-95%**, because even complex expressions usually start with analyzable field access.

### Corpus analysis: n8n test fixtures

From the `WorkflowDataProxy` test fixtures and the `node-reference-parser-utils` tests:

The test fixtures confirm the same dominant patterns:
- `$('NodeName').item.json.field` (most common in test assertions)
- `$json.field` (used in Set node assignments)
- `$input.first().json.field`, `$input.item.json.field`
- Legacy: `$node["NodeName"].json.field`, `$data.field`, `$items()[0].json.field`

### Non-analyzable patterns

Patterns that cannot be statically resolved:

1. **Code node output** (`n8n-nodes-base.code`, `n8n-nodes-base.function`, `n8n-nodes-base.functionItem`, `n8n-nodes-base.aiTransform`) -- identified in `SCRIPTING_NODE_TYPES` at `packages/workflow/src/constants.ts` line 65. These nodes execute arbitrary JS and output whatever they want. Output shape is unknowable statically.

2. **Dynamic key access** -- `$json[someVariable]` where the key is computed. Rare in practice; the test fixtures and reference workflows do not contain any instances.

3. **Complex `itemMatching` arguments** -- `$("A").itemMatching(someExpression)` where the argument is not a literal number. The existing parser (line 45) only supports `itemMatching(\d+)`. Rare in practice.

4. **`$fromAI()` / `$tool`** -- AI agent tool inputs resolved at execution time. Not statically resolvable, but identifiable as "AI-filled" fields.

5. **`$evaluateExpression()`** -- Dynamic expression evaluation. Very rare.

### Verdict: 1.1

**FEASIBLE. High coverage achievable.**

Static analysis of expression references can cover approximately 84-95% of real expression patterns in agent-built workflows. The n8n codebase already contains a production-grade expression parser (`node-reference-parser-utils.ts`) that recognizes all the primary patterns. Even expressions with complex JS transforms typically start with extractable `$json.field` or `$('NodeName').accessor().json.field` references.

The main gap is Code node output, which is a known boundary -- the product can treat Code node outputs as opaque/untrusted boundaries, which is a reasonable and already-planned approach.

Key implementation asset: `extractReferencesInNodeExpressions()` in `packages/workflow/src/node-reference-parser-utils.ts` is a directly reusable function that already handles name deduplication, nested field paths, legacy syntax variants, and edge cases.

---

## 1.2 Upstream Output-Shape Reasoning

### Question

What shape information is practically available from node type definitions, prior execution data, pin data schemas, and sub-workflow boundaries?

### Source 1: Node type definitions (INodeTypeDescription)

The `INodeTypeDescription` interface (`packages/workflow/src/interfaces.ts`, line 2454) defines node metadata including:

```typescript
interface INodeTypeDescription {
    inputs: Array<NodeConnectionType | INodeInputConfiguration> | ExpressionString;
    outputs: Array<NodeConnectionType | INodeOutputConfiguration> | ExpressionString;
    outputNames?: string[];
    properties: INodeProperties[];  // Parameter definitions
    credentials?: INodeCredentialDescription[];
    codex?: CodexData;
    // ...
}
```

**Output schema from codex/JSON Schema files:** The `@n8n/workflow-sdk` package has a sophisticated schema discovery system at `packages/@n8n/workflow-sdk/src/generate-types/generate-types.ts`. The `discoverSchemasForNode()` function (line 408) looks for pre-generated JSON Schema files in `packages/nodes-base/dist/nodes/<nodeName>/schemas/<version>/` organized by resource and operation.

These schemas exist for many API nodes (Slack, Google Sheets, etc.) and are keyed by resource + operation combination. The `findSchemaForOperation()` function matches schemas based on the node's `resource` and `operation` parameters.

**Coverage of schema discovery:** The `discoverOutputSchemaForNode()` function in `packages/@n8n/workflow-sdk/src/pin-data-utils.ts` (line 78) provides a clean API:

```typescript
function discoverOutputSchemaForNode(
    nodeType: string,
    typeVersion: number,
    parameters?: { resource?: string; operation?: string }
): JsonSchema | undefined
```

This returns `undefined` when no schema exists, which provides a clean "unknown shape" signal.

### Source 2: Prior execution data

The `inferSchemasFromRunData()` function (`packages/@n8n/workflow-sdk/src/pin-data-utils.ts`, line 118) takes execution run data and infers a JSON Schema from the first output item's shape:

```typescript
function inferSchemasFromRunData(
    runData: Record<string, INodeExecutionData[]>
): Record<string, JsonSchema>
```

This is used by the `prepare_test_pin_data` MCP tool (`packages/cli/src/modules/mcp/tools/prepare-workflow-pin-data.tool.ts`) in a two-tier strategy:
1. **Tier 1:** Infer schema from last successful execution output
2. **Tier 2:** Discover schema from node type definition (resource + operation)
3. **Tier 3:** No schema available

The execution-based inference uses `generateJsonSchemaFromData()` from `packages/@n8n/workflow-sdk/src/generate-types/json-schema-from-data.ts`.

### Source 3: Pin data

Pin data in n8n is stored per-node as `INodeExecutionData[]` items. The `getPinDataIfManualExecution()` helper in `workflow-data-proxy.ts` resolves pin data for manual execution mode. Pin data has known, concrete shapes since it is authored data -- either manually created or generated from schemas.

### Node behavior categories for shape reasoning

Based on analysis of node implementations:

**Category 1: Shape-preserving nodes (pass-through)**
These nodes forward input items without modifying `$json`:
- **If** (`packages/nodes-base/nodes/If/V2/IfV2.node.ts`, line 91): Routes input items to true/false outputs unchanged. Items keep their `pairedItem` reference.
- **Switch**: Same pattern as If, multiple outputs.
- **Merge**: Combines items from multiple inputs.
- **NoOp** (No Operation): Pure pass-through.
- **SplitInBatches**: Splits items into batches.
- **Wait**: Delays items.

These are safe -- downstream expressions referencing upstream fields will still be valid.

**Category 2: Shape-augmenting nodes (add fields to existing shape)**
- **Set/Edit Fields** (`packages/nodes-base/nodes/Set/v2/manual.mode.ts`): The `composeReturnItem()` function (`Set/v2/helpers/utils.ts`, line 56) has an `include` option controlling shape:
  - `INCLUDE.ALL` (line 83): Copies all input JSON fields, then adds new ones. Shape is input + new fields.
  - `INCLUDE.SELECTED` (line 86): Only keeps explicitly selected input fields.
  - `INCLUDE.NONE` / `INCLUDE.EXCEPT` (line 84-85): Drops input fields, only outputs new fields.
  
  The default behavior (when `include` is `'all'`) preserves the input shape and augments it. This is analyzable from the node's `options.include` parameter.

**Category 3: Shape-replacing nodes (output completely new shape)**
These nodes overwrite `$json` with data from external sources:
- **HTTP Request** (`packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts`): Output is the API response body. Shape is determined by the external API, not the input. The node creates brand new `{ json: responseBody }` items (line 1075-1080).
- **Database nodes** (Postgres, MySQL, etc.): Query results replace `$json` entirely. `PostgresV1.node.ts` line 359: `returnItems = queryResult as INodeExecutionData[]`.
- **All API integration nodes** (Slack, Google Sheets, Gmail, etc.): These call external APIs and return the API's response shape.

**Category 4: Shape-transforming nodes (unpredictable output)**
- **Code node**: Arbitrary JavaScript. Output shape is whatever the code returns.
- **AI Transform**: LLM-generated code execution.
- **Function/FunctionItem**: Legacy code execution nodes.

### Identifying node categories programmatically

The `needsPinData()` function (`packages/@n8n/workflow-sdk/src/pin-data-utils.ts`, line 47) already classifies nodes by their interaction with external services:

```typescript
function needsPinData(node: INode, isTriggerNode?: IsTriggerNodeFn): boolean {
    if (isTriggerNode?.(node)) return true;
    if (node.credentials && Object.keys(node.credentials).length > 0) return true;
    if (node.type === HTTP_REQUEST_NODE_TYPE) return true;
    return false;
}
```

This classification is a strong proxy for "shape-replacing" behavior:
- Nodes with credentials = API nodes = replacement nodes
- HTTP Request = replacement node
- Trigger nodes = source nodes (shape comes from external event)
- Everything else = logic/transform nodes (typically shape-preserving or shape-augmenting)

Additionally, `SCRIPTING_NODE_TYPES` (`packages/workflow/src/constants.ts`, line 65) identifies code execution nodes:
```typescript
const SCRIPTING_NODE_TYPES = [
    'n8n-nodes-base.function',
    'n8n-nodes-base.functionItem', 
    'n8n-nodes-base.code',
    'n8n-nodes-base.aiTransform',
];
```

### Verdict: 1.2

**FEASIBLE. Multiple complementary shape sources exist.**

The n8n ecosystem provides four practical sources of output shape information:

1. **Node type JSON Schema files** -- available for many API nodes, keyed by resource + operation. Discoverable via `discoverSchemasForNode()`.
2. **Execution history inference** -- `inferSchemasFromRunData()` infers schemas from the first item of any previous successful execution.
3. **Pin data** -- concrete known shapes for manually authored test data.
4. **Node behavior classification** -- `needsPinData()` and `SCRIPTING_NODE_TYPES` let you classify nodes into shape-preserving, shape-replacing, or shape-opaque categories without needing the actual schema.

For n8n-vet's purposes, the most valuable insight is the **node category classification** rather than exact schemas. Knowing whether a node preserves, augments, or replaces `$json` is sufficient to detect the highest-value bug class (data loss through replacement). Exact schema matching is a bonus that can be layered on top using the JSON Schema discovery and execution inference systems that already exist.

The Set node's `options.include` parameter is a particularly important signal -- it directly controls whether the node preserves or drops input fields.

---

## 1.3 Data-Loss-Through-Replacement Detection

### Question

Can the product reliably detect bugs where a replacement node (HTTP Request, API node, database node) overwrites `$json`, causing downstream references to silently point at the wrong structure?

### The failure pattern

The classic bug pattern is:

```
[Trigger] -> [Set Fields: adds field "userId"] -> [HTTP Request] -> [Downstream node]
```

The downstream node uses `$json.userId` expecting the field set earlier, but `HTTP Request` has completely replaced `$json` with the API response, which does not contain `userId`. The expression silently evaluates to `undefined`.

### How replacement nodes work

**HTTP Request** (`packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts`):

The node creates entirely new items with `json` set to the API response:

```typescript
// Line 1075-1080 (JSON response format)
returnItems.push({
    json: response,        // <-- completely new $json
    pairedItem: { item: itemIndex },
});
```

```typescript
// Line 1007-1012 (text response format)
returnItems.push({
    json: {
        [outputPropertyName]: toText(response),  // <-- completely new $json
    },
    pairedItem: { item: itemIndex },
});
```

```typescript
// Line 939-944 (file/binary response)
const newItem: INodeExecutionData = {
    json: {},              // <-- empty $json
    binary: {},
    pairedItem: { item: itemIndex },
};
```

In all cases, the input item's `$json` is discarded. The HTTP Request node never merges its response with the input data.

**Database nodes** (e.g., Postgres V1, line 359):
```typescript
returnItems = queryResult as INodeExecutionData[];  // <-- completely new items from DB
```

**API integration nodes** (Slack, Google Sheets, etc.): All follow the same pattern -- they call an external API and return the API's response as new `$json` items.

### Detection approach: graph walk + expression analysis

The detection algorithm would be:

1. **Parse expressions** in each node using the existing `extractReferencesInNodeExpressions()` parser to extract field references like `$json.userId` or `$('SetFields').item.json.userId`.

2. **Walk the graph backwards** from each expression reference to find the node that would provide the referenced data.

3. **Check for replacement nodes** in the path between the referenced node and the current node. A replacement node is one where:
   - `needsPinData(node) === true` (has credentials, is HTTP Request, or is trigger), OR
   - `SCRIPTING_NODE_TYPES.includes(node.type)` (Code node, etc.)

4. **Flag the mismatch** when:
   - A `$json.field` reference expects data from a node earlier in the chain
   - A replacement node sits between the source and the consumer
   - The replacement node does NOT have a known output schema that includes the referenced field

### Concrete detection heuristics

**Heuristic 1: `$json.field` after a replacement node**

When a node uses `$json.someField` and its immediate upstream node is a replacement node (HTTP Request, API node with credentials, Code node), the field reference is suspect unless the replacement node's output schema (if known) includes that field.

This is the highest-value detection because:
- `$json` is the most common expression pattern (54% of expressions in the corpus)
- Replacement nodes are the most common cause of silent data loss
- The detection is cheap: just check if the immediate parent is a replacement node

**Heuristic 2: `$('EarlierNode').first().json.field` across a replacement node**

When a node references a specific upstream node by name, and there is a replacement node between them, the reference is valid (n8n resolves it via paired item tracking). BUT if the reference uses `$json.field` (shorthand for current item), it will resolve to the replacement node's output, not the earlier node's.

This is a subtler detection: the bug is specifically using `$json.field` when `$('NodeName').item.json.field` was intended.

**Heuristic 3: Set node with `include: 'none'`**

The Set node with `options.include` set to `'none'` behaves as a replacement node -- it drops all input fields. This can be detected from the node's parameters.

### Identifying replacement nodes deterministically

The following classification is deterministic from node metadata:

| Detection method | Nodes covered | False positives |
|---|---|---|
| `node.credentials` has entries | All API/service nodes | Very low -- credentials mean external calls |
| `node.type === HTTP_REQUEST_NODE_TYPE` | HTTP Request | Zero |
| `SCRIPTING_NODE_TYPES.includes(node.type)` | Code, Function, AI Transform | Medium -- code MAY preserve shape |
| Trigger node detection (`isTriggerNode()`) | All triggers | Zero -- triggers are always sources |
| Set node `options.include === 'none'` | Set node in replace mode | Zero |

The combination of `needsPinData()` + `SCRIPTING_NODE_TYPES` covers the vast majority of replacement nodes. The only false negatives would be custom community nodes with unusual behavior, which are out of scope for the initial product.

### False positive / negative analysis

**Expected false positives (flags something that works):**
- Code node that actually passes through input data unchanged. The tool cannot know this without executing the code. Acceptable -- Code node boundaries should be treated as opaque anyway.
- API node where the response happens to include a field with the same name as the referenced field. Possible but rare, and the tool can note this as "field exists in response schema" when a schema is available.

**Expected false negatives (misses a real bug):**
- Set node in "manual" mode that replaces a field with an incorrect value (same name, wrong data). This is a semantic error beyond static analysis.
- Expression that constructs a field name dynamically. Very rare (see 1.1 analysis).

### Verdict: 1.3

**FEASIBLE. The highest-value bug class is cheaply detectable.**

The data-loss-through-replacement pattern can be detected with a combination of:
1. Expression parsing (already exists in `node-reference-parser-utils.ts`)
2. Graph walking (straightforward from workflow connections)
3. Node classification (already exists via `needsPinData()` + `SCRIPTING_NODE_TYPES`)

The detection has high precision for the most common case (`$json.field` after HTTP Request/API nodes) and acceptable precision for subtler cases. False positive rate is manageable because the node classification is based on concrete metadata (credentials, node type), not heuristics.

Key implementation advantage: all three required capabilities already exist as reusable functions in the n8n codebase. The product does not need to build expression parsing or node classification from scratch.

---

## Summary of Feasibility Verdicts

| Question | Verdict | Confidence | Key finding |
|---|---|---|---|
| 1.1 Expression reference coverage | FEASIBLE | High | 84-95% of expressions use statically analyzable patterns. Existing parser covers all primary patterns. |
| 1.2 Upstream output-shape reasoning | FEASIBLE | High | Four complementary shape sources exist. Node category classification alone enables the highest-value detections. |
| 1.3 Data-loss-through-replacement detection | FEASIBLE | High | Replacement nodes are deterministically identifiable. The classic `$json` loss pattern is cheaply detectable via graph walk + expression analysis. |

### Recommended implementation order

1. **Expression parsing** -- reuse or port `extractReferencesInNodeExpressions()` from `node-reference-parser-utils.ts`
2. **Node classification** -- implement replacement-node detection using `needsPinData()` logic + `SCRIPTING_NODE_TYPES`  
3. **Graph walk** -- walk connections backwards from expression references to check for replacement nodes in the path
4. **`$json` loss detection** -- combine the above to flag `$json.field` references that cross replacement node boundaries
5. **Schema-enhanced detection** -- layer on `discoverOutputSchemaForNode()` and `inferSchemasFromRunData()` for richer diagnostics

---

## Key Source Files Referenced

| File | Purpose |
|---|---|
| `packages/workflow/src/workflow-data-proxy.ts` | Expression proxy -- defines all `$` variables and their behavior |
| `packages/workflow/src/node-reference-parser-utils.ts` | Expression reference parser -- extracts node references and field paths |
| `packages/workflow/src/expression.ts` | Expression evaluation engine |
| `packages/workflow/src/constants.ts` | Node type constants including `SCRIPTING_NODE_TYPES`, `HTTP_REQUEST_NODE_TYPE` |
| `packages/workflow/src/interfaces.ts` | `INodeTypeDescription`, `INodeOutputConfiguration` |
| `packages/@n8n/workflow-sdk/src/pin-data-utils.ts` | `needsPinData()`, `discoverOutputSchemaForNode()`, `inferSchemasFromRunData()` |
| `packages/@n8n/workflow-sdk/src/generate-types/generate-types.ts` | `discoverSchemasForNode()` -- JSON Schema discovery from node type definitions |
| `packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts` | HTTP Request execute -- demonstrates replacement behavior |
| `packages/nodes-base/nodes/Set/v2/helpers/utils.ts` | Set node `composeReturnItem()` -- demonstrates `include` option controlling shape preservation |
| `packages/nodes-base/nodes/If/V2/IfV2.node.ts` | If node execute -- demonstrates shape-preserving pass-through |
| `packages/cli/src/modules/mcp/tools/prepare-workflow-pin-data.tool.ts` | MCP pin data preparation -- demonstrates tiered schema discovery |
| `packages/workflow/test/node-reference-parser-utils.test.ts` | Expression parser tests -- comprehensive coverage of expression patterns |
