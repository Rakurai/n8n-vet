# n8n Platform Capabilities Reference

> Research document for the n8n-vet project. Catalogs all n8n platform functionality relevant to workflow validation, testing, execution control, mocking, and diagnostics. Sources: n8n repository source code and n8n-docs official documentation.

---

## 1. Workflow Execution Engine

### Core execution model

n8n workflows execute node-by-node through a stack-based execution loop. The central class is `WorkflowExecute` in `packages/core/src/execution-engine/workflow-execute.ts`.

```typescript
class WorkflowExecute {
  run(options: RunWorkflowOptions): PCancelable<IRun>
  
  runPartialWorkflow2(
    workflow: Workflow,
    runData: IRunData,
    pinData?: IPinData,
    dirtyNodeNames?: string[],
    destinationNode?: IDestinationNode,
    agentRequest?: AiAgentRequest
  ): PCancelable<IRun>
}

interface RunWorkflowOptions {
  workflow: Workflow
  startNode?: INode
  destinationNode?: IDestinationNode
  pinData?: IPinData
  triggerToStartFrom?: IWorkflowExecutionDataProcess['triggerToStartFrom']
  additionalRunFilterNodes?: string[]
}
```

**Execution flow:**
1. Initializes `nodeExecutionStack` with start node and empty data
2. Calls `processRunExecutionData()` for the main loop
3. For each node on the stack: resolves input data, executes node, pushes child nodes onto stack
4. Returns `PCancelable<IRun>` — a cancelable promise with full execution results

### Execution modes

```typescript
type WorkflowExecuteModeValues =
  | 'cli'         // Command line execution
  | 'error'       // Error handler execution
  | 'integrated'  // n8n internal execution
  | 'internal'    // Internal system execution
  | 'manual'      // User-triggered (UI or API)
  | 'retry'       // Retry of previous execution
  | 'trigger'     // Trigger event execution
  | 'webhook'     // Webhook POST execution
  | 'evaluation'  // Testing/evaluation execution
  | 'chat'        // Chat trigger execution
```

**Manual executions** are the primary development mode. They:
- Run when clicking Execute Workflow in the editor
- Support data pinning (frozen node output)
- Don't count toward execution quotas
- Display data in the editor for inspection

**Partial executions** run a subset of the workflow:
- Start by selecting a node → detail view → Execute Step
- Execute the selected node and all required predecessor nodes
- Useful for iterative testing of specific node logic
- Require a trigger node connection (use Manual Trigger as fallback)
- Limitation: may fail on very large workflows

**Production executions** are triggered automatically by events/schedules when a workflow is active. They ignore all pinned data.

### Destination node execution

A key capability for targeted validation: execution can be bounded to a specific destination node.

```typescript
interface IDestinationNode {
  nodeName: string
  mode: 'inclusive' | 'exclusive'  // Include or exclude destination from execution
}
```

When `destinationNode` is provided:
- Only nodes on the path between the start and destination are executed
- `inclusive` mode executes the destination node itself
- `exclusive` mode stops just before it

**Relevance to n8n-vet:** This is the closest platform primitive to "validate a slice." A destination node effectively bounds execution to a subgraph.

### Partial execution utilities

`packages/core/src/execution-engine/partial-execution-utils/` provides graph-aware helpers:

```typescript
// Find starting nodes for partial execution
function findStartNodes(workflow, destinationNodeName, runData, pinData): INode[]

// Find the trigger to start from
function findTriggerForPartialExecution(workflow, destinationNodeName, runData): INode | undefined

// Build subgraph between parent and destination
function findSubgraph(graph: DirectedGraph, parentNode: INode): DirectedGraph

// Recreate node execution stack for continuation
function recreateNodeExecutionStack(workflow, startNode, runData, pinData, destinationNode, agentRequest?): IExecuteData[]

// Clean historical run data (keep only relevant paths)
function cleanRunData(workflow, runData, destinationNodeName): IRunData

// Handle cyclic graph structures
function handleCycles(graph: DirectedGraph): void

// Remove disabled nodes
function filterDisabledNodes(workflow: Workflow): INode[]
```

