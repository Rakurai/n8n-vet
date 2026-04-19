# Trust, Change Detection, and Guardrail Feasibility Research

Research artifact covering FEASIBILITY.md sections 4 (Trusted-boundary feasibility), and 5 (Guardrail feasibility).

Based on source code analysis of:
- `/Users/QTE2333/repos/n8n` (n8n platform)
- `/Users/QTE2333/repos/n8n-as-code` (n8nac tool)

---

## 4.1 Derived Trust Model Viability

### Question

Can trusted boundaries be derived from prior validation state? What evidence is sufficient? What invalidates trust?

### Existing infrastructure for trust derivation

n8nac already maintains a per-workflow state record in `.n8n-state.json` that tracks synchronization between local files and the remote n8n instance. The relevant data structure (from `packages/cli/src/core/services/state-manager.ts`):

```typescript
interface IWorkflowState {
    lastSyncedHash: string;   // SHA-256 of normalized workflow content
    lastSyncedAt: string;     // ISO timestamp of last sync
    filename?: string;        // recovery hint: last known local filename
}

interface IInstanceState {
    workflows: Record<string, IWorkflowState>;  // keyed by workflow ID
}
```

This gives us a baseline: for any workflow, we can compare the current local content hash against the last-known-good hash. The `WorkflowStateTracker` (line 534-578 of `workflow-state-tracker.ts`) already implements a 3-way comparison (local hash vs. last synced hash vs. remote hash) to compute sync status. This same mechanism can be repurposed for trust derivation.

### What constitutes sufficient trust evidence

For n8n-vet, a node or region should be considered "trusted" when ALL of the following hold:

1. **Prior validation passed.** A validation run targeting that region completed without errors.
2. **No relevant changes since validation.** The content hash of every node in the region matches what was present when the validation passed.
3. **No upstream changes that could affect inputs.** Nodes feeding into the trusted region have not changed their output-affecting properties (parameters, expressions, connections).
4. **No fixture/pin-data changes that would alter the execution context.** If validation was execution-backed, the fixtures used must also be unchanged.

The first two conditions are straightforward to check with hashes. The third requires understanding the graph topology (which n8n-vet will already have from its slice/path analysis). The fourth requires tracking fixture identity alongside validation results.

### Proposed trust state data structure

```typescript
/** Trust record for a single node */
interface NodeTrustRecord {
    /** Hash of the node's trust-relevant properties at validation time */
    contentHash: string;
    /** Validation run ID that established trust */
    validatedBy: string;
    /** Timestamp of the validation */
    validatedAt: string;
    /** What kind of validation established trust */
    validationKind: 'static' | 'execution' | 'both';
    /** Hash of fixture/pin-data used, if execution-backed */
    fixtureHash?: string;
}

/** Trust state for an entire workflow */
interface WorkflowTrustState {
    /** Workflow ID */
    workflowId: string;
    /** Hash of the full workflow at last trust computation */
    workflowHash: string;
    /** Per-node trust records, keyed by node name */
    nodes: Record<string, NodeTrustRecord>;
    /** Edges (connections) hash at last trust computation */
    connectionsHash: string;
    /** Trusted boundary definitions (node pairs where trust was established) */
    boundaries: TrustedBoundary[];
}

/** A trusted boundary between two regions */
interface TrustedBoundary {
    /** The "producer" node at the boundary */
    upstreamNode: string;
    /** The "consumer" node at the boundary */
    downstreamNode: string;
    /** Hash of the upstream node's output-relevant config */
    upstreamHash: string;
    /** Hash of the downstream node's input-relevant config */
    downstreamHash: string;
    /** Validation run that established this boundary */
    validatedBy: string;
}
```

### Trust durability across lifecycle events

