# Research: Test Suite Audit

**Feature**: 013-test-suite-audit  
**Date**: 2026-04-19

## R1: Dead Code Status

**Decision**: R1 is already complete — no work needed.

**Rationale**: Phase-12 has already removed all `executeBounded`, `destinationNode`, `destinationMode` references from source and tests. The `test/execution/rest-client.test.ts` file no longer exists. Integration scenario 06 has been rewritten.

**Alternatives considered**: N/A — verified by grep across entire codebase.

## F2: Pipeline Precedence Test Rewrite Strategy

**Decision**: Rewrite the test at evaluate.test.ts:367 to actually test Step 4 (narrow).

**Rationale**: The current test labeled "Step 4 wins" uses `layer: 'execution'` with shape-preserving changes, which triggers Step 3 (redirect) — identical to the test at line 352. The existing Step 5 pipeline test at line 385 demonstrates the correct narrow test pattern: `largeGraph()`, partial trust, `layer: 'static'`, specific change set.

**Alternatives considered**: Deleting the test was acceptable per PRD, but rewriting maintains the pipeline's step-by-step precedence coverage (Step 1 through Step 8).

## A2: Expression Extractor Testing Approach

**Decision**: Test through the public `traceExpressions()` API using `makeGraph()` helper.

**Rationale**: The three extractor functions (`extractBinaryRefs`, `extractItemsRefs`, `extractNodeDotRefs`) are private. The only export is `traceExpressions()`. Existing tests already use this pattern — construct a graph with specific parameters containing expressions, call `traceExpressions`, assert on the returned `ExpressionReference[]`.

**Alternatives considered**: Exporting the private functions for direct testing would violate the project's "no over-engineering" principle and expose internal implementation details.

## A4: Trust-Boundary Hash Computation

**Decision**: Use `computeContentHash` from the trust module to generate real hashes for the test fixture's minimal AST.

**Rationale**: The incomplete test's comments (resolve.test.ts:335-339) explain the challenge: `computeContentHash` operates on AST structures, and the test's minimal AST yields deterministic but non-trivial hashes. The approach is to compute the hash at test time for the known fixture nodes, then insert trust records with those hashes. The trust module's own tests (`test/trust/hash.test.ts`, `test/trust/trust.test.ts`) demonstrate this pattern.

**Alternatives considered**: Using dummy/hardcoded hashes would be fragile and break if the hash algorithm changes.

## Classify Tests: Public API Access

**Decision**: Test `classifyMergeNode()` through the public `classifyNode()` function.

**Rationale**: `classifyMergeNode()` is a private function called by `classifyNode()` when the node type is `n8n-nodes-base.merge`. Existing classify tests use `classifyNode()` with `makeNode({ type: '...' })`. The merge tests follow the same pattern with `parameters: { mode: '...' }`.

**Alternatives considered**: N/A — this is the only viable approach given the module's export surface.
