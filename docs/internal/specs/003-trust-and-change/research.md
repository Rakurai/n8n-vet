# Research: Trust & Change Subsystem

**Feature**: 003-trust-and-change
**Date**: 2026-04-18

## R1: Canonical JSON Serialization for Content Hashing

**Decision**: Use `json-stable-stringify` as the canonical serialization library.

**Rationale**: n8nac's `HashUtils.computeHash()` (at `packages/cli/src/core/services/hash-utils.ts`) uses `json-stable-stringify` + SHA-256. Matching this behavior ensures hash compatibility between n8n-check and n8nac. The library recursively sorts object keys before stringifying, producing deterministic output regardless of property insertion order.

**Alternatives considered**:
- `fast-json-stable-stringify`: Faster but does not handle `toJSON` methods correctly in all edge cases. Risk of subtle hash divergence from n8nac.
- `JSON.stringify` with custom replacer + `Object.keys().sort()`: Manual implementation. More code, more bug surface, no benefit over proven library.
- Native `structuredClone` + sort: Does not produce canonical strings; only useful for deep comparison, not hashing.

## R2: Trust-Relevant vs Excluded Node Properties

**Decision**: Hash exactly these properties: `type`, `typeVersion`, `parameters`, `credentials`, `disabled`, `retryOnFail`, `executeOnce`, `onError`. Exclude: `position`, `name`, `displayName`, `notes`, `notesInFlow`, `id`, `classification`.

**Rationale**: The included set matches the phase-3 PRD definition and the feasibility research (section 4.2). These are the properties that affect execution behavior. `classification` is excluded because it is derived from `type` (computed by static analysis, not persisted in the workflow file). `name`/`displayName` are excluded because they are identity keys, not content — renaming is handled by the rename detection algorithm at the change-set level.

**Alternatives considered**:
- Including `name` in hash: Would cause all renames to appear as content changes. Renames are already handled by the remove+add pair detection.
- Including `classification`: Redundant — classification is deterministically derived from `type` and would just double-count type changes.

## R3: Execution Settings Location in GraphNode

**Decision**: Execution settings (`retryOnFail`, `executeOnce`, `onError`) are NOT currently fields on `GraphNode`. They must be extracted from the node's AST representation or from the `parameters` object.

**Rationale**: The `GraphNode` interface (at `src/types/graph.ts`) carries `disabled` but not `retryOnFail`, `executeOnce`, or `onError`. In n8n's data model, these are top-level properties on `INode`, not nested in `parameters`. The n8nac `NodeAST` should carry them. The content hash function needs access to the original AST node or these properties need to be added to `GraphNode`.

**Resolution**: The hash function will accept the raw `NodeAST` (accessible via `WorkflowGraph.ast.nodes`) to extract execution settings, rather than modifying `GraphNode` (which would be a cross-phase interface change). The `GraphNode` carries the properties needed for classification and expression resolution; the hash function needs the full node representation.

**Alternatives considered**:
- Extending `GraphNode` with execution settings: Would be cleaner for hashing but constitutes a Phase 1/2 interface change. Deferred — can be proposed as a follow-up if the AST approach proves awkward.
- Ignoring execution settings: Would miss trust-breaking changes like disabling retry on fail. Not acceptable per spec.

## R4: Expression Change Detection Heuristic

**Decision**: Detect expression changes by walking both parameter trees and comparing string values that match the `={{ }}` expression pattern. A parameter change that specifically involves expression content (addition, removal, or modification of `={{ ... }}` strings) receives the `expression` change kind in addition to `parameter`.

**Rationale**: The feasibility research (section 4.2) describes this approach. Expressions in n8n are strings prefixed with `=` (e.g., `={{ $json.name }}`). Walking the parameter tree recursively and checking for strings starting with `=` is sufficient to identify expression changes. A node can receive both `parameter` and `expression` change kinds simultaneously if both expression and non-expression parameters changed.

**Alternatives considered**:
- Full expression parsing: Over-engineered for change classification. The trust subsystem only needs to know "did an expression change?", not "what does the expression reference?". Expression reference analysis is Phase 2's responsibility.
- Treating all parameter changes as potential expression changes: Would inflate the `expression` change kind count. Distinguishing expression changes is useful for guardrail redirect decisions (STRATEGY.md escalation heuristic).

## R5: Persistence Schema Design

**Decision**: The persisted trust state file is a JSON object with top-level `schemaVersion` (number) and `workflows` (object keyed by workflow ID). Each workflow entry contains `workflowId`, `connectionsHash`, and `nodes` (object keyed by node name, since Map does not serialize to JSON natively).

**Rationale**: JSON does not support `Map` natively. The in-memory `TrustState` uses `Map<NodeIdentity, NodeTrustRecord>`, but the persisted form uses a plain object `Record<string, NodeTrustRecord>`. Conversion happens at the persistence boundary (load: object → Map, save: Map → object). Zod validates the persisted schema at the boundary.

**Alternatives considered**:
- Storing Map as array of entries: Less readable in JSON, no benefit for lookup.
- Using a database (SQLite): Over-engineered for a single small JSON file per project.
- Separate file per workflow: More files to manage, no benefit when workflows are small.

## R6: Workflow-Level Quick Check Implementation

**Decision**: Compute a full workflow hash by hashing the combined content hashes of all nodes (sorted by name) plus the connections hash. Store this as `workflowHash` in the persisted trust state. Compare before node-level diffing.

**Rationale**: If the workflow hash matches, no nodes changed and no connections changed — the entire change detection can be short-circuited. This is a constant-time check (single hash comparison) vs O(n) node-level diffing. The hash is composed from individual node hashes rather than re-hashing the full AST, so it can be computed incrementally if needed.

**Alternatives considered**:
- Hashing the full AST JSON: Would include excluded properties (position, notes). Would not match the per-node hash approach and could produce false "unchanged" results if excluded properties changed.
- Skipping the quick check: Simple but wasteful for the common case of running validation twice with no changes between runs.

## R7: `json-stable-stringify` Type Declarations

**Decision**: Install `json-stable-stringify` as a runtime dependency and `@types/json-stable-stringify` as a dev dependency.

**Rationale**: The package has well-maintained type declarations on DefinitelyTyped. The package itself is small (no transitive dependencies) and proven in the n8nac codebase.

**Alternatives considered**:
- Vendoring the sort+stringify logic: Eliminates a dependency but adds maintenance burden for no benefit. The library is 1 file, 0 transitive deps.
