# Contract: parseWorkflowFile behavior change

**Feature**: 014-n8nac-sibling-alignment  
**Scope**: `src/static-analysis/graph.ts` — `parseWorkflowFile()`

## Before (current)

```
parseWorkflowFile(filePath: string): Promise<WorkflowAST>
  - .ts  → parseTypeScriptFile() → WorkflowAST
  - .json → parseJsonFile() → WorkflowAST
  - other → MalformedWorkflowError
```

## After (phase 14)

```
parseWorkflowFile(filePath: string): Promise<WorkflowAST>
  - .ts  → parseTypeScriptFile() → WorkflowAST
  - .json → MalformedWorkflowError("... use n8nac for TypeScript workflow files")
  - other → MalformedWorkflowError
```

## Breaking change

Yes — `.json` files are no longer accepted. This is intentional dead-code removal. No consumer in the codebase or agent workflow passes `.json` files.

## Internal routing change (not a contract change)

`interpret()` now passes `graph.ast.metadata.id` (n8n UUID) to MCP execution calls instead of `deriveWorkflowId()` (file path). The `executeSmoke()` and `getExecution()` function signatures are unchanged — they accept `string`. The semantic meaning of the `workflowId` parameter changes from "file path" to "n8n workflow ID", which is what MCP always expected.
