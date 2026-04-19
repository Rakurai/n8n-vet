# Data Model: Shared Cross-Subsystem Types

**Feature**: 001-shared-types | **Date**: 2026-04-18

## Entity Map

This phase defines type-only entities (no persistence, no runtime state). All types are transcribed from `docs/reference/INDEX.md`. Relationships shown are structural (type references), not relational.

## Entities

### NodeIdentity

**File**: `src/types/identity.ts`

Branded string type representing a node's stable graph key (`propertyName` from n8nac).

| Field | Type | Notes |
|-------|------|-------|
| (value) | `string` | Base type |
| `__brand` | `'NodeIdentity'` (readonly) | Compile-time brand, no runtime representation |

**Factory**: `nodeIdentity(name: string): NodeIdentity` — casts a validated string to the branded type.

---

### WorkflowGraph

**File**: `src/types/graph.ts`

Central traversable graph representation built from parsed workflow files.

| Field | Type | Notes |
|-------|------|-------|
| `nodes` | `Map<string, GraphNode>` | All nodes, keyed by node name |
| `forward` | `Map<string, Edge[]>` | Forward adjacency: source → outgoing edges |
| `backward` | `Map<string, Edge[]>` | Backward adjacency: destination → incoming edges |
| `ast` | `WorkflowAST` | Original AST from `@n8n-as-code/transformer` |

**Dependencies**: Imports `WorkflowAST` from `@n8n-as-code/transformer`.

---

### GraphNode

**File**: `src/types/graph.ts`

A single node in the workflow graph.

| Field | Type | Notes |
|-------|------|-------|
| `name` | `string` | Property name — stable graph key |
| `displayName` | `string` | Human-readable name, used in expression resolution |
| `type` | `string` | n8n node type identifier |
| `typeVersion` | `number` | Node type version |
| `parameters` | `Record<string, unknown>` | Full node parameters |
| `credentials` | `Record<string, unknown> \| null` | Credential bindings |
| `disabled` | `boolean` | Whether node is disabled |
| `classification` | `NodeClassification` | Behavior classification for static analysis |

---

### NodeClassification

**File**: `src/types/graph.ts`

String literal union: `'shape-preserving' | 'shape-augmenting' | 'shape-replacing' | 'shape-opaque'`

---

### Edge

**File**: `src/types/graph.ts`

A directed connection between two nodes.

| Field | Type | Notes |
|-------|------|-------|
| `from` | `string` | Source node name |
| `fromOutput` | `number` | Source output index |
| `isError` | `boolean` | Whether this is an error output |
| `to` | `string` | Destination node name |
| `toInput` | `number` | Destination input index |

---

### SliceDefinition

**File**: `src/types/slice.ts`

Bounded region of the workflow graph.

| Field | Type | Notes |
|-------|------|-------|
| `nodes` | `Set<NodeIdentity>` | Nodes in the slice |
| `seedNodes` | `Set<NodeIdentity>` | Nodes that triggered this slice |
| `entryPoints` | `NodeIdentity[]` | Entry points into the slice |
| `exitPoints` | `NodeIdentity[]` | Exit points from the slice |

---

### PathDefinition

**File**: `src/types/slice.ts`

Concrete execution route through a slice.

| Field | Type | Notes |
|-------|------|-------|
| `nodes` | `NodeIdentity[]` | Ordered nodes from entry to exit |
| `edges` | `PathEdge[]` | Connecting edges for each consecutive pair |
| `usesErrorOutput` | `boolean` | Whether path uses any error outputs |
| `selectionReason` | `string` | Why this path was selected |

---

### PathEdge

**File**: `src/types/slice.ts`

| Field | Type | Notes |
|-------|------|-------|
| `from` | `NodeIdentity` | Source node |
| `fromOutput` | `number` | Source output index |
| `to` | `NodeIdentity` | Destination node |
| `toInput` | `number` | Destination input index |
| `isError` | `boolean` | Whether this is an error output |

