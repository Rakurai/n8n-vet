# Implementation Audit: Trust & Change Subsystem

**Date**: 2026-04-18
**Branch**: `003-trust-and-change`
**Base**: `main` (merge base: `88353f5`)
**Files audited**: 10 (6 source, 4 test)

---

## Findings

| ID | Category | Severity | Location | Description | Quoted Evidence |
|----|----------|----------|----------|-------------|-----------------|
| SD-001 | Spec Drift | HIGH | `src/trust/change.ts:244-250` | Rename detection does not transfer trust records from old name to new name. Renamed node is classified as `metadata-only` on the new identity, but the old trust record is keyed to the old NodeIdentity and removed as stale. `isTrusted(renamedNode)` returns false even though FR-007 says "trust records transfer from old name to new name." | `modified.push({ node: added[ai], changes: ['metadata-only'] });` — no trust record copy/move occurs |
| SD-002 | Spec Drift | HIGH | `src/trust/persistence.ts:119-121` | `N8N_VET_DATA_DIR` environment variable is never read. FR-013 and US4-S6 require: "Given the environment variable `N8N_VET_DATA_DIR` is set, When the system determines the storage path, Then it uses that directory." The implementation only accepts an explicit `dataDir` parameter with a hardcoded default. | `function resolveFilePath(dataDir?: string): string { return join(dataDir ?? DEFAULT_DATA_DIR, TRUST_FILE); }` |
| CV-001 | Constitution Violation | HIGH | `src/trust/persistence.ts:95-97` | Bare `catch {}` in `persistTrustState` silently swallows ALL errors when reading the existing file. A permission error, disk full error, or I/O error would silently discard existing trust data for other workflows. Constitution I: "No silent catches, no log-and-continue, no default-value recovery on error paths." | `} catch { // Corrupt file — start fresh }` |
| SD-003 | Spec Drift | MEDIUM | `src/trust/change.ts:55-65` | `position-only` change kind is never produced by change detection. Position is excluded from content hash (correctly per FR-002), so position-only changes are invisible to the hash comparison and classify as `unchanged`. FR-005 requires support for `position-only` classification. US1-S6: "Then the node is classified as `position-only` (trust-preserving)." | Content-hash-equal nodes always go to `unchanged.push(name as NodeIdentity)` — no mechanism to detect position-only changes. |
| CV-002 | Constitution Violation | MEDIUM | `src/trust/hash.ts:40` | `stringify(hashInput) ?? ''` silently falls back to empty string if `json-stable-stringify` returns undefined, producing sha256('') instead of propagating the failure. Constitution I: "no default-value recovery on error paths." Wrapped in try-catch but the fallback prevents the catch from triggering. | `return sha256(stringify(hashInput) ?? '');` |
| SF-001 | Silent Failure | MEDIUM | `src/trust/trust.ts:37-38` | `recordValidation` silently skips NodeIdentity values not found in the graph. If the caller passes a node that doesn't exist, the function produces no error and no record — the caller has no signal that the operation was incomplete. Constitution I: "If a required value is absent, the caller receives a typed error." | `const graphNode = graph.nodes.get(nodeId); if (!graphNode) continue;` |
| TQ-001 | Test Quality | MEDIUM | `test/trust/hash.test.ts:10` | `ContentHashError` is imported but never used. No test exercises the error-throwing path of `computeContentHash`. Constitution V: "Public error-path tests are mandatory." The API contract specifies `@throws {ContentHashError}` but no test verifies this behavior. | `import { ContentHashError } from '../../src/trust/errors.js';` — unused |
| SD-004 | Spec Drift | LOW | `src/trust/trust.ts:99-103` | Stale record removal is in `invalidateTrust`, not in `computeChangeSet`. FR-021: "System MUST remove stale trust records... during change detection." Functionally equivalent since both are called in sequence, but location differs from spec. | `if (!currentNodeNames.has(nodeId)) continue; // stale record` — in invalidateTrust, not computeChangeSet |
| CQ-001 | Code Quality | LOW | `test/trust/hash.test.ts:10` | Unused import. | `import { ContentHashError } from '../../src/trust/errors.js';` |

---

## Requirement Traceability

