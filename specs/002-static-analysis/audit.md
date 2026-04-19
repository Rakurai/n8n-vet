# Implementation Audit: Static Analysis Subsystem

**Date**: 2026-04-18
**Branch**: `002-static-analysis`
**Base**: `main` (ae7a244)
**Files audited**: 12 source + 6 test + 8 fixture = 26 total

---

## Findings

| ID | Category | Severity | Location | Description | Quoted Evidence |
|----|----------|----------|----------|-------------|-----------------|
| SD-001 | Spec Drift | HIGH | `src/static-analysis/expressions.ts:50-64` | FR-011: `$fromAI()`, dynamic key access (`$json[variable]`), and other unparseable expression patterns are silently dropped. Spec requires recording them with `resolved: false`. No regex or catch-all logic exists for unrecognized expression patterns. | Only 4 fixed patterns defined: `JSON_DOT_PATTERN`, `JSON_BRACKET_PATTERN`, `EXPLICIT_REF_PATTERN`, `INPUT_PATTERN`, `NODE_REF_PATTERN`. No fallback for unrecognized expressions. |
| SD-002 | Spec Drift | HIGH | `src/static-analysis/data-loss.ts:21-24` | FR-023: Schema downgrade logic completely missing. `detectDataLoss()` signature is `(graph, references, targetNodes)` with no `schemaProvider` parameter. No code path exists to downgrade a data-loss `error` to `warning` when the upstream node has a known schema containing the referenced field. | `export function detectDataLoss(graph: WorkflowGraph, references: ExpressionReference[], targetNodes: NodeIdentity[]): StaticFinding[]` — no schema parameter |
| PH-001 | Phantom | HIGH | `src/static-analysis/params.ts:51-65` | Credential validation claims to check for "undefined credential types" but the check is vacuous. `Object.keys()` always returns strings, so `typeof credentialType !== 'string'` is always false. Only empty-string keys are caught — a trivially unlikely edge case. No actual validation against a credential type registry occurs. | `if (typeof credentialType !== 'string' \|\| credentialType.trim() === '')` |
| TQ-001 | Test Quality | MEDIUM | `test/static-analysis/params.test.ts` | No test exists for the `missing-credentials` finding path. The spec acceptance scenario US5.3 requires testing "node with an undefined credential type." The test file covers required-params and no-schema cases but omits credentials entirely. | File has 5 tests; none exercise the credentials code path at `params.ts:51-65` |
| SD-003 | Spec Drift | MEDIUM | `src/static-analysis/schemas.ts:44`, `src/static-analysis/params.ts:17` | FR-019 says both `@n8n-as-code/transformer` AND `@n8n-as-code/skills` must raise `ConfigurationError` when unavailable. `checkSchemas()` and `validateNodeParams()` return empty arrays when no `schemaProvider` is given — no error raised. Tasks.md documents this as intentional ("not an error per constitution principle I") but contradicts the spec literal. | `if (!schemaProvider) { return []; }` |

---

## Requirement Traceability

| Requirement | Status | Implementing Code | Notes |
|-------------|--------|-------------------|-------|
| FR-001 | IMPLEMENTED | `src/static-analysis/graph.ts:95-109` | parseWorkflowFile() auto-detects .ts/.json |
| FR-002 | IMPLEMENTED | `src/static-analysis/graph.ts:26-84` | buildGraph() produces node map, edges, adjacency |
| FR-003 | IMPLEMENTED | `src/static-analysis/graph.ts:34-77` | Unique names + valid edge refs enforced |
| FR-004 | IMPLEMENTED | `src/static-analysis/classify.ts:29-62` | classifyNode() with 7 priority rules |
| FR-005 | IMPLEMENTED | `src/static-analysis/classify.ts:67-77` | Set node include variants handled |
| FR-006 | IMPLEMENTED | `src/static-analysis/classify.ts:61` | Default to shape-opaque |
| FR-007 | IMPLEMENTED | `src/static-analysis/graph.ts:52` | displayNameIndex built per node |
| FR-008 | IMPLEMENTED | `src/static-analysis/expressions.ts:70-96` | Recursive walkParameters |
| FR-009 | IMPLEMENTED | `src/static-analysis/expressions.ts:53-64` | All 4 ACCESS_PATTERNS as regex |
| FR-010 | IMPLEMENTED | `src/static-analysis/expressions.ts:172-195, 221-245` | displayNameIndex lookup in explicit/node ref |
| FR-011 | MISSING | — | No detection of `$fromAI()`, dynamic keys, or computed names. See SD-001. |
| FR-012 | IMPLEMENTED | `src/static-analysis/data-loss.ts:84-138` | walkBackward with shape-replacing detection |
| FR-013 | IMPLEMENTED | `src/static-analysis/data-loss.ts:149-178` | isFirstDataSource with allPathsReachEntry |
| FR-014 | IMPLEMENTED | `src/static-analysis/data-loss.ts:153-177` | ALL backward paths checked |
| FR-015 | IMPLEMENTED | `src/static-analysis/schemas.ts:39-82` | checkSchemas via NodeSchemaProvider |
| FR-016 | IMPLEMENTED | `src/static-analysis/schemas.ts:62-63` | Skip per-node when schema unavailable |
| FR-017 | PARTIAL | `src/static-analysis/params.ts:12-69` | Required params checked; credential validation is phantom. See PH-001. |
| FR-018 | IMPLEMENTED | `src/static-analysis/data-loss.ts:107-116` | opaque-boundary warning emitted |
| FR-019 | DEVIATED | `src/static-analysis/graph.ts:117-118` | Transformer raises ConfigurationError; skills returns empty instead. See SD-003. |
| FR-020 | IMPLEMENTED | `src/static-analysis/types.ts:73-80` | StaticFinding discriminated union |
| FR-021 | IMPLEMENTED | `src/static-analysis/types.ts:13-26` | ExpressionReference with all fields |
| FR-022 | IMPLEMENTED | `src/static-analysis/expressions.ts:27-30`, `data-loss.ts:21-25` | Both accept target node lists |
| FR-023 | MISSING | — | No schema downgrade in detectDataLoss. See SD-002. |
| FR-024 | IMPLEMENTED | `src/index.ts:12-16` | All 5 public functions exported |

