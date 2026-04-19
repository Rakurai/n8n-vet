# Contract: MCP Input Schema (FR-028)

**Current**: Flat `z.object` that doesn't enforce field requirements per request kind.

**Target**: `z.discriminatedUnion('kind', [...])` that requires `nodes` when `kind === 'nodes'`.

```
ValidationRequestInput = z.discriminatedUnion('kind', [
  z.object({ kind: 'changed', workflowPath: string, layer?: string, force?: boolean }),
  z.object({ kind: 'nodes', workflowPath: string, nodes: string[], layer?: string, force?: boolean }),
  z.object({ kind: 'workflow', workflowPath: string, layer?: string, force?: boolean }),
])
```

# Contract: MCP Error Codes (FR-030)

**Current**: Only maps `MalformedWorkflowError`, `ZodError`, `ConfigurationError`, `ExecutionConfigError`, and ENOENT. All others → `internal_error`.

**Target**: Map all typed domain errors:

| Error Class | MCP Error Type |
|-------------|---------------|
| `ENOENT` | `workflow_not_found` |
| `MalformedWorkflowError` | `parse_error` |
| `ZodError` | `parse_error` |
| `ConfigurationError` | `configuration_error` |
| `ExecutionConfigError` | `configuration_error` |
| `ExecutionInfrastructureError` | `infrastructure_error` |
| `TrustPersistenceError` | `trust_error` |
| `SynthesisError` | `internal_error` |
| `ExecutionPreconditionError` | `precondition_error` |
| Unknown | `internal_error` |

# Contract: REST API Schemas

Verified against live n8n instance and source code. See `research.md` R1 for details.
Zod schemas updated to match actual response shapes after live verification.
