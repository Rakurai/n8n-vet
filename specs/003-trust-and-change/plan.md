# Implementation Plan: Trust & Change Subsystem

**Branch**: `003-trust-and-change` | **Date**: 2026-04-18 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-trust-and-change/spec.md`

## Summary

Implement the trust and change subsystem: content hashing for deterministic node comparison, node-level change detection between workflow snapshots, trust derivation from successful validation, forward-only trust invalidation via BFS, local JSON persistence with schema versioning, and four trust query functions (`isTrusted`, `getTrustedBoundaries`, `getUntrustedNodes`, `getRerunAssessment`). This subsystem is entirely local (no n8n instance required) and consumes `WorkflowGraph` from Phase 2's static analysis.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 20+ (ESM, strict mode)
**Primary Dependencies**: `json-stable-stringify` (new, for canonical JSON serialization), `zod` (existing, for persistence schema validation), Node.js `crypto` (built-in, for SHA-256)
**Storage**: Local JSON file at `.n8n-check/trust-state.json` (configurable via `N8N_VET_DATA_DIR`)
**Testing**: vitest 3.1, graph fixtures (no n8n instance required)
**Target Platform**: Node.js library (consumed by downstream subsystems: guardrails, orchestrator, MCP/CLI)
**Project Type**: Library subsystem within the `n8n-check` package
**Performance Goals**: Hash computation and change detection must be negligible relative to static analysis. Workflow sizes are tens to low hundreds of nodes.
**Constraints**: Must match n8nac's `HashUtils.computeHash()` behavior (`json-stable-stringify` + SHA-256). Forward-only invalidation only. Last-write-wins for concurrent access.
**Scale/Scope**: Single workflow at a time. Trust state per workflow keyed by workflow ID.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Fail-Fast, No Fallbacks | PASS | Missing file → empty trust (not a fallback, specified behavior). Corrupt file → typed error. Schema version mismatch → discard (safe degradation, specified). No silent catches. |
| II. Contract-Driven Boundaries | PASS | Persistence layer validates with Zod at the boundary. Branded `NodeIdentity` type enforces identity contracts. Internal code trusts validated types. |
| III. No Over-Engineering | PASS | No abstract base classes. Functions, not classes with single methods. No speculative generality. `RerunAssessment` checks only trust-level conditions (guardrails owns the rest). |
| IV. Honest Code Only | PASS | All functions will have complete implementations. No stubs. Hash function matches n8nac's proven `HashUtils.computeHash()` pattern. |
| V. Minimal, Meaningful Tests | PASS | Happy-path tests for each function. Public error-path tests for persistence (corrupt file, missing file). Graph fixtures for invalidation BFS. No trivial constructor tests. |

## Project Structure

### Documentation (this feature)

```text
specs/003-trust-and-change/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── types/
│   └── trust.ts              # Existing shared types (TrustState, NodeChangeSet, etc.)
├── trust/
│   ├── hash.ts               # Content hashing and connections hashing
│   ├── change.ts             # Change detection between two WorkflowGraph snapshots
│   ├── trust.ts              # Trust derivation, invalidation, and queries
│   ├── persistence.ts        # Read/write trust state JSON file with schema validation
│   └── errors.ts             # Typed error classes for trust subsystem
├── static-analysis/          # Existing Phase 2 (consumed, not modified)
└── index.ts                  # Updated: add trust subsystem exports

test/
├── trust/
│   ├── hash.test.ts          # Content hash stability, exclusions, connections hash
│   ├── change.test.ts        # Change detection: all change kinds, rename, quick check
│   ├── trust.test.ts         # Trust derivation, invalidation BFS, queries
│   └── persistence.test.ts   # Round-trip, missing file, corrupt file, version mismatch
└── fixtures/
    └── workflows/            # Existing fixtures (reused for trust tests)
```

**Structure Decision**: New `src/trust/` directory with 5 files. Follows the existing pattern from `src/static-analysis/`. Each file has one clear responsibility. No barrel files — consumers import directly from the specific module.

## Complexity Tracking

No constitution violations. Table not needed.

## Post-Design Constitution Re-Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Fail-Fast, No Fallbacks | PASS | All error paths confirmed: `TrustPersistenceError` for corrupt files, `ContentHashError` for serialization failures. Missing file and schema mismatch are specified empty-state behaviors, not fallbacks. |
| II. Contract-Driven Boundaries | PASS | Zod schema validates persistence boundary. `RerunAssessment` type is a clean internal contract. All function signatures use branded `NodeIdentity`. No re-validation inside trust functions. |
| III. No Over-Engineering | PASS | 5 source files, each with clear responsibility. No interfaces with single implementors. `computeContentHash` takes raw parameters rather than introducing an abstraction layer. |
| IV. Honest Code Only | PASS | Every function in the contract has a defined behavior. No TODO stubs. Hash approach verified against n8nac source (`HashUtils.computeHash`). |
| V. Minimal, Meaningful Tests | PASS | 4 test files covering distinct behaviors: hash stability, change classification, BFS propagation, persistence round-trip. No redundant tests across files. |