**DirectedGraph** class provides a structured graph representation:

```typescript
class DirectedGraph {
  static fromWorkflow(workflow: Workflow): DirectedGraph
  toWorkflow(baseWorkflow: Workflow): Workflow
  
  getNodes(): Map<string, INode>
  getNodesByNames(names: string[]): Set<INode>
  getConnections(filter?: { to?: INode }): GraphConnection[]
  
  addNode(node: INode): this
  addNodes(...nodes: INode[]): this
  addConnection(connection: GraphConnection): this
  removeNode(node: INode | string): this
  removeConnection(from, to, type, ...): this
}
```

**Relevance to n8n-vet:** These utilities handle subgraph extraction, cycle detection, and execution stack reconstruction — all needed for slice-based validation.

---

## 2. Data Pinning System

Data pinning is n8n's primary mechanism for mocking node output during development.

### Type definition

```typescript
interface IPinData {
  [nodeName: string]: INodeExecutionData[]
}

interface INodeExecutionData {
  json?: IDataObject
  binary?: IBinaryKeyData
  pairedItem?: IPairedItemData
}
```

### How pinning works during execution

1. Pin data is passed to `WorkflowExecute.run()` via the `pinData` option
2. Stored in `IRunExecutionData.resultData.pinData`
3. During node execution, if a node has pin data → pinned data is used without executing the node
4. Child nodes receive the pinned data as input, as if the node had executed normally

### Which nodes get pinned vs. executed

The `needsPinData()` utility determines this:

| Node category | Pinned? | Examples |
|---|---|---|
| Trigger nodes | Yes | Webhook, Schedule, Form, Chat |
| Nodes with credentials | Yes | Postgres, Slack, OpenAI |
| HTTP Request nodes | Yes | Any HTTP Request |
| Other integration nodes | Yes | API-backed nodes |
| Logic nodes | No — executes normally | Set, If, Switch, Code, Merge |
| File I/O nodes | No — executes normally | Execute Command, Read/Write File |
| Mapping nodes | No — executes normally | Edit Fields, similar |

### Limitations

- **Binary pin data: GUI-only limitation** — the n8n editor UI disables pin data for nodes whose output contains binary data (locale string: "Pin Data is disabled as this node's output contains binary data"). However, the engine's `IPinData` type includes `binary?: IBinaryKeyData` on `INodeExecutionData`, and the execution engine does not reject binary pin data passed programmatically. Since n8n-vet constructs pin data via the API (not the editor GUI), binary pin data is technically possible but untested. For practical purposes, n8n-vet should focus on JSON pin data and treat binary-output nodes as requiring execution rather than mocking.
- **Development only** — production executions ignore all pinned data
- **Manual construction** — pin data must be explicitly provided; there's no automatic inference of "good enough" mock data
- **No partial pinning within a node** — a node is either fully pinned or fully executed

### Pin data in the GUI

- Pin data via OUTPUT panel → "Pin data" button
- Edit pinned data in JSON view
- Copy data from previous executions
- Yellow "dirty node" indicator when pinned data may be stale

### Relevance to n8n-vet

Pin data is the primary mechanism for:
- Mocking expensive/external nodes during validation
- Creating deterministic execution paths
- Isolating workflow slices for focused testing

Limitations that matter:
- No binary data support limits testing of file-processing workflows
- Manual pin data construction is expensive — `prepare_test_pin_data` helps with schemas but doesn't generate data
- Pin data is all-or-nothing per node — no partial mocking of a node's behavior

---

## 3. MCP Server Tools

n8n exposes a built-in MCP server (`packages/cli/src/modules/mcp/tools/`) with tools for programmatic workflow interaction.

### test_workflow

The primary tool for mocked execution.

```typescript
// Input
{
  workflowId: string                              // Required
  pinData: Record<string, Array<{json: any}>>     // Pin data wrapped in {json: ...}
  triggerNodeName?: string                         // Optional trigger override
}

// Output
{
  executionId: string | null
  status: 'success' | 'error' | 'running' | 'waiting' | 'canceled' | 'crashed' | 'new' | 'unknown'
  error?: string
}
```

