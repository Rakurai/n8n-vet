# Validation Surface Map

> Synthesis document for the n8n-vet project. Maps the complete set of interaction surfaces, capabilities, and gaps across n8n platform and n8n-as-code, organized by what n8n-vet needs to do. This is the "how do we actually build this" reference.

---

## 1. Interaction Channels

n8n-vet can interact with n8n workflows through these channels:

```
┌──────────────────────────────────────────────────────────┐
│                    n8n-vet                             │
└─────┬────────────┬─────────────┬─────────────┬──────────┘
      │            │             │             │
      ▼            ▼             ▼             ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│  Local   │ │  n8nac   │ │ n8n MCP  │ │ n8n REST API │
│  Files   │ │   CLI    │ │  Server  │ │              │
└──────────┘ └──────────┘ └──────────┘ └──────────────┘
      │            │             │             │
      │            │             ▼             ▼
      │            │       ┌──────────────────────┐
      │            └──────►│   n8n Instance        │
      │                    └──────────────────────┘
      ▼
  No execution
  (static only)
```

### Channel capabilities

| Channel | Static analysis | Execution | Pin data mocking | Execution inspection | Offline? |
|---|---|---|---|---|---|
| Local files | Yes | No | No | No | Yes |
| n8nac CLI | Validation | HTTP trigger only | No | Full (verbose) | Validation only |
| n8nac MCP | Schema validation | No | No | No | Yes |
| n8n MCP | No | Yes (test_workflow) | Yes | Yes (filtered) | No |
| n8n REST API | No | Yes (full control) | Yes | Yes (filtered) | No |

### Recommended channel strategy

- **Static validation:** Local files + n8nac schema validation (offline, fast, free)
- **Bounded execution:** n8n REST API `POST /workflows/:id/run` with `destinationNode` (the only surface supporting partial execution)
- **Mocked execution (when MCP available):** n8n MCP `test_workflow` (pin data support, synchronous, 5-minute timeout). Note: MCP tool availability is per-workflow, gated by `settings.availableInMCP`. The n8nac `push` command currently strips this flag, which means MCP access may be lost after a push cycle. Until this is fixed, MCP should be treated as **opportunistic, not assumed**. Fall back to REST API execution when MCP is unavailable.
- **Live execution:** n8nac CLI `test` or n8n MCP `execute_workflow` (HTTP trigger, real services)
- **Execution inspection:** n8n MCP `get_execution` (node-level filtering, truncation) or REST API `GET /executions/:id`
- **Deployment:** n8nac CLI `push` (with `verify` flag)

---

## 2. Static Analysis Surface

What can be validated without touching the n8n instance.

### Available today

| Check | Tool | Catches |
|---|---|---|
| Node type exists | n8nac `verify` / `skills validate` | Invalid node types |
| Valid typeVersion | n8nac `verify` / `skills validate` | Wrong node version |
| Required params present | n8nac `verify` / `skills validate` | Missing config |
| Parameter types correct | n8nac `verify` / `skills validate` | Type mismatches |
| Credential types match | n8nac `skills validate` | Wrong credential type |
| Basic expression syntax | n8nac `skills validate` | Malformed expressions |
| Workflow structure (connections) | TypeScript AST parsing via transformer | Disconnected nodes |
| All credentials available | n8nac `workflow credential-required` | Missing credentials |

### Gaps that n8n-vet must fill

| Check | Status | Catches |
|---|---|---|
| `$json.field` references valid upstream output | Not available | Data contract breaks |
| `$('NodeName').first().json.field` node exists and has field | Not available | Cross-node reference breaks |
| Data loss through replacement nodes | Not available | HTTP/API nodes replacing `$json` |
| Expression references resolvable at runtime | Not available | Dead references |
| Output shape compatibility across connections | Not available | Shape mismatches |
| Sub-workflow interface compatibility | Not available | Integration breaks |
| Contract-based boundary validation | Not available | Boundary violations |

### Static analysis data sources

| Source | What it provides | How to access |
|---|---|---|
| Workflow TypeScript file | Full node config, connections, expressions | ts-morph / transformer |
| Workflow JSON file | Same, in JSON format | JSON.parse |
| n8n-nodes-technical.json | Node schemas (params, types, defaults) | n8nac skills package |
| n8nac-custom-nodes.json | Custom node schemas | Local file |
| Last successful execution data | Actual node output shapes | n8n MCP `get_execution` |
| Pin data schemas | Expected node output structure | n8n MCP `prepare_test_pin_data` |

### Expression reference patterns to parse

The three dominant patterns that cover the vast majority of expression references:

```
1. $json.fieldName                           → Previous node's output
2. $('Node Name').first().json.fieldName     → Named node reference
3. $input.first().json.fieldName             → Explicit input reference
```

Also relevant but harder:
```
4. $json[someVariable]                       → Dynamic reference (not statically analyzable)
5. $parents[0].json.fieldName               → Parent node by index
6. Code node output                          → Arbitrary JS (not statically analyzable)
```

### Graph traversal for data flow analysis

To trace whether a `$json.field` reference is satisfiable:

1. Parse the expression to extract the reference pattern
2. Identify the source node (previous node for `$json`, named node for `$('NodeName')`)
3. Look up the source node's output schema:
   a. First try: last execution data (most accurate)
   b. Second try: node type definition output schema
   c. Third try: pin data schema from `prepare_test_pin_data`
4. Check if the referenced field exists in the schema
5. Flag if node is a "replacement" type (HTTP Request, API nodes) that replaces `$json`

**The critical bug class:** A Code node produces items with fields like `vector`, `depth_phase`. Then an HTTP Request node sits between it and a downstream loop. The HTTP node **replaces** `$json` with its own response body. The downstream loop references `$json.vector` which now points at the HTTP response, not the Code output. No existing tool catches this.

---

## 3. Execution-Backed Validation Surface

What can be validated by executing the workflow (or part of it).

### Execution options comparison

| Approach | Mocking | Scope | Latency | Cost |
|---|---|---|---|---|
| n8n MCP `test_workflow` | Full pin data | Whole workflow | 5-30s | Medium (no external calls) |
| n8n REST `POST /workflows/:id/run` with destinationNode | Pin data + bounded | Subgraph | Variable | Lower (bounded) |
| n8nac `test` | None | Whole workflow via HTTP | 30-120s | High (real services) |
| n8n MCP `execute_workflow` | None | Whole workflow | Variable | Highest (async, real services) |

### Bounded execution via REST API

The most powerful option for slice-based validation:

```
POST /workflows/:workflowId/run
{
  "destinationNode": {
    "nodeName": "Target Node",
    "mode": "inclusive"
  },
  "pinData": {
    "Trigger": [{"json": {"key": "value"}}],
    "External API": [{"json": {"response": "mocked"}}]
  },
  "triggerToStartFrom": {
    "nodeName": "Webhook"
  }
}
```

This executes only the subgraph from trigger to destination node, with pin data for mocking. This is the closest platform primitive to "validate a slice."

**Gap:** This endpoint is designed for the n8n editor's partial execution feature. It's not exposed through MCP or n8nac. n8n-vet would need to call the REST API directly.

### Pin data strategy for slice validation

For a workflow slice bounded by a start node and an end node:

1. Call `prepare_test_pin_data` to get schemas for all nodes needing pin data
2. Generate or supply fixture data for:
   - The trigger node (test input)
   - All external/credentialed nodes within the slice (mocked responses)
   - All external nodes upstream of the slice that feed into it (mocked context)
3. Execute via `test_workflow` or REST API with pin data
4. Retrieve execution data via `get_execution` with `nodeNames` filter for assertion targets

### Execution data retrieval for assertions

```typescript
// Via n8n MCP
get_execution({
  workflowId: "abc",
  executionId: "123",
  includeData: true,
  nodeNames: ["Target Output Node", "Final Transform"],
  truncateData: 10     // Limit items for manageable response
})
```

Returns per-node execution data including:
- Input data (what the node received)
- Output data (what the node produced)
- Execution status
- Error information if any

### What execution-backed validation catches that static analysis can't

| Bug class | Static? | Execution? | Example |
|---|---|---|---|
| Code node output shape wrong | No (arbitrary JS) | **Yes** | Code produces wrong field names |
| LLM response doesn't match expected schema | No | **Yes** | GPT returns unexpected format |
| Conditional path takes wrong branch | Partially | **Yes** | If node logic is wrong |
| Database query returns unexpected shape | No | **Yes** (with mocks) | Postgres schema mismatch |
| Expression evaluation fails at runtime | Partially | **Yes** | Template literal errors |
| Sub-workflow returns wrong data | No | **Yes** | Interface contract violation |
| Race condition in parallel branches | No | **Yes** | Merge node timing |

---

## 4. Diagnostic Output Surface

What the platform tells us after execution.

### Available execution data

```typescript
// Per-node task data
interface ITaskData {
  data?: {
    main: Array<INodeExecutionData[]>    // Output items per output index
  }
  startTime: number
  executionTime: number
  executionStatus: 'success' | 'error' | ...
}

// Per-item data
interface INodeExecutionData {
  json: IDataObject       // The actual data
  binary?: IBinaryKeyData // Binary attachments
  pairedItem?: { item: number, input?: number }  // Item lineage
}
```

