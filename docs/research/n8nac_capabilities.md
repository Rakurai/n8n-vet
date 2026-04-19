# n8n-as-code Capabilities Reference

> Research document for the n8n-vet project. Catalogs all n8n-as-code (n8nac) functionality relevant to workflow validation, testing, execution inspection, and development workflow management. Source: n8n-as-code repository at /Users/QTE2333/repos/n8n-as-code.

---

## 1. Project Overview

**n8n-as-code** is a monorepo tool that treats n8n as a deployment surface and local TypeScript/JSON files as the source of truth for workflow authoring.

### Package structure

| Package | Version | Purpose |
|---|---|---|
| `packages/cli` | 1.6.2 | Main CLI tool (`n8nac` command) |
| `packages/mcp` | 1.3.0 | Dedicated MCP server for AI agents |
| `packages/skills` | 1.8.2 | AI knowledge base, node schemas, validation |
| `packages/transformer` | 1.1.0 | JSON ↔ TypeScript bidirectional converter |
| `packages/vscode-extension` | 1.40.0 | VS Code editor integration |
| `plugins/claude/` | — | Claude Code plugin integration |
| `plugins/openclaw/` | — | OpenClaw plugin integration |

### Tech stack

- **Runtime:** Node.js + TypeScript
- **CLI framework:** Commander.js v11.1.0
- **Configuration:** conf (local), Zod validation
- **File watching:** chokidar v5.0.0
- **MCP framework:** @modelcontextprotocol/sdk v1.29.0
- **Workflow transform:** ts-morph v21.0.1, prettier v3.2.5
- **Knowledge search:** flexsearch v0.8.212
- **Testing:** Vitest (CLI), Jest (transformer, skills)
- **Build:** TypeScript + Turbo orchestration

---

## 2. Workflow Representation

### TypeScript DSL

n8n-as-code uses a decorator-based TypeScript DSL to represent workflows as diffable, versionable code.

```typescript
import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
    id: "G9GXzwX97XBKAwcj",
    name: "Job Application Assistant",
    active: false,
    tags: ["automation", "hr"],
    settings: { executionOrder: "v1" },
    projectId: "proj_123",
    projectName: "Default"
})
export class JobApplicationAssistantWorkflow {
    @node({
        name: "Schedule Trigger",
        type: "n8n-nodes-base.scheduleTrigger",
        version: 1.2,
        position: [-1072, 720],
        onError: "stopWorkflow",
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 5000
    })
    ScheduleTrigger = {
        rule: {
            interval: [
                { field: "cronExpression", expression: "0 9 * * 1-5" }
            ]
        }
    };

    @node({
        name: "HTTP Request",
        type: "n8n-nodes-base.httpRequest",
        version: 4,
        credentials: {
            httpBasicAuth: { id: "cred_123", name: "My Cred" }
        }
    })
    HttpRequest = {
        method: "POST",
        url: "https://api.example.com/webhook",
        sendBody: true,
        contentType: "application/json",
        body: '{"item":"{{$json.id}}"}'
    };

    @links()
    defineRouting() {
        this.ScheduleTrigger.out(0).to(this.HttpRequest.in(0));
    }
}
```

### Decorator metadata

**@workflow metadata:**
- `id` — Workflow UUID
- `name` — Display name
- `active` — Published state
- `tags` — String array
- `settings` — Execution settings
- `projectId`, `projectName` — Project scope
- `isArchived` — Archive flag

**@node metadata:**
- `name` — Display name
- `type` — Node type identifier (e.g., `n8n-nodes-base.httpRequest`)
- `version` — typeVersion
- `position` — `[x, y]` coordinates
- `credentials` — Credential references
- `onError` — `continueErrorOutput`, `continueRegularOutput`, `stopWorkflow`
- `alwaysOutputData`, `executeOnce` — Execution behavior
- `retryOnFail`, `maxTries`, `waitBetweenTries` — Retry config

### Connection API (fluent DSL)

```typescript
@links()
defineRouting() {
    this.NodeA.out(0).to(this.NodeB.in(0));       // Basic connection
    this.NodeA.error().to(this.ErrorHandler.in(0)); // Error output
    this.NodeA.out(0).to(this.Success.in(0));       // Multiple outputs
    this.NodeA.out(1).to(this.Fallback.in(0));
    this.NodeA.out(0).to(this.Merger.in(0));        // Multiple inputs
    this.NodeB.out(0).to(this.Merger.in(1));
}
```

