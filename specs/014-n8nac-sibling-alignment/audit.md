# Implementation Audit: n8nac Sibling Alignment

**Date**: 2026-04-19
**Branch**: `014-n8nac-sibling-alignment`
**Base**: `main` (2179f6e)
**Files audited**: 18 (unstaged changes only; no committed changes on branch yet)

---

## Findings

| ID | Category | Severity | Location | Description | Quoted Evidence |
|----|----------|----------|----------|-------------|-----------------|
| SD-001 | Spec Drift | MEDIUM | `docs/DESIGN.md:301` | DESIGN.md still claims JSON workflow files are parsed. FR-002 requires removal of all JSON parsing claims. | `n8n JSON workflow files: parsed via the transformer's JSON parser` |
| SD-002 | Spec Drift | MEDIUM | `docs/DESIGN.md:314` | DESIGN.md still references parsing `.json` files and AST-to-JSON conversion for REST API submission, contradicting JSON support removal. | `parsing .ts and .json workflow files into AST form, and for AST-to-JSON conversion when submitting workflows to the REST API` |
| SD-003 | Spec Drift | MEDIUM | `docs/reference/static-analysis.md:16` | Static analysis spec still references "TypeScript or JSON source" as input. JSON is no longer supported. | `WorkflowAST from n8nac transformer (TypeScript or JSON source)` |
| SD-004 | Spec Drift | MEDIUM | `docs/reference/static-analysis.md:97` | Static analysis spec still references `JsonToAstParser` as an input source. This parser no longer exists. | `Input: WorkflowAST (from TypeScriptParser.parseFile() or JsonToAstParser)` |
| SD-005 | Spec Drift | MEDIUM | `docs/reference/static-analysis.md:284` | External packages list still references `JsonToAstParser` as a dependency. | `@n8n-as-code/transformer -- TypeScriptParser, JsonToAstParser, WorkflowAST, NodeAST, ConnectionAST types` |
| SD-006 | Spec Drift | LOW | `docs/reference/static-analysis.md:213` | References "n8nac skills" as a schema source. Skills package has been removed. | `from n8nac skills or prior execution` |
| CQ-001 | Code Quality | LOW | `src/static-analysis/schemas.ts:18-19` | Comment references `@n8n-as-code/skills` package which has been removed from the project. Stale provenance comment. | `Minimal schema provider interface -- compatible with @n8n-as-code/skills NodeSchemaProvider. Defined locally to avoid hard dependency on skills package.` |
| CQ-002 | Code Quality | LOW | `docs/reference/execution.md:291` | External packages list references `WorkflowBuilder` for "AST-to-JSON conversion (needed for REST API submission)" — REST API was removed in phase 12. | `@n8n-as-code/transformer -- WorkflowBuilder for AST-to-JSON conversion (needed for REST API submission)` |

---

## Requirement Traceability

| Requirement | Status | Implementing Code | Notes |
|-------------|--------|-------------------|-------|
| FR-001 | IMPLEMENTED | `src/static-analysis/graph.ts:105-109` | `.json` rejected with `MalformedWorkflowError` mentioning n8nac |
| FR-002 | IMPLEMENTED | `src/static-analysis/graph.ts` (entire file) | No `parseJsonFile()` or JSON-specific parsing code exists |
| FR-003 | IMPLEMENTED | `src/orchestrator/interpret.ts:61,217,227` | `n8nWorkflowId` extracted from `graph.ast.metadata.id` and passed to `executeSmoke`/`getExecution` |
| FR-004 | IMPLEMENTED | `src/orchestrator/interpret.ts:71-72,76,203,300` | `deriveWorkflowId()` (file-path) used for trust, snapshots, pin data cache |
| FR-005 | IMPLEMENTED | `src/orchestrator/interpret.ts:178-187` | Missing/empty `n8nWorkflowId` pushes error into `executionErrors` array |
| FR-006 | IMPLEMENTED | `src/orchestrator/interpret.ts:150-165` | Static analysis runs regardless of `n8nWorkflowId` |
| FR-007 | IMPLEMENTED | `skills/validate-workflow/SKILL.md:25-57` | Two-phase validation clearly described |
| FR-008 | IMPLEMENTED | `skills/validate-workflow/SKILL.md:41-44` | `n8nac push` identified as agent's responsibility |
| FR-009 | IMPLEMENTED | `skills/validate-workflow/SKILL.md:68-76` | Trust persistence across calls described |
| FR-010 | IMPLEMENTED | `README.md:9-13` | Prerequisites section lists Node >= 20, n8n instance, n8nac |
| FR-011 | IMPLEMENTED | `README.md:17-28` | Setup section with clone, install, build, .env steps |
| FR-012 | IMPLEMENTED | `package.json` | No `@n8n-as-code/skills` in any dependency field |
| FR-013 | IMPLEMENTED | `package.json` | No `file:` or `link:` dependency references |
| FR-014 | IMPLEMENTED | `docs/DESIGN.md:76`, `docs/TECH.md:22-25`, `README.md:119` | Consistently described as sibling tool |
| FR-015 | PARTIAL | `docs/DESIGN.md:314` | `docs/DESIGN.md` no longer references ConfigService or `@n8n-as-code/skills` as integrated deps, but still claims `.json` parsing via transformer (SD-001/SD-002) |
| FR-016 | IMPLEMENTED | `docs/SCOPE.md:122-124` | "Wrapping, proxying, or orchestrating n8nac" listed as explicit non-goal |
| FR-017 | IMPLEMENTED | `docs/CONCEPTS.md:256-264` | Two-phase validation defined as shared vocabulary |
| FR-018 | IMPLEMENTED | verified via `npm run typecheck` + `npm test` | Zero errors on both |

---

## Architecture Compliance Summary

Architecture compliance: all checks passed. (This is a TypeScript project without the `game/`, `commands/`, `typeclasses/` architecture described in the audit template's H1-H10 checks. The project-specific architecture rules from CLAUDE.md — fail-fast, contract-driven, no over-engineering, honest code — are checked under Constitution Violations below.)

---

## Metrics

- **Files audited**: 18
- **Findings**: 0 critical, 0 high, 5 medium, 3 low
- **Spec coverage**: 17/18 requirements fully implemented, 1 partial (FR-015)
- **Constitution compliance**: 0 violations across 5 principles checked

---

## Remediation Decisions

No CRITICAL or HIGH findings.

### MEDIUM / LOW Summary

- **SD-001** (MEDIUM): `docs/DESIGN.md:301` — stale "n8n JSON workflow files" claim
- **SD-002** (MEDIUM): `docs/DESIGN.md:314` — stale ".json" and "AST-to-JSON conversion" reference
- **SD-003** (MEDIUM): `docs/reference/static-analysis.md:16` — stale "TypeScript or JSON source" input reference
- **SD-004** (MEDIUM): `docs/reference/static-analysis.md:97` — stale `JsonToAstParser` reference
- **SD-005** (MEDIUM): `docs/reference/static-analysis.md:284` — stale `JsonToAstParser` in external packages list
- **SD-006** (LOW): `docs/reference/static-analysis.md:213` — stale "n8nac skills" schema source reference
- **CQ-001** (LOW): `src/static-analysis/schemas.ts:18-19` — stale `@n8n-as-code/skills` comment
- **CQ-002** (LOW): `docs/reference/execution.md:291` — stale `WorkflowBuilder` / REST API reference

Do you want to promote any of these to remediation tasks, or should I create fix tasks for all of them?

---

## Proposed Spec Changes

None. All findings are implementation/documentation gaps, not spec issues.

---

## Remediation Tasks

_Awaiting user decisions before generating tasks._