**Behavior:**
1. Validates user has `workflow:execute` permission
2. Selects trigger node (override with `triggerNodeName`)
3. Creates execution data with pin data
4. Runs workflow synchronously
5. Returns after completion or timeout

**Timeout:** 5 minutes (`WORKFLOW_EXECUTION_TIMEOUT_MS = 5 * Time.minutes.toMilliseconds` in `packages/cli/src/modules/mcp/tools/execution-utils.ts`). This is the workflow execution timeout used by both `test_workflow` and `execute_workflow` MCP tools.

**Key detail:** Pin data values **must** be wrapped in `{json: {...}}` format. Raw objects will fail.

### prepare_test_pin_data

Schema discovery for generating pin data.

```typescript
// Input
{ workflowId: string }

// Output
{
  nodeSchemasToGenerate: Record<string, JsonSchema>   // Nodes needing pin data, with JSON Schemas
  nodesWithoutSchema: string[]                         // Nodes with no discoverable schema
  nodesSkipped: string[]                               // Logic nodes that execute normally
  coverage: {
    withSchemaFromExecution: number    // Inferred from last execution output
    withSchemaFromDefinition: number   // From node type definition
    withoutSchema: number             // No schema available
    skipped: number                   // Don't need pin data
    total: number
  }
}
```

**Schema generation tiers:**
1. Infer from output of the last successful execution (highest quality)
2. Discover from node type definition (structural but may miss runtime-specific fields)
3. Generate empty `{}` for nodes with no available schema

### execute_workflow

Full execution without mocking.

```typescript
// Input
{
  workflowId: string
  executionMode: 'manual' | 'production'
  inputs?: {
    type: 'chat' | 'form' | 'webhook'
    // chat: { chatInput: string }
    // form: { formData: Record<string, unknown> }
    // webhook: { webhookData: { method?, query?, body?, headers? } }
  }
}

// Output
{
  executionId: string | null
  status: 'started' | 'error'
  error?: string
}
```

**Important:** Returns immediately (non-blocking). Does not wait for completion. Must poll `get_execution` for results.

### get_execution

Retrieve execution data for inspection.

```typescript
// Input
{
  workflowId: string
  executionId: string
  includeData?: boolean        // Include node input/output data
  nodeNames?: string[]         // Filter to specific nodes
  truncateData?: number        // Limit items per node output
}

// Output
{
  execution: {
    id, workflowId, mode, status, startedAt, stoppedAt,
    retryOf, retrySuccessId, waitTill
  } | null
  data?: unknown               // Execution data when includeData=true
  error?: string
}
```

**Key details:**
- Default returns metadata only — must set `includeData: true` for node data
- `nodeNames` filter is critical for large workflows — avoids pulling thousands of lines of data
- `truncateData` limits items per node output for manageable response size

### Other MCP tools

| Tool | Purpose |
|---|---|
| `get-workflow-details` | Fetch workflow structure and input schemas |
| `search-workflows` | Find workflows by name/folder |
| `publish-workflow` / `unpublish-workflow` | Lifecycle management |
| `create-data-table` | Create evaluation dataset tables |
| `add-data-table-rows` | Insert test data rows |
| `search-data-tables` | Find existing data tables |

---

## 4. REST API Endpoints

### Workflow execution

```
POST /workflows/:workflowId/run
Body: ManualRunPayload
Returns: { executionId: string }
```

The payload supports three execution paths:

1. **Partial execution** — `destinationNode` + `runData` + optional `dirtyNodeNames`
2. **Full execution from specific trigger** — `triggerToStartFrom` + optional `destinationNode`
3. **Full execution from auto-selected trigger** — `destinationNode` only, system picks trigger

All paths accept `pinData` for mocking.

### Execution inspection

```
GET /executions/:id                          # Metadata only
GET /executions/:id?includeData=true         # Full data
GET /executions/:id?nodeNames=Node1,Node2    # Filtered
GET /executions                              # List (filterable by status, workflow)
POST /executions/:id/stop                    # Cancel running execution
POST /executions/:id/retry                   # Retry failed execution
```