---

## Architecture Compliance Summary

This project does not have `docs/architecture/` documents (pre-implementation repo). Architecture checks from the audit skill's H1-H10 are not applicable. The codebase follows a flat module structure as prescribed by plan.md.

Architecture compliance: N/A — no architecture docs exist for this project.

---

## Metrics

- **Files audited**: 26
- **Findings**: 0 critical, 3 high, 2 medium, 0 low
- **Spec coverage**: 21 / 24 requirements implemented (2 MISSING, 1 PARTIAL)
- **Constitution compliance**: 1 violation (Principle IV — Honest Code Only) across 5 principles checked

---

## Remediation Decisions

For each item below, choose an action:
- **fix**: Create a remediation task to fix the implementation
- **spec**: Update the spec to match the implementation (if the implementation is actually correct)
- **skip**: Accept the finding and take no action
- **split**: Fix part in implementation, update part in spec

### 1. [SD-001] Unresolvable expressions not recorded (FR-011)
**Location**: `src/static-analysis/expressions.ts:50-64`
**Spec says**: Record `$fromAI()`, dynamic key access, and computed node names with `resolved: false` (FR-011, US2 scenario 5)
**Code does**: Only the 4 known reference patterns are extracted. Anything else is invisible — no catch-all for unrecognized expression patterns.
**Remediation sketch**: Add a fallback pattern that detects expressions containing `$fromAI(`, `$json[` with non-literal brackets, or other unparseable references, and records them as `unresolvable-expression` findings.

Action: fix / spec / skip / split

### 2. [SD-002] Schema downgrade logic missing (FR-023)
**Location**: `src/static-analysis/data-loss.ts:21-24`
**Spec says**: Downgrade data-loss `error` to `warning` when shape-replacing node has known output schema containing the referenced field (FR-023)
**Code does**: `detectDataLoss()` has no schema parameter and no downgrade logic.
**Remediation sketch**: Add optional `schemaProvider` parameter to `detectDataLoss()`. When a data-loss finding would be emitted, check if the upstream node's schema contains the referenced field; if so, downgrade severity to `warning`.

Action: fix / spec / skip / split

### 3. [PH-001] Credential validation is phantom (FR-017, Constitution IV)
**Location**: `src/static-analysis/params.ts:51-65`
**Spec says**: Flag nodes with undefined credential types (US5.3)
**Code does**: Checks `typeof credentialType !== 'string'` (always false for Object.keys output) and `credentialType.trim() === ''` (trivially unlikely). No actual validation against any credential type registry.
**Context**: The `NodeSchemaProvider` interface doesn't expose credential type information, so real validation may not be feasible with the current abstraction. The honest fix may be to remove the phantom check and document credential validation as deferred.

Action: fix / spec / skip / split

### MEDIUM / LOW Summary

- **TQ-001 (MEDIUM)**: `test/static-analysis/params.test.ts` — No test for `missing-credentials` finding. If the credential check stays, it needs a test; if removed, the test gap resolves itself.
- **SD-003 (MEDIUM)**: `schemas.ts:44`, `params.ts:17` — FR-019 says skills unavailability must raise `ConfigurationError`, but implementation returns empty arrays. Tasks.md documents this as intentional. Consider updating FR-019 to reflect that skills is optional (not a configuration error to omit).

Would you like to promote any MEDIUM findings to remediation tasks?

---

## Proposed Spec Changes

- **FR-019**: Scope `ConfigurationError` to `@n8n-as-code/transformer` only. `@n8n-as-code/skills` is optional; its absence results in empty findings, not an error. (T035)

---

## Remediation Tasks

Appended to `specs/002-static-analysis/tasks.md` under "Audit Remediation":

- [ ] T031 [AR] Record unresolvable expressions (`$fromAI()`, dynamic keys) with `resolved: false` — `expressions.ts` + test
- [ ] T032 [AR] Add schema downgrade logic to `detectDataLoss()` — optional `schemaProvider` param, `error` → `warning` when field in schema
- [ ] T033 [AR] Remove phantom credential validation from `params.ts:51-65` — document as deferred
- [ ] T034 [AR] Add missing-credentials test or remove dead code path — depends on T033 outcome
- [ ] T035 [AR] Update FR-019 in spec.md — scope ConfigurationError to transformer only