---

### AgentTarget

**File**: `src/types/target.ts`

Discriminated union (discriminant: `kind`). Agent-facing target specification.

| Variant | Fields | Notes |
|---------|--------|-------|
| `kind: 'nodes'` | `nodes: NodeIdentity[]` | Validate specific nodes |
| `kind: 'changed'` | (none) | Validate whatever changed |
| `kind: 'workflow'` | (none) | Validate entire workflow |

---

### ValidationTarget

**File**: `src/types/target.ts`

Discriminated union (discriminant: `kind`). Extends `AgentTarget` with internal variants.

| Variant | Fields | Notes |
|---------|--------|-------|
| `kind: 'nodes'` | `nodes: NodeIdentity[]` | From AgentTarget |
| `kind: 'changed'` | (none) | From AgentTarget |
| `kind: 'workflow'` | (none) | From AgentTarget |
| `kind: 'slice'` | `slice: SliceDefinition` | Computed slice |
| `kind: 'path'` | `path: PathDefinition` | Specific path |

---

### ValidationLayer

**File**: `src/types/target.ts`

String literal union: `'static' | 'execution' | 'both'`

---

### TrustState

**File**: `src/types/trust.ts`

Per-workflow trust state.

| Field | Type | Notes |
|-------|------|-------|
| `workflowId` | `string` | Workflow identifier |
| `nodes` | `Map<NodeIdentity, NodeTrustRecord>` | Per-node trust records |
| `connectionsHash` | `string` | Hash of full connection topology |

---

### NodeTrustRecord

**File**: `src/types/trust.ts`

| Field | Type | Notes |
|-------|------|-------|
| `contentHash` | `string` | Hash of trust-relevant properties |
| `validatedBy` | `string` | Validation run identifier |
| `validatedAt` | `string` | ISO 8601 timestamp |
| `validationLayer` | `ValidationLayer` | What kind of validation |
| `fixtureHash` | `string \| null` | Hash of fixture data, null for static-only |

---

### NodeChangeSet

**File**: `src/types/trust.ts`

| Field | Type | Notes |
|-------|------|-------|
| `added` | `NodeIdentity[]` | New nodes |
| `removed` | `NodeIdentity[]` | Deleted nodes |
| `modified` | `NodeModification[]` | Changed nodes |
| `unchanged` | `NodeIdentity[]` | Unchanged nodes |

---

### NodeModification

**File**: `src/types/trust.ts`

| Field | Type | Notes |
|-------|------|-------|
| `node` | `NodeIdentity` | Which node |
| `changes` | `ChangeKind[]` | What changed |

---

### ChangeKind

**File**: `src/types/trust.ts`

String literal union: `'parameter' | 'expression' | 'connection' | 'type-version' | 'credential' | 'execution-setting' | 'position-only' | 'metadata-only'`

Trust-breaking: all except `position-only` and `metadata-only`.

---

### GuardrailDecision

**File**: `src/types/guardrail.ts`

Discriminated union (discriminant: `action`). All variants extend `GuardrailDecisionBase`.

| Variant | Extra Fields | Notes |
|---------|-------------|-------|
| `action: 'proceed'` | (none) | Validation proceeds normally |
| `action: 'warn'` | (none) | Proceed with warning |
| `action: 'narrow'` | `narrowedTarget: ValidationTarget` | Scope was narrowed |
| `action: 'redirect'` | `redirectedLayer: ValidationLayer` | Layer was changed |
| `action: 'refuse'` | (none) | Validation refused |

**Base fields** (`GuardrailDecisionBase`): `explanation: string`, `evidence: GuardrailEvidence`, `overridable: boolean`

---

### GuardrailEvidence

**File**: `src/types/guardrail.ts`

| Field | Type | Notes |
|-------|------|-------|
| `changedNodes` | `NodeIdentity[]` | Nodes that changed |
| `trustedNodes` | `NodeIdentity[]` | Nodes still trusted |
| `lastValidatedAt` | `string \| null` | Last validation timestamp |
| `fixtureChanged` | `boolean` | Whether fixture data changed |