### Workflow management

```
GET /workflows/:workflowId                   # Full workflow definition
POST /workflows/:workflowId/activate         # Publish
POST /workflows/:workflowId/deactivate       # Unpublish
```

### Authentication

API key in header: `X-N8N-API-KEY: <key>`

Create keys in Settings → n8n API. Enterprise plans support scoped keys with limited resource access.

---

## 5. Workflow Graph Structure

### Connection model

Connections are indexed by **source node**:

```typescript
type IConnections = {
  [sourceNodeName: string]: {
    [connectionType: string]: {    // 'main', 'error', etc.
      [outputIndex: number]: IConnection[]
    }
  }
}

interface IConnection {
  node: string      // Target node name
  type: string      // Connection type
  index: number     // Input index on target
}
```

To find **parent nodes** (predecessors), you must invert the connections:

```typescript
import { getParentNodes, getChildNodes, mapConnectionsByDestination } from 'n8n-workflow';

const connectionsByDestination = mapConnectionsByDestination(workflow.connections);
const parents = getParentNodes(connectionsByDestination, 'NodeName', 'main', 1);
const children = getChildNodes(workflow.connections, 'NodeName', 'main', 1);
```

### Workflow class graph methods

```typescript
class Workflow {
  getParentNodes(nodeName, type?, depth?): string[]
  getChildNodes(nodeName, type?, depth?): string[]
  getConnectedNodes(connections, nodeName, type?, depth?): string[]
  getParentNodesByDepth(nodeName, maxDepth?): IConnectedNode[]
  searchNodesBFS(connections, sourceNode, maxDepth?): IConnectedNode[]
  getHighestNode(nodeName): string[]          // Find root ancestors
  getStartNode(destinationNode?): INode       // Find execution start point
  getTriggerNodes(): INode[]
  getPollNodes(): INode[]
  getPinDataOfNode(nodeName): INodeExecutionData[] | undefined
}
```

### Node structure

```typescript
interface INode {
  id: string
  name: string
  type: string                    // e.g. 'n8n-nodes-base.webhook'
  typeVersion: number
  position: [number, number]
  parameters: INodeParameters
  disabled?: boolean
  credentials?: INodeCredentials
}
```

### Workflow checksum

`packages/workflow/src/workflow-checksum.ts` calculates a hash over nodes, connections, settings, and pinData. Used internally to detect whether a workflow has been modified.

**Relevance to n8n-vet:** Checksum could be used to detect whether a workflow (or slice of a workflow) has changed since last validation, supporting the "trusted boundary" concept.

---

## 6. Expression System

### Resolution model

Expressions are evaluated by `WorkflowExpression` using `WorkflowDataProxy` to resolve `$` references.

```typescript
class WorkflowExpression {
  resolveSimpleParameterValue(
    parameterValue, siblingParameters, runExecutionData,
    runIndex, itemIndex, activeNodeName, connectionInputData,
    mode, additionalKeys, executeData?
  ): NodeParameterValue
}
```

### Available expression references

| Expression | Meaning |
|---|---|
| `$json` | Current item's JSON data |
| `$json.fieldName` | Specific field of current item |
| `$binary` | Current item's binary data |
| `$input` | Reference to current node's inputs |
| `$('NodeName').first()` | First item from named node |
| `$('NodeName').item` | Linked item from named node |
| `$('NodeName').all()` | All items from named node |
| `$('NodeName').last()` | Last item from named node |
| `$parents[0]` | Parent node data |
| `$vars` | Workflow variables |
| `$now`, `$today` | Date/time |
| `$if(cond, a, b)` | Conditional helper |
| `$execution.customData` | Custom execution metadata |

### Expression security

Expressions are sandboxed. Blocked constructs include:
- `with` statements
- Class extensions
- Destructuring with computed keys
- Reserved variable access
- Class instantiation

### Relevance to n8n-vet