### AI dependency injection

```typescript
@links()
defineRouting() {
    this.Conversation.uses({
        ai_languageModel: { output: "llm" },
        ai_memory: { output: "memory" },
        ai_tool: [
            { output: "slackTool" },
            { output: "n8nExecutor" }
        ]
    });
}
```

Supported AI dependencies: `ai_languageModel`, `ai_memory`, `ai_outputParser`, `ai_tool`, `ai_agent`, `ai_chain`, `ai_document`, `ai_textSplitter`, `ai_embedding`, `ai_retriever`, `ai_reranker`, `ai_vectorStore`.

### Format conversion

```bash
n8nac convert ./workflow.json --format typescript       # JSON → TypeScript
n8nac convert ./workflow.workflow.ts --format json       # TypeScript → JSON
n8nac convert-batch ./src --format typescript --force    # Batch conversion
```

Auto-detection: `.json` → JSON, `.workflow.ts` → TypeScript.

### Relevance to n8n-vet

The TypeScript DSL provides:
- A parseable, diffable representation of workflows
- Decorator metadata that can be extracted programmatically (node types, versions, credentials, connections)
- A connection graph that can be traversed for data flow analysis
- Expression references embedded in node property values that can be statically analyzed

The `n8n-as-code/transformer` package provides the parsing and generation infrastructure.

---

## 3. CLI Commands for Validation and Testing

### n8nac verify

Schema-based validation of a workflow fetched from n8n.

```bash
n8nac verify <workflowId>
```

**What it checks:**
- Node type existence in schema
- Valid typeVersion for each node
- Required parameters present
- Parameter types match schema
- Missing required fields

**Exit codes:** 0 = valid, 1 = errors found.

**What it does NOT check:**
- Data flow between nodes (expression references)
- Whether upstream outputs contain fields referenced by downstream nodes
- Data loss through passthrough nodes
- Runtime behavior

### n8nac skills validate

More comprehensive offline validation of a workflow file.

```bash
n8nac skills validate <file> [--strict] [--debug] [--json]
```

**What it checks:**
- Everything `verify` checks
- Credential type correctness
- Expression syntax validity (basic regex-based)

**Output structure:**
```typescript
{
    valid: boolean;
    errors: Array<{
        message: string;
        nodeName?: string;
        nodeId?: string;
        path?: string;
    }>;
    warnings: Array<{
        message: string;
        nodeName?: string;
        nodeId?: string;
        path?: string;
    }>;
}
```

### n8nac test

Trigger a workflow via its webhook/form/chat URL and report the outcome.

```bash
n8nac test <workflowId> [--prod] [--data '{"key":"value"}'] [--query '{"key":"value"}']
```

**Mechanism:**
1. Detects workflow trigger type (webhook, form, chat, schedule, unknown)
2. Extracts webhook path from node parameters
3. Constructs appropriate URL (e.g., `/webhook-test/{path}`)
4. Sends HTTP request
5. Classifies the result

**Supported trigger types:**

| Trigger | URL pattern | Testable? |
|---|---|---|
| webhook | `/webhook-test/{path}` | Yes |
| form | `/form-test/{path}` | Yes |
| chat | `/webhook-test/{path}/chat` | Yes |
| schedule | N/A | No (informational) |
| unknown | N/A | No (informational) |

**Error classification:**

| Class | Exit | Description | Action |
|---|---|---|---|
| A (config-gap) | 0 | Missing credentials, LLM model not set | User configures in UI |
| Runtime-state | 0 | Webhook not armed, production hook not registered | Change n8n state |
| B (wiring-error) | 1 | Bad expressions, wrong field names | Agent fixes code |

**Response structure:**
```typescript
interface ITestResult {
    success: boolean;
    triggerInfo: ITriggerInfo;
    webhookUrl: string;
    statusCode: number;
    responseData: unknown;
    errorMessage: string;
    errorClass: 'config-gap' | 'runtime-state' | 'wiring-error' | null;
    notes: string[];
}
```

### n8nac test-plan

Pre-execution analysis of testability and suggested payloads.

