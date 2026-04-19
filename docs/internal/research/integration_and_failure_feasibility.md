# Integration and Failure Feasibility Research

Research into dependency robustness, API/MCP stability, authentication models, error taxonomy, and timeout/scale behavior for n8n-vet.

---

## 6.1 n8nac Dependency Robustness

### Package Landscape

The n8n-as-code monorepo contains five packages under `packages/`:

| Package | npm Name | Version | Intended Use |
|---------|----------|---------|--------------|
| `transformer` | `@n8n-as-code/transformer` | 1.1.0 | Programmatic import (library) |
| `skills` | `@n8n-as-code/skills` | 1.8.2 | Programmatic import (library) |
| `cli` | `n8nac` | 1.6.2 | CLI + programmatic import via `lib.ts` |
| `mcp` | `@n8n-as-code/mcp` | 1.3.0 | MCP server (wraps CLI via child_process spawn) |
| `vscode-extension` | (not published separately) | — | VS Code extension, not relevant |

### Packages Safe for Programmatic Import

**@n8n-as-code/transformer (HIGH confidence)**

Exports from `dist/index.js`:
- `workflow`, `node`, `links` — decorators for TypeScript workflow files
- `JsonToAstParser`, `AstToTypeScriptGenerator` — JSON-to-AST-to-TS pipeline
- `TypeScriptParser`, `WorkflowBuilder` — TS-to-AST-to-JSON pipeline
- Type exports: `WorkflowAST`, `NodeAST`, `ConnectionAST`, `N8nWorkflow`, `N8nNode`, `ValidationResult`, `ValidationError`, `ValidationWarning`
- Utility exports: `generatePropertyName`, `generateClassName`, `createPropertyNameContext`

Dependencies are minimal and stable: `ts-morph`, `prettier`, `uuid`, `reflect-metadata`. No peer dependencies. No n8n runtime dependencies.

**Assessment:** Clean library surface. Safe to depend on. The bidirectional transform pipeline (JSON to TS and back) is the core value for n8n-vet static analysis.

**@n8n-as-code/skills (HIGH confidence)**

Exports from `dist/index.js`:
- `NodeSchemaProvider` — node type schema lookup, search, validation data
- `WorkflowValidator` — static validation of workflow JSON/TypeScript against node schemas
- `AiContextGenerator` — AI context generation (less relevant)
- `DocsProvider` — n8n docs search
- `KnowledgeSearch` — unified search across nodes/docs/workflows
- `TypeScriptFormatter` — TS formatting
- Type exports: `ValidationResult`, `ValidationError`, `ValidationWarning`

Dependencies include `@n8n-as-code/transformer`, `@modelcontextprotocol/sdk`, `zod`, `flexsearch`, `chalk`, `commander`. No peer dependencies.

**Assessment:** The two critical exports for n8n-vet are `WorkflowValidator` and `NodeSchemaProvider`. Both are well-structured classes with clean interfaces. `WorkflowValidator` already implements:
- Structure validation (nodes array, connections object)
- Node type existence checks (via schema index)
- TypeVersion validation against known versions
- Required parameter checking with displayOptions awareness
- Option value validation (catches "Could not find property option" errors)
- Resource/operation cross-validation
- Connection integrity checks
- Community node detection (warns instead of errors)
- Expression skipping (values containing `{{` are not statically validated)

This is directly usable as a validation primitive. n8n-vet does not need to reimplement this.

**n8nac CLI library surface (MODERATE confidence)**

The CLI package exports a `lib.ts` that re-exports:
- `ConfigService` — instance config management (host, API key, project, sync folder)
- All types from `ILocalConfig`, `IInstanceProfile`, `IWorkspaceConfig`, etc.
- Core services: `N8nApiClient`, `SyncManager`, `SyncEngine`, `WorkflowSanitizer`, etc.

**Assessment:** The `ConfigService` is the key export for config reuse. The `N8nApiClient` wraps the n8n REST API and is usable but CLI-oriented (console output, spinner integration). For n8n-vet, importing `ConfigService` to discover host/apiKey/project is safe. Using `N8nApiClient` directly is possible but carries more coupling risk.

**@n8n-as-code/mcp (LOW confidence for import)**