### Execution result structure

```typescript
interface IRun {
  data: {
    resultData: {
      runData: {
        [nodeName: string]: ITaskData[]   // Every node's I/O
      }
      pinData?: IPinData                  // What was mocked
      lastNodeExecuted?: string
      error?: ExecutionError
    }
    startData?: {
      destinationNode?: IDestinationNode  // What was targeted
      runNodeFilter?: string[]            // What was in scope
    }
  }
  status: ExecutionStatus
  startedAt: Date
  stoppedAt: Date
  executionTime: number
}
```

### Error information

When a node fails:
- `resultData.error` contains the error with node context
- `resultData.lastNodeExecuted` identifies the failing node
- Individual node task data may have `executionStatus: 'error'`

**Problem:** Error messages are often generic. "Invalid JSON in response body" without the actual body. "Could not get parameter" without which expression failed. Getting useful diagnostics requires pulling full execution data and manually correlating.

### What n8n-vet must build for diagnostics

1. **Error-focused extraction** — Given an execution, extract only the failed node(s) with their input data and error message
2. **Path observation** — Which nodes actually executed, in what order, with what status
3. **Scope annotation** — Which nodes were mocked, skipped, or treated as trusted
4. **Compact summary** — One structured output that answers: what was tested, what path ran, what broke, what was mocked

---

## 5. Trust and Change Detection Surface

What the platform tells us about what changed and what hasn't.

### Workflow-level change detection (n8nac)

- Hash-based comparison of local file content vs. cached remote hash
- Detects: property modifications, node additions/removals, connection changes, expression changes
- Ignores: position-only changes, whitespace/formatting, metadata timestamps
- Granularity: **workflow-level only** — "this workflow changed" not "these specific nodes changed"

### Node-level change detection (n8n editor)

- Dirty node tracking — yellow triangle on nodes that may have stale output
- Triggered by: parameter changes, connection changes, node insertion/deletion, pin data modifications
- Granularity: **per-node** — specific nodes are flagged dirty

**Gap:** n8nac does not expose dirty node information. The n8n editor tracks it internally but doesn't surface it through API or MCP. n8n-vet would need to compute node-level diffs from two workflow snapshots.

### Workflow checksum (n8n core)

`packages/workflow/src/workflow-checksum.ts` computes a hash over nodes, connections, settings, and pinData. Could potentially be used to detect whether a subgraph has changed by computing checksum over a filtered set of nodes.

### What n8n-vet must build for trust tracking

1. **Node-level change detection** — Diff two workflow snapshots to identify exactly which nodes and connections changed
2. **Trusted boundary metadata** — Record which boundaries have been validated and what their expected interfaces are
3. **Green-lit region tracking** — Know which subgraphs have passed validation and haven't changed since
4. **Revalidation scoping** — Given a set of changed nodes, determine the minimum set of paths/slices that need revalidation

---

## 6. Sub-Workflow and Boundary Surface

Sub-workflows in n8n provide natural trust boundaries.

### Sub-workflow mechanics

- **Parent calls child** via Execute Sub-workflow node
- **Data passes in** through Execute Sub-workflow Trigger
- **Data returns** from last node of sub-workflow back to parent
- **Modes:** Run once with all items (batch) or run once per item

### Sub-workflow source options

| Source | Description | n8n-vet relevance |
|---|---|---|
| Database | Select workflow from n8n instance | Most common for deployed workflows |
| Local File | Path to workflow JSON file | Direct access for static analysis |
| Parameter | Inline workflow JSON | Less common |
| URL | Remote workflow JSON | Less common |

### Interface information available

For sub-workflows with "Define using fields below" input mode:
- Input field names and types are explicitly declared
- This is the strongest interface contract available in n8n

For sub-workflows with "Accept all data" input mode:
- No input contract — anything goes

**Gap:** n8n has no formal output contract for sub-workflows. The output is whatever the last node produces. There's no declaration of expected output shape.

### Relevance to n8n-vet

Sub-workflows are the most natural candidates for trusted boundaries:
- They have explicit inputs (sometimes typed)
- They have a clear output point (last node)
- They can be tested independently
- They can be mocked in parent workflow validation by pinning the Execute Sub-workflow node

n8n-vet could establish sub-workflow boundaries as trusted interfaces by:
1. Recording the input/output contract from a successful execution
2. Treating the boundary as trusted unless the sub-workflow changes
3. Pinning the sub-workflow call in parent validation when the sub-workflow hasn't changed

---

