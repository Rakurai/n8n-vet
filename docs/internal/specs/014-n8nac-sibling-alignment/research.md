# Research: n8nac Sibling Alignment

**Feature**: 014-n8nac-sibling-alignment  
**Date**: 2026-04-19

## R1: WorkflowAST metadata.id availability

**Decision**: Extract `n8nWorkflowId` from `graph.ast.metadata.id` in `interpret.ts` after graph construction.

**Rationale**: `WorkflowAST.metadata` is typed as `WorkflowMetadata` with `id: string` (required field in `@n8n-as-code/transformer` types). The `graph.ast` reference is already available in `interpret()` at line 59. The ID comes from the `@workflow({ id })` decorator — populated by n8nac on first `push`. Before push, the field may be an empty string (TypeScript type says `string`, not `string | undefined`).

**Alternatives considered**:
- Parse the `.ts` file a second time to extract the decorator — rejected, AST already available via graph.
- Add a new `resolveN8nId()` function — rejected, single-use extraction doesn't warrant a helper (Constitution III).

## R2: Empty vs. missing metadata.id detection

**Decision**: Treat empty string (`''`) and whitespace-only as equivalent to "missing". Check with `graph.ast.metadata.id.trim()` before execution calls.

**Rationale**: n8nac's transformer always populates `metadata.id` as a string. Before first push, it's `''` (empty string). After push, it's a UUID like `'abc123-...'`. Whitespace-only would be a bug but should be handled identically.

**Alternatives considered**:
- Check for `undefined` — rejected, type is `string` (not optional), so only empty string is the real case.
- Throw an error — rejected, Constitution I says fail-fast but `interpret()` uses `errorDiagnostic()` return pattern (never throws for foreseeable failures, per its doc comment).

## R3: JSON parser removal scope

**Decision**: Remove `parseJsonFile()` entirely. Update `parseWorkflowFile()` to reject non-`.ts` extensions with `MalformedWorkflowError`. Remove JSON fixture tests.

**Rationale**: `parseJsonFile()` is dead code — no path in the agent workflow produces a local `.json` file. n8nac `pull` produces `.ts` files. The JSON parser depends on `JsonToAstParser` from transformer, adding unnecessary coupling.

**Alternatives considered**:
- Keep as deprecated with a warning — rejected, dead code should be removed (CLAUDE.md: "Refactoring: Update interfaces everywhere, remove dead code, no compatibility shims").

## R4: N8N_HOST / N8N_API_KEY env vars

**Decision**: Do NOT add `N8N_HOST` or `N8N_API_KEY` to `.env.example`. They are not read by any source code.

**Rationale**: Grep across `src/` for `N8N_HOST` and `N8N_API_KEY` returns zero matches. MCP connectivity is handled via the `callTool` function passed into `interpret()` by the caller (MCP client or test harness). The n8n instance connection is configured at the MCP transport level, not by n8n-vet. The `.env.example` correctly documents only `N8N_VET_DATA_DIR`.

**Alternatives considered**:
- Add them anyway for documentation completeness — rejected, documenting unused vars creates confusion.

## R5: Documentation files needing update

**Decision**: Update `docs/DESIGN.md`, `docs/TECH.md`, `docs/SCOPE.md`, `docs/CONCEPTS.md`, `docs/prd/PLAN.md`, and `README.md`. Also update stale references in `docs/reference/execution.md` and `docs/reference/static-analysis.md`.

**Rationale**: Research found:
- `docs/DESIGN.md:76-82` — describes "n8nac (dependency)" framing
- `docs/reference/execution.md:293-294` — mentions `@n8n-as-code/skills` for pin data
- `docs/reference/static-analysis.md:224,240,285` — references skills package
- `README.md:61` — says "TypeScript or JSON via n8n-as-code"

**Alternatives considered**:
- Only update the four docs listed in PRD — rejected, reference docs also have stale claims that would contradict the corrected top-level docs.