| Event | Trust impact | Rationale |
|-------|-------------|-----------|
| **Local parameter edit on a trusted node** | Invalidates that node and downstream dependents | Content hash changes; output may differ |
| **Local expression edit on a trusted node** | Invalidates that node and downstream dependents | Data flow may change |
| **Connection change (add/remove edge)** | Invalidates affected nodes on both sides | Graph topology changed |
| **Position-only change** | Trust preserved | Position is cosmetic; does not affect execution |
| **Metadata-only change (notes)** | Trust preserved | Notes are cosmetic; no execution impact |
| **Node rename** | Trust-breaking (appears as remove+add) | Node names are connection keys and expression targets; a rename breaks references and must be treated as a topology change |
| **Sync/push cycle (no content change)** | Trust preserved | If content hash is identical before and after sync, nothing changed |
| **Sync/push cycle (content change from remote)** | Invalidates changed nodes | Remote edits are equivalent to local edits |
| **Fixture/pin-data change** | Invalidates execution-backed trust; static trust preserved | Execution results may differ with new fixtures |
| **Path change (different branch targeted)** | Trust for the old path preserved; new path needs validation | Different paths exercise different nodes |
| **Node type version upgrade** | Invalidates that node | Behavior may change across versions |
| **Credential change** | Invalidates nodes using that credential (execution trust only) | Runtime behavior may differ |

### Verdict: FEASIBLE

Derived trust is viable because:

1. n8nac already provides stable per-workflow hashing infrastructure (`HashUtils.computeHash`, `WorkflowTransformerAdapter.hashWorkflow`).
2. The workflow JSON structure exposes node parameters, expressions, and connections as discrete, hashable objects.
3. Trust invalidation rules can be conservative (hash any content change as trust-breaking) without being so aggressive that trust is never useful -- because position-only and metadata-only changes can be explicitly excluded.
4. The `.n8n-state.json` pattern provides a proven model for local state persistence that n8n-vet can extend.

The main risk is **granularity cost**: computing per-node hashes on every validation request adds overhead. However, workflow sizes in practice are small enough (tens to low hundreds of nodes) that this is negligible.

---

## 4.2 Node-Level Change Detection

### Question

Can n8n-vet compute changed slices from local workflow snapshots? How feasible is node-level or edge-level diffing?

### n8n's workflow checksum approach

The n8n platform (`packages/workflow/src/workflow-checksum.ts`) computes a single SHA-256 hash over the entire workflow content:

```typescript
// Fields included in checksum (line 22-32):
const CHECKSUM_FIELDS = [
    'name', 'description', 'nodes', 'connections',
    'settings', 'meta', 'pinData', 'isArchived', 'activeVersionId'
];
```

The approach:
1. Extract listed fields from the workflow
2. Recursively sort all object keys for canonical ordering (`sortObjectKeys`)
3. `JSON.stringify` the result
4. SHA-256 the serialized string

This is a **whole-workflow** checksum designed for conflict detection, not change localization. It answers "did anything change?" but not "what changed?" -- which is insufficient for n8n-vet's needs.

### n8nac's hashing approach

n8nac (`packages/cli/src/core/services/workflow-transformer-adapter.ts`, line 129-147) computes hashes through a round-trip:

1. Compile TypeScript to JSON (`compileToJson`)
2. Normalize: strip volatile fields (node IDs, webhookIds, organization metadata, non-allowlisted settings)
3. Hash the normalized JSON via `HashUtils.computeHash` (which uses `json-stable-stringify` + SHA-256)

This is also a **whole-workflow** hash. n8nac uses it to determine sync status (local-modified, remote-modified, conflict, tracked), not to identify which nodes changed.

### Feasibility of node-level diffing

The n8n workflow JSON structure makes node-level diffing straightforward. A workflow's `nodes` array contains self-contained objects:

```typescript
// From n8n INode (packages/workflow/src/interfaces.ts, line 1344):
interface INode {
    id: string;
    name: string;          // unique within workflow, used as connection key
    type: string;          // e.g., "n8n-nodes-base.httpRequest"
    typeVersion: number;
    position: [number, number];
    parameters: INodeParameters;
    credentials?: INodeCredentials;
    // ... execution settings (disabled, retryOnFail, etc.)
}
```

And connections are keyed by node name:

```typescript
// From n8n IConnections:
interface IConnections {
    [sourceNodeName: string]: {
        [outputType: string]: Array<Array<{
            node: string;    // destination node name
            type: string;    // connection type ("main", AI types)
            index: number;   // input index
        }>>;
    };
}
```

This structure directly supports node-level diffing:

### Proposed change detection algorithm

```typescript
interface NodeChangeSet {
    added: string[];          // node names new in current version
    removed: string[];        // node names absent from current version
    modified: NodeModification[];  // nodes present in both but changed
    unchanged: string[];      // nodes present in both, identical
}

interface NodeModification {
    nodeName: string;
    changeKind: ChangeKind[];
}

type ChangeKind =
    | 'parameter'       // parameters object differs
    | 'expression'      // expression within parameters differs
    | 'connection'      // edges to/from this node changed
    | 'type-version'    // typeVersion changed
    | 'credential'      // credentials changed
    | 'execution-setting'  // disabled, retryOnFail, etc.
    | 'position-only'   // only position changed (cosmetic)
    | 'metadata-only'   // only name/notes changed (cosmetic)
    ;

function computeNodeChangeSet(
    prev: WorkflowSnapshot,
    curr: WorkflowSnapshot
): NodeChangeSet {
    const prevNodes = indexByName(prev.nodes);
    const currNodes = indexByName(curr.nodes);

    const added = [...currNodes.keys()].filter(n => !prevNodes.has(n));
    const removed = [...prevNodes.keys()].filter(n => !currNodes.has(n));
    const common = [...currNodes.keys()].filter(n => prevNodes.has(n));

    const modified: NodeModification[] = [];
    const unchanged: string[] = [];

    for (const name of common) {
        const changes = diffNode(prevNodes.get(name)!, currNodes.get(name)!);
        if (changes.length > 0) {
            modified.push({ nodeName: name, changeKind: changes });
        } else {
            unchanged.push(name);
        }
    }

    // Also diff connections for each node
    const prevConns = prev.connections || {};
    const currConns = curr.connections || {};
    for (const name of common) {
        if (!unchanged.includes(name)) continue; // already in modified
        const prevEdges = JSON.stringify(sortObjectKeys(prevConns[name] || {}));
        const currEdges = JSON.stringify(sortObjectKeys(currConns[name] || {}));
        if (prevEdges !== currEdges) {
            modified.push({ nodeName: name, changeKind: ['connection'] });
            // Remove from unchanged
            const idx = unchanged.indexOf(name);
            if (idx >= 0) unchanged.splice(idx, 1);
        }
    }

    return { added, removed, modified, unchanged };
}

function diffNode(prev: INode, curr: INode): ChangeKind[] {
    const changes: ChangeKind[] = [];

    // Check cosmetic-only changes first
    const posChanged = prev.position[0] !== curr.position[0]
                    || prev.position[1] !== curr.position[1];
    const notesChanged = prev.notes !== curr.notes;

    // Note: node name changes cannot appear here because nodes are matched
    // by name in computeNodeChangeSet. A renamed node appears as a
    // remove+add pair, not as a common node with a name diff. Node names
    // are connection keys and expression targets ($('NodeName')), so a
    // rename is always trust-breaking — it is handled at the change-set
    // level, not the per-node diff level.

    // Check semantic changes
    const paramsChanged = !deepEqual(prev.parameters, curr.parameters);
    const typeVerChanged = prev.typeVersion !== curr.typeVersion;
    const credChanged = !deepEqual(prev.credentials, curr.credentials);
    const execSettingsChanged = prev.disabled !== curr.disabled
        || prev.retryOnFail !== curr.retryOnFail
        || prev.executeOnce !== curr.executeOnce;

    if (paramsChanged) {
        // Further classify: does the diff involve expressions?
        if (hasExpressionDiff(prev.parameters, curr.parameters)) {
            changes.push('expression');
        }
        changes.push('parameter');
    }
    if (typeVerChanged) changes.push('type-version');
    if (credChanged) changes.push('credential');
    if (execSettingsChanged) changes.push('execution-setting');

    // If ONLY cosmetic changes, classify as such
    if (changes.length === 0) {
        if (posChanged) changes.push('position-only');
        if (notesChanged) changes.push('metadata-only');
    }

    return changes;
}
```