The MCP package wraps all operations via `child_process.spawn` to the CLI entry point. Its `N8nAsCodeMcpService` class shells out for every operation (validate, push, pull, test, etc.).

**Assessment:** Not suitable for programmatic import by n8n-vet. The spawn-based architecture means every call has process overhead and stdout parsing. Use the underlying libraries directly instead.

### Internal APIs to Avoid

- `NodeSchemaProvider.loadIndex()` / `injectSyntheticToolNodes()` — private, asset-path dependent
- `WorkflowValidator.validateNodeParameters()` / `validateConnections()` — private, but the public `validateWorkflow()` is sufficient
- All CLI command classes (`SyncCommand`, `TestCommand`, etc.) — CLI-oriented, not library APIs
- `N8nAsCodeMcpService.runCliCommand()` — spawns child processes, not for library use

### Dependency Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Transformer API breaks | Low | Version pinning; API is stable (1.1.0), types are well-defined |
| Skills schema index format changes | Medium | The `n8n-nodes-technical.json` asset is rebuilt from n8n source; format could change on n8n version bumps |
| Skills prebuild step required | Medium | Skills package has a complex prebuild chain (8 scripts). n8n-vet must use published dist, not build from source |
| ConfigService format migration | Low | Config format is at version 2, with legacy migration built in |
| Zod version mismatch | Low | Both skills and CLI use zod ^3.22; align with same range |

### Recommendation

Depend on `@n8n-as-code/transformer` and `@n8n-as-code/skills` as direct npm dependencies. Import `ConfigService` from `n8nac` for config discovery. Do not import or wrap the MCP package.

---

## 6.2 n8n API and MCP Stability

### n8n REST API

The n8n public API is versioned at `/api/v1/`. The n8nac API client exclusively uses v1 endpoints:

| Endpoint | Purpose | Used by n8nac |
|----------|---------|---------------|
| `GET /api/v1/workflows` | List workflows (paginated) | Yes |
| `GET /api/v1/workflows/:id` | Get single workflow | Yes |
| `PUT /api/v1/workflows/:id` | Update workflow | Yes |
| `POST /api/v1/workflows` | Create workflow | Yes |
| `POST /api/v1/workflows/:id/activate` | Activate | Yes |
| `POST /api/v1/workflows/:id/deactivate` | Deactivate | Yes |
| `GET /api/v1/executions` | List executions | Yes |
| `GET /api/v1/executions/:id` | Get execution details | Yes |
| `GET /api/v1/credentials` | List credentials | Yes |
| `GET /api/v1/credentials/schema/:type` | Credential schema | Yes |
| `POST /api/v1/credentials` | Create credential | Yes |
| `GET /api/v1/tags` | List tags | Yes |
| `POST /api/v1/tags` | Create tag | Yes |
| `GET /api/v1/users/me` | Current user | Yes |
| `GET /api/v1/projects` | List projects | Yes |

**Stability assessment:** The v1 API has been stable across n8n releases. No v2 API exists yet. The `DeprecationService` in n8n tracks env var deprecations, not API deprecations — the API surface itself has no deprecation markers in the codebase. The breaking-changes module (`modules/breaking-changes/rules/v2/`) tracks node removal and config changes, not REST API changes.

**Risk:** The API is stable but has no formal stability guarantee or SLA. It is a first-party product API, not a community contract.

### n8n MCP Tools

The n8n MCP server (built into n8n CLI) exposes these tools in `packages/cli/src/modules/mcp/tools/`:

| Tool | Input Schema | Output | Notes |
|------|-------------|--------|-------|
| `execute_workflow` | workflowId, executionMode, inputs (chat/form/webhook) | executionId, status | Async — returns immediately, does not wait |
| `test_workflow` | workflowId, pinData, triggerNodeName | executionId, status, error | Sync — waits for completion with 5-minute timeout |
| `get_workflow_details` | workflowId | Full workflow structure + trigger info | Read-only |
| `get_execution` | executionId | Execution status and data | Read-only |
| `search_workflows` | query, limit, projectId | Workflow list | Read-only |
| `search_folders` | query, limit, projectId | Folder list | Read-only |
| `search_projects` | query, limit | Project list | Read-only |
| `publish_workflow` | workflowId | Success/message | Activates workflow |
| `unpublish_workflow` | workflowId | Success/message | Deactivates workflow |
| `prepare_workflow_pin_data` | (workflow builder tools) | Pin data for testing | Complex tool |

