# Research: Shared Cross-Subsystem Types

**Feature**: 001-shared-types | **Date**: 2026-04-18

## R1: @n8n-as-code/transformer Type Availability

**Decision**: Import `WorkflowAST`, `NodeAST`, `ConnectionAST` directly from `@n8n-as-code/transformer`.

**Rationale**: The transformer package (installed as `file:../n8n-as-code/packages/transformer`) exports all three types from its main entry point. Verified in `src/types.ts` → re-exported via `src/index.ts`. The types are stable AST intermediates — the core data model the transformer is built around.

**Key type shapes confirmed**:
- `WorkflowAST`: `{ metadata: WorkflowMetadata; nodes: NodeAST[]; connections: ConnectionAST[] }`
- `NodeAST`: includes `propertyName` (graph key), `displayName`, `type`, `version`, `parameters`, `credentials`, `onError`, execution settings (`executeOnce`, `retryOnFail`, etc.)
- `ConnectionAST`: `{ from: { node, output, isError? }; to: { node, input } }`

**Alternatives considered**:
- Define local stub types for WorkflowAST/NodeAST/ConnectionAST → rejected. The real types are available and pinned via `file:` reference. Stubs would drift from the actual shapes.

## R2: NodeIdentity Branded Type Pattern

**Decision**: Use TypeScript's intersection branding pattern: `type NodeIdentity = string & { readonly __brand: 'NodeIdentity' }`. Provide a single factory function `nodeIdentity(name: string): NodeIdentity` for construction.

**Rationale**: This is the standard TypeScript pattern for nominal typing via structural type system. The `__brand` property exists only at the type level — no runtime overhead. The factory function is the single point of construction, enforcing that NodeIdentity values are created intentionally.

**Alternatives considered**:
- Opaque type via `unique symbol` — more complex, no practical benefit for this use case.
- No branding (plain string alias) — rejected per spec FR-003; allows accidental wrong-string-kind bugs.

## R3: Discriminated Union Pattern Confirmation

**Decision**: Use literal type discriminants on intersection types, matching the INDEX.md patterns exactly.

**Rationale**: INDEX.md already defines well-structured discriminated unions:
- `GuardrailDecision`: discriminant field `action` with 5 variants, each extending `GuardrailDecisionBase`
- `DiagnosticError`: discriminant field `classification` with 7 variants, each extending `DiagnosticErrorBase`
- `ValidationTarget`: discriminant field `kind` with 4 variants
- `AgentTarget`: discriminant field `kind` with 3 variants

TypeScript narrows these correctly when the discriminant is a literal type. No special patterns needed beyond what INDEX.md specifies.

**Alternatives considered**: None — the INDEX.md patterns are idiomatic TypeScript.

## R4: File Organization — No Barrel File

**Decision**: Organize types into 7 files by domain concept. No `index.ts` barrel in `src/types/`. Internal imports use direct paths. Package entry point `src/index.ts` re-exports the public API for external consumers.

**Rationale**: CODING.md explicitly prohibits barrel files (`index.ts` that re-exports a directory). The only acceptable barrel is the package entry point. Internal code imports directly from source files with `.js` extensions (ESM convention).

**Alternatives considered**:
- Single `types.ts` file — rejected. Would become a 400+ line file mixing unrelated domains.
- Barrel `src/types/index.ts` — prohibited by CODING.md.

## R5: Map vs Record for Keyed Collections

**Decision**: Use `Map<string, T>` and `Map<NodeIdentity, T>` as specified in INDEX.md.

**Rationale**: INDEX.md explicitly uses `Map` for `WorkflowGraph.nodes`, `WorkflowGraph.forward`, `WorkflowGraph.backward`, and `TrustState.nodes`. Maps provide correct semantics for keyed lookups, preserve insertion order, and work naturally with `NodeIdentity` branded types as keys. `Record<string, T>` would lose the branded key type information.

**Alternatives considered**:
- `Record<string, GraphNode>` — loses `NodeIdentity` key branding on `TrustState.nodes`. Also, `Record` does not guarantee key existence at the type level without additional index signature handling.

## R6: Type-Level Testing Strategy

**Decision**: Use vitest with `expectTypeOf` for type-level assertions. Use `.test-d.ts` file extension for type-only test files (vitest convention for type-checking tests).

**Rationale**: vitest natively supports type-level testing via `expectTypeOf()` from `vitest`. The `.test-d.ts` extension signals that these tests are type-check-only (no runtime execution). This avoids adding a separate tool like `tsd` or `@ts-expect-error` comment hacks.

**Tests needed**:
- Each variant of `GuardrailDecision` narrows to the correct shape
- Each variant of `DiagnosticError` narrows to the correct context shape
- Each variant of `ValidationTarget` and `AgentTarget` narrows correctly
- `string` is not assignable to `NodeIdentity`
- `NodeIdentity` is assignable to `string` (structural compatibility)

**Alternatives considered**:
- `tsd` package — adds a dependency for something vitest handles natively.
- `@ts-expect-error` comments — brittle and doesn't verify the positive (correct narrowing) case.