### Expression change detection

Expressions in n8n node parameters are strings prefixed with `=`. A parameter value like `"={{ $json.name }}"` is an expression. Detecting expression changes specifically (vs. static parameter changes) is valuable because expression changes affect data flow while static parameter changes may only affect node behavior.

The detection is straightforward: walk both parameter trees, find string values starting with `=`, and compare them. The existing expression reference parser from n8n (`packages/workflow/src/node-reference-parser-utils.ts`) can even identify which upstream nodes are referenced, enabling precise impact analysis.

### Connection-level diffing

Connections in n8n are keyed by source node name, making edge-level diffing natural. For each node, its outgoing connections are a nested structure:

```
connections["NodeName"]["main"][outputIndex] = [
    { node: "TargetNode", type: "main", index: 0 }
]
```

Diffing involves:
1. Compare the set of source nodes (added/removed sources = topology change)
2. For each common source, compare the serialized connection arrays
3. For changed connections, identify specifically which targets were added/removed/reordered

### Node name as stable identity

A critical question: what identifies "the same node" across versions? Two options:

1. **Node name** (`INode.name`): Unique within a workflow, used as the connection key, stable across most edits. If a node is renamed, it appears as a remove+add pair. This is acceptable because renames in n8n also require updating all expression references.

2. **Node ID** (`INode.id`): UUID, stable across renames. However, n8nac's normalization strips node IDs during hashing (line 213-216 of `workflow-transformer-adapter.ts`): `const { id, webhookId, ...rest } = node;`. This means IDs are not reliable for cross-version comparison in the n8nac workflow.

**Recommendation:** Use **node name** as the primary identity key. It is the connection key in n8n's own data model, and it is the property used in expressions (`$('NodeName')`). When the n8nac AST is available, use `NodeAST.propertyName` as an additional stable identifier.

### Verdict: FEASIBLE

Node-level change detection is well-supported by the existing data structures:

1. Nodes are self-contained objects keyed by unique name.
2. Connections are keyed by node name, enabling edge-level diffing.
3. Change categories (parameter, expression, connection, position, metadata) are naturally separable from the INode structure.
4. The existing hash infrastructure (n8nac's `HashUtils`, n8n's `sortObjectKeys`) provides canonicalization utilities.
5. Expression changes can be specifically identified by walking parameter values.

Whole-workflow hashing (n8n and n8nac style) is useful as a fast "anything changed?" check, but node-level diffing is required from the start for trust boundary tracking and slice identification.

---

## 4.3 Boundary Invalidation Rules

### Question

Which changes break trust? Which are safe to ignore? Can trust be invalidated conservatively without too many false revalidations?

### Proposed invalidation taxonomy

Changes fall into three categories:

#### Category A: Always trust-breaking

These changes invalidate trust for the affected node and all downstream nodes in the validated path:

| Change | Why trust-breaking |
|--------|--------------------|
| Parameter change (non-expression) | Node behavior may change |
| Expression change | Data flow may change |
| Connection added/removed | Graph topology changed; different data may flow |
| Node type or typeVersion change | Different runtime behavior |
| Node added to or removed from a validated path | Validated path no longer exists as validated |
| Credential change (for execution trust) | Runtime behavior may differ |

#### Category B: Always safe to ignore

These changes never invalidate trust:

| Change | Why safe |
|--------|----------|
| Position change only | Cosmetic; n8n ignores position during execution |
| Notes/description change | Cosmetic |
| Workflow name change | Does not affect execution |
| Workflow settings change (non-execution) | e.g., `saveManualExecutions` does not affect behavior |
| Node disabled/enabled outside the validated path | Does not affect the path's execution |

#### Category C: Context-dependent

