# Feature Specification: Trust & Change Subsystem

**Feature Branch**: `003-trust-and-change`  
**Created**: 2026-04-18  
**Status**: Draft  
**Input**: User description: "Phase 3: Trust and Change subsystem - change detection, trust derivation, forward-only invalidation, persistence"

## Clarifications

### Session 2026-04-18

- Q: Should `getRerunAssessment` check all rerun suppression conditions (including prior failing path and failure class), or only trust-level conditions? → A: Trust-level conditions only (target nodes trusted, fixture hash matches, no relevant changes). Failing-path relevance and failure-class checks are owned by the guardrails layer (Phase 4).
- Q: Should the persisted trust state file include a schema version for forward compatibility? → A: Yes. Include a `schemaVersion` field. On version mismatch, discard the file and start with empty trust (safe degradation, consistent with missing-file behavior).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Detect What Changed Between Workflow Versions (Priority: P1)

When an agent modifies a workflow and requests validation, the system must identify exactly which nodes changed and how. This is the foundation for all downstream trust and guardrail decisions. Without accurate change detection, the system cannot determine what needs re-validation.

**Why this priority**: Change detection is the prerequisite for every other capability in this subsystem. Trust derivation, invalidation, and guardrail evaluation all depend on knowing what changed.

**Independent Test**: Can be fully tested by providing two workflow graph snapshots and verifying the resulting change set classifies every node correctly. Delivers immediate value by enabling change-scoped validation targeting.

**Acceptance Scenarios**:

1. **Given** a previous workflow graph and a current graph with one node's parameters changed, **When** the system computes the change set, **Then** that node appears in `modified` with change kind `parameter`, and all other nodes appear in `unchanged`.
2. **Given** a previous graph and a current graph with a new node added, **When** the system computes the change set, **Then** the new node appears in `added` and no existing nodes are affected.
3. **Given** a previous graph and a current graph where a node was removed, **When** the system computes the change set, **Then** the removed node appears in `removed`.
4. **Given** a previous graph and a current graph where a node was removed and a new node was added with the same type, typeVersion, and parameters, **When** the system computes the change set, **Then** the pair is treated as a rename rather than separate add/remove.
5. **Given** two identical workflow graphs, **When** the system computes the change set, **Then** the result contains only `unchanged` nodes and the workflow-level quick check short-circuits before node-level diffing.
6. **Given** a node whose only change is its position on the canvas, **When** the system computes the change set, **Then** the node is classified as `position-only` (trust-preserving).
7. **Given** a node with a changed expression in its parameters, **When** the system computes the change set, **Then** the node is classified as modified with change kind `expression`.
8. **Given** two graphs where only the connection topology differs (a connection was added or removed between unchanged nodes), **When** the system computes the change set, **Then** the affected nodes receive a `connection` change kind.

---

### User Story 2 - Record Trust from Successful Validation (Priority: P1)

After a validation run succeeds, the system must record which nodes were validated and what evidence supports that trust. This enables future validation runs to skip re-proving unchanged, already-validated nodes.

**Why this priority**: Trust derivation is the mechanism that makes bounded validation possible. Without recording trust, every validation run must treat the entire workflow as unvalidated.

**Independent Test**: Can be fully tested by simulating a successful validation result and verifying that trust records are created with correct content hashes, timestamps, validation layers, and fixture hashes. Delivers value by enabling trusted boundary reuse in subsequent runs.

**Acceptance Scenarios**:

1. **Given** a successful validation of nodes A, B, and C at the static layer, **When** trust is recorded, **Then** each node receives a `NodeTrustRecord` containing its current content hash, the run ID, an ISO 8601 timestamp, validation layer `static`, and fixture hash `null`.
2. **Given** a successful execution-backed validation with pin data, **When** trust is recorded, **Then** the trust records include the fixture hash and validation layer `execution` or `both`.
3. **Given** a node that was mocked or skipped during validation, **When** trust is recorded, **Then** that node does NOT receive a trust record.
4. **Given** a node that already has a trust record from a previous run, **When** a new validation succeeds for that node, **Then** the trust record is replaced with the new run's data.

---

### User Story 3 - Invalidate Trust When Changes Break It (Priority: P1)

When a node changes in a trust-breaking way, all downstream nodes that depended on it must lose their trust. This ensures the system never treats a stale trust record as valid.

**Why this priority**: Trust invalidation is inseparable from trust derivation. Without forward propagation of invalidation, the system would incorrectly report downstream nodes as trusted when their inputs have changed.