## 7. Evaluation Framework Integration Surface

n8n's evaluation framework is a potential complement, not a replacement, for n8n-vet.

### What evaluations provide

- Dataset-driven execution (Data Tables or Google Sheets as source)
- Output capture and comparison
- Numeric quality metrics (correctness, helpfulness, similarity, categorization)
- Execution history tracking across evaluation runs

### Integration possibilities

| Use case | Approach |
|---|---|
| Structural regression testing | Store known-good inputs in Data Table → Run evaluation → Compare outputs |
| LLM output quality validation | Use metric-based evaluation with correctness/helpfulness scores |
| Fixture management | Use Data Tables as structured fixture storage |
| Evaluation mode detection | `Check If Evaluating` node to skip evaluation logic in production |

### Practical considerations

- Evaluations require dataset setup (not trivial for quick iteration)
- One Evaluation Trigger per workflow (limits modular testing)
- Metric-based evaluations need Pro/Enterprise
- Better suited for stabilized workflows than active development
- Not designed for data flow correctness checking

---

## 8. Gap Analysis Summary

### The three layers needed for n8n-vet

```
Layer 1: STATIC ANALYSIS (offline, fast, free)
├── Already available: Node schema validation, credential checking
└── Needs building: Data flow analysis, expression reference tracing,
    output shape compatibility, contract validation

Layer 2: EXECUTION-BACKED VALIDATION (requires n8n instance, has cost)
├── Already available: test_workflow (pin data), partial execution (REST API),
│   HTTP trigger testing (n8nac test)
└── Needs building: Orchestrated run+inspect+assert pipeline,
    slice-scoped execution, fixture-to-pin-data bridge

Layer 3: DIAGNOSTIC OUTPUT (post-execution)
├── Already available: Full execution data (verbose), node-level filtering
└── Needs building: Error-focused extraction, path observation,
    compact diagnostic summaries, scope annotation
```

### Critical building blocks not available anywhere

1. **Data flow linter** — Trace expression references through graph, check against output schemas
2. **Assertion layer** — Assert on specific node outputs after execution
3. **Diagnostic summarizer** — Convert verbose execution data into compact, actionable reports
4. **Trusted boundary tracker** — Record, maintain, and reuse boundary validation state
5. **Revalidation scoper** — Given changes, determine minimum validation needed
6. **Fixture-to-pin-data bridge** — Map local fixture files to pin data format
7. **Orchestration pipeline** — wire up: push → execute → wait → inspect → assert → report

### Platform capabilities that should not be rebuilt

These exist and work — n8n-vet should use them as-is:

- Node schema validation (n8nac `skills validate`)
- Pin data execution (n8n MCP `test_workflow`)
- Pin data schema discovery (n8n MCP `prepare_test_pin_data`)
- Execution data retrieval with filtering (n8n MCP `get_execution`)
- Workflow push/pull/sync (n8nac CLI)
- TypeScript workflow parsing (n8nac transformer package)

**Note on n8n-workflow package:** The graph traversal and checksum utilities in `n8n-workflow` are well-designed but impractical to depend on directly — the package requires an `INodeTypes` registry, has 20+ runtime dependencies, and depends on workspace packages that are not published to npm. See `graph_parsing_feasibility.md` for details. The recommended approach is to use n8nac transformer's `ConnectionAST[]` as the graph representation and implement a lightweight graph walker (~150-250 lines) rather than importing `n8n-workflow`. The algorithm patterns from `n8n-workflow/src/common/` are useful as reference but should be reimplemented, not depended on.

---

## 9. Access Pattern Summary

For quick reference: how to do common operations relevant to n8n-vet.

| Operation | Best approach |
|---|---|
| Parse workflow structure | n8nac transformer (TypeScript) or JSON.parse (JSON) |
| Get node schemas | n8nac `skills node-info <name>` or n8n-nodes-technical.json |
| Validate node parameters | n8nac `skills validate <file>` |
| Check credential availability | n8nac `workflow credential-required <id>` |
| Get pin data schemas | n8n MCP `prepare_test_pin_data` |
| Execute with mocks | n8n MCP `test_workflow` with pinData |
| Execute bounded subgraph | n8n REST `POST /workflows/:id/run` with destinationNode |
| Inspect specific node output | n8n MCP `get_execution` with nodeNames filter |
| Push workflow to n8n | n8nac `push <path> --verify` |
| Detect workflow changes | n8nac file watcher / hash comparison |
| Traverse workflow graph | n8n-workflow `getParentNodes`, `getChildNodes`, `DirectedGraph` |
| Compute workflow checksum | n8n-workflow `workflow-checksum.ts` |