These require additional analysis:

| Change | When trust-breaking | When safe |
|--------|--------------------|----|
| Upstream node parameter change (outside slice) | When the change affects output shape/content flowing into the trusted boundary | When the change is cosmetic or affects only an unrelated output branch |
| Fixture/pin-data change | When the validated path used execution-backed validation | When trust was established via static analysis only |
| Node disabled/enabled inside the validated path | Always trust-breaking for that path | N/A |
| Workflow settings change (execution-related) | `executionOrder`, `errorWorkflow`, `timezone` -- may affect runtime | When the setting does not apply to the validated path |

### Conservative invalidation strategy

For the initial implementation, the recommended approach is **conservative with explicit safe-list**:

1. **Default: any content change to a node invalidates trust for that node.**
2. **Explicit safe-list: position and metadata changes are excluded from content hashing.**
3. **Propagation: invalidation propagates forward (downstream) through connections, not backward.**
4. **Scope: only nodes within the previously validated path/slice are checked; nodes entirely outside the validated region are irrelevant.**

This is conservative in that it may occasionally invalidate trust when a parameter change does not actually affect output (e.g., changing a log message). But the cost of a false revalidation is low (one extra validation run), while the cost of false trust is high (missed bug). This matches the product philosophy.

### Propagation rules

When a node's trust is invalidated:

```
invalidated_node = node whose content changed
impact_set = {invalidated_node}

// Forward propagation through connections
for each node in impact_set (breadth-first):
    for each downstream node connected to it:
        if downstream node is in the trusted region:
            add downstream node to impact_set

// Boundary impact
for each trusted boundary:
    if boundary.upstreamNode is in impact_set:
        invalidate boundary
        add boundary.downstreamNode to impact_set
```

This ensures that a change to an upstream node correctly invalidates trust for everything it feeds, but does NOT invalidate trust for unrelated parallel branches.

### False revalidation rate estimate

With the conservative strategy, false revalidations will occur when:
- A parameter change does not affect output (e.g., changing error handling settings on a node that does not error)
- A credential change does not affect behavior (e.g., rotating a key with identical permissions)

In practice, these cases are uncommon during active development. The dominant case is: the agent changes a parameter or expression, and the downstream nodes genuinely need revalidation. **Estimated false revalidation rate: under 10% of invalidation events.**

### Verdict: FEASIBLE

Conservative invalidation is viable because:
1. The safe-list (position, metadata) covers the most common non-semantic changes.
2. Forward-only propagation limits the blast radius naturally.
3. The cost of false revalidation is proportional (one extra validation, not an explosion).
4. The category-C cases can be refined over time without changing the core model.

---

## 5.1 Low-Value Rerun Detection

### Question

What signals indicate a validation is unlikely to add useful information? Can validation requests be compared against prior state?

### Available signals for redundancy detection

| Signal | How to detect | Reliability |
|--------|--------------|-------------|
| **No changes since last pass** | Compare current node hashes against trust records | High -- hash comparison is exact |
| **Same fixture as last run** | Compare fixture hash against trust record's fixtureHash | High |
| **Same effective path** | Compare the set of nodes in the requested path against last validated path | High |
| **Repeated request within short time** | Timestamp comparison against last validation | High |
| **Broad target when only narrow change occurred** | Compare requested scope against computed change set | Medium -- requires change detection |
| **Validation of unchanged upstream** | Check if all upstream nodes in the requested path are trusted | High |

### Proposed rerun detection algorithm

