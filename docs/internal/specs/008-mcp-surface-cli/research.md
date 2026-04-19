# Research: MCP Surface and CLI

**Feature**: 008-mcp-surface-cli | **Date**: 2026-04-19

## R1: MCP SDK Server API

**Decision**: Use `McpServer` (high-level API) with `StdioServerTransport` for stdio communication.

**Rationale**: The SDK provides two levels — `Server` (low-level, deprecated) and `McpServer` (high-level). `McpServer` handles tool registration, input validation, and protocol management. `registerTool` accepts a Zod schema for input validation and a callback returning `CallToolResult`. This is the documented path.

**Alternatives considered**:
- `Server` (low-level): Deprecated by SDK. Requires manual request handler registration. More boilerplate for no benefit.

**Key API surface**:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'n8n-vet', version: '0.1.0' });

server.registerTool('validate', {
  description: '...',
  inputSchema: zodSchema,
}, async (args, extra) => {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Note**: `registerTool` accepts Zod schemas directly (the SDK supports `ZodRawShapeCompat`). The callback receives parsed args and returns `CallToolResult` with `content` array. Our response envelope will be serialized as a text content block.

## R2: Trust Status Facade

**Decision**: Create a `getTrustStatus` function that composes existing trust primitives into a `TrustStatusReport`.

**Rationale**: The spec defines `trust_status` delegating to `getTrustStatus(workflowPath)`, but no such function exists. The existing trust API provides the building blocks: `loadTrustState`, `isTrusted`, `getUntrustedNodes`, `computeChangeSet`. The facade needs to:
1. Parse workflow file → build graph
2. Load trust state
3. Load snapshot (previous graph)
4. Compute change set (if snapshot exists)
5. Assemble TrustStatusReport from trust state + change set

This facade belongs in `src/mcp/server.ts` (or a thin helper) since it's specific to the MCP/CLI surface. It composes existing functions without adding business logic.

**Alternatives considered**:
- Adding `getTrustStatus` to the orchestrator: Rejected — the orchestrator handles validation requests, not read-only queries. Adding this would expand orchestrator scope.
- Putting it in trust subsystem: Rejected — the trust subsystem doesn't know about workflow parsing or graph building. The facade crosses subsystem boundaries.

## R3: Guardrail Explain Facade

**Decision**: Create an `explainGuardrails` function that performs dry-run guardrail evaluation.

**Rationale**: Similar to trust status, `explain` needs to:
1. Parse workflow file → build graph
2. Load trust state, load snapshot, compute change set
3. Resolve target (compute target nodes from AgentTarget)
4. Call `evaluate(input)` to get GuardrailDecision
5. Detect capabilities
6. Assemble GuardrailExplanation

This is more work than trust_status because it needs target resolution and guardrail evaluation. The facade composes existing functions.

**Alternatives considered**:
- Reusing `interpret()` with a dry-run flag: Rejected — `interpret` runs the full 10-step pipeline. A dry-run flag would add conditional logic to the orchestrator, violating the clean pipeline design.

## R4: Domain Error → McpError Mapping

**Decision**: Map errors at the MCP/CLI boundary using `instanceof` checks against the existing typed error classes.

**Rationale**: The codebase defines typed error classes:
- `MalformedWorkflowError` → `parse_error`
- `ConfigurationError`, `ExecutionConfigError` → `configuration_error`
- File not found (ENOENT from `parseWorkflowFile`) → `workflow_not_found`
- Everything else → `internal_error`

A single `mapToMcpError(error: unknown): McpError` function at the boundary handles all cases.

**Alternatives considered**:
- Error codes on domain errors: Would require modifying all existing error classes. Unnecessary since `instanceof` is reliable and the error class set is small.

## R5: CLI Argument Parsing with node:util.parseArgs

**Decision**: Use `node:util.parseArgs` with subcommand detection via positional args.

**Rationale**: `parseArgs` handles `--flag value` and `--boolean` patterns. For subcommands (`validate`, `trust`, `explain`), we detect the first positional argument. The workflow path is the second positional. This matches the CLI spec: `n8n-vet validate <path> [options]`.

**Key pattern**:
```typescript
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    target: { type: 'string' },
    nodes: { type: 'string' },
    layer: { type: 'string' },
    force: { type: 'boolean', default: false },
    destination: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const [command, workflowPath] = positionals;
```

**Alternatives considered**:
- `commander`, `yargs`: External dependencies. `parseArgs` is built-in and sufficient for 3 commands with 6 options.

## R6: Dependency Wiring

**Decision**: Create a `buildDeps(): OrchestratorDeps` factory function that wires all real implementations.

**Rationale**: `interpret(request, deps)` requires an `OrchestratorDeps` object. Both MCP and CLI need to construct this. A shared factory avoids duplication. The factory imports all subsystem functions and assembles them into the deps object.

This factory lives at `src/deps.ts` — shared by both MCP and CLI entry points.

**Alternatives considered**:
- Constructing deps inline in each handler: Duplicates 20+ imports across MCP and CLI. The factory is justified by having two consumers (MCP and CLI).