```bash
n8nac test-plan <workflowId> [--json]
```

**Returns:**
```typescript
interface ITestPlan {
    workflowId: string;
    workflowName: string;
    testable: boolean;
    reason: string;
    triggerInfo: ITriggerInfo;
    endpoints: {
        testUrl: string;
        productionUrl: string;
    };
    payload: {
        inferred: Record<string, unknown>;
        confidence: 'low' | 'medium';
        fields: IInferredPayloadField[];
        notes: string[];
    };
}
```

**Exit codes:** 0 = testable, 1 = not testable.

### Relevance to n8n-vet

These commands provide the foundation for automated validation:
- `verify` / `skills validate` cover structural correctness (the "static lint" layer)
- `test` provides HTTP-triggered execution with structured error classification
- `test-plan` provides introspection of testability without execution

**Gaps:**
- No pin data support in `test` — it only tests via HTTP triggers, requiring the full workflow to execute
- No assertion layer — `test` reports HTTP success/failure but can't assert on specific node outputs
- No data flow analysis — neither `verify` nor `validate` trace expression references
- No path targeting — execution is always full workflow, not bounded to a slice

---

## 4. Execution Inspection

### n8nac execution list

```bash
n8nac execution list [--workflow-id <id>] [--status <status>] [--limit <n>] [--json]
```

Filterable by: workflow, status (canceled|crashed|error|new|running|success|unknown|waiting), project. Supports pagination with `--cursor`.

### n8nac execution get

```bash
n8nac execution get <id> [--include-data] [--json]
```

Returns full execution object with workflow details and run data when `--include-data` is set.

**Known issue from testing_experiences.md:** The raw execution JSON is enormous (thousands of lines for 50+ node workflows). No built-in filtering, summarization, or error-focused view. Users end up writing custom scripts (e.g., `n8n_exec_inspect.py`) to extract useful information.

### Missing execution inspection capabilities