**Key constraints discovered:**

1. **MCP availability gating:** Workflows must have `settings.availableInMCP === true` to be accessible via MCP tools. This is checked in `getMcpWorkflow()` via `workflow-validation.utils.ts`. This is a per-workflow opt-in.

2. **Trigger type restrictions:** `execute_workflow` only supports specific trigger types (manual, webhook, chat, form, schedule). Workflows with other triggers cannot be executed via MCP.

3. **Pin data normalization:** `test_workflow` requires pre-built pin data with `{json: {...}}` wrappers. The `normalizePinData` function from `@n8n/workflow-sdk` handles this, but malformed pin data produces `WorkflowAccessError` with reason `invalid_pin_data`.

4. **Execution mode matters:** `execute_workflow` distinguishes `manual` (current version, uses workflow pinData) from `production` (active/published version, no pinData from workflow). This affects which graph is executed.

**MCP stability assessment:** The n8n MCP surface is new (introduced alongside AI features). Tool names, schemas, and behaviors should be considered less stable than the REST API. The structured output schemas (Zod-based) are well-defined but may evolve.

### Fallback Strategy

| Primary Surface | Fallback | Trigger for Fallback |
|----------------|----------|---------------------|
| n8n MCP `test_workflow` | n8nac `test` command (HTTP webhook trigger) | MCP unavailable, workflow not MCP-enabled |
| n8n MCP `get_workflow_details` | n8n REST `GET /api/v1/workflows/:id` | MCP unavailable |
| n8n MCP `execute_workflow` | n8n REST `POST /api/v1/workflows/:id/activate` + webhook trigger | MCP unavailable |
| n8n MCP `get_execution` | n8n REST `GET /api/v1/executions/:id` | MCP unavailable |
| Static validation (local) | No fallback needed | Always available |

**Recommendation:** Design the execution backend with a strategy interface. Static analysis (transformer + skills packages) requires no runtime surface and should be the default. Execution-based validation should prefer REST API for reliability, with MCP as an enhancement when available.

---

## 6.3 Authentication and Environment Model

### Credential/Configuration Requirements by Operation

| Operation | Host URL | API Key | Project ID | Sync Folder | n8n MCP Enabled |
|-----------|----------|---------|------------|-------------|-----------------|
| Local static analysis | No | No | No | No | No |
| Workflow push/pull | Yes | Yes | Yes | Yes | No |
| REST API execution | Yes | Yes | No | No | No |
| REST API execution get | Yes | Yes | No | No | No |
| n8n MCP tool calls | Yes | Yes (or OAuth) | No | No | Yes (per-workflow) |
| n8nac `test` command | Yes | Yes | Yes | Yes | No |

### n8nac Config Resolution

The `ConfigService` resolves configuration from `n8nac-config.json` in the working directory. The workspace config format (version 2) supports multiple instance profiles:

```
n8nac-config.json
{
  version: 2,
  activeInstanceId: "instance-abc12345",
  instances: [
    {
      id: "instance-abc12345",
      name: "localhost:5678 - User Name",
      host: "http://localhost:5678",
      syncFolder: "workflows",
      projectId: "proj-xyz",
      projectName: "My Project",
      instanceIdentifier: "local_5678_user",
      workflowDir: "workflows/local_5678_user/my-project",
      verification: { status: "verified", ... }
    }
  ]
}
```

API keys are stored separately in a global `conf` store (`~/.config/n8nac/credentials.json`), keyed by both host URL and instance ID. The `ConfigService.getApiKey(host, instanceId)` method resolves keys with instance-scoped keys taking priority.

### What n8n-vet Can Reuse

1. **Host + API key:** Import `ConfigService` from `n8nac`, call `getActiveInstance()` to get host, then `getApiKeyForActiveInstance()` for the API key. This requires the working directory to contain `n8nac-config.json`.

2. **Project context:** The active instance profile includes `projectId`, `projectName`, `workflowDir`, and `syncFolder`. These locate the local workflow files.

3. **Instance identifier:** Used to construct the local file path. Available from `instance.instanceIdentifier`.

