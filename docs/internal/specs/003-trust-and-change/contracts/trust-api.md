# Trust & Change Subsystem — Public API Contract

**Feature**: 003-trust-and-change
**Date**: 2026-04-18

This subsystem exposes its functionality as module-level functions (per CODING.md: no classes with single methods). All functions are imported directly from their source modules, not through barrel files.

## Module: `src/trust/hash.ts`

### `computeContentHash(node: GraphNode, ast: WorkflowAST): string`

Compute SHA-256 hash of a node's trust-relevant properties.

**Input**: A `GraphNode` from the workflow graph plus the original `WorkflowAST` (for execution settings not on `GraphNode`).
**Output**: Hex-encoded SHA-256 hash string.
**Throws**: `ContentHashError` if canonical serialization fails.

**Contract**:
- Includes: `type`, `typeVersion`, `parameters`, `credentials`, `disabled`, `retryOnFail`, `executeOnce`, `onError`
- Excludes: `position`, `name`, `displayName`, `notes`, `notesInFlow`, `id`, `classification`
- Uses `json-stable-stringify` + SHA-256 to match n8nac `HashUtils.computeHash()` behavior
- Deterministic: same input always produces same output regardless of property insertion order

### `computeConnectionsHash(graph: WorkflowGraph): string`

Compute SHA-256 hash of the full connection topology.

**Input**: The `WorkflowGraph`.
**Output**: Hex-encoded SHA-256 hash string.

**Contract**:
- Hashes the complete forward adjacency map (sorted by node name, edges sorted by output index)
- Deterministic regardless of Map iteration order

### `computeWorkflowHash(graph: WorkflowGraph): string`

Compute a composite workflow hash for quick-check short-circuiting.

**Input**: The `WorkflowGraph`.
**Output**: Hex-encoded SHA-256 hash string.

**Contract**:
- Composed from sorted node content hashes + connections hash
- If this hash matches between two snapshots, no node-level diffing is needed

---

## Module: `src/trust/change.ts`

### `computeChangeSet(previous: WorkflowGraph, current: WorkflowGraph): NodeChangeSet`

Compute the diff between two workflow snapshots.

**Input**: Two `WorkflowGraph` instances (previous and current).
**Output**: `NodeChangeSet` with `added`, `removed`, `modified` (sub-classified), and `unchanged` arrays.

**Contract**:
- Performs workflow-level quick check first; short-circuits with empty change set on hash match
- Indexes nodes by name for cross-snapshot comparison
- Classifies modifications with one or more `ChangeKind` values per node
- Applies rename detection: removed+added pairs with identical `type`, `typeVersion`, `parameters` are treated as renames
- Detects connection changes for nodes whose content hash is unchanged but topology differs
- Expression changes detected by walking parameter trees for `={{ }}` pattern differences

---

## Module: `src/trust/trust.ts`

### `recordValidation(state: TrustState, nodes: NodeIdentity[], graph: WorkflowGraph, layer: ValidationLayer, runId: string, fixtureHash: string | null): TrustState`

Record trust from a successful validation run.

**Input**: Current trust state, validated node identities, the graph (for computing content hashes), validation layer, run ID, and fixture hash.
**Output**: New `TrustState` with updated trust records for the validated nodes.

**Contract**:
- Creates `NodeTrustRecord` for each specified node
- Replaces existing records if present
- Does NOT mutate the input `TrustState` (returns a new instance)
- Caller is responsible for excluding mocked/skipped nodes from the `nodes` list

### `invalidateTrust(state: TrustState, changeSet: NodeChangeSet, graph: WorkflowGraph): TrustState`

Apply forward-only trust invalidation based on detected changes.

**Input**: Current trust state, change set, and workflow graph (for adjacency traversal).
**Output**: New `TrustState` with invalidated records removed.

**Contract**:
- Seeds invalidation from: trust-breaking modified nodes, added nodes, connection-changed nodes
- `position-only` and `metadata-only` changes are trust-preserving (not seeded)
- BFS forward through `graph.forward` adjacency
- Removes trust records for all nodes in the final invalidation set
- Removes stale records for nodes no longer in the graph
- Does NOT mutate the input `TrustState`

### `isTrusted(state: TrustState, node: NodeIdentity, currentHash: string): boolean`

Check if a node is currently trusted.

**Input**: Trust state, node identity, and the node's current content hash.
**Output**: `true` if a trust record exists AND its `contentHash` matches `currentHash`.

### `getTrustedBoundaries(state: TrustState, graph: WorkflowGraph, scope: Set<NodeIdentity>, currentHashes: Map<NodeIdentity, string>): NodeIdentity[]`

Find trusted nodes at the edge of the trusted region.

**Input**: Trust state, graph, scope of interest, and current content hashes for nodes in scope.
**Output**: Array of trusted nodes (within or adjacent to scope) that have at least one untrusted downstream neighbor.

### `getUntrustedNodes(state: TrustState, scope: Set<NodeIdentity>, currentHashes: Map<NodeIdentity, string>): NodeIdentity[]`

Find untrusted nodes within a scope.

**Input**: Trust state, scope, and current hashes.
**Output**: Array of nodes in scope that are not trusted.

### `getRerunAssessment(state: TrustState, target: NodeIdentity[], currentHashes: Map<NodeIdentity, string>, fixtureHash: string | null): RerunAssessment`

Evaluate whether re-validating a target is likely low-value.

**Input**: Trust state, target nodes, current hashes, and fixture hash.
**Output**: `RerunAssessment` with `isLowValue`, `confidence`, `reason`, and optional `suggestedNarrowedTarget`.

**Contract**:
- Checks trust-level conditions only: all target nodes trusted, fixture hash matches, no relevant changes
- Does NOT check failing-path relevance or failure-class (owned by guardrails, Phase 4)
- Returns `isLowValue: true` with high confidence when all conditions met
- Returns `isLowValue: false` when any target node is untrusted or hashes diverge

---

## Module: `src/trust/persistence.ts`

### `loadTrustState(workflowId: string, dataDir?: string): TrustState`

Load trust state from the local JSON file.

**Input**: Workflow ID and optional data directory override (defaults to `.n8n-check/`).
**Output**: `TrustState` for the specified workflow.

**Contract**:
- Missing file → returns empty trust state (no error)
- Schema version mismatch → discards file, returns empty trust state (no error)
- Corrupt file (invalid JSON or Zod validation failure) → throws `TrustPersistenceError`
- Workflow ID not in file → returns empty trust state (no error)
- Converts persisted `Record<string, NodeTrustRecord>` to `Map<NodeIdentity, NodeTrustRecord>`

### `persistTrustState(state: TrustState, workflowHash: string, dataDir?: string): void`

Write trust state to the local JSON file.

**Input**: Trust state to persist, the composite workflow hash, and optional data directory.
**Output**: None (writes file).

**Contract**:
- Creates directory if it does not exist
- Reads existing file to preserve other workflows' trust state
- Merges the specified workflow's state into the store
- Writes with `schemaVersion: 1`
- Converts `Map<NodeIdentity, NodeTrustRecord>` to `Record<string, NodeTrustRecord>` for JSON

---

## Module: `src/trust/errors.ts`

### `TrustPersistenceError`

Typed error for corrupt or unreadable trust state files.

**Properties**: `name: 'TrustPersistenceError'`, `filePath: string`, `cause: Error`

### `ContentHashError`

Typed error for content hash computation failures.

**Properties**: `name: 'ContentHashError'`, `nodeName: string`, `cause: Error`
