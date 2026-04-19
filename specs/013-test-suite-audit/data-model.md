# Data Model: Test Suite Audit

**Feature**: 013-test-suite-audit  
**Date**: 2026-04-19

## Overview

This feature is a test audit — it modifies test files, not domain entities. No new data models, entities, or state transitions are introduced.

## Affected Test Fixtures

### Merge Node Test Fixtures (A1)

New test inputs for `classifyNode()`:
- `makeNode({ type: 'n8n-nodes-base.merge', parameters: { mode: '<mode>' } })`
- 5 modes: `append`, `chooseBranch`, `combineByPosition`, `combineByFields`, `combineBySql`
- Expected outputs: `'shape-preserving'`, `'shape-augmenting'`, `'shape-replacing'`

### Expression Test Fixtures (A2)

New graph nodes with expression-containing parameters:
- `$binary.data` → `ExpressionReference` with `resolved: false`
- `$items("NodeName")` → `ExpressionReference` with `resolved: true` (if display name resolves)
- `$node.DisplayName.json.field` → `ExpressionReference` with `resolved: true` (if display name resolves)

### Redirect Test Fixtures (A3)

New redirect evaluation input:
- Branching node with `ExpressionReference` where `resolved: false`, `referencedNode: null`
- Upstream node classified as `'shape-opaque'`

### Trust-Boundary Test Fixtures (A4)

Extended trust state for `resolveTarget()`:
- Content hashes computed via `computeContentHash()` for boundary nodes A and D
- Trust records with matching hashes inserted into trust state