4. **Custom nodes path:** `instance.customNodesPath` points to `n8nac-custom-nodes.json` if the user has custom node schemas.

### Hidden Failure Modes

| Failure Mode | Cause | Detection | Impact |
|-------------|-------|-----------|--------|
| Missing n8nac-config.json | n8nac never initialized in this directory | `ConfigService.hasConfig()` returns false | Cannot discover host/API key |
| Stale API key | Key rotated in n8n, not updated locally | REST calls return 401 | All remote operations fail |
| Wrong active instance | User switched instances without awareness | Config points to wrong host | Operations target wrong n8n |
| Missing project selection | `projectId` not set | `getActiveInstance().projectId` is undefined | Cannot scope workflow operations |
| Verification expired | n8n user deleted or permissions changed | `verification.status === 'failed'` | API calls may fail with 403 |
| Global credentials file permissions | Credentials stored at 0o600, but multi-user systems | File read fails | No API key resolution |
| n8nac-config.json locked/corrupted | Concurrent writes, crash during save | JSON parse error | Config service throws |
| Workspace directory mismatch | n8n-vet invoked from different cwd than n8nac | No config file found | Silent failure — falls back to empty config |

### Config Discovery Recommendation

1. Accept explicit config path as constructor option (override everything)
2. Fall back to n8nac config discovery via `ConfigService(cwd)`
3. Fall back to environment variables (`N8N_HOST`, `N8N_API_KEY`) as last resort
4. For static-only analysis, require zero configuration — only workflow file path needed
5. Clearly separate "can do static analysis" from "can reach n8n instance" in capability reporting

---

## 7.1 Tool-Failure Handling

### Error Taxonomy

n8n's error hierarchy (from `packages/workflow/src/errors/`):

```
BaseError
  ├── UserError (user-caused, expected)
  │     ├── McpExecutionTimeoutError
  │     └── WorkflowAccessError
  ├── UnexpectedError (system/infra)
  ├── OperationalError (runtime ops)
  └── ExecutionBaseError
        ├── ExpressionError
        │     ├── ExpressionExtensionError
        │     ├── ExpressionDestructuringError
        │     ├── ExpressionReservedVariableError
        │     └── ExpressionWithStatementError
        ├── NodeError
        │     ├── NodeOperationError
        │     │     └── WorkflowConfigurationError
        │     └── NodeApiError (HTTP status, external service failures)
        ├── WorkflowOperationError
        │     └── SubworkflowOperationError
        ├── WorkflowActivationError
        │     ├── WebhookPathTakenError
        │     └── WorkflowDeactivationError
        ├── NodeSslError
        └── ExecutionCancelledError
              ├── ManualExecutionCancelledError
              ├── TimeoutExecutionCancelledError
              └── SystemShutdownExecutionCancelledError
```

### Classification for n8n-vet

n8n-vet needs to distinguish three categories:

**Category 1: Workflow Logic Errors (fixable by editing workflow code)**
- `ExpressionError` and all subtypes — bad expressions in node parameters
- `NodeOperationError` — wrong parameter values, missing fields
- `WorkflowConfigurationError` — structural wiring problems
- Connection errors detected by `WorkflowValidator`

**Category 2: Infrastructure/Environment Errors (not fixable by editing workflow)**
- `NodeApiError` — external service down, rate limited, auth expired
- `NodeSslError` — certificate problems
- `DbConnectionTimeoutError` — n8n database issues
- `ExecutionCancelledError` subtypes — n8n shutting down, manual cancel
- `McpExecutionTimeoutError` — execution exceeded 5-minute MCP timeout
- `UnexpectedError` — n8n internal bugs
- HTTP 401/403 from REST API — API key problems
- HTTP 5xx from REST API — n8n server issues

**Category 3: Access/Configuration Errors (requires user action, not code changes)**
- `WorkflowAccessError` with reason `no_permission` — user lacks access
- `WorkflowAccessError` with reason `not_available_in_mcp` — MCP not enabled
- `WorkflowAccessError` with reason `workflow_archived` — archived workflow
- `WorkflowAccessError` with reason `unsupported_trigger` — trigger type not supported
- Missing credentials (n8nac `config-gap` class)

### n8nac Error Classification (Already Implemented)

