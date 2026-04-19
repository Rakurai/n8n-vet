# Implementation Audit: MCP Surface and CLI

**Date**: 2026-04-19
**Branch**: `008-mcp-surface-cli`
**Base**: `main` (54f5722)
**Files audited**: 11 source + test files

---

## Findings

| ID | Category | Severity | Location | Description | Quoted Evidence |
|----|----------|----------|----------|-------------|-----------------|
| SD-001 | Spec Drift | HIGH | `src/mcp/server.ts:69` | `target.kind='nodes'` with empty/missing `nodes` array silently defaults to `[]` instead of returning a parse error as specified in Edge Cases | `return { kind: 'nodes', nodes: (raw.nodes ?? []) as NodeIdentity[] };` |
| SD-002 | Spec Drift | HIGH | `src/mcp/server.ts:89-104` | Spec acceptance scenarios US1-3 and US1-4 expect `{ success: false, error: { type: 'workflow_not_found' } }` and `parse_error` for file-not-found and malformed workflows, but `interpret()` catches these internally and returns `{ success: true, data: { status: 'error' } }`. The validate tool can never produce `success: false` for these cases. | `const summary = await interpret(request, deps); return wrapSuccess(summary);` — interpret never throws for foreseeable failures |
| CQ-001 | Code Quality | HIGH | `src/mcp/server.ts:143-277` and `src/cli/commands.ts:65-204` | ~130 lines of nearly identical logic duplicated between MCP server and CLI commands for `trust_status` and `explain`. Both `buildTrustStatusReport` (50 lines) and `buildGuardrailExplanation` (82 lines) are copy-pasted into CLI `runTrust` and `runExplain`. Constitution III requires abstractions to have two consumers — here we have exactly two consumers sharing no code. | Server: `async function buildTrustStatusReport(workflowPath, deps)` / CLI: `export async function runTrust(workflowPath, deps)` — identical bodies wrapped differently |
| CQ-002 | Code Quality | MEDIUM | `src/mcp/server.ts:247` and `src/cli/commands.ts:168` | `target: { kind: target.kind } as AgentTarget` creates a structurally invalid `AgentTarget` when `kind === 'nodes'` (missing required `nodes` field). The cast bypasses type safety. Not a runtime bug because `evaluate()` only reads `input.targetNodes`, not `input.target.nodes`. | `target: { kind: target.kind } as AgentTarget,` |
| CQ-003 | Code Quality | MEDIUM | `src/cli/index.ts:189-194` | Direct-run detection uses fragile string suffix matching on `process.argv[1]`. If the entry point path changes or is invoked differently (symlink, npx), this fails silently. | `const isDirectRun = process.argv[1]?.endsWith('/cli/index.js') \|\| process.argv[1]?.endsWith('/cli/index.ts');` |
| TQ-001 | Test Quality | MEDIUM | `test/mcp/server.test.ts:164-171` | `getToolHandler` accesses `McpServer._registeredTools` private internals, coupling tests to SDK implementation details. If the SDK changes its internal property name, all server tests break. | `const internal = server as unknown as { _registeredTools: Record<string, ...> };` |
| TQ-002 | Test Quality | MEDIUM | `test/mcp/server.test.ts:247-287` | `trust_status` trusted-node test can never actually test the trusted-node path. `computeContentHash` is imported directly (not via deps), so the hash never matches the fixture `'will-be-matched'`. The test title says "reports trusted nodes" but only verifies the untrusted path. | `// computeContentHash is a real call, so the hash won't match our fake 'will-be-matched'. // The node will show as untrusted with 'content changed' reason.` |

---

## Requirement Traceability