The expression system is the primary mechanism for data flow between nodes. Expression references like `$json.field` and `$('NodeName').first().json.field` are the critical links that can break when upstream nodes change. Any data flow analysis tool must parse these references.

**Key insight:** Expressions can contain arbitrary JavaScript, making full static analysis impossible. A practical analyzer should handle the three common patterns:
1. `$json.field` — previous node's output
2. `$('NodeName').first().json.field` — named node reference
3. `$input.first().json.field` — explicit input reference

---

## 7. Validation Capabilities

### Node validation

```typescript
// packages/workflow/src/node-validation.ts

function validateNodeCredentials(node, nodeType): NodeCredentialIssue[]
// Checks all required credentials are configured

function isNodeConnected(nodeName, connections, connectionsByDestination): boolean
// Checks if node has incoming or outgoing connections

function isTriggerLikeNode(nodeType): boolean
// Returns true for trigger, webhook, or poll nodes
```

### Parameter validation

```typescript
// packages/workflow/src/node-parameters/parameter-type-validation.ts

function validateNodeParameters<T>(nodeType, nodeParameters): ValidationResult
// Returns { valid: boolean, errors?: ValidationError[] }
```

### What validation covers

- Node type existence
- Valid typeVersion
- Required parameters present
- Parameter type correctness
- Credential configuration
- Basic expression syntax

### What validation does NOT cover

- **Data flow correctness** — whether `$json.field` references actually exist in upstream output
- **Expression evaluation** — whether expressions will resolve successfully at runtime
- **Output shape compatibility** — whether a node's output matches what downstream nodes expect
- **Data loss through passthrough** — whether an HTTP Request or similar node replaces `$json` with its own response

This gap is the central motivation for n8n-vet.

---

## 8. Evaluation Framework

n8n has a built-in evaluation system for AI workflow quality testing.

### Architecture

- **Evaluation Trigger node** — pulls rows from a dataset (Data Table or Google Sheets)
- **Evaluation node** — three operations:
  - `Set Outputs` — capture workflow output for comparison
  - `Set Metrics` — record numeric quality scores
  - `Check If Evaluating` — branch based on execution mode (evaluation vs production)

### Built-in metrics

| Metric | Type | Scale | Description |
|---|---|---|---|
| Correctness | AI-based | 1-5 | Semantic consistency with reference answer |
| Helpfulness | AI-based | 1-5 | Whether response answers the query |
| String Similarity | Algorithmic | 0-1 | Edit distance comparison |
| Categorization | Exact match | 0/1 | Classification match |
| Tools Used | Presence | 0/1 | Whether execution used tools |
| Custom | User-defined | Numeric | Via Code node or LLM |

### Two evaluation modes

**Light evaluations** (pre-deployment):
- Small, hand-generated datasets
- Visual comparison of outputs
- No formal metrics required
- Good for initial development

**Metric-based evaluations** (post-deployment):
- Large, representative datasets
- Require expected outputs and numeric metrics
- Track scores across runs
- Good for regression testing

### Setup

1. Create dataset (Data Table or Google Sheets) with input, expected output, and empty actual output columns
2. Add Evaluation Trigger node (outputs one row per execution)
3. Wire trigger to workflow with dataset input columns
4. Add Evaluation node with Set Outputs to populate output columns
5. Optionally add Set Metrics for numeric scoring
6. Run from Evaluations tab

### Limitations

- Designed for **AI output quality** — not structural workflow correctness
- Requires dataset setup overhead (Data Table or Google Sheets)
- One Evaluation Trigger per workflow
- Metric-based evaluations require Pro/Enterprise plans
- No data flow analysis or expression reference checking

### Relevance to n8n-vet

Evaluations serve a different purpose than n8n-vet. They measure **output quality** (is the LLM response good?), while n8n-vet targets **structural correctness** (does the data flow work?). However:
- The `Check If Evaluating` operation could be useful for dual-mode workflows
- Data Tables could store validation fixtures
- The evaluation execution mode (`'evaluation'`) could potentially be leveraged for validation runs

---

## 9. Execution Data Structures

