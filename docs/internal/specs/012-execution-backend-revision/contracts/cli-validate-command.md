# CLI Validate Command Contract (Post-Revision)

**Command**: `n8n-vet validate <workflowPath>`

## Options

```
--target <kind>     Target kind: nodes, changed, workflow (default: changed)
--nodes <list>      Comma-separated node names (required when --target=nodes)
--layer <layer>     Validation layer: static, execution, both (default: static)
--force             Skip guardrail checks
--json              Output as structured JSON
```

## Removed Options

- `--destination <node>` — removed, no bounded execution backend available

## JSON Output

Same DiagnosticSummary structure as MCP validate tool response `data` field.
See `mcp-validate-tool.md` for schema.