---

### DiagnosticSummary

**File**: `src/types/diagnostic.ts`

Canonical validation output.

| Field | Type | Notes |
|-------|------|-------|
| `schemaVersion` | `1` (literal) | Forward compatibility marker |
| `status` | `'pass' \| 'fail' \| 'error' \| 'skipped'` | Overall outcome |
| `target` | `ResolvedTarget` | What was validated |
| `evidenceBasis` | `ValidationLayer` | Which evidence layer |
| `executedPath` | `PathNode[] \| null` | Executed path, if any |
| `errors` | `DiagnosticError[]` | Classified errors |
| `nodeAnnotations` | `NodeAnnotation[]` | Per-node annotations |
| `guardrailActions` | `GuardrailDecision[]` | Guardrail actions taken |
| `hints` | `DiagnosticHint[]` | Runtime hints |
| `capabilities` | `AvailableCapabilities` | Available capabilities |
| `meta` | `ValidationMeta` | Run metadata |

---

### DiagnosticError

**File**: `src/types/diagnostic.ts`

Discriminated union (discriminant: `classification`). All variants extend `DiagnosticErrorBase`.

| Variant | Context Fields |
|---------|---------------|
| `classification: 'wiring'` | `parameter?`, `referencedNode?`, `fieldPath?` |
| `classification: 'expression'` | `expression?`, `parameter?`, `itemIndex?` |
| `classification: 'credentials'` | `credentialType?`, `httpCode?` |
| `classification: 'external-service'` | `httpCode?`, `errorCode?` |
| `classification: 'platform'` | `runIndex?` |
| `classification: 'cancelled'` | `reason?` |
| `classification: 'unknown'` | `runIndex?`, `itemIndex?` |

**Base fields** (`DiagnosticErrorBase`): `type: string`, `message: string`, `description: string | null`, `node: NodeIdentity | null`

---

### Supporting Types (in diagnostic.ts)

- **ResolvedTarget**: `{ description: string; nodes: NodeIdentity[]; automatic: boolean }`
- **PathNode**: `{ name: NodeIdentity; executionIndex: number; sourceOutput: number | null }`
- **NodeAnnotation**: `{ node: NodeIdentity; status: NodeAnnotationStatus; reason: string }`
- **NodeAnnotationStatus**: `'validated' | 'trusted' | 'mocked' | 'skipped'`
- **DiagnosticHint**: `{ node: NodeIdentity; message: string; severity: 'info' | 'warning' | 'danger' }`
- **AvailableCapabilities**: `{ staticAnalysis: true; restApi: boolean; mcpTools: boolean }`
- **ValidationMeta**: `{ runId: string; executionId: string | null; partialExecution: boolean; timestamp: string; durationMs: number }`

## Derived Types

- **GuardrailAction**: `GuardrailDecision['action']` — derived from discriminant
- **ErrorClassification**: `DiagnosticError['classification']` — derived from discriminant

## Relationship Summary

```
NodeIdentity ──used-by──> GraphNode.name (conceptually)
NodeIdentity ──used-by──> SliceDefinition, PathDefinition, PathEdge
NodeIdentity ──used-by──> TrustState.nodes (Map key)
NodeIdentity ──used-by──> GuardrailEvidence, DiagnosticError, NodeAnnotation, etc.

WorkflowAST (external) ──used-by──> WorkflowGraph.ast
NodeClassification ──used-by──> GraphNode.classification
ValidationLayer ──used-by──> NodeTrustRecord, ValidationTarget, DiagnosticSummary
ValidationTarget ──used-by──> GuardrailDecision.narrowedTarget
SliceDefinition ──used-by──> ValidationTarget (kind: 'slice')
PathDefinition ──used-by──> ValidationTarget (kind: 'path')
GuardrailDecision ──used-by──> DiagnosticSummary.guardrailActions
```