| Requirement | Status | Implementing Code | Notes |
|-------------|--------|-------------------|-------|
| FR-001 | IMPLEMENTED | `src/trust/hash.ts:24-43` | SHA-256 over canonicalized trust-relevant properties |
| FR-002 | IMPLEMENTED | `src/trust/hash.ts:29-38` | Only specified properties included in hashInput |
| FR-003 | IMPLEMENTED | `src/trust/hash.ts:52-67` | Connections hash over sorted forward adjacency |
| FR-004 | IMPLEMENTED | `src/trust/change.ts:19-77` | Full NodeChangeSet classification |
| FR-005 | PARTIAL | `src/trust/change.ts:113-160` | `position-only` never produced (SD-003). All other change kinds work. |
| FR-006 | IMPLEMENTED | `src/trust/change.ts:119-160` | Multiple ChangeKind values accumulated per node |
| FR-007 | DEVIATED | `src/trust/change.ts:222-264` | Rename detected and classified as metadata-only, but trust records are NOT transferred (SD-001) |
| FR-008 | IMPLEMENTED | `src/trust/change.ts:20-24` | Workflow hash quick check with short-circuit |
| FR-009 | IMPLEMENTED | `src/trust/trust.ts:25-52` | NodeTrustRecord with all required fields |
| FR-010 | IMPLEMENTED | `src/trust/trust.ts:63-108` | Forward-only BFS invalidation |
| FR-011 | IMPLEMENTED | `src/trust/trust.ts:15,72` | position-only and metadata-only are trust-preserving |
| FR-012 | IMPLEMENTED | `src/trust/trust.ts:70-81` | Trust-breaking + added + connection-changed nodes seeded |
| FR-013 | PARTIAL | `src/trust/persistence.ts` | JSON file with schemaVersion works, but N8N_VET_DATA_DIR env var not read (SD-002) |
| FR-014 | IMPLEMENTED | `src/trust/persistence.ts:28-73` | Missing file → empty, version mismatch → empty |
| FR-015 | IMPLEMENTED | `src/trust/persistence.ts:48-51` | TrustPersistenceError on corrupt file |
| FR-016 | IMPLEMENTED | `src/trust/trust.ts:118-121` | Hash match + record exists |
| FR-017 | IMPLEMENTED | `src/trust/trust.ts:127-164` | Trusted nodes with untrusted downstream |
| FR-018 | IMPLEMENTED | `src/trust/trust.ts:170-183` | Untrusted nodes in scope |
| FR-019 | IMPLEMENTED | `src/trust/trust.ts:191-238` | Trust-level conditions only |
| FR-020 | IMPLEMENTED | `src/trust/persistence.ts:67-70` | Per-workflow keying, missing → empty |
| FR-021 | DEVIATED | `src/trust/trust.ts:99-103` | Stale removal is in invalidateTrust, not computeChangeSet (SD-004) |

---

## Architecture Compliance

Architecture compliance: no project architecture docs exist (`docs/architecture/` is empty). Architecture-specific checks (H1-H10) are not applicable to this TypeScript library project.

---

## Metrics

- **Files audited**: 10
- **Findings**: 0 critical, 3 high, 4 medium, 2 low
- **Spec coverage**: 18 / 21 requirements fully implemented (3 partial/deviated)
- **Constitution compliance**: 2 violations across 5 principles checked (Principles III, IV, V clean)

---

## Remediation Decisions

For each item below, choose an action:
- **fix**: Create a remediation task to fix the implementation
- **spec**: Update the spec to match the implementation (if the implementation is actually correct)
- **skip**: Accept the finding and take no action
- **split**: Fix part in implementation, update part in spec

### 1. [SD-001] Rename detection does not transfer trust records
**Location**: `src/trust/change.ts:244-250`
**Spec says**: FR-007 — "trust records transfer from old name to new name"
**Code does**: Classifies rename as `metadata-only` but never copies the trust record from old NodeIdentity to new NodeIdentity. After rename, `isTrusted(newName)` returns false.

**Proposed fix**: In `invalidateTrust` (or a separate function called alongside it), when a `metadata-only` modification is detected on a node that doesn't have a trust record, look up the removed nodes from the change set and copy the matching trust record to the new identity.

Action: fix / spec / skip / split

### 2. [SD-002] N8N_VET_DATA_DIR environment variable not read
**Location**: `src/trust/persistence.ts:119-121`
**Spec says**: FR-013 and US4-S6 — environment variable `N8N_VET_DATA_DIR` overrides the default storage path
**Code does**: `resolveFilePath` accepts `dataDir` parameter with hardcoded default `.n8n-check/`, never reads `process.env.N8N_VET_DATA_DIR`

**Proposed fix**: Read `process.env.N8N_VET_DATA_DIR` in `resolveFilePath` as the fallback before the hardcoded default: `dataDir ?? process.env.N8N_VET_DATA_DIR ?? DEFAULT_DATA_DIR`

Action: fix / spec / skip / split

### 3. [CV-001] Bare catch in persistTrustState swallows all errors
**Location**: `src/trust/persistence.ts:95-97`
**Constitution says**: Principle I — "No silent catches, no log-and-continue"
**Code does**: `catch {}` swallows permission errors, I/O errors, etc., potentially losing other workflows' trust data by starting fresh

**Proposed fix**: Narrow the catch to only handle JSON parse failures and Zod validation failures. Re-throw unexpected errors (permissions, I/O).

Action: fix / spec / skip / split

### MEDIUM / LOW Summary

- **SD-003** (MEDIUM): `position-only` change kind never produced. Position changes classify as `unchanged`. Functionally equivalent for trust but violates FR-005/US1-S6.
- **CV-002** (MEDIUM): `stringify(hashInput) ?? ''` silent fallback in hash.ts:40. Replace `?? ''` with explicit check — if stringify returns undefined, throw ContentHashError.
- **SF-001** (MEDIUM): `recordValidation` silently skips missing nodes. Could throw instead when a requested node is not in the graph.
- **TQ-001** (MEDIUM): No test for ContentHashError throwing path. Add a test that triggers serialization failure.
- **SD-004** (LOW): Stale record removal is in `invalidateTrust` not `computeChangeSet`. Minor location deviation.
- **CQ-001** (LOW): Unused `ContentHashError` import in hash.test.ts. Remove or use in a new error-path test (TQ-001).

Would you like to promote any MEDIUM/LOW findings to remediation tasks?
