# Data Model: Trust & Change Subsystem

**Feature**: 003-trust-and-change
**Date**: 2026-04-18

## Existing Types (from Phase 1, `src/types/trust.ts`)

These types are already defined and will be used as-is. No modifications needed.

### TrustState
Per-workflow trust state. The in-memory representation.

| Field | Type | Description |
|-------|------|-------------|
| `workflowId` | `string` | Workflow identifier |
| `nodes` | `Map<NodeIdentity, NodeTrustRecord>` | Per-node trust records |
| `connectionsHash` | `string` | SHA-256 hash of full connection topology |

### NodeTrustRecord
Trust evidence for a single node.

| Field | Type | Description |
|-------|------|-------------|
| `contentHash` | `string` | SHA-256 of trust-relevant properties at validation time |
| `validatedBy` | `string` | Validation run ID that established trust |
| `validatedAt` | `string` | ISO 8601 timestamp |
| `validationLayer` | `ValidationLayer` | `'static'` | `'execution'` | `'both'` |
| `fixtureHash` | `string \| null` | Hash of fixture/pin-data; null for static-only |

### NodeChangeSet
Diff between two workflow snapshots.

| Field | Type | Description |
|-------|------|-------------|
| `added` | `NodeIdentity[]` | Nodes new in current snapshot |
| `removed` | `NodeIdentity[]` | Nodes absent from current snapshot |
| `modified` | `NodeModification[]` | Nodes with changes (sub-classified) |
| `unchanged` | `NodeIdentity[]` | Nodes identical in both snapshots |

### NodeModification
A changed node with its specific change kinds.

| Field | Type | Description |
|-------|------|-------------|
| `node` | `NodeIdentity` | The changed node |
| `changes` | `ChangeKind[]` | One or more change kinds (can be multiple) |

### ChangeKind
Discriminant for type of change. `position-only` and `metadata-only` are trust-preserving; all others are trust-breaking.

Values: `'parameter'` | `'expression'` | `'connection'` | `'type-version'` | `'credential'` | `'execution-setting'` | `'position-only'` | `'metadata-only'`

## New Internal Types (defined in `src/trust/`)

### RerunAssessment
Returned by `getRerunAssessment`. Consumed by guardrails (Phase 4).

| Field | Type | Description |
|-------|------|-------------|
| `isLowValue` | `boolean` | Whether re-validation is likely low-value |
| `confidence` | `'high' \| 'medium'` | Confidence in the assessment |
| `reason` | `string` | Human/agent-readable explanation |
| `suggestedNarrowedTarget` | `NodeIdentity[] \| null` | Suggested narrower target, if applicable |

### PersistedTrustStore
The on-disk representation of trust state. Differs from in-memory `TrustState` (uses plain objects instead of Maps).

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `number` | Schema version for forward compatibility (current: 1) |
| `workflows` | `Record<string, PersistedWorkflowTrust>` | Per-workflow trust, keyed by workflow ID |

### PersistedWorkflowTrust
Single workflow's trust state in persisted form.

| Field | Type | Description |
|-------|------|-------------|
| `workflowId` | `string` | Workflow identifier |
| `workflowHash` | `string` | Composite hash for quick-check short-circuit |
| `connectionsHash` | `string` | Hash of connection topology |
| `nodes` | `Record<string, NodeTrustRecord>` | Per-node records (plain object, not Map) |

### TrustPersistenceError
Typed error for corrupt trust state files.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `'TrustPersistenceError'` | Error class discriminant |
| `filePath` | `string` | Path to the corrupt file |
| `cause` | `Error` | Original parse error |

### ContentHashError
Typed error for serialization failures during content hashing.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `'ContentHashError'` | Error class discriminant |
| `nodeName` | `string` | Node that failed to hash |
| `cause` | `Error` | Original serialization error |

## State Transitions

### Trust Record Lifecycle

```
[absent] ──recordValidation()──→ [trusted]
[trusted] ──invalidateTrust()──→ [absent]
[trusted] ──content hash mismatch──→ [effectively untrusted] (isTrusted returns false)
[trusted] ──node removed from graph──→ [stale, removed during change detection]
[trusted] ──recordValidation()──→ [trusted] (replaced with newer record)
```

### Change Detection Flow

```
Two WorkflowGraph snapshots
    │
    ├─ Workflow-level quick check (hash comparison)
    │   └─ Match → empty NodeChangeSet (short-circuit)
    │
    └─ No match → node-level diff
        ├─ Index by name
        ├─ Compute added (in current, not in previous)
        ├─ Compute removed (in previous, not in current)
        ├─ For common nodes: compare content hashes
        │   ├─ Match → unchanged
        │   └─ Mismatch → classify change kinds
        ├─ Check connections hash for unchanged nodes → connection change kind
        └─ Apply rename detection (removed+added with matching content)
```

### Trust Invalidation Flow

```
NodeChangeSet + TrustState + WorkflowGraph
    │
    ├─ Seed invalidation set:
    │   ├─ Nodes with trust-breaking changes
    │   ├─ Added nodes (never validated)
    │   └─ Nodes with connection changes
    │
    └─ BFS forward through graph:
        For each node in invalidation set:
            Follow forward adjacency edges
            Add downstream trusted nodes to set
            Continue BFS from newly added nodes
        │
        └─ Remove trust records for all nodes in final set
```

## Relationships

```
WorkflowGraph (Phase 2, input)
    │
    ├── consumed by ──→ change.ts (computeChangeSet)
    ├── consumed by ──→ hash.ts (computeContentHash, computeConnectionsHash)
    └── consumed by ──→ trust.ts (invalidateTrust, getTrustedBoundaries)

TrustState (in-memory)
    │
    ├── read/written by ──→ trust.ts (recordValidation, invalidateTrust, queries)
    ├── serialized by ──→ persistence.ts (persistTrustState)
    └── deserialized by ──→ persistence.ts (loadTrustState)

PersistedTrustStore (on-disk)
    │
    └── validated by ──→ persistence.ts (Zod schema at boundary)

NodeChangeSet (output)
    │
    ├── consumed by ──→ trust.ts (invalidateTrust)
    └── consumed by ──→ Phase 4 Guardrails (evaluate)
```