```typescript
interface RerunAssessment {
    /** Whether this validation is likely low-value */
    isLowValue: boolean;
    /** Confidence in the assessment */
    confidence: 'high' | 'medium' | 'low';
    /** Why this is considered low-value (or why it is not) */
    reason: string;
    /** Suggested alternative action */
    suggestion?: GuardrailAction;
}

function assessRerunValue(
    request: ValidationRequest,
    trustState: WorkflowTrustState,
    changeSet: NodeChangeSet
): RerunAssessment {
    // 1. Check: is the requested target entirely unchanged?
    const targetNodes = getNodesInTarget(request.target);
    const changedInTarget = targetNodes.filter(n =>
        changeSet.modified.some(m => m.nodeName === n)
        || changeSet.added.includes(n)
    );

    if (changedInTarget.length === 0 && changeSet.removed.length === 0) {
        return {
            isLowValue: true,
            confidence: 'high',
            reason: 'No nodes in the validation target have changed since last successful validation.',
            suggestion: { action: 'skip', explanation: 'Target is unchanged; prior validation still applies.' }
        };
    }

    // 2. Check: is this a broad request when only a narrow region changed?
    const totalTargetNodes = targetNodes.length;
    const changedRatio = changedInTarget.length / totalTargetNodes;
    if (changedRatio < 0.15 && totalTargetNodes > 5) {
        return {
            isLowValue: true,
            confidence: 'medium',
            reason: `Only ${changedInTarget.length}/${totalTargetNodes} nodes changed. ` +
                    `Validating the full target is broader than needed.`,
            suggestion: {
                action: 'narrow',
                explanation: `Suggest narrowing to: ${changedInTarget.join(', ')} and their downstream dependents.`,
                narrowedTarget: computeNarrowedSlice(changedInTarget, request.target)
            }
        };
    }

    // 3. Check: same fixture as last run on an unchanged target?
    if (request.fixtureHash && request.validationKind === 'execution') {
        const allTrustedWithSameFixture = targetNodes.every(n => {
            const trust = trustState.nodes[n];
            return trust && trust.fixtureHash === request.fixtureHash;
        });
        if (allTrustedWithSameFixture && changedInTarget.length === 0) {
            return {
                isLowValue: true,
                confidence: 'high',
                reason: 'Same fixture, same target, no changes. Execution will produce identical results.',
                suggestion: { action: 'skip', explanation: 'Prior execution result still valid.' }
            };
        }
    }

    // 4. Not low-value
    return {
        isLowValue: false,
        confidence: 'high',
        reason: `${changedInTarget.length} node(s) changed in the target.`
    };
}
```

### Cost of rerun detection

The detection algorithm requires:
1. Hash comparison for each node in the target (O(n), cheap)
2. Change set computation (one diff operation per validation request, cacheable)
3. Fixture hash comparison (single hash lookup)

All of these are local, in-memory operations. The overhead is negligible compared to even a static analysis pass, let alone execution-backed validation.

### Verdict: FEASIBLE

Low-value rerun detection is straightforward because:
1. The trust state provides exact hash-based evidence of what has been validated.
2. Change detection (section 4.2) provides exact evidence of what has changed.
3. Comparing "what was validated" against "what changed" is a simple set operation.
4. The signals are objective (hash equality), not heuristic, so confidence is high.

---

## 5.2 Guardrail Action Selection

### Question

Can the tool reliably warn, narrow scope, redirect, or refuse? What explanation must accompany these actions?

### Proposed guardrail action taxonomy

```typescript
type GuardrailAction =
    | { action: 'proceed'; explanation: string }
    | { action: 'warn'; explanation: string; proceedAnyway: boolean }
    | { action: 'narrow'; explanation: string; narrowedTarget: ValidationTarget }
    | { action: 'redirect'; explanation: string; suggestedAction: string }
    | { action: 'refuse'; explanation: string }
    ;
```

### When each action applies

| Action | Trigger condition | Example scenario |
|--------|------------------|------------------|
| **proceed** | Request is well-scoped and has changed nodes | Agent requests validation of a modified slice |
| **warn** | Request is valid but broader than needed | Agent validates a whole workflow when only 2 nodes changed |
| **narrow** | Request can be automatically reduced in scope | Agent asks for full-path validation; only the tail changed |
| **redirect** | Execution requested but static would suffice | Agent requests execution-backed validation for a pure expression/wiring change |
| **refuse** | Request is demonstrably wasteful | Identical request with no changes since last pass |

### Explanation requirements

Every guardrail action MUST include:

