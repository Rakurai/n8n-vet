# CLI Interface Contract

**Feature**: 008-mcp-surface-cli | **Date**: 2026-04-19

## Commands

### `n8n-vet validate <workflow-path> [options]`

Validate a workflow. Mirrors MCP `validate` tool.

**Positional**: `<workflow-path>` (required) — path to workflow file

**Options**:
- `--target <kind>` — `nodes`, `changed`, or `workflow` (default: `changed`)
- `--nodes <name,...>` — comma-separated node names (requires `--target nodes`)
- `--layer <layer>` — `static`, `execution`, or `both` (default: `static`)
- `--force` — bypass guardrails (default: `false`)
- `--destination <node>` — destination node for bounded execution
- `--json` — output raw JSON identical to MCP response envelope

**Default output**: Human-readable formatted summary with color-coded status.

**`--json` output**: `McpResponse<DiagnosticSummary>` — identical to MCP envelope.

**Exit codes**: 0 on success, 1 on tool-level error, 2 on invalid arguments.

---

### `n8n-vet trust <workflow-path> [options]`

Show trust status for a workflow. Mirrors MCP `trust_status` tool.

**Positional**: `<workflow-path>` (required) — path to workflow file

**Options**:
- `--json` — output raw JSON identical to MCP response envelope

**Default output**: Human-readable trust summary (trusted/untrusted nodes, change list).

**`--json` output**: `McpResponse<TrustStatusReport>`.

**Exit codes**: 0 on success, 1 on tool-level error, 2 on invalid arguments.

---

### `n8n-vet explain <workflow-path> [options]`

Preview guardrail behavior. Mirrors MCP `explain` tool.

**Positional**: `<workflow-path>` (required) — path to workflow file

**Options**:
- `--target <kind>` — `nodes`, `changed`, or `workflow` (default: `changed`)
- `--nodes <name,...>` — comma-separated node names (requires `--target nodes`)
- `--layer <layer>` — `static`, `execution`, or `both` (default: `static`)
- `--json` — output raw JSON identical to MCP response envelope

**Default output**: Human-readable guardrail explanation.

**`--json` output**: `McpResponse<GuardrailExplanation>`.

**Exit codes**: 0 on success, 1 on tool-level error, 2 on invalid arguments.

---

## Argument Validation Rules

1. Missing `<workflow-path>` → print usage to stderr, exit 2.
2. Unknown command → print usage to stderr, exit 2.
3. `--nodes` without `--target nodes` → print error to stderr, exit 2.
4. `--target nodes` without `--nodes` → print error to stderr, exit 2.
5. Invalid `--target` value → print error to stderr, exit 2.
6. Invalid `--layer` value → print error to stderr, exit 2.

## Output Routing

- Default mode: formatted output to stdout, errors to stderr.
- `--json` mode: JSON envelope to stdout, nothing to stderr (errors are in the envelope).
- Process exit code reflects tool-level success/failure, not validation outcome.
