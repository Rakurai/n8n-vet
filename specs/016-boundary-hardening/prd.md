# Remediation PRD A

## Title

Boundary Hardening and Safety Nets

## Purpose

This document defines the first remediation spec for the foundation repair program. It is the first unit of work because later architectural changes are unsafe without better public-boundary behavior and stronger test coverage around execution-facing entrypoints.

This PRD is standalone. It does not assume the reader has [audit.synthesis.md](./audit/audit.synthesis.md) open.

## Series Context

The codebase has strong top-level architecture: clear subsystem boundaries, disciplined shared types, discriminated unions, strong use of Zod at boundaries, and a coherent split between static analysis, trust, execution, diagnostics, and surfaces.

The main implementation problems driving the remediation series are:

1. MCP bootstrap and error-boundary behavior are inconsistent with the project’s fail-fast philosophy.
2. Graph traversal and slice construction logic are duplicated across multiple files.
3. Execution-facing entrypoints are under-tested relative to their importance.
4. Tests are not included in normal TypeScript typechecking.
5. The orchestrator has become a policy-and-plumbing god function.
6. Several convenience shortcuts leak abstraction intent and increase long-term fragility.

This PRD addresses items 1, 3, and 4 directly. It also lays the safety net required for later work on items 2, 5, and 6.

## Evidence Posture

The source audit work was reconciled using three evidence buckets:

- `Confirmed`: directly supported by current repository code and suitable to drive this PRD.
- `Probable`: worth preserving as backlog, but not strong enough to define this spec by itself.
- `Downgraded`: explicitly not a driver for this spec.

This PRD uses only confirmed findings as primary scope drivers.

## Problems This PRD Resolves

### Problem 1: MCP bootstrap silently degrades and propagates raw upstream error text

The MCP entrypoint currently falls back to static-only mode when n8n MCP connection setup fails. That behavior is implicit rather than explicit. The same path also embeds raw upstream MCP tool text into thrown errors, and those messages flow into MCP and CLI envelopes.

Verified evidence:

- [src/mcp/serve.ts](../../src/mcp/serve.ts) returns `undefined` from `connectToN8n()` on connection failure and still starts the server.
- [src/mcp/serve.ts](../../src/mcp/serve.ts) throws `Error` with raw MCP tool output text.
- [src/errors.ts](../../src/errors.ts) forwards error messages directly into public envelopes.

### Problem 2: Critical execution-facing entrypoints are under-tested

The code paths with the highest consequence for public behavior have weaker direct coverage than less critical supporting modules.

Verified evidence:

- There is no direct test file for [src/execution/lock.ts](../../src/execution/lock.ts).
- [src/mcp/server.ts](../../src/mcp/server.ts) registers a `test` tool that is not directly exercised in [test/mcp/server.test.ts](../../test/mcp/server.test.ts).
- [src/cli/commands.ts](../../src/cli/commands.ts) implements `runTest()` that is not directly exercised in [test/cli/commands.test.ts](../../test/cli/commands.test.ts).
- [src/mcp/serve.ts](../../src/mcp/serve.ts) has no direct bootstrap behavior tests.

### Problem 3: Tests are outside the normal compiler boundary

The repository’s main TypeScript configuration covers production code only, leaving tests outside the normal typecheck path.

Verified evidence:

- [tsconfig.json](../../tsconfig.json) includes `src` only.

## Goals

1. Make MCP bootstrap behavior explicit and deterministic.
2. Prevent raw upstream MCP tool payload text from leaking into public error envelopes.
3. Add direct execution-path tests for the most important public edges.
4. Bring tests under TypeScript typechecking.
5. Create the safety net needed before later structural refactors.

## Non-Goals

This PRD does not include:

- graph traversal or slice-semantics refactoring
- orchestrator decomposition
- execution ownership redesign
- dependency contract reshape
- broad dependency upgrades
- `.gitignore` hygiene expansion
- blanket replacement of generic `Error` usage
- plugin test redesign
- CLI format-output tightening beyond what is needed for direct execution-path tests

These items may still matter, but they are not the purpose of this spec.

## Scope

This PRD covers Unit 0 and Unit 1 of the remediation sequence.

### Unit 0: Safety Nets Before Structural Change