**Independent Test**: Can be fully tested by constructing a graph with trusted nodes, applying a change set with trust-breaking modifications, and verifying that the correct nodes lose trust via forward-only BFS.

**Acceptance Scenarios**:

1. **Given** a linear graph A -> B -> C where all three nodes are trusted, **When** B receives a trust-breaking change (e.g., parameter change), **Then** B and C lose their trust records, but A retains its trust.
2. **Given** a branching graph where A -> B and A -> C, both B and C are trusted, **When** A receives a trust-breaking change, **Then** A, B, and C all lose their trust records.
3. **Given** a graph where A -> B -> C and C has a trust-breaking change, **When** trust invalidation runs, **Then** only C loses trust. A and B (upstream) retain their trust.
4. **Given** a node with a `position-only` change, **When** trust invalidation runs, **Then** that node's trust is NOT invalidated (position-only is trust-preserving).
5. **Given** a newly added node, **When** trust invalidation runs, **Then** the added node is in the invalidation set and its downstream nodes also lose trust.
6. **Given** a node whose connections changed (a new downstream edge was added), **When** trust invalidation runs, **Then** the node and its new downstream neighbors are invalidated.

---

### User Story 4 - Persist and Load Trust State (Priority: P2)

Trust state must survive across validation sessions. The system must write trust state to a local JSON file and load it on subsequent runs, so that trust accumulated over multiple validation cycles is not lost.

**Why this priority**: Persistence is what makes trust reuse practical across sessions. Without it, trust would reset on every invocation, eliminating the key benefit of trusted boundary reuse.

**Independent Test**: Can be fully tested by writing a trust state to disk, reading it back, and verifying equivalence. Also testable by verifying behavior when the file is missing or corrupt.

**Acceptance Scenarios**:

1. **Given** an updated trust state after a validation run, **When** the system persists it, **Then** a JSON file is written at the configured storage path containing the serialized `TrustState`.
2. **Given** a previously persisted trust state file, **When** the system loads trust state for a workflow, **Then** it returns the deserialized `TrustState` with all node records intact.
3. **Given** no trust state file exists at the storage path, **When** the system loads trust state, **Then** it returns an empty trust state without raising an error.
4. **Given** a corrupt trust state file (invalid JSON or schema mismatch), **When** the system loads trust state, **Then** it raises a typed error with the file path and parse error details.
5. **Given** a trust state file that contains records for workflow "wf-1" but the system requests trust for "wf-2", **When** the system loads trust, **Then** it returns empty trust for "wf-2" without error.
6. **Given** the environment variable `N8N_VET_DATA_DIR` is set, **When** the system determines the storage path, **Then** it uses that directory instead of the default `.n8n-check/`.
7. **Given** a trust state file with a `schemaVersion` that does not match the current expected version, **When** the system loads trust state, **Then** it discards the file contents and returns empty trust state without raising an error.

---

### User Story 5 - Query Trust State for Validation Decisions (Priority: P2)

The system must provide trust query functions that downstream subsystems (guardrails, request interpretation) use to decide validation scope. These queries answer: is a node trusted, where are the trust boundaries, which nodes need re-validation, and is a rerun likely low-value.

**Why this priority**: Trust queries are the interface between trust state and the rest of the system. Guardrails and request interpretation depend on these to make scoping and suppression decisions.

**Independent Test**: Can be fully tested by constructing a trust state and graph, then verifying each query function returns correct results for various trust configurations.

**Acceptance Scenarios**:

1. **Given** a node with a trust record whose content hash matches the current node content, **When** `isTrusted` is called, **Then** it returns `true`.
2. **Given** a node with a trust record whose content hash does NOT match the current content (node changed since validation), **When** `isTrusted` is called, **Then** it returns `false`.
3. **Given** a node with no trust record, **When** `isTrusted` is called, **Then** it returns `false`.
4. **Given** a graph with trusted nodes A, B adjacent to untrusted node C (A -> C, B -> C), **When** `getTrustedBoundaries` is called with a scope containing A, B, and C, **Then** it returns A and B as trusted boundary nodes.
5. **Given** a scope of five nodes where two are trusted and three are not, **When** `getUntrustedNodes` is called, **Then** it returns the three untrusted nodes.
6. **Given** a target where all nodes are trusted, the fixture hash matches, and no relevant changes occurred since the last run, **When** `getRerunAssessment` is called, **Then** it returns `isLowValue: true` with an explanation. Note: this function checks only trust-level conditions; failing-path and failure-class checks are handled by the guardrails layer.
7. **Given** a target where some nodes have trust-breaking changes, **When** `getRerunAssessment` is called, **Then** it returns `isLowValue: false`.