- No `--errors-only` flag to extract just failed nodes with their input data and error message
- No `--summary` flag for one-line-per-node overview
- No `--trace <node1> <node2> ...` to show specific node I/O
- No `--node-names` filter (the n8n MCP `get_execution` has this, but n8nac CLI doesn't expose it)

---

## 5. Workflow Sync Model

### Push / Pull / Resolve

```bash
n8nac pull <workflowId>                          # Download from n8n
n8nac push <path> [--verify]                     # Upload to n8n
n8nac fetch <workflowId>                         # Update remote cache
n8nac resolve <workflowId> --mode <keep-current|keep-incoming>  # Resolve conflicts
```

### State tracking

The `WorkflowStateTracker` maintains a local hash cache:

**Sync states:**
- `EXIST_ONLY_LOCALLY` — Not yet pushed
- `EXIST_ONLY_REMOTELY` — Not yet pulled
- `TRACKED` — In sync
- `CONFLICT` — Changed in both local and remote

### OCC (Optimistic Concurrency Control) conflicts

Any change in the n8n GUI (even toggling MCP exposure) creates a version mismatch. Every subsequent `push` fails with a conflict. Resolution requires `n8nac resolve <id> --mode keep-current`.

**Pain point from testing_experiences.md:** In a typical debug cycle (edit file → push → check GUI → push again), this happens on nearly every second push.

**No `--force` flag exists** to auto-resolve in favor of local version. This is a significant friction point for iterative development.

### Known bug: availableInMCP silently dropped

`n8nac push` strips the `availableInMCP` workflow setting because its internal `WorkflowSettings` interface uses a closed allowlist. Every push disables MCP access, requiring manual re-enablement in the GUI.

---

## 6. n8nac MCP Server

The n8nac MCP server is separate from n8n's built-in MCP server. It provides **offline, read-only** access to n8n knowledge.

```bash
n8nac mcp [--cwd <path>]
```

Serves on stdio (default) or HTTP.

### MCP tools exposed

All tools are **read-only** — no API calls, no side effects.

#### search_n8n_knowledge

Search the local knowledge base for nodes, documentation, and examples.

```typescript
// Parameters
{
  query: string       // Natural-language search
  category?: string   // Documentation category filter
  type?: 'node' | 'documentation'
  limit?: number      // 1-25
}
```

#### get_n8n_node_info

Get the full offline schema and metadata for a specific node.

```typescript
// Parameters
{ name: string }      // Exact or close node name
```

Returns complete node schema with all properties, forms, methods, and technical metadata.

#### validate_n8n_workflow

Validate a workflow from JSON or TypeScript content against the bundled schema.

```typescript
// Parameters
{
  workflowContent: string    // Workflow source (JSON or .workflow.ts)
  format?: 'auto' | 'json' | 'typescript'
}
```

Returns validation result with errors, warnings, and detailed node-level feedback.

#### search_n8n_workflow_examples

Search bundled community workflow index (7000+ workflows from n8nworkflows.xyz).

```typescript
// Parameters
{
  query: string
  limit?: number     // 1-25
}
```

#### search_n8n_docs

Search bundled documentation pages.

```typescript
// Parameters
{
  query: string
  category?: string
  type?: 'node' | 'documentation'
  limit?: number     // 1-10
}
```

### Relevance to n8n-vet

The n8nac MCP server provides:
- **Offline schema validation** without API calls — useful for static analysis
- **Node schema lookup** for understanding expected parameters and output shapes
- **Community workflow examples** for fixture/pattern discovery

It does NOT provide:
- Execution capabilities (read-only)
- Pin data handling
- Data flow analysis
- Any runtime interaction with n8n

---

## 7. Workflow Lifecycle Management

### Activation / Deactivation

```bash
n8nac workflow activate <workflowId>
n8nac workflow deactivate <workflowId>
```

### Credential management

```bash
n8nac credential schema <type> [--json]       # Show JSON schema for credential type
n8nac credential list [--json]                  # List all credentials (metadata only)
n8nac credential get <id> [--json]             # Get credential metadata
n8nac credential create --type <type> --name <name> [--data <json>] [--file <path>]
n8nac credential delete <id>
```

### Credential requirement checking

```bash
n8nac workflow credential-required <workflowId> [--json]
```

Returns list of required credentials and whether they exist. Exit 0 = all present, 1 = any missing.

**Relevance to n8n-vet:** Credential checking is a pre-validation step. If a workflow requires credentials that don't exist, execution-backed validation will fail for reasons unrelated to the workflow logic.

---

## 8. Knowledge Base and Skills

### Skills commands

```bash
n8nac skills search <query> [--category <cat>] [--type <type>] [--limit <n>]
n8nac skills list [--nodes|--docs|--guides]
n8nac skills node-info <name> [--json]           # Complete node information
n8nac skills node-schema <name> [--json]         # Quick TypeScript snippet
n8nac skills docs [title] [--list|--category <cat>]
n8nac skills guides [query] [--list]
n8nac skills related <query>
n8nac skills examples search <query>             # Community workflows
n8nac skills examples download <id>
```

### Schema provider

The skills package includes a bundled `n8n-nodes-technical.json` that provides:
- Complete node type catalog
- Property introspection with types, defaults, constraints
- Parameter gating detection (conditional field visibility)
- Credential type specifications

Custom node definitions can be added via `n8nac-custom-nodes.json`.

### Relevance to n8n-vet

Node schemas are essential for:
- Understanding what parameters each node expects
- Inferring output shapes (partially — schemas describe structure but not runtime data)
- Generating minimal valid pin data
- Validating that node configurations are correct

---

## 9. File Watching and Change Detection

### Watcher implementation

Uses chokidar v5.0.0 for cross-platform file watching.

**Watched patterns:**
- `.json` — Standard n8n workflow format
- `.workflow.ts` — TypeScript workflow format

**ID extraction from TypeScript:**
```javascript
/@workflow\s*\(\s*{\s*id:\s*["']([^"']+)["']/
```

### Hash-based change detection

1. Compute hash of local file content (stable JSON stringify)
2. Compare to cached remote hash
3. If different, mark workflow for sync

**Detected changes:**
- Property modifications (name, tags, active state)
- Node additions/removals
- Connection changes
- Credential updates
- Expression changes

**Ignored changes:**
- Position/layout-only updates
- Whitespace/formatting (TypeScript)
- Metadata fields (projectId, timestamps)

### Relevance to n8n-vet

Change detection provides the foundation for:
- Knowing which workflows have been modified since last validation
- Identifying the scope of changes (which nodes, connections, or expressions were altered)
- Driving the "bounded batching" principle — validate what changed, not everything

**Gap:** Current change detection is workflow-level, not node-level. For n8n-vet's slice-based validation, finer-grained change tracking (which specific nodes/connections changed) would be needed.

---

## 10. Configuration

### n8nac-config.json

```json
{
    "version": 2,
    "activeInstanceId": "uuid",
    "instances": [
        {
            "id": "prod-instance",
            "name": "Production",
            "host": "https://n8n.company.com",
            "syncFolder": "./workflows",
            "projectId": "proj_123",
            "projectName": "Default",
            "workflowDir": "./workflows/company-prod/default",
            "customNodesPath": "./n8nac-custom-nodes.json",
            "folderSync": false,
            "verification": {
                "status": "verified",
                "normalizedHost": "...",
                "userId": "...",
                "userName": "...",
                "lastCheckedAt": "..."
            }
        }
    ]
}
```

### Environment variables

| Variable | Purpose |
|---|---|
| `N8N_API_KEY` | API key for n8n instance |
| `N8N_HOST` | n8n instance URL |
| `N8N_AS_CODE_ASSETS_DIR` | Override skills assets location |
| `N8N_AS_CODE_PROJECT_DIR` | Override project directory for MCP |
| `N8NAC_INSTANCE_NAME` | Select instance at runtime |

### Resolution hierarchy

1. CLI flags (highest)
2. Environment variables
3. n8nac-config.json (active instance)
4. Global credential store (~/.config/n8nac/credentials.json)
5. Defaults (lowest)

### Multi-instance support

n8nac supports multiple n8n instances with per-instance project selection, verification checks, and duplicate detection. Useful for dev/staging/production workflows.

---

## 11. Capability Summary for n8n-vet

### What n8nac provides that n8n-vet can build on

| Capability | Command/Feature | Relevance |
|---|---|---|
| Offline schema validation | `skills validate`, MCP `validate_n8n_workflow` | Static correctness checking |
| HTTP trigger testing | `test` | Execution-backed validation with error classification |
| Testability analysis | `test-plan` | Know what can be tested and how |
| Execution data retrieval | `execution get --include-data` | Post-execution inspection |
| Node schema access | `skills node-info`, n8n-nodes-technical.json | Output shape inference, parameter validation |
| Workflow-level change detection | File watcher, hash comparison | Know what changed |
| Workflow format conversion | `convert`, transformer package | Parse workflows programmatically |
| TypeScript workflow parsing | ts-morph, decorator extraction | Static analysis of workflow structure |
| Credential availability check | `workflow credential-required` | Pre-validation gating |
| Sync with conflict detection | push/pull/resolve | Controlled deployment for testing |

### What n8nac does NOT provide (gaps for n8n-vet)

| Gap | Description |
|---|---|
| Pin data support in CLI | `test` only does HTTP trigger execution; no pin data mocking via CLI |
| Assertion layer | No mechanism to assert on specific node outputs |
| Execution data filtering | No `--errors-only`, `--summary`, or per-node filtering |
| Data flow analysis | No tracing of expression references through the graph |
| Node-level change detection | Change detection is workflow-level, not node-level |
| Slice-based execution | No way to execute only a portion of the workflow via CLI |
| Diagnostic summarization | Raw execution data is unprocessed |
| Force push | No `--force` flag to bypass OCC conflicts |
| Pin data in TypeScript DSL | Planned but not implemented |
| Binary data in fixtures | Not supported by underlying n8n pin data system |

### Integration points for n8n-vet

n8n-vet should likely integrate with n8nac rather than replace it:

1. **Use n8nac's transformer** for parsing workflow TypeScript into an AST for static analysis
2. **Use n8nac's node schemas** for understanding expected node parameters and output shapes
3. **Use n8nac's push/pull** for controlled deployment before execution-backed validation
4. **Use n8nac's credential check** as a pre-validation gate
5. **Use n8nac's change detection** as input to "what needs revalidation" logic
6. **Complement n8nac's `test`** with pin data-backed execution via n8n's MCP `test_workflow`
7. **Add the missing layers** — data flow analysis, assertion, diagnostics, trusted boundaries — on top
