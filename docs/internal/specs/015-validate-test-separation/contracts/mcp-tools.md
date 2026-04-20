# MCP Tool Contracts: Validate / Test Separation

**Date**: 2026-04-19

## validate Tool

**Purpose**: Structural analysis of a local workflow file. Pure, read-only, no side effects.

### Input Schema

```
{
  kind: 'changed' | 'nodes' | 'workflow'   (required)
  workflowPath: string                      (required)
  nodes: string[]                           (required when kind='nodes')
  force: boolean                            (optional, default false)
}
```

**Strict mode**: Unknown properties produce an error. Passing `layer` or `pinData` returns: `"Unrecognized key(s) in object: 'layer'"` (or `'pinData'`).

### Output

```
{
  success: true,
  data: DiagnosticSummary { evidenceBasis: 'static', ... }
}
```

Or error envelope:

```
{
  success: false,
  error: { type: 'workflow_not_found' | 'parse_error' | ..., message: string }
}
```

### Guardrails

- Force bypass (Step 1)
- Empty target refuse (Step 2)
- Broad-change narrowing (Step 4)
- DeFlaker warn (Step 5)
- Broad-target warning (Step 6)
- Identical-rerun refusal (Step 7)
- Proceed (Step 8)

**Not applied**: Test-refusal (Step 3) -- only applies to `test` tool.

---

## test Tool

**Purpose**: Execution-backed smoke test of a deployed workflow. Has side effects. Requires n8n.

### Input Schema

```
{
  kind: 'changed' | 'nodes' | 'workflow'            (required)
  workflowPath: string                               (required, must contain metadata.id)
  nodes: string[]                                    (required when kind='nodes')
  force: boolean                                     (optional, default false)
  pinData: Record<string, { json: object }[]>        (optional)
}
```

### Precondition Errors

| Condition | Error |
|-----------|-------|
| Missing `metadata.id` | `{ type: 'precondition_error', message: 'Workflow has no metadata.id -- push with n8nac first.' }` |
| No MCP connection | `{ type: 'configuration_error', message: 'n8n MCP connection not available -- configure n8n_host and n8n_mcp_token.' }` |

### Output

```
{
  success: true,
  data: DiagnosticSummary { evidenceBasis: 'execution', ... }
}
```

### Guardrails

- Force bypass (Step 1)
- Empty target refuse (Step 2)
- **Test-refusal** (Step 3) -- refuses when no escalation triggers fire: `"All changes are structurally analyzable -- use validate instead."`
- Broad-change narrowing (Step 4)
- DeFlaker warn (Step 5)
- Broad-target warning (Step 6)
- Identical-rerun refusal (Step 7, uses execution trust)
- Proceed (Step 8)

---

## explain Tool

**Purpose**: Dry-run guardrail evaluation. Shows what `validate` or `test` would decide without running.

### Input Schema

```
{
  workflowPath: string                          (required)
  tool: 'validate' | 'test'                     (optional, default 'validate')
  kind: 'changed' | 'nodes' | 'workflow'        (optional, default 'changed')
  nodes: string[]                               (optional)
}
```

**Strict mode**: Passing `layer` produces an error.

### Output

Guardrail explanation with the decision that would be made for the specified tool. When `tool: 'test'`, the output includes precondition status (MCP availability, `metadata.id` presence) so the agent can assess readiness before calling `test`.

---

## trust_status Tool

**Unchanged**. Input: `workflowPath`. Output: trust state report with `validatedWith` field (renamed from `validationLayer`).

---

## CLI Commands

| Command | Params | Notes |
|---------|--------|-------|
| `n8n-vet validate <path>` | `--target`, `--nodes`, `--force`, `--json` | No `--layer` |
| `n8n-vet test <path>` | `--target`, `--nodes`, `--force`, `--pin-data`, `--json` | New command |
| `n8n-vet explain <path>` | `--target`, `--nodes`, `--tool`, `--json` | `--tool` replaces `--layer` |
| `n8n-vet trust <path>` | `--json` | Unchanged |