The n8nac `test` command already classifies test results using `TestErrorClass`:

| Class | Meaning | n8n-vet Action |
|-------|---------|-----------------|
| `null` | Not HTTP-testable (schedule trigger, unknown) | Report as untestable, not an error |
| `'config-gap'` | Missing credentials, LLM model, env vars | Report as environment issue, exit 0 |
| `'runtime-state'` | Test webhook not armed, production not published | Report as state issue, exit 0 |
| `'wiring-error'` | Bad expression, wrong field, HTTP failure | Report as fixable error, exit 1 |

**This classification is directly reusable.** n8n-vet should import `ITestResult` and `TestErrorClass` from `n8nac` core types and extend the taxonomy for its own static analysis results.

### Structured Error Output for n8n-vet

```typescript
type ErrorCategory = 
  | 'workflow-logic'      // Fixable by editing workflow code
  | 'environment'         // Missing credentials, config, external service
  | 'infrastructure'      // n8n server, network, timeout
  | 'access'              // Permissions, MCP availability
  | 'untestable';         // Trigger type, schedule, etc.

interface DiagnosticError {
  category: ErrorCategory;
  source: 'static' | 'execution' | 'api';
  nodeName?: string;
  nodeType?: string;
  message: string;
  fixable: boolean;
  details?: Record<string, unknown>;
}
```

### Can Failures Be Reliably Classified?

| Signal | Reliability | Notes |
|--------|-------------|-------|
| Static validation errors from `WorkflowValidator` | High | Always category `workflow-logic` |
| `NodeApiError` with HTTP status codes | High | 4xx from external = likely config; 5xx = infra |
| `ExpressionError` from execution | High | Always `workflow-logic` |
| `NodeOperationError` from execution | Medium | Could be logic or environment depending on node |
| n8nac `TestErrorClass` | High | Already well-classified |
| Generic execution `status: 'error'` | Low | Need to inspect `resultData.error` for classification |
| MCP tool error responses | Medium | `WorkflowAccessError.reason` is reliable; other errors less so |

**Recommendation:** Layer classification. Static errors are always classifiable. Execution errors should be classified by matching error type/name first, then HTTP status code, then message pattern matching as a fallback. Never expose raw error messages as diagnostics — always wrap in structured categories.

---

## 7.2 Timeout and Scale Behavior

### Known Timeout Values

| Surface | Timeout | Source | Configurable |
|---------|---------|--------|--------------|
| n8n MCP `test_workflow` | 5 minutes (300,000 ms) | `WORKFLOW_EXECUTION_TIMEOUT_MS` in `execution-utils.ts` | No (hardcoded) |
| n8n MCP `execute_workflow` | None (async) | Returns immediately | N/A |
| n8nac webhook test call | 30 seconds | `timeout: 30_000` in `n8n-api-client.ts` | No (hardcoded) |
| n8n REST API (axios default) | No explicit timeout | axios defaults (none) | Could set via interceptor |
| n8n workflow execution (server) | Configurable per instance | n8n `EXECUTIONS_TIMEOUT` env var | Yes |
| n8n queue mode stalled jobs | Configurable | `queue.bull.redis.timeoutThreshold` | Yes |

### Performance Cliffs

**Static Analysis (local, no n8n required)**

| Factor | Impact | Threshold |
|--------|--------|-----------|
| Workflow node count | Linear | `WorkflowValidator` iterates all nodes; 500+ nodes may take >1s for schema lookup |
| `ts-morph` parsing | Moderate | TypeScript parsing of large workflow files; `TypeScriptParser.parseCode()` uses in-memory AST |
| Schema index size | One-time | `n8n-nodes-technical.json` is ~20-40MB; loaded once, cached in memory |
| Connection validation | O(nodes * connections) | Nested loops, but connections are typically sparse |

**Assessment:** Static analysis should be fast for typical workflows (10-100 nodes, <1s). For very large workflows (500+ nodes), schema loading dominates. The `NodeSchemaProvider` loads the entire index into memory on first access — this is a one-time cost per process.

**REST API Operations**