---

### User Story 6 - Content Hashing for Deterministic Comparison (Priority: P1)

The system must produce stable, deterministic hashes of node content so that identical node configurations always produce the same hash, regardless of property insertion order. This is the foundation for change detection and trust record validity checking.

**Why this priority**: Hashing underpins both change detection and trust verification. Non-deterministic hashing would cause false positives in change detection and premature trust invalidation.

**Independent Test**: Can be fully tested by hashing the same node content with properties in different insertion orders and verifying the hashes are identical. Also testable by verifying that excluded properties (position, name, notes) do not affect the hash.

**Acceptance Scenarios**:

1. **Given** a node with parameters in insertion order `{a: 1, b: 2}` and another representation with `{b: 2, a: 1}`, **When** content hashes are computed, **Then** both produce the same SHA-256 hash.
2. **Given** two nodes that differ only in `position`, **When** content hashes are computed, **Then** the hashes are identical.
3. **Given** two nodes that differ only in `name` (display name), **When** content hashes are computed, **Then** the hashes are identical.
4. **Given** two nodes that differ only in `notes` or `notesInFlow`, **When** content hashes are computed, **Then** the hashes are identical.
5. **Given** two nodes that differ in `parameters`, **When** content hashes are computed, **Then** the hashes are different.
6. **Given** the full connection topology of a workflow, **When** a connections hash is computed, **Then** the same topology always produces the same hash, and a different topology produces a different hash.

---

### Edge Cases

- What happens when multiple removed+added pairs have identical content hashes (ambiguous rename candidates)? The system resolves greedily by insertion order.
- What happens when a node exists in the trust state but no longer exists in the current graph? The stale trust record is removed during change detection.
- What happens when the trust state file is locked by another process (concurrent agent)? Last-write-wins. Losing a write causes redundant re-validation on the next run, which is safe.
- What happens when the workflow graph has zero nodes? Change detection produces an empty change set. Trust state remains unchanged.
- What happens when content hash computation fails due to a serialization error? A typed error is raised indicating a serialization bug.
- What happens when a persisted trust state file has an outdated schema version? The file is discarded and the system starts with empty trust (safe degradation).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST compute SHA-256 content hashes over canonically serialized trust-relevant node properties (`type`, `typeVersion`, `parameters`, `credentials`, `disabled`, `retryOnFail`, `executeOnce`, `onError`) with sorted keys.
- **FR-002**: System MUST exclude `position`, `name`, `notes`, `notesInFlow`, and node `id` from content hash computation.
- **FR-003**: System MUST compute a separate connections hash over the full connection topology for detecting topology changes.
- **FR-004**: System MUST compute a `NodeChangeSet` from two `WorkflowGraph` snapshots, classifying nodes as added, removed, modified (with sub-classification), or unchanged.
- **FR-005**: System MUST support the following change kinds: `parameter`, `expression`, `type-version`, `credential`, `execution-setting`, `position-only`, `metadata-only`, `connection`.
- **FR-006**: A single node modification MUST support carrying multiple `ChangeKind` values simultaneously.
- **FR-007**: System MUST perform rename detection: removed+added pairs with identical `type`, `typeVersion`, and `parameters` are treated as renames, and trust records transfer from old name to new name.
- **FR-008**: System MUST perform a workflow-level quick check (full workflow hash comparison) before node-level diffing, short-circuiting with an empty change set when hashes match.
- **FR-009**: System MUST create `NodeTrustRecord` entries for each validated (not mocked, not skipped) node after successful validation, containing content hash, run ID, ISO 8601 timestamp, validation layer, and fixture hash.
- **FR-010**: System MUST invalidate trust via forward-only BFS propagation: trust-breaking changes seed the invalidation set, then BFS follows forward adjacency edges to invalidate downstream nodes.
- **FR-011**: System MUST treat `position-only` and `metadata-only` changes as trust-preserving (they do NOT trigger invalidation).
- **FR-012**: System MUST add newly added nodes, nodes with connection changes, and nodes with trust-breaking changes to the invalidation seed set.
- **FR-013**: System MUST persist `TrustState` to a local JSON file at `.n8n-check/trust-state.json` (default) or `$N8N_VET_DATA_DIR/trust-state.json` (when configured). The persisted file MUST include a `schemaVersion` field for forward compatibility.
- **FR-014**: System MUST load trust state from the persistence file, returning empty trust state when the file is missing (no error). When the file exists but its `schemaVersion` does not match the current expected version, the system MUST discard the file contents and start with empty trust (safe degradation, no error raised).
- **FR-015**: System MUST raise a typed error with file path and parse details when the trust state file is corrupt (invalid JSON or schema mismatch).
- **FR-016**: System MUST implement `isTrusted(node)` returning true only when a trust record exists AND the recorded content hash matches the node's current content hash.
- **FR-017**: System MUST implement `getTrustedBoundaries(graph, scope)` returning trusted nodes within or adjacent to scope that have at least one untrusted downstream neighbor.
- **FR-018**: System MUST implement `getUntrustedNodes(scope)` returning nodes within scope that are not currently trusted.
- **FR-019**: System MUST implement `getRerunAssessment(target, fixtureHash)` evaluating trust-level rerun conditions only: whether all target nodes are trusted, the fixture hash matches recorded fixture hashes, and no relevant changes occurred since the last validation. Returns a `RerunAssessment` with explanation and optional narrowed target. Failing-path relevance and failure-class checks are out of scope for this function (owned by guardrails, Phase 4).
- **FR-020**: System MUST store trust state per workflow, keyed by workflow ID. Requesting trust for a workflow not present in the store returns empty trust without error.
- **FR-021**: System MUST remove stale trust records for nodes that no longer exist in the current graph during change detection.

