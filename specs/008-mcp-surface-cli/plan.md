# Implementation Plan: MCP Surface and CLI

**Branch**: `008-mcp-surface-cli` | **Date**: 2026-04-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-mcp-surface-cli/spec.md`

## Summary

Implement thin MCP server and CLI entry points that expose the n8n-vet library core to agents and developers. The MCP server registers three tools (`validate`, `trust_status`, `explain`) using `@modelcontextprotocol/sdk`. The CLI mirrors all three commands using `node:util.parseArgs`. Both layers parse input, apply defaults, delegate to library core functions, and format output. No validation logic lives in either surface.

## Technical Context

**Language/Version**: TypeScript 5.7+ (strict mode, ESM) on Node.js 20+
**Primary Dependencies**: `@modelcontextprotocol/sdk` ^1.12.1 (McpServer, StdioServerTransport), `zod` ^3.24 (input validation), `node:util.parseArgs` (CLI)
**Storage**: N/A (delegates to trust subsystem for persistence)
**Testing**: Vitest ^3.1
**Target Platform**: Node.js 20+ (local development, Claude Code plugin)
**Project Type**: Library with MCP server + CLI entry points
**Performance Goals**: N/A (thin delegation layer; performance dominated by upstream subsystems)
**Constraints**: Both surfaces must remain thin — no business logic, no orchestration, no diagnostic construction
**Scale/Scope**: 3 MCP tools, 3 CLI commands, ~4-6 new source files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Fail-Fast, No Fallbacks | PASS | Error mapping at boundary only; no silent catches. Domain errors → McpError. Unexpected → `internal_error`. |
| II. Contract-Driven Boundaries | PASS | Zod validation at MCP/CLI input boundary. After validation, trust internally. McpError as typed domain error at public surface. |
| III. No Over-Engineering | PASS | No abstractions planned beyond what's needed. Three tool handlers, three CLI commands, one shared dependency wiring function. |
| IV. Honest Code Only | PASS | All three upstream functions exist (`interpret`, trust queries, `evaluate`). No stubs needed. |
| V. Minimal, Meaningful Tests | PASS | Happy-path per tool + error mapping tests. No redundant coverage. |

## Project Structure

### Documentation (this feature)

```text
specs/008-mcp-surface-cli/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── mcp-tools.md     # MCP tool input/output schemas
│   └── cli-interface.md # CLI argument spec
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── mcp/
│   ├── server.ts        # MCP server: tool registration, handlers, response wrapping
│   └── serve.ts         # Entry point: create server, connect stdio transport, start
├── cli/
│   ├── index.ts         # Entry point: parseArgs, dispatch to commands
│   ├── commands.ts      # Command implementations: validate, trust, explain
│   └── format.ts        # Human-readable output formatting with color
├── errors.ts            # McpError type, domain error → McpError mapping function
└── deps.ts              # OrchestratorDeps factory: wire all real subsystem implementations

test/
├── mcp/
│   └── server.test.ts   # MCP tool invocation tests (mock orchestrator)
├── cli/
│   ├── commands.test.ts # CLI command tests (argument parsing, default application)
│   └── format.test.ts   # Human-readable formatting tests
└── errors.test.ts       # Error mapping tests
```

**Structure Decision**: MCP and CLI are separate directories under `src/` matching the existing subsystem pattern. Shared concerns (error mapping, dependency wiring) live at `src/` root level. The `serve.ts` entry point is referenced by `.mcp.json`; the `cli/index.ts` entry point is referenced by `package.json` bin field.

## Complexity Tracking

No violations to justify. The implementation follows all constitution principles without deviation.
