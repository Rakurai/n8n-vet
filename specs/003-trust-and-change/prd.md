# Phase 3 — Trust & Change

## Goal

Implement the trust and change subsystem: local trust state persistence, node-level change detection between workflow snapshots, and forward-only trust invalidation when changes break previously established trust.

## Context Files

| File | Role |
|------|------|
| `docs/reference/INDEX.md` | Shared type definitions (`TrustState`, `NodeTrustRecord`, `NodeChangeSet`, `NodeModification`, `ChangeKind`, `WorkflowGraph`, `GraphNode`, `Edge`, `NodeIdentity`, `ValidationLayer`) |
| `docs/CODING.md` | TypeScript rules — fail-fast, contract-driven, no fallbacks, no phantom implementations |
| `docs/CONCEPTS.md` | Shared vocabulary — trusted boundary, validation locality, low-value rerun, redundant validation |
| `docs/STRATEGY.md` | Trust model, forward-only invalidation, change-based validation, rerun suppression heuristics, CDCT-derived trust boundaries |

## Scope

**In scope:**
- Content hashing for trust-relevant node properties (SHA-256 over canonical JSON)
- Connections hash computation for topology change detection
- Node-level change detection between two `WorkflowGraph` snapshots (added, removed, modified with sub-classification, unchanged)
- Rename detection for removed+added pairs with identical content hashes
- Trust derivation from successful validation results
- Forward-only trust invalidation via BFS through the workflow graph
- Trust state persistence to local JSON file
- Trust queries: `isTrusted`, `getTrustedBoundaries`, `getUntrustedNodes`, `getRerunAssessment`
- Workflow-level quick check via full workflow hash before node-level diff

**Out of scope:**
- How guardrails consume trust state (Phase 4)
- How request interpretation loads/saves trust (Phase 7)
- Plugin storage variant details (Phase 9) — storage path is configurable via `N8N_VET_DATA_DIR`

## Inputs and Outputs

### Inputs

- **Two `WorkflowGraph` snapshots** (previous and current) for change detection. Each contains a `nodes` map keyed by node name, plus `forward` and `backward` adjacency maps.
- **Persisted `TrustState`** loaded from local storage (`.n8n-vet/trust-state.json` or `$N8N_VET_DATA_DIR/trust-state.json`).
- **Validation results** from completed runs: node identities, validation layer, fixture hash, and run metadata — used to record new trust.

### Outputs

- **`NodeChangeSet`** — what changed between two snapshots (added, removed, modified with sub-classification, unchanged).
- **Updated `TrustState`** — with invalidations applied or new trust recorded.
- **Trust query results** — boolean trust checks, boundary identification, untrusted node lists, rerun assessments.

## Internal Types

### RerunAssessment

Returned by `getRerunAssessment`. Used by guardrails (Phase 4) to decide whether a validation request is low-value.

```typescript
interface RerunAssessment {
  isLowValue: boolean;
  confidence: 'high' | 'medium';
  reason: string;
  suggestedNarrowedTarget: NodeIdentity[] | null;
}
```

## Upstream Interface Summary

### WorkflowGraph

The traversable graph representation received as input from static analysis (Phase 2). This subsystem does not build it.

```typescript
interface WorkflowGraph {
  nodes: Map<string, GraphNode>;    // All nodes, keyed by node name
  forward: Map<string, Edge[]>;     // Forward adjacency: source → outgoing edges
  backward: Map<string, Edge[]>;    // Backward adjacency: destination → incoming edges
  ast: WorkflowAST;                 // Original AST (retained for format conversion)
}
```

`GraphNode` carries `name`, `displayName`, `type`, `typeVersion`, `parameters`, `credentials`, `disabled`, and `classification`. `Edge` carries `from`, `fromOutput`, `isError`, `to`, `toInput`. Full definitions in `docs/reference/INDEX.md`.

## Behavior

### 1. Node identity

Nodes are identified by `NodeIdentity` (branded string matching `propertyName`). This is the stable graph key used in connection references and cross-snapshot comparison.

**Rename handling:** A removed+added pair with identical content hashes (same `type`, `typeVersion`, `parameters`) is treated as a rename. The trust record transfers from the old name to the new name. When multiple candidates match, resolve greedily by insertion order.

### 2. Content hashing

SHA-256 over canonically serialized trust-relevant node properties.

**Included properties:** `type`, `typeVersion`, `parameters`, `credentials`, execution settings (`disabled`, `retryOnFail`, `executeOnce`, `onError`).

**Excluded properties:** `position`, `name`, `notes`/`notesInFlow`, node `id`.

**Serialization:** Canonical JSON with sorted keys (`json-stable-stringify` or equivalent) piped through SHA-256. Must match `n8nac`'s `HashUtils.computeHash()` behavior.

**Connections hash:** The full connection topology is hashed separately. Connection changes are detected by comparing the connections hash between snapshots.

### 3. Change detection

Given two `WorkflowGraph` snapshots (previous and current):

1. **Index both by node name.**
2. **Compute added nodes** — present in current, absent from previous.
3. **Compute removed nodes** — present in previous, absent from current.
4. **For common nodes, compare content hashes:**
   - Identical hash: unchanged.
   - Different hash: classify the change kind(s) — `parameter`, `expression`, `type-version`, `credential`, `execution-setting`, `position-only`, `metadata-only`. A single node modification may carry multiple `ChangeKind` values simultaneously (e.g., a node with both a changed parameter and a changed credential gets `['parameter', 'credential']`).