### Primary result types

```typescript
interface IRun {
  data: IRunExecutionData
  status: ExecutionStatus
  startedAt: Date
  stoppedAt: Date
  executionTime: number
}

interface IRunExecutionData {
  version: 1
  startData?: {
    startNodes?: StartNodeData[]
    destinationNode?: IDestinationNode
    runNodeFilter?: string[]
  }
  resultData: {
    error?: ExecutionError
    runData?: IRunData       // Per-node execution output
    pinData?: IPinData
    lastNodeExecuted?: string
    metadata?: Record<string, string>
  }
  executionData?: {
    contextData?: IExecuteContextData
    nodeExecutionStack?: IExecuteData[]
    metadata?: Record<string, ITaskMetadata[]>
    waitingExecution?: IWaitingForExecution
  }
  parentExecution?: RelatedExecution
}

// Run data: keyed by node name
interface IRunData {
  [nodeName: string]: ITaskData[]
}

// Per-task data  
interface ITaskData {
  data?: ITaskDataConnections     // Node inputs and outputs
  inputOverride?: ITaskDataConnections
}

// Connection-indexed data
interface ITaskDataConnections {
  [connectionType: string]: {     // 'main', 'error', etc.
    [outputIndex: number]: INodeExecutionData[]
  }
}
```

### Execution status values

```typescript
type ExecutionStatus =
  | 'canceled' | 'crashed' | 'error' | 'new'
  | 'running' | 'success' | 'unknown' | 'waiting'
```

### Custom execution data

Workflows can set searchable metadata on their own execution:

```javascript
$execution.customData.set("key", "value");
$execution.customData.setAll({"key1": "value1"});
```

Limits: 10 items, key max 50 chars, value max 255 chars, string values only.

### Factory functions

```typescript
function createRunExecutionData(options?): IRunExecutionData
function createEmptyRunExecutionData(): IRunExecutionData
function createErrorExecutionData(node, error): IRunExecutionData
```

---

## 10. Error System

### Error hierarchy

```
ExecutionBaseError (abstract)
├── WorkflowOperationError
│   ├── SubworkflowOperationError
│   └── CliWorkflowOperationError
├── WorkflowActivationError
├── ExpressionError
│   ├── ExpressionReservedVariableError
│   ├── ExpressionClassExtensionError
│   ├── ExpressionWithStatementError
│   ├── ExpressionDestructuringError
│   └── ExpressionComputedDestructuringError
├── NodeError
│   └── NodeOperationError
├── NodeApiError
├── NodeSslError
├── ExecutionCancelledError
│   ├── ManualExecutionCancelledError
│   └── TimeoutExecutionCancelledError
└── WebhookPathTakenError
```

### Error reporting gaps

Per testing_experiences.md:
- Error messages are often generic ("Invalid JSON in response body" without showing the body)
- No indication of which expression failed evaluation
- Diagnosing errors often requires pulling full execution data and inspecting node inputs manually

---

## 11. Sub-Workflow Execution

### How sub-workflows work

- **Execute Sub-workflow node** in parent → **Execute Sub-workflow Trigger** in child
- Last node of sub-workflow returns data to the parent node
- Sub-workflow executions don't count toward execution limits

### Source options

The Execute Sub-workflow node can load sub-workflows from:
- Database (by list selection or ID)
- Local file (JSON file path)
- Parameter (inline workflow JSON)
- URL (remote workflow JSON)

### Data passing

- **Input:** Items from parent flow into Execute Sub-workflow Trigger
- **Output:** Last node's output returns to parent
- **Modes:** Run once with all items (batch) or run once per item

### Context inheritance

```typescript
interface IExecutionContext {
  version: 1
  parentExecutionId?: string
  parentWorkflowId?: string
  establishedAt: number
  credentialContext?: ICredentialContext
}
```

Sub-workflows inherit parent context, including credentials. Redaction policies on child workflows override parent.

### Relevance to n8n-vet