1. **What was detected** -- the specific condition that triggered the guardrail (e.g., "no nodes in the requested target have changed since the last successful validation at 2024-01-15T10:30:00Z").
2. **What the tool recommends** -- the specific alternative (e.g., "skip this validation" or "narrow to nodes X, Y, Z").
3. **How to override** -- if the guardrail is not a hard refuse, how the agent can proceed anyway (e.g., `force: true` flag).

This ensures the guardrail is transparent, not opaque. The agent (and supervising human) can always understand why the tool made a specific recommendation.

### Proposed guardrail output structure

```typescript
interface GuardrailResult {
    /** The original validation request */
    originalRequest: ValidationRequest;
    /** The guardrail decision */
    decision: GuardrailAction;
    /** Evidence supporting the decision */
    evidence: {
        /** Nodes that changed since last validation */
        changedNodes: string[];
        /** Nodes that are still trusted */
        trustedNodes: string[];
        /** Last validation timestamp for the target */
        lastValidatedAt?: string;
        /** Whether the fixture changed */
        fixtureChanged: boolean;
    };
    /** If narrowing: the proposed reduced target */
    proposedTarget?: ValidationTarget;
    /** If redirecting: what the tool suggests instead */
    alternativeAction?: string;
}
```

### Reliability of each action

| Action | Reliability | Risk |
|--------|------------|------|
| **proceed** | Very high | None -- this is the default happy path |
| **warn** | High | Agent may ignore warning and waste resources; acceptable |
| **narrow** | High | Narrowed scope may miss a relevant node if change propagation is incomplete; mitigated by conservative propagation (section 4.3) |
| **redirect** | Medium | Static analysis may not catch all bugs that execution would; mitigated by clear explanation that static is not equivalent |
| **refuse** | High | False refuse is possible if the trust state is stale; mitigated by providing `force: true` escape hatch |

### Verdict: FEASIBLE

Guardrail action selection is viable because:
1. Each action maps to a specific, detectable condition (not heuristic guessing).
2. The evidence for each action comes from the trust state and change detection, which are reliable (section 4.1, 4.2).
3. All actions include escape hatches (`force: true`), preventing the tool from becoming a blocker.
4. Explanations are generated from concrete data (node names, timestamps, hashes), not vague advice.

---

## 5.3 Happy-Path Default Enforcement

### Question

What signals identify the intended/normal path? Can the tool default to happy-path without being rigid?

### Signals for happy-path identification

| Signal | Source | Reliability |
|--------|--------|-------------|
| **First/main output of branching nodes** | Connection structure: output index 0 on If/Switch/Router nodes is typically the "true"/happy case | Medium -- convention-dependent |
| **Non-error output** | n8n nodes have explicit error outputs (`isError: true` on ConnectionAST); the non-error path is the happy path | High |
| **Most recently validated path** | Trust state records which path was last validated successfully | High |
| **Trigger-to-terminal path with fewest branches** | Graph analysis: the shortest path through the workflow that does not take error or conditional branches | Medium |
| **Pin-data path** | If pin data exists for a specific execution path, that path was likely the intended development focus | Medium |
| **Path with most trusted nodes** | The path with the highest proportion of already-validated nodes is likely the established happy path | Medium |

### Happy-path detection algorithm

