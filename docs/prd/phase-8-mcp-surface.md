# Phase 8 — MCP Surface + CLI

## Goal

Implement the MCP server and CLI entry points that expose n8n-vet to agents and developers. The MCP server registers three tools (`validate`, `trust_status`, `explain`) with JSON schema input validation and a uniform response envelope. The CLI provides mirrored commands with human-readable formatting by default and `--json` for machine output identical to MCP. Both layers are thin: they parse input, delegate to the library core, and format output. No validation logic, orchestration, or diagnostic construction lives here.

## Context Files

| File | Role |
|------|------|
| `docs/reference/INDEX.md` | Shared types: `DiagnosticSummary`, `GuardrailDecision`, `TrustState`, `NodeTrustRecord`, `ValidationLayer`, `AgentTarget`, `AvailableCapabilities` |
| `docs/reference/mcp-surface.md` | Full reference spec with JSON schemas for all three tools |
| `docs/CODING.md` | TypeScript rules — fail-fast, contract-driven, no fallbacks, no phantom implementations |
| `docs/CONCEPTS.md` | Shared vocabulary — diagnostic summary, guardrail, validation target, trusted boundary |
| `docs/PRD.md` | Product requirements — agent is the user, structured output, compact diagnostics |
| `docs/SCOPE.md` | What the tool claims and explicitly does not |

## Scope

**In scope:**
- MCP server that registers three tools: `validate`, `trust_status`, `explain`
- JSON schema input validation for each tool
- Response envelope: `{ success: true, data }` or `{ success: false, error: McpError }`
- CLI commands: `n8n-vet validate <path>`, `n8n-vet trust <path>`, `n8n-vet explain <path>`
- CLI options: `--target`, `--nodes`, `--layer`, `--force`, `--destination`, `--json`
- Default application of omitted fields (target defaults to `{ kind: 'changed' }`, layer defaults to `'static'`, force defaults to `false`)
- Human-readable formatted output in CLI (with color)
- `--json` flag producing output identical to MCP response envelope
- McpError typing with four error types

**Out of scope:**
- Request interpretation and orchestration logic (Phase 7)
- Diagnostic summary construction (Phase 6)
- Guardrail evaluation logic (Phase 4)
- Trust state management (Phase 3)
- Streaming responses
- Batch validation (multiple targets per call)
- Additional MCP tools beyond the three defined for v1

## Inputs and Outputs

### MCP `validate`

**Input (JSON schema):**

```json
{
  "type": "object",
  "properties": {
    "workflowPath": { "type": "string", "description": "Path to workflow file (.ts or .json)" },
    "target": {
      "type": "object",
      "properties": {
        "kind": { "type": "string", "enum": ["nodes", "changed", "workflow"] },
        "nodes": { "type": "array", "items": { "type": "string" } }
      }
    },
    "layer": { "type": "string", "enum": ["static", "execution", "both"], "default": "static" },
    "force": { "type": "boolean", "default": false },
    "pinData": { "type": "object", "additionalProperties": { "type": "array", "items": { "type": "object", "properties": { "json": { "type": "object" } }, "required": ["json"] } } },
    "destinationNode": { "type": "string" },
    "destinationMode": { "type": "string", "enum": ["inclusive", "exclusive"], "default": "inclusive" }
  },
  "required": ["workflowPath"]
}
```

**Defaults when omitted:**
- `target`: `{ kind: 'changed' }`
- `layer`: `'static'`
- `force`: `false`
- `pinData`: `null` (system constructs automatically)
- `destinationNode`: `null` (system computes)
- `destinationMode`: `'inclusive'`

**Output:** `McpResponse<DiagnosticSummary>`

### MCP `trust_status`

**Input:** `{ workflowPath: string }`

**Output:** `McpResponse<TrustStatusReport>`