Sub-workflows are natural **trusted boundaries** in the n8n-vet model. A sub-workflow with a stable interface (known input/output shape) can be treated as a trusted region when validating the parent workflow. The `Local File` source option is particularly relevant for n8n-as-code workflows.

---

## 12. Dirty Nodes

n8n tracks "dirty" nodes — nodes with potentially stale output — via a yellow triangle indicator.

### What marks a node dirty

- Inserting or deleting nodes
- Modifying node parameters
- Adding connectors
- Deactivating nodes
- Unpinning data
- Modifying pinned data

### Resolution

Execute the node again (manual trigger or partial execution).

### Relevance to n8n-vet

The dirty node concept aligns directly with n8n-vet's "validation locality" principle. Dirty nodes identify the minimum set of nodes needing re-validation after a change. This information could feed into validation target selection.

---

## 13. Webhooks and Trigger Testing

### Webhook URLs

Each webhook node has two URLs:
- **Test URL:** `/webhook-test/<path>` — active for 120 seconds when "Listen for Test Event" is clicked
- **Production URL:** `/webhook/<path>` — active when workflow is published

### Webhook parameters

- HTTP method: DELETE, GET, HEAD, PATCH, POST, PUT
- Path: custom or auto-generated (supports route parameters like `/:variable`)
- Authentication: Basic, Header, JWT, or None
- Response mode: Immediately, When Last Node Finishes, Using Respond to Webhook, or Streaming
- Max payload: 16MB (configurable via `N8N_PAYLOAD_SIZE_MAX`)

### Testing pattern

1. Arm the test webhook (120 sec window)
2. Send HTTP request to test URL
3. Inspect execution data

This is the pattern `n8nac test` automates.

---

## 14. Data Tables

n8n's Data Tables provide structured in-instance data storage.

- CRUD operations via Data Table node, REST API, or UI
- Import/export CSV
- 50MB default limit per instance
- Scoped to projects
- Cannot be accessed directly from Code node
- No cross-project access

### Relevance to n8n-vet

Data tables could serve as:
- Fixture storage for validation inputs
- Expected output storage for assertions
- Validation result recording
- Evaluation dataset storage

Limitation: 50MB per instance and no Code node access make them more suited for evaluation datasets than for high-frequency validation fixtures.

---

## 15. Capability Summary for n8n-vet

### What n8n provides that n8n-vet can build on

| Capability | Mechanism | Relevance |
|---|---|---|
| Bounded execution | `destinationNode` parameter | Execute only a subgraph (slice) |
| Mocked execution | Pin data system | Replace external nodes with deterministic data |
| Schema discovery | `prepare_test_pin_data` | Know what pin data is needed |
| Programmatic execution | `test_workflow` MCP tool | Run mocked workflows from tooling |
| Execution inspection | `get_execution` with filters | Extract specific node outputs |
| Graph traversal | `getParentNodes`, `getChildNodes`, `DirectedGraph` | Navigate workflow structure |
| Subgraph extraction | Partial execution utilities | Isolate workflow regions |
| Change detection | Workflow checksum, dirty nodes | Know what changed |
| Sub-workflow boundaries | Execute Sub-workflow node | Natural trust boundaries |
| Expression parsing | `WorkflowExpression`, `WorkflowDataProxy` | Understand data flow references |

### What n8n does NOT provide (gaps for n8n-vet)

| Gap | Description |
|---|---|
| Data flow analysis | No tracing of `$json.field` references through graph to verify upstream output shapes |
| Output shape assertions | No mechanism to assert "node X should output items matching shape Y" |
| Execution checkpointing | No saving/restoring execution state at arbitrary nodes |
| Execution forking | No "continue from node N" with modified downstream graph |
| Compact diagnostic output | Raw execution data is voluminous; no built-in summarization |
| Validation orchestration | No single command: run → wait → inspect → report pass/fail |
| Fixture-to-pin-data bridge | No mapping from fixture files to pin data format |
| Trusted boundary tracking | No concept of "this region hasn't changed, skip revalidation" |
| Low-value rerun detection | No awareness of whether a validation run adds new information |
| Binary data mocking | Pin data doesn't support binary data |