```typescript
interface PathCandidate {
    nodes: string[];       // ordered list of node names
    score: number;         // higher = more likely happy path
    reasoning: string[];   // why this path was scored this way
}

function identifyHappyPath(
    workflow: WorkflowGraph,
    trustState: WorkflowTrustState,
    slice: WorkflowSlice
): PathCandidate {
    const allPaths = enumeratePathsThroughSlice(workflow, slice);

    for (const path of allPaths) {
        let score = 0;
        const reasoning: string[] = [];

        // Prefer non-error paths
        if (!path.usesErrorOutput) {
            score += 10;
            reasoning.push('Uses main (non-error) outputs');
        }

        // Prefer output index 0 on branching nodes
        const branchNodes = path.nodes.filter(n => workflow.isBranching(n));
        const usesFirstOutput = branchNodes.every(n =>
            path.outputIndexAt(n) === 0
        );
        if (usesFirstOutput) {
            score += 5;
            reasoning.push('Takes first output on all branch nodes');
        }

        // Prefer paths with more trusted nodes
        const trustedCount = path.nodes.filter(n =>
            trustState.nodes[n]?.contentHash !== undefined
        ).length;
        score += trustedCount;
        reasoning.push(`${trustedCount}/${path.nodes.length} nodes already trusted`);

        path.score = score;
        path.reasoning = reasoning;
    }

    // Return highest-scoring path
    return allPaths.sort((a, b) => b.score - a.score)[0];
}
```

### Avoiding overreach

The happy-path default should be a **suggestion, not a mandate**. Specifically:

1. **Default behavior**: When the agent does not specify a path, the tool automatically selects the happy path and reports which path it chose.
2. **Explicit override**: The agent can specify `path: [nodeA, nodeB, nodeC]` to validate any specific path, including error paths.
3. **Broader request**: The agent can specify `allPaths: true` to validate all paths through a slice (the tool will warn if this is broad, per section 5.2).
4. **Transparency**: The diagnostic summary always reports which path was actually validated and why it was selected, so the agent understands the scope.

Overreach would mean: refusing to validate non-happy paths, or silently ignoring the agent's explicit path request. The tool should never do either.

### Verdict: FEASIBLE

Happy-path defaults are viable because:
1. Error outputs are explicitly marked in n8n's connection model (`isError` on ConnectionAST), providing a reliable signal.
2. Branch output indices provide a reasonable convention-based signal (output 0 = main case).
3. Trust state provides historical evidence of which paths have been validated.
4. The default is a suggestion with transparent reporting, not a rigid constraint.
5. Explicit overrides prevent the tool from becoming opinionated to the point of obstruction.

---

## Summary of Verdicts

| Question | Verdict | Key dependency |
|----------|---------|----------------|
| 4.1 Derived trust model | **FEASIBLE** | Per-node hashing + trust state persistence |
| 4.2 Node-level change detection | **FEASIBLE** | Node name as identity key + existing hash infra |
| 4.3 Boundary invalidation rules | **FEASIBLE** | Conservative default + forward propagation |
| 5.1 Low-value rerun detection | **FEASIBLE** | Trust state + change set comparison |
| 5.2 Guardrail action selection | **FEASIBLE** | Evidence-based conditions + escape hatches |
| 5.3 Happy-path default enforcement | **FEASIBLE** | Error output markers + trust history |

### Key implementation risks

1. **Node rename handling**: Using node name as identity means renames look like remove+add. This is acceptable for change detection but could cause unnecessary trust invalidation. A mitigation: if a "removed" and "added" node have identical parameters and type, treat it as a rename (trust preserved).

2. **Expression reference graph**: Full impact analysis requires parsing expressions to find upstream references. The n8n reference parser (`node-reference-parser-utils.ts`) handles this, but n8n-vet would need to either depend on it or reimplement the core patterns.

3. **Trust state persistence location**: The `.n8n-state.json` file is n8nac's territory. n8n-vet should use a separate file (e.g., `.n8n-vet-state.json`) to avoid conflicts.

4. **Path enumeration on complex graphs**: Workflows with many branches can have exponential path counts. The tool should cap enumeration (e.g., top 10 paths by score) and use the happy-path heuristic to avoid combinatorial explosion.

### Recommended next steps

1. **Implement `NodeChangeSet` computation** as a standalone function operating on two workflow JSON snapshots.
2. **Implement per-node content hashing** with the proposed safe-list (exclude position, metadata).
3. **Design the `.n8n-vet-state.json` schema** for trust persistence, including `WorkflowTrustState`.
4. **Prototype the rerun assessment** on a real workflow with known edit history to validate the detection accuracy.
5. **Integrate with n8n's expression reference parser** for upstream impact analysis.
