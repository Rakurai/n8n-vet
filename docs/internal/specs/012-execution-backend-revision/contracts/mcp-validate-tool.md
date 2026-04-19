# MCP Validate Tool Contract (Post-Revision)

**Tool**: `validate`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "workflowPath": {
      "type": "string",
      "description": "Path to the n8n-as-code workflow YAML file"
    },
    "target": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": ["nodes", "changed", "workflow"]
        },
        "nodes": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Required when kind is 'nodes'"
        }
      },
      "required": ["kind"]
    },
    "layer": {
      "type": "string",
      "enum": ["static", "execution", "both"],
      "default": "static"
    },
    "force": {
      "type": "boolean",
      "default": false
    },
    "pinData": {
      "type": "object",
      "description": "Pin data keyed by node name",
      "additionalProperties": true
    }
  },
  "required": ["workflowPath"]
}
```

## Removed Fields

- `destinationNode` (string | null) — removed, no bounded execution backend available
- `destinationMode` ("inclusive" | "exclusive") — removed, no bounded execution backend available

## Response Envelope

```json
{
  "success": true,
  "data": {
    "schemaVersion": 1,
    "status": "pass | fail | error | skipped",
    "target": { "description": "...", "nodes": [...], "automatic": true },
    "evidenceBasis": "static | execution | both",
    "executedPath": [...] | null,
    "errors": [...],
    "nodeAnnotations": [...],
    "guardrailActions": [...],
    "hints": [...],
    "capabilities": {
      "staticAnalysis": true,
      "restReadable": false,
      "mcpTools": true
    },
    "meta": {
      "runId": "...",
      "executionId": "..." | null,
      "timestamp": "...",
      "durationMs": 0
    }
  }
}
```

## Key Changes in Response

- `capabilities.restApi` renamed to `capabilities.restReadable`
- `meta.partialExecution` removed (all executions are whole-workflow)
