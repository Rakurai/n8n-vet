# MCP Tool Contracts

**Feature**: 008-mcp-surface-cli | **Date**: 2026-04-19

## Tool: `validate`

**Description**: Validate an n8n workflow. Accepts a target, resolves scope, applies guardrails, runs static and/or execution-backed validation, returns a diagnostic summary.

**Input Schema** (Zod at registration boundary):

```
workflowPath: string (required) — path to workflow file (.ts or .json)
target?: { kind: 'nodes' | 'changed' | 'workflow', nodes?: string[] } — default: { kind: 'changed' }
layer?: 'static' | 'execution' | 'both' — default: 'static'
force?: boolean — default: false
pinData?: Record<string, Array<{ json: Record<string, unknown> }>> — default: null
destinationNode?: string — default: null
destinationMode?: 'inclusive' | 'exclusive' — default: 'inclusive'
```

**Output**: `McpResponse<DiagnosticSummary>`

**Delegation**: `interpret(request, deps)`

**Error mapping**:
- File not found → `{ success: false, error: { type: 'workflow_not_found', message } }`
- Parse failure → `{ success: false, error: { type: 'parse_error', message } }`
- Config error → `{ success: false, error: { type: 'configuration_error', message } }`
- Unexpected → `{ success: false, error: { type: 'internal_error', message } }`

---

## Tool: `trust_status`

**Description**: Inspect the current trust state for a workflow. Shows which nodes are trusted, when they were validated, and what changed.

**Input Schema**:

```
workflowPath: string (required) — path to workflow file
```

**Output**: `McpResponse<TrustStatusReport>`

**Delegation**: Facade composing `parseWorkflowFile` → `buildGraph` → `loadTrustState` → `loadSnapshot` → `computeChangeSet` → assemble report.

---

## Tool: `explain`

**Description**: Dry-run guardrail evaluation. Shows what guardrails would decide for a potential validation request without performing validation or modifying trust state.

**Input Schema**:

```
workflowPath: string (required) — path to workflow file
target?: { kind: 'nodes' | 'changed' | 'workflow', nodes?: string[] } — default: { kind: 'changed' }
layer?: 'static' | 'execution' | 'both' — default: 'static'
```

**Output**: `McpResponse<GuardrailExplanation>`

**Delegation**: Facade composing `parseWorkflowFile` → `buildGraph` → `loadTrustState` → `loadSnapshot` → `computeChangeSet` → resolve target → `evaluate(input)` → `detectCapabilities` → assemble explanation.

---

## Response Envelope

All tools return responses wrapped in the `McpResponse<T>` envelope, serialized as a JSON text content block in the MCP `CallToolResult`:

```
{ content: [{ type: 'text', text: JSON.stringify(envelope) }] }
```

Where `envelope` is either:
- `{ success: true, data: <T> }`
- `{ success: false, error: { type: <McpErrorType>, message: <string> } }`
