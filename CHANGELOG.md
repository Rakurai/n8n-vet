# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.2.0] - 2026-04-21

Audit remediation — internal restructuring with no new user-facing features.

### Changed

- **Grouped dependency injection** — `OrchestratorDeps` split into 7 named subsystem contracts (`ParsingDeps`, `TrustDeps`, `GuardrailDeps`, `AnalysisDeps`, `ExecutionDeps`, `DiagnosticsDeps`, `SnapshotDeps`)
- **Orchestrator decomposed** — `interpret()` delegates to phase helpers (`validate`, `synthesize`, `persist`) instead of owning detailed mechanics
- **Execution ownership moved** — pin-data tiering and MCP execution preparation extracted from orchestrator to `execution/prepare.ts`
- **Shared traversal primitives** — `traverse()` and `classifyBoundaries()` in `static-analysis/traversal.ts`, used by both target resolution and guardrail narrowing
- **Explicit degraded MCP bootstrap** — failed n8n connection logs once to stderr and starts in static-only mode instead of silently degrading
- **Error envelope sanitization** — `sanitizeMessage()` strips control characters and truncates to 500 chars across all `mapToMcpError` returns

### Removed

- `n8nHost` and `n8nApiKey` from `ValidationRequest` and `createServer()` — no longer needed after execution ownership move

### Added

- `tsconfig.check.json` — test files now included in typecheck
- Direct tests for execution lock lifecycle, MCP bootstrap, MCP `test` tool, CLI `runTest()`
- `SnapshotAST` type for deserialized workflow snapshots
- `TRUST_PRESERVING` shared constant (was duplicated in trust and guardrails)
- MCP tier-3 pin-data failures surfaced as warnings instead of silently swallowed
- Pinning tests for slice/boundary/narrowing semantics

## [0.1.0] - 2026-04-20

Initial release.

### Added

- **MCP server** exposing `validate`, `test`, `trust_status`, and `explain` tools
- **CLI** (`n8n-proctor validate`, `test`, `trust`, `explain`) with `--json` output
- **Static analysis**: graph parsing, expression tracing, data-loss detection, schema/param validation, node classification
- **Trust system**: content hashing, change detection, trust-state persistence, rerun assessment
- **Guardrails**: proceed / narrow / redirect / refuse decisions with structured evidence and explanations
- **Execution layer**: MCP-backed workflow execution with pin-data construction and capability detection (`mcp` / `static-only`)
- **Diagnostics**: structured summaries from static + execution results, error classification, actionable hints
- **Orchestrator**: request interpretation, path selection, workflow snapshots
- **Validate/test separation**: static validation and execution testing as distinct tools with separate evidence types
- **Integration test suite** with 15 scenarios against a live n8n instance
- **Claude Code plugin** distribution with skills, hooks, and MCP server
