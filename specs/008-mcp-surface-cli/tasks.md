# Tasks: MCP Surface and CLI

**Input**: Design documents from `/specs/008-mcp-surface-cli/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

## Format: `[ID] [P?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

---

## Phase 1: Shared Types and Infrastructure

**Purpose**: Error types, surface types, and dependency wiring used by both MCP server and CLI.

- [X] T001 [P] Implement McpError type, McpResponse type, and `mapToMcpError(error: unknown): McpError` mapping function in `src/errors.ts`. Map domain errors: ENOENT → `workflow_not_found`, `MalformedWorkflowError` → `parse_error`, `ConfigurationError`/`ExecutionConfigError` → `configuration_error`, ZodError → `parse_error`, all others → `internal_error`. Export McpError type, McpResponse type, and mapping function.
- [X] T002 [P] Implement `TrustStatusReport`, `GuardrailExplanation`, and `TargetResolutionInfo` types in `src/types/surface.ts`. Define TrustStatusReport (workflowId, totalNodes, trustedNodes array with name/validatedAt/validationLayer/contentUnchanged, untrustedNodes array with name/reason, changedSinceLastValidation). Define GuardrailExplanation (guardrailDecision, targetResolution with resolvedNodes/selectedPath/automatic, capabilities). Export all types.
- [X] T003 [P] Implement `buildDeps(): OrchestratorDeps` factory in `src/deps.ts`. Wire all real subsystem implementations (parseWorkflowFile, buildGraph, loadTrustState, persistTrustState, computeChangeSet, invalidateTrust, recordValidation, evaluate, traceExpressions, detectDataLoss, checkSchemas, validateNodeParams, executeBounded, executeSmoke, getExecutionData, constructPinData, synthesize, loadSnapshot, saveSnapshot, detectCapabilities). Import from existing subsystem modules.
- [X] T004 Write error mapping tests in `test/errors.test.ts`. Test mapToMcpError with: MalformedWorkflowError → parse_error, ConfigurationError → configuration_error, ExecutionConfigError → configuration_error, ENOENT error → workflow_not_found, ZodError → parse_error, generic Error → internal_error, non-Error throw → internal_error.

---

## Phase 2: MCP Server

**Purpose**: All three MCP tools (`validate`, `trust_status`, `explain`) and the stdio entry point.

- [X] T005 Implement MCP server with all three tool handlers in `src/mcp/server.ts`. Create `createServer(deps: OrchestratorDeps)` function that instantiates McpServer from `@modelcontextprotocol/sdk/server/mcp.js`. Register `validate` tool: Zod input schema (workflowPath required; optional target, layer, force, pinData, destinationNode, destinationMode), apply defaults, call `interpret(request, deps)`, wrap in McpResponse envelope. Register `trust_status` tool: Zod input schema (workflowPath required), parse workflow, build graph, load trust state, load snapshot, compute change set, assemble TrustStatusReport, wrap in envelope. Register `explain` tool: Zod input schema (workflowPath required; optional target, layer), parse workflow, build graph, load trust state, compute change set, resolve target, call evaluate(), call detectCapabilities(), assemble GuardrailExplanation, wrap in envelope (read-only — no trust modification). All handlers: on error call mapToMcpError, wrap in error envelope, return as `{ content: [{ type: 'text', text: JSON.stringify(envelope) }] }`.
- [X] T006 Implement MCP serve entry point in `src/mcp/serve.ts`. Import createServer from server.ts, StdioServerTransport from `@modelcontextprotocol/sdk/server/stdio.js`. Build deps via buildDeps(), create server, connect stdio transport. This is the entry point referenced by `.mcp.json` (`dist/mcp/serve.js`).
- [X] T007 Write MCP server tests in `test/mcp/server.test.ts`. Test validate tool: mock deps (mock interpret to return a DiagnosticSummary), verify success envelope shape, verify defaults applied when optional fields omitted. Test trust_status tool: mock deps, verify TrustStatusReport shape. Test explain tool: mock deps, verify GuardrailExplanation shape, verify explain does not call persistTrustState or recordValidation (read-only). Test error cases: mock interpret to throw MalformedWorkflowError → verify parse_error envelope, mock file not found → verify workflow_not_found envelope.

---

## Phase 3: CLI

**Purpose**: All three CLI commands (`validate`, `trust`, `explain`) with human-readable and `--json` output.

- [X] T008 Implement human-readable output formatting in `src/cli/format.ts`. Functions: `formatDiagnosticSummary(summary: DiagnosticSummary): string` with color-coded status (pass=green, fail=red, error=red, skipped=yellow), indented error sections with classification, node annotations, guardrail actions, and hints. `formatTrustStatus(report: TrustStatusReport): string` with trusted/untrusted node lists. `formatGuardrailExplanation(explanation: GuardrailExplanation): string` with decision action, explanation text, target resolution. `formatMcpError(error: McpError): string` for error display. Use direct ANSI escape codes for color (Node 20 compatible; `node:util.styleText` is experimental in Node 20 and should not be used).
- [X] T009 Implement all CLI command functions in `src/cli/commands.ts`. Functions: `runValidate(workflowPath, options, deps): Promise<McpResponse<DiagnosticSummary>>` — build ValidationRequest from options, apply defaults, call interpret(), catch errors via mapToMcpError. `runTrust(workflowPath, deps): Promise<McpResponse<TrustStatusReport>>` — parse workflow, build graph, load trust state, load snapshot, compute change set, assemble TrustStatusReport. `runExplain(workflowPath, options, deps): Promise<McpResponse<GuardrailExplanation>>` — parse workflow, build graph, load trust state, compute change set, resolve target, evaluate guardrails, detect capabilities, assemble GuardrailExplanation. All functions return McpResponse envelopes.
- [X] T010 Implement CLI entry point in `src/cli/index.ts`. Use `node:util.parseArgs` with options: target (string), nodes (string), layer (string), force (boolean), destination (string), json (boolean). Parse positionals for command (validate/trust/explain) and workflow path. Validate: command required, path required, --nodes requires --target nodes, --target nodes requires --nodes. Build deps via buildDeps(), dispatch to command functions. Output: if --json, JSON.stringify envelope to stdout; else format with format.ts to stdout. On tool error with --json: envelope to stdout; without --json: print to stderr, exit 1. On invalid args: print usage to stderr, exit 2.
- [X] T011 Write CLI command tests in `test/cli/commands.test.ts`. Test runValidate: mock deps, verify defaults applied, verify McpResponse envelope. Test runTrust: mock deps, verify TrustStatusReport envelope. Test runExplain: mock deps, verify GuardrailExplanation envelope. Test argument validation: --nodes without --target nodes produces error.
- [X] T012 [P] Write formatting tests in `test/cli/format.test.ts`. Test formatDiagnosticSummary with pass/fail/error/skipped statuses. Test formatTrustStatus with mixed trusted/untrusted nodes. Test formatGuardrailExplanation with proceed/warn/narrow decisions. Test formatMcpError with each error type.

---

## Phase 4: Integration

**Purpose**: Exports, build verification, full test suite.

- [X] T013 Update `src/index.ts` to export new public types: McpError, McpResponse from `src/errors.ts`. Export TrustStatusReport, GuardrailExplanation, TargetResolutionInfo from `src/types/surface.ts`. Export buildDeps from `src/deps.ts`. Export createServer from `src/mcp/server.ts`.
- [X] T014 Run `npm run build` and verify both entry points compile. Run `npm run typecheck` for full type checking. Run `npx vitest run` and verify all new and existing tests pass. Fix any regressions.

---

## Dependencies & Execution Order

```
Phase 1: T001, T002, T003 in parallel → T004
Phase 2: T005 → T006 → T007
Phase 3: T008 → T009 → T010 → T011, T012 in parallel
Phase 4: T013 → T014
```

- Phase 2 and Phase 3 can run in parallel after Phase 1
- Within Phase 3, T008 and T009 can run in parallel (different files), then T010 depends on both
- T011 and T012 can run in parallel (different test files)

---

## Audit Remediation

> Generated by `/speckit.audit` on 2026-04-19. All items resolved.

- [X] T015 [AR] Extract shared trust_status and explain composition into `src/surface.ts`, imported by both MCP server and CLI (CQ-001)
- [X] T016 [AR] Add empty-nodes validation in MCP `resolveTarget` and CLI `resolveTarget` — return parse error when `target.kind='nodes'` with empty/missing nodes (SD-001)
- [X] T017 [AR] Update spec US1-3 and US1-4 acceptance scenarios to reflect `interpret()` behavior: validate returns `success:true` with `status:'error'` for file-not-found and parse errors (SD-002)
- [X] T018 [AR] Fix `EvaluationInput.target` to pass full target object instead of `{ kind: target.kind } as AgentTarget` (CQ-002)
- [X] T019 [AR] Replace fragile `process.argv[1]?.endsWith()` in CLI with `fileURLToPath(import.meta.url)` comparison (CQ-003)
- [X] T020 [AR] Fix trusted-node test to compute real content hash via `computeContentHash()` so it actually tests the trusted path (TQ-002)
- [X] T021 [AR] Add test for empty-nodes → error envelope in MCP server tests (SD-001 coverage)

- 14 tasks total, 4 phases, straight-through implementation
- All MCP tool handlers in one file (`src/mcp/server.ts`), all CLI commands in one file (`src/cli/commands.ts`)
- Project already has 50 source files and 47 test files — this adds ~7 source files and ~4 test files