| Requirement | Status | Implementing Code | Notes |
|-------------|--------|-------------------|-------|
| FR-001 | IMPLEMENTED | `src/mcp/server.ts:86,108,121` | Three tools registered |
| FR-002 | IMPLEMENTED | `src/mcp/server.ts:57-65`, `src/errors.ts:31-33` | Consistent envelope wrapping |
| FR-003 | DEVIATED | `src/mcp/server.ts:89-104` | Correctly implemented in code (interpret returns success+error-status), but spec acceptance scenarios US1-3/US1-4 contradict this. See SD-002. |
| FR-004 | IMPLEMENTED | `src/mcp/server.ts:67-77,93-98` | Defaults applied correctly |
| FR-005 | IMPLEMENTED | `src/errors.ts:52-77` | Four McpError types mapped correctly |
| FR-006 | IMPLEMENTED | `src/cli/index.ts:73-186` | All three CLI commands with correct options |
| FR-007 | IMPLEMENTED | `src/cli/format.ts` | Color-coded human formatting |
| FR-008 | IMPLEMENTED | `src/cli/index.ts:127-129,143-145,172-174` | `--json` outputs envelope |
| FR-009 | IMPLEMENTED | `src/cli/index.ts:98-101,107-109,136-137` | Errors to stderr, non-zero exit codes |
| FR-010 | IMPLEMENTED | `src/mcp/server.ts:30-53` | Zod schemas validate input; SDK validates before handler invocation |
| FR-011 | IMPLEMENTED | `src/mcp/server.ts:100,143-192,196-277` | validate delegates to interpret(); others compose subsystem functions |
| FR-012 | IMPLEMENTED | All surface files | No business logic in surface layers |
| FR-013 | IMPLEMENTED | `src/mcp/server.ts:196-277` | explain is read-only; no trust modification calls |

---

## Architecture Compliance

No `docs/architecture/` directory exists in this project. Architecture checks H1-H10 from the audit template are not applicable. Compliance validated against constitution and CLAUDE.md only.

---

## Metrics

- **Files audited**: 11 (7 source, 4 test)
- **Findings**: 0 critical, 3 high, 4 medium, 0 low
- **Spec coverage**: 13/13 requirements (12 implemented, 1 deviated)
- **Constitution compliance**: 0 direct violations across 5 principles checked (CQ-001 is a quality issue warranting extraction, not a constitutional violation per se — the constitution says "three similar lines" are fine, but 130 duplicated lines is well past that threshold)

---

## Remediation Decisions

For each item below, choose an action:
- **fix**: Create a remediation task
- **spec**: Update the spec to match the implementation
- **skip**: Accept and take no action
- **split**: Fix part, update spec part

### 1. [SD-001] Empty nodes array silently accepted when target.kind='nodes'
**Location**: `src/mcp/server.ts:69`
**Spec says**: Edge case: "The system returns a parse error indicating that node names are required when target kind is 'nodes'."
**Code does**: Defaults to empty array `[]` and proceeds.

Action: fix / spec / skip / split

### 2. [SD-002] validate tool never returns success:false for file-not-found or parse errors
**Location**: `src/mcp/server.ts:89-104`
**Spec says**: US1-3: "returns `{ success: false, error: { type: 'workflow_not_found' } }`", US1-4: "returns `{ success: false, error: { type: 'parse_error' } }`"
**Code does**: `interpret()` catches these errors and returns `{ success: true, data: { status: 'error' } }`. This is correct behavior per FR-003 ("validation failure is a successful tool invocation"), but the acceptance scenarios contradict it.

Action: fix / spec / skip / split

### 3. [CQ-001] ~130 lines of duplicated logic between MCP server and CLI commands
**Location**: `src/mcp/server.ts:143-277` and `src/cli/commands.ts:65-204`
**Issue**: `buildTrustStatusReport` and `buildGuardrailExplanation` are copy-pasted between MCP and CLI. These should be shared functions called by both surfaces. Constitution III says abstractions need >=2 consumers — this has exactly 2.

Action: fix / spec / skip / split

### MEDIUM / LOW Summary

- **CQ-002**: `{ kind: target.kind } as AgentTarget` drops `nodes` field — type-unsafe cast. Not a runtime bug currently.
- **CQ-003**: Direct-run detection in CLI uses fragile path suffix matching.
- **TQ-001**: Server tests couple to McpServer SDK internals (`_registeredTools`).
- **TQ-002**: "Reports trusted nodes" test only tests the untrusted path due to inability to mock `computeContentHash`.

Would you like to promote any MEDIUM findings to remediation tasks?