### Key Entities

- **NodeTrustRecord**: A per-node record of validation evidence: content hash at validation time, run ID, timestamp, validation layer, and fixture hash. Keyed by `NodeIdentity`.
- **TrustState**: Per-workflow collection of `NodeTrustRecord` entries plus a connections hash and a `schemaVersion` for forward compatibility. The unit of persistence.
- **NodeChangeSet**: The diff between two workflow snapshots: added, removed, modified (with sub-classified change kinds), and unchanged nodes.
- **RerunAssessment**: Evaluation of whether a validation target is low-value to re-validate: includes confidence level, explanation, and optional narrowed target suggestion.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Content hashing produces identical hashes for identical node content 100% of the time, regardless of property insertion order.
- **SC-002**: Change detection correctly classifies all node change kinds (parameter, expression, type-version, credential, execution-setting, position-only, metadata-only, connection) with zero misclassifications on test fixtures.
- **SC-003**: Trust invalidation propagates forward-only: in a chain of N nodes, changing node K invalidates nodes K through N but never nodes 1 through K-1.
- **SC-004**: Trust state round-trips through persistence with no data loss: write followed by read produces equivalent state.
- **SC-005**: The workflow-level quick check avoids node-level diffing when graphs are identical, completing in constant time relative to graph size.
- **SC-006**: Rename detection correctly identifies and transfers trust for at least 95% of simple rename cases (same type, version, and parameters) in test fixtures.
- **SC-007**: All trust queries (`isTrusted`, `getTrustedBoundaries`, `getUntrustedNodes`, `getRerunAssessment`) return correct results for all test fixture scenarios without false positives or false negatives.
- **SC-008**: All functionality is testable with graph fixtures alone, requiring no running n8n instance.

## Assumptions

- The `WorkflowGraph` type provided by static analysis (Phase 2) is available and correctly constructed. This subsystem consumes it but does not build it.
- `NodeIdentity` is a branded string matching `propertyName`, as defined in INDEX.md. Node identity is stable across snapshots when the node name does not change.
- Canonical JSON serialization with sorted keys (via `json-stable-stringify` or equivalent) is deterministic across Node.js versions and platforms.
- SHA-256 via Node.js `crypto` module provides sufficient collision resistance for content hashing purposes.
- Trust state files are small enough to read and write atomically for practical purposes. No file-locking mechanism is required; concurrent write conflicts are resolved by last-write-wins.
- The `GraphNode` type includes all trust-relevant properties needed for content hashing (`type`, `typeVersion`, `parameters`, `credentials`, `disabled`). Execution settings (`retryOnFail`, `executeOnce`, `onError`) are accessible from the node's parameters or a known location in the AST.

## Dependencies

- **Phase 2 (Static Analysis)**: Provides `WorkflowGraph` and `GraphNode` types. This subsystem depends on the graph being already constructed.
- **Shared types (Phase 1)**: `TrustState`, `NodeTrustRecord`, `NodeChangeSet`, `NodeModification`, `ChangeKind`, `NodeIdentity`, `ValidationLayer`, `WorkflowGraph`, `GraphNode`, `Edge`.
- **External**: `json-stable-stringify` (or equivalent) for canonical JSON serialization. SHA-256 via Node.js `crypto` module.