This unit exists to create the minimum test and type safety required before changing public execution behavior or core slice semantics.

Includes:

- direct tests for [src/execution/lock.ts](../../src/execution/lock.ts)
- direct CLI tests for `runTest()` in [src/cli/commands.ts](../../src/cli/commands.ts)
- direct MCP tests for the `test` tool in [src/mcp/server.ts](../../src/mcp/server.ts)
- direct bootstrap tests for [src/mcp/serve.ts](../../src/mcp/serve.ts)
- test typechecking via [tsconfig.json](../../tsconfig.json) or a dedicated test tsconfig

### Unit 1: Boundary Hardening

This unit makes bootstrap and error-boundary behavior explicit and safe before broader internal refactors.

Includes:

- explicit MCP bootstrap policy in [src/mcp/serve.ts](../../src/mcp/serve.ts)
- sanitized execution error mapping in [src/mcp/serve.ts](../../src/mcp/serve.ts) and [src/errors.ts](../../src/errors.ts)
- optional validated runtime config layer if the bootstrap redesign requires one

## Requirements

### Requirement A1: Define one explicit MCP bootstrap policy

The implementation must choose and encode exactly one policy for the case where remote MCP configuration exists but the connection cannot be established.

Allowed policy shapes:

- fail startup when MCP configuration is present but unusable, or
- start in an explicit degraded mode with surfaced diagnostic state and capability markers

Not allowed:

- silent downgrade with no surfaced behavior change

### Requirement A2: Sanitize upstream MCP errors before envelope mapping

Errors coming back from remote MCP tools must not be surfaced unchanged to users or agents through the public MCP or CLI surface.

The implementation must:

- bound message size
- remove or normalize raw upstream payload text
- preserve enough information for actionability without echoing remote internals verbatim

### Requirement A3: Add direct tests for execution-facing entrypoints

The implementation must add direct tests covering:

- lock acquisition, release, contention, and stale-state handling
- CLI `runTest()` success and failure envelopes
- MCP `test` tool handler request plumbing and result mapping
- `serve.ts` bootstrap behavior for successful and failed remote connection setup

### Requirement A4: Bring tests under TypeScript typechecking

The implementation must ensure tests are typechecked in standard local and CI workflows.

Acceptable solutions:

- widen the existing typecheck coverage, or
- add a dedicated test tsconfig and wire it into scripts and CI

### Requirement A5: Allow small helper extraction only when it directly supports the unit

Shared test fixture extraction is permitted only where it reduces duplication caused by the new direct tests. It is not the primary goal of this PRD.

## Deferred Findings Related To This PRD

These items were preserved from the audit synthesis but are explicitly deferred here:

- runtime config centralization beyond what is needed for MCP/bootstrap hardening
- repeated test fixture builders outside the tests touched by this PRD
- CLI format-output contract tightening
- plugin-test concerns

## Downgraded Findings Explicitly Not Driving This PRD

These findings were deliberately excluded as primary spec drivers:

- generic `Error` usage everywhere is not the core issue
- `.gitignore` secret-pattern expansion is hygiene, not a boundary-hardening objective

## Dependency Position

This PRD is first in the remediation sequence.

Depends on:

- nothing

Enables:

- PRD B: traversal and orchestrator work
- PRD C: execution ownership and dependency contract reshape

## Acceptance Criteria

1. MCP startup behavior is deterministic and documented.
2. A failed MCP connection does not silently collapse into static-only mode.
3. Raw upstream MCP tool payload text is not exposed unchanged in public envelopes.
4. `runTest()` has direct CLI-level coverage.
5. The MCP `test` handler is directly exercised by tests.
6. Lock lifecycle behavior is directly covered by tests.
7. `serve.ts` bootstrap behavior is directly covered by tests.
8. Tests are included in the project’s normal TypeScript typechecking workflow.

## Verification

- `npm run typecheck` covers production code and tests.
- execution-facing entrypoints have direct tests for success and failure behavior.
- MCP bootstrap behavior is explicit and documented.
- no raw upstream MCP tool payload text leaks into public-facing error envelopes.

## Output Of This PRD

If successful, this PRD leaves the codebase in a state where later structural work can happen with less public-edge risk and better regression detection.