5. **For unchanged nodes:** check if connections changed (connections hash differs). If so, add a `connection` change kind.
6. **Apply rename detection:** For each removed+added pair where both have identical `type`, `typeVersion`, and `parameters` — treat as rename, transfer trust record. Match greedily by insertion order.
7. **Classify trust-breaking vs. trust-preserving:** All change kinds are trust-breaking except `position-only` and `metadata-only`.

**Workflow-level quick check:** Before performing node-level diffing, compare a full workflow hash. If identical, short-circuit with an empty change set.

### 4. Trust derivation

Trust is established by successful validation:

1. For each validated node (not mocked, not skipped): create a `NodeTrustRecord` containing the node's current content hash, the validation run ID, timestamp (ISO 8601), validation layer (`static` | `execution` | `both`), and fixture hash (null for static-only).
2. Update the `TrustState` by inserting or replacing the record in the `nodes` map.

Trust requires BOTH conditions: the node was validated AND the node has not changed (current content hash matches the recorded content hash).

### 5. Trust invalidation

Forward-only propagation through the workflow graph:

1. **Seed the invalidation set** with nodes that have trust-breaking changes.
2. **Add all added nodes** (new, never validated).
3. **Add nodes whose connections changed.**
4. **BFS forward through the graph:** For each invalidated node, follow `forward` adjacency edges. For each downstream node that has a trust record, add it to the invalidation set and continue BFS from that node.
5. **Remove trust records** for every node in the final invalidation set.

**Forward-only rule:** If B changes, C (downstream of B) is invalidated. If C changes, B (upstream of C) is NOT invalidated.

### 6. Trust queries

**`isTrusted(node: NodeIdentity): boolean`** — Returns true if and only if the node has a trust record in the current `TrustState` AND the recorded content hash matches the node's current content hash.

**`getTrustedBoundaries(graph: WorkflowGraph, scope: Set<NodeIdentity>): NodeIdentity[]`** — Returns trusted nodes (within or adjacent to scope) that have at least one untrusted downstream neighbor. These are the edges of the trusted region where validation should begin.

**`getUntrustedNodes(scope: Set<NodeIdentity>): NodeIdentity[]`** — Returns nodes within the given scope that are not currently trusted.

**`getRerunAssessment(target: NodeIdentity[], fixtureHash: string | null): RerunAssessment`** — Evaluates whether re-validating the target would produce meaningful new information. A rerun is low-value when all of: same effective target as a prior run, same fixture hash, same trust state (no relevant change since last run), and the previous failing path did not touch the changed slice or the failure class is external/infrastructural. Returns a `RerunAssessment` with explanation and optional narrowed target.

### 7. Trust persistence

**Storage path:** `.n8n-vet/trust-state.json` (standalone default). Configurable via `N8N_VET_DATA_DIR` environment variable.

**Storage format:** Serialized `TrustState` per workflow, keyed by workflow ID.

**Write triggers:** After successful validation (recording new trust) and after invalidation (removing broken trust).

**Missing file handling:** Treated as empty trust state. No error.

**Corrupt file handling:** Raise a typed error with the file path and parse error details. Never silently discard.

**Locality:** Trust state is local to the project directory.

**Workflow-level quick check:** Store a full workflow hash alongside per-node records. Compare this hash before performing node-level diff to enable fast short-circuiting.

### 8. Trust lifetime

- **No expiration timer** — trust is invalidated only by detected changes, never by elapsed time.
- **Survives across sessions** — file-persisted, loaded on next validation.
- **Not branch-aware** — content hashing handles branch switches naturally (different content produces different hashes, triggering invalidation).
- **External edits** — detected on next validation via hash divergence between persisted trust records and current workflow content.

## Error Conditions

| Condition | Behavior |
|-----------|----------|
| Trust state file missing | Empty trust state. No error. |
| Trust state file corrupt (invalid JSON, schema mismatch) | Raise typed error with file path and parse details. |
| Workflow ID not found in trust state | Empty trust for that workflow. No error. |
| Content hash computation fails (serialization error) | Raise error — indicates a serialization bug. |
| Stale trust record (node no longer exists in current graph) | Remove the record during change detection. |

## Acceptance Criteria

- Content hashing produces stable, deterministic hashes for identical node content regardless of property insertion order.
- Change detection correctly classifies added, removed, modified (with sub-classification into `parameter`, `expression`, `type-version`, `credential`, `execution-setting`, `position-only`, `metadata-only`, `connection`), and unchanged nodes.
- Rename detection identifies removed+added pairs with matching type/typeVersion/parameters and transfers trust records from old name to new name.
- Trust invalidation propagates forward-only through the graph: downstream nodes lose trust, upstream nodes do not.
- Trust persistence round-trips to disk correctly (write then read produces equivalent state).
- Missing trust file starts with empty trust state (no error raised).
- Corrupt trust file raises a typed error with path and parse details (not silently ignored).
- `isTrusted` returns true only when a trust record exists AND the content hash matches.
- `getTrustedBoundaries` returns trusted nodes adjacent to untrusted downstream neighbors.
- `getUntrustedNodes` returns all nodes in scope without current trust.
- `getRerunAssessment` correctly identifies low-value reruns (same target, same fixture, no relevant changes) and suggests narrowed targets when applicable.
- All tests use graph fixtures. No n8n instance required.

## Decisions

1. **Multi-workflow trust:** No. Each workflow has its own independent trust state.
2. **Partial validation trust:** Yes. Trust is per-node, not per-path. A node validated on any path through it receives a trust record.
3. **Concurrent agents:** Last-write-wins. Losing a write means the affected nodes will be re-validated on the next run. This is safe — it causes redundant work, not incorrect results.
4. **External dependencies:** `json-stable-stringify` (or equivalent) for canonical JSON serialization. SHA-256 via Node.js `crypto` module (no additional dependency).