| Operation | Typical Latency | Risk |
|-----------|----------------|------|
| `GET /api/v1/workflows/:id` | <500ms | Grows with node count (full workflow JSON) |
| `GET /api/v1/executions/:id` (no data) | <200ms | Fast |
| `GET /api/v1/executions/:id` (with data) | 500ms-30s | Execution data can be enormous for large workflows |
| `GET /api/v1/workflows` (paginated) | <1s per page | n8nac paginates automatically |
| `PUT /api/v1/workflows/:id` | <1s | Workflow size matters |

**Assessment:** The main performance cliff is execution data retrieval. Large workflows produce large `IRunData` structures (one entry per node, per execution item). Retrieving full execution data for a 100-node workflow with multiple items per node can produce multi-MB JSON responses.

**MCP Execution**

| Factor | Impact |
|--------|--------|
| 5-minute hard timeout | Workflows that call slow external APIs will timeout |
| Queue mode limitation | Cannot cancel timed-out executions on remote workers |
| Pin data size | Large pin data objects increase MCP message size |
| Concurrent executions | n8n has configurable concurrency limits |

**Assessment:** The 5-minute MCP timeout is the primary constraint for execution-based validation. n8n-vet should:
1. Prefer static analysis (no timeout concern)
2. For execution, prefer small slices (fewer nodes = faster)
3. Set explicit timeouts on all REST calls (n8nac does not set them by default)
4. Never wait indefinitely for execution results

### Data Size Considerations

| Data | Typical Size | Large Case | Impact on n8n-vet |
|------|-------------|------------|---------------------|
| Workflow JSON (100 nodes) | 50-200 KB | 1-5 MB (500+ nodes) | Manageable for static analysis |
| Execution data (full, 50 nodes) | 500 KB - 5 MB | 50+ MB (many items) | Must selective-load, not bulk-fetch |
| Node schema index | 20-40 MB | Stable | One-time memory cost |
| Pin data for testing | 1-50 KB | 500 KB+ (many nodes) | Grows with slice size |
| Diagnostic output | 1-10 KB | 50 KB (many errors) | Always manageable |

### Recommendation: Timeout Strategy

```
Static analysis:     No timeout needed (local, fast)
Config discovery:    5s timeout (reading local files)
REST API calls:      15s per request (add axios timeout)
Execution polling:   3 minutes max (shorter than n8n MCP's 5min)
Overall validation:  5 minutes max (inclusive of all steps)
```

Set timeouts explicitly on every external call. Never inherit defaults. The n8nac API client does not set request-level timeouts (except for the 30s webhook test), which is a gap n8n-vet should not replicate.

---

## Summary of Key Findings

### Safe to Depend On
- `@n8n-as-code/transformer` — stable, clean library API, no runtime deps
- `@n8n-as-code/skills` (`WorkflowValidator`, `NodeSchemaProvider`) — well-structured validation primitives
- `n8nac` `ConfigService` — config discovery and API key resolution
- n8n REST API v1 — stable, well-exercised by n8nac
- n8nac `TestErrorClass` taxonomy — directly reusable error classification

### Use with Caution
- n8n MCP tools — newer surface, may evolve, requires per-workflow opt-in
- `N8nApiClient` from n8nac — usable but CLI-oriented, no timeout defaults
- Execution data retrieval — can be very large, needs selective access

### Avoid
- `@n8n-as-code/mcp` for programmatic import — child_process spawn architecture
- n8nac CLI command classes — not designed as library APIs
- Internal/private methods on skills and transformer classes
- Hardcoding to n8n MCP as the sole execution backend

### Critical Design Decisions for n8n-vet

1. **Static-first architecture is validated.** The transformer and skills packages provide all primitives needed for local, offline validation with zero n8n connectivity.

2. **Execution validation needs a strategy interface.** Multiple backends (REST API, MCP tools, n8nac test command) have different capabilities and availability. Abstraction is required.

3. **Error classification is feasible.** Between n8n's error hierarchy, n8nac's TestErrorClass, and WorkflowValidator's structured output, n8n-vet can reliably distinguish fixable workflow errors from environment/infra problems.

4. **Timeout discipline is non-negotiable.** Every external call must have an explicit timeout. The n8nac codebase demonstrates what happens without them (only one timeout is set across the entire API client).

5. **Config discovery should cascade:** explicit path > n8nac config > environment variables > static-only mode. Never fail hard when remote access is unavailable — degrade to static analysis.