```typescript
interface TrustStatusReport {
  workflowId: string;
  totalNodes: number;
  trustedNodes: Array<{
    name: string;
    validatedAt: string;
    validationLayer: string;
    contentUnchanged: boolean;
  }>;
  untrustedNodes: Array<{
    name: string;
    reason: string;
  }>;
  changedSinceLastValidation: string[];
}
```

### MCP `explain`

**Input:** `{ workflowPath: string, target?: Target, layer?: Layer }`

**Output:** `McpResponse<GuardrailExplanation>`

Dry-run guardrail evaluation. Read-only, no validation is performed.

```typescript
interface GuardrailExplanation {
  guardrailDecision: string;
  targetResolution: object;
  capabilities: object;
}
```

### Response Envelope

```typescript
type McpResponse<T> =
  | { success: true; data: T }
  | { success: false; error: McpError };

interface McpError {
  type: 'workflow_not_found' | 'parse_error' | 'configuration_error' | 'internal_error';
  message: string;
}
```

Validation status `'fail'` is `success: true` at the tool level. The workflow failed validation, but the tool operated correctly. Tool-level `success: false` is reserved for n8n-vet internal errors (file not found, parse failure, misconfiguration, unexpected exceptions).

### CLI

**Commands:**
- `n8n-vet validate <path> [options]`
- `n8n-vet trust <path>`
- `n8n-vet explain <path> [options]`

**Options:**
- `--target <kind>` — `nodes`, `changed`, or `workflow`
- `--nodes <name,...>` — comma-separated node names (used with `--target nodes`)
- `--layer <layer>` — `static`, `execution`, or `both`
- `--force` — bypass guardrails
- `--destination <node>` — destination node name
- `--json` — output raw JSON identical to MCP response envelope

**Default output:** Human-readable formatted summary with color. Human formatting is applied exclusively in the CLI layer. The library core works only with structured data.

**`--json` output:** Identical to MCP response envelope. No human formatting applied.

## Upstream Interface Summary

- **Request Interpretation:** `interpret(request: ValidationRequest): Promise<DiagnosticSummary>` — the sole entry point for validation. Both `validate` (MCP) and `validate` (CLI) delegate to this after input parsing.
- **Trust queries:** `getTrustStatus(workflowPath: string): TrustStatusReport` — direct trust inspection. Both `trust_status` (MCP) and `trust` (CLI) delegate to this.
- **Guardrail explain:** `explainGuardrails(request: ValidationRequest): GuardrailExplanation` — dry-run guardrail evaluation. Both `explain` (MCP) and `explain` (CLI) delegate to this.

## Behavior

### 1. Input parsing and default application

Both MCP and CLI layers parse raw input into a typed `ValidationRequest`. Omitted fields receive their documented defaults before delegation:

| Field | Default |
|-------|---------|
| `target` | `{ kind: 'changed' }` |
| `layer` | `'static'` |
| `force` | `false` |
| `pinData` | `null` |
| `destinationNode` | `null` |
| `destinationMode` | `'inclusive'` |

Input validation uses JSON schema (MCP) or argument parsing with typed validation (CLI). Invalid input produces `McpError` with `type: 'parse_error'` (MCP) or a clear error message and non-zero exit code (CLI).

### 2. Input vocabulary resolution

The agent expresses intent through the `target` field. The MCP/CLI layer resolves the vocabulary before delegation:

| Agent says | Resolved target |
|-----------|-----------------|
| No target provided | `{ kind: 'changed' }` |
| `{ kind: 'nodes', nodes: [...] }` | Validate named nodes plus connecting path |
| `{ kind: 'changed' }` | Compute change set, build slice, select path |
| `{ kind: 'workflow' }` | Target everything (guardrails will warn/narrow) |

The MCP/CLI layer does not interpret these targets. It applies defaults and passes the resolved request to the library core.

### 3. Delegation

Each tool/command delegates to exactly one upstream function:

| Tool/Command | Delegates to |
|-------------|-------------|
| `validate` | `interpret(request)` |
| `trust_status` / `trust` | `getTrustStatus(workflowPath)` |
| `explain` | `explainGuardrails(request)` |

The MCP/CLI layer does not catch, transform, or interpret the results from these functions beyond wrapping them in the response envelope (MCP) or formatting them for human display (CLI).

### 4. Response wrapping

**MCP:** Wraps the upstream return value in `{ success: true, data: <result> }`. If the upstream function throws a typed domain error, catches it and wraps in `{ success: false, error: { type, message } }`. Unexpected exceptions become `{ success: false, error: { type: 'internal_error', message } }`.

**CLI default:** Formats the upstream return value as a human-readable summary with color. Validation failures are displayed with clear error sections. Tool-level failures print the error message to stderr and exit with a non-zero code.

**CLI `--json`:** Wraps in the same envelope as MCP. No human formatting. Output to stdout.

### 5. Error-to-McpError mapping

Domain errors from the library core are mapped to `McpError` types at the MCP/CLI boundary:

| Domain error | McpError type |
|-------------|---------------|
| Workflow file not found | `workflow_not_found` |
| Workflow parse failure | `parse_error` |
| Missing configuration (packages, credentials) | `configuration_error` |
| Unexpected exception | `internal_error` |

This mapping happens once, at the interface boundary. The library core throws typed domain errors; the MCP/CLI layer translates them into `McpError` for the response envelope.

## Error Conditions

| Condition | Behavior |
|-----------|----------|
| Workflow path does not exist | `{ success: false, error: { type: 'workflow_not_found', message } }` |
| Workflow cannot be parsed | `{ success: false, error: { type: 'parse_error', message } }` |
| Missing required configuration | `{ success: false, error: { type: 'configuration_error', message } }` |
| Unexpected internal failure | `{ success: false, error: { type: 'internal_error', message } }` |
| Invalid input schema (MCP) | `{ success: false, error: { type: 'parse_error', message } }` |
| Invalid arguments (CLI) | Print error to stderr, exit non-zero |
| Validation target fails | `{ success: true, data: <DiagnosticSummary with status 'fail'> }` — tool succeeded, workflow failed |

## Acceptance Criteria

- MCP server registers 3 tools: `validate`, `trust_status`, `explain`
- Input validation per JSON schemas — invalid input produces `McpError` with `type: 'parse_error'`
- Response envelope: `{ success: true, data }` or `{ success: false, error: McpError }`
- Validation status `'fail'` is `success: true` (tool worked, workflow failed validation)
- Default target is `{ kind: 'changed' }` when omitted
- CLI commands mirror MCP tools: `validate`, `trust`, `explain`
- `--json` produces output identical to MCP response envelope
- Human-readable formatting only in CLI layer, not library core
- Tool-level errors use `McpError` type with correct error type discriminants
- MCP tool invocation tests (mock orchestrator, verify envelope structure and error mapping)
- CLI integration tests (verify argument parsing, default application, `--json` output, exit codes)
- End-to-end test with a real workflow file exercising the full path from MCP/CLI input to response envelope

## Decisions

1. **Three tools for v1.** `validate`, `trust_status`, `explain`. Additional tools are deferred to future phases.
2. **No streaming.** Return the final summary as a single response. Streaming adds complexity without proportional value for bounded validation results.
3. **No batch validation.** One target per call. Agents compose multiple calls if needed. Batching adds input complexity and ambiguous error semantics.
4. **CLI is a development/debug surface.** The primary interface is MCP. CLI exists for human inspection and development workflows, not as a production agent interface.
5. **Human formatting is CLI-only.** The library core returns structured data. Human-readable formatting with color is applied exclusively in the CLI output layer. This preserves the principle that the agent is the user and structured output is primary.
6. **McpError is the only error shape at the boundary.** All domain errors are mapped to one of four `McpError` types. Consumers do not need to handle arbitrary error shapes.
