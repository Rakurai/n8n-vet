# Implementation Plan: Static Analysis Subsystem

**Branch**: `002-static-analysis` | **Date**: 2026-04-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-static-analysis/spec.md`

## Summary

Build the static analysis subsystem — a local, offline analysis layer that parses n8n workflow files (TypeScript and JSON) into a traversable `WorkflowGraph`, classifies nodes by data-shape behavior, traces expression references, and detects structural problems (data loss, broken references, schema mismatches, missing parameters). This is a leaf subsystem with no internal deps, producing three outputs consumed by later phases: `WorkflowGraph`, `StaticFinding[]`, and `ExpressionReference[]`.

## Technical Context

**Language/Version**: TypeScript 5.7+ on Node.js 20+
**Primary Dependencies**: `@n8n-as-code/transformer` (workflow parsing), `@n8n-as-code/skills` (optional — node schema lookup, parameter validation), `zod` (boundary validation)
**Storage**: N/A (stateless subsystem — no persistence)
**Testing**: vitest 3.1+
**Target Platform**: Node.js 20+ (library, not a service)
**Project Type**: Library subsystem within a standalone package
**Performance Goals**: Sub-second analysis for typical workflows (< 100 nodes)
**Constraints**: No dependency on `n8n-workflow` package. No running n8n instance required. ESM-only.
**Scale/Scope**: Single workflow at a time, typical size 5–50 nodes, max ~200 nodes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Fail-Fast, No Fallbacks | PASS | Parse/graph errors raise typed errors. Missing deps raise `ConfigurationError`. No default-value recovery. |
| II. Contract-Driven Boundaries | PASS | Public API accepts `WorkflowAST` (validated by transformer). Internal types trusted after graph construction. Zod at edges if needed. |
| III. No Over-Engineering | PASS | Five public functions matching INDEX.md contract. No single-implementor interfaces. Classification is a static set lookup, not an abstract strategy pattern. |
| IV. Honest Code Only | PASS | All five public functions will have real implementations. No stubs. Expression parser ports real n8n regex patterns. |
| V. Minimal, Meaningful Tests | PASS | Happy-path tests for each analysis capability. Error-path tests for malformed workflows and missing deps. Fixture-based tests with real workflow patterns. No trivial tests. |

**GATE RESULT: PASS** — No violations. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/002-static-analysis/
├── plan.md              # This file
├── research.md          # Phase 0: API research findings
├── data-model.md        # Phase 1: Internal types and entity model
├── contracts/           # Phase 1: Public API contracts
│   └── static-analysis-api.md
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── index.ts                          # Package entry point (exists)
├── types/                            # Shared types (exists — Phase 1)
│   ├── identity.ts
│   ├── graph.ts
│   ├── slice.ts
│   ├── target.ts
│   ├── trust.ts
│   ├── guardrail.ts
│   └── diagnostic.ts
└── static-analysis/                  # NEW — this phase
    ├── graph.ts                      # buildGraph(): WorkflowAST → WorkflowGraph
    ├── classify.ts                   # classifyNode(): NodeAST → NodeClassification
    ├── expressions.ts                # traceExpressions(): expression reference extraction
    ├── data-loss.ts                  # detectDataLoss(): data-loss-through-replacement detection
    ├── schemas.ts                    # checkSchemas(): schema compatibility checking
    ├── params.ts                     # validateNodeParams(): parameter validation
    ├── errors.ts                     # Typed error classes (MalformedWorkflowError, ConfigurationError)
    └── node-sets.ts                  # Shape-preserving/replacing/opaque node type sets

test/
├── fixtures/                         # Workflow fixture files
│   ├── README.md                     # (exists)
│   └── workflows/                    # NEW — workflow fixtures
│   │   ├── linear-simple.ts          # Trigger → API → Set → output
│   │   ├── linear-simple.json        # JSON equivalent
│   │   ├── branching-if.ts           # If node with true/false paths
│   │   ├── data-loss-bug.ts          # Canonical data-loss pattern
│   │   ├── code-node-opaque.ts       # Code node (opaque boundary)
│   │   ├── explicit-references.ts    # $('NodeName') patterns
│   │   └── single-trigger.ts         # Edge case: trigger only
├── types/                            # Type-level tests (exists)
└── static-analysis/                  # NEW — unit tests for this phase
    ├── graph.test.ts
    ├── classify.test.ts
    ├── expressions.test.ts
    ├── data-loss.test.ts
    ├── schemas.test.ts
    └── params.test.ts
```

**Structure Decision**: Static analysis lives in `src/static-analysis/` as a flat module directory. No subdirectories within — each analysis capability is a single file. This matches the plan.md's prescribed directory structure from Phase 0 scaffolding.

## Complexity Tracking

No constitution violations. Table not applicable.
