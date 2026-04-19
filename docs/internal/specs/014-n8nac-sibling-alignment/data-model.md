# Data Model: n8nac Sibling Alignment

**Feature**: 014-n8nac-sibling-alignment  
**Date**: 2026-04-19

## Entities

This feature does not introduce new entities. It clarifies the distinction between two existing ID concepts that were previously conflated.

### workflowFileId (existing, unchanged)

| Attribute | Value |
|-----------|-------|
| Source | `deriveWorkflowId(workflowPath)` — project-relative file path |
| Format | String, e.g., `workflows/my-flow.ts` |
| Stability | Stable across n8n instance changes (tied to local file) |
| Used for | Trust state key, snapshot key, pin data cache key |
| Uniqueness | Unique per project directory + file path |

### n8nWorkflowId (existing, now correctly routed)

| Attribute | Value |
|-----------|-------|
| Source | `WorkflowAST.metadata.id` — from `@workflow({ id })` decorator |
| Format | String, UUID or numeric ID, e.g., `'abc123-def4-...'` |
| Stability | Tied to n8n instance; changes if workflow recreated on different instance |
| Used for | MCP calls: `test_workflow`, `get_execution` |
| Uniqueness | Unique per n8n instance |
| Lifecycle | Empty string before first `n8nac push`; populated after push |

## Relationships

```
workflowFile (.ts) ──parsed──▶ WorkflowAST
    │                              │
    ├── deriveWorkflowId() ─▶ workflowFileId (local persistence)
    │
    └── ast.metadata.id ────▶ n8nWorkflowId (MCP execution calls)
```

## State Transitions

**n8nWorkflowId lifecycle:**

```
[New .ts file] ──n8nac pull/init──▶ metadata.id = '' (empty)
                                          │
                                    n8nac push
                                          │
                                          ▼
                                   metadata.id = 'uuid-...' (populated)
```

## Validation Rules

- `n8nWorkflowId` must be non-empty and non-whitespace for execution-layer calls
- `workflowFileId` is always valid if a file path was successfully parsed
- Missing `n8nWorkflowId` with execution request → error diagnostic (not thrown error)
- Missing `n8nWorkflowId` with static-only request → no error, proceed normally
