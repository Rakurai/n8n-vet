# Quickstart: MCP Surface and CLI

**Feature**: 008-mcp-surface-cli

## What This Feature Adds

Two entry points for the n8n-vet library:

1. **MCP Server** (`src/mcp/serve.ts`) — agent-facing, stdio transport, three tools
2. **CLI** (`src/cli/index.ts`) — developer-facing, human-readable + `--json` mode

Both delegate to the same library core. No business logic in either surface.

## Running the MCP Server

```bash
# Build first
npm run build

# Start MCP server (stdio transport — typically invoked by Claude Code, not manually)
node dist/mcp/serve.js
```

The server communicates over stdin/stdout using the MCP protocol. It registers three tools: `validate`, `trust_status`, `explain`.

## Using the CLI

```bash
# Validate a workflow (human-readable output)
n8n-vet validate path/to/workflow.ts

# Validate specific nodes
n8n-vet validate path/to/workflow.ts --target nodes --nodes "HTTP Request,Set"

# Get JSON output (same as MCP response)
n8n-vet validate path/to/workflow.ts --json

# Check trust status
n8n-vet trust path/to/workflow.ts

# Preview guardrail behavior
n8n-vet explain path/to/workflow.ts --target workflow
```

## Development

```bash
# Run tests
npx vitest run test/mcp/ test/cli/ test/errors.test.ts

# Type check
npm run typecheck

# Lint
npm run lint
```

## Key Files

| File | Purpose |
|------|---------|
| `src/mcp/serve.ts` | MCP server entry point (stdio transport) |
| `src/mcp/server.ts` | Tool registration, handlers, response wrapping |
| `src/cli/index.ts` | CLI entry point (parseArgs, dispatch) |
| `src/cli/commands.ts` | Command implementations |
| `src/cli/format.ts` | Human-readable output formatting |
| `src/errors.ts` | McpError type + domain error mapping |
| `src/deps.ts` | OrchestratorDeps factory |
