# Feature Specification: Static Analysis Subsystem

**Feature Branch**: `002-static-analysis`  
**Created**: 2026-04-18  
**Status**: Draft  
**Input**: User description: "read docs/prd/plan.md and spec phase 2"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Parse Workflow and Build Graph (Priority: P1)

An agent (or developer) provides a workflow file (TypeScript or JSON format) and the tool parses it into a traversable graph representation. The graph captures all nodes, their connections, forward/backward adjacency, and per-node classification (shape-preserving, shape-augmenting, shape-replacing, shape-opaque). This is the foundational capability that every other analysis depends on.

**Why this priority**: Without a correct, traversable graph, no downstream analysis (expression tracing, data-loss detection, schema checking) can function. This is the structural foundation.

**Independent Test**: Can be fully tested by providing a fixture workflow file and verifying that the returned graph has the correct nodes, edges, adjacency maps, and node classifications. Delivers a usable `WorkflowGraph` that later subsystems consume.

**Acceptance Scenarios**:

1. **Given** a TypeScript workflow file, **When** the tool parses it, **Then** a `WorkflowGraph` is produced with all nodes, edges, and correct forward/backward adjacency maps.
2. **Given** a JSON workflow file, **When** the tool parses it, **Then** the same graph structure is produced as with the equivalent TypeScript file.
3. **Given** a workflow with a Set node using `options.include = 'all'`, **When** the tool classifies nodes, **Then** the Set node is classified as shape-augmenting.
4. **Given** a workflow with a Set node using `options.include = 'none'`, **When** the tool classifies nodes, **Then** the Set node is classified as shape-replacing.
5. **Given** a workflow with an unrecognized community node type, **When** the tool classifies nodes, **Then** the unknown node defaults to shape-opaque.
6. **Given** a workflow where a connection references a non-existent node, **When** the tool builds the graph, **Then** it raises an error indicating a malformed workflow.
7. **Given** a workflow with duplicate node names, **When** the tool builds the graph, **Then** it raises an error indicating a malformed workflow.
8. **Given** a workflow where nodes have display names (e.g., "Schedule Trigger") that differ from their property names (e.g., "scheduleTrigger"), **When** the tool builds the graph, **Then** a `displayName → propertyName` index is built for expression resolution.

---

### User Story 2 - Trace Expression References (Priority: P1)

An agent provides a workflow and the tool extracts all expression references from node parameters, identifying which upstream nodes and fields are referenced. This enables downstream data-loss detection and broken-reference checking.

**Why this priority**: Expression tracing is a prerequisite for the two highest-value static findings (data-loss and broken references). Without it, the tool cannot detect the most common structural bugs in n8n workflows.

**Independent Test**: Can be tested by providing a workflow with various expression patterns (`$json.field`, `$('NodeName')...`, `$input...`, `$node["Name"]...`) and verifying extracted references match expectations.

**Acceptance Scenarios**:

1. **Given** a node parameter containing `={{ $json.fieldName }}`, **When** expressions are traced, **Then** an `ExpressionReference` is produced pointing to the immediate upstream node with `fieldPath = 'fieldName'` and `resolved = true`.
2. **Given** a node parameter containing `={{ $('Schedule Trigger').first().json.field }}` where "Schedule Trigger" is a display name, **When** expressions are traced, **Then** the reference resolves through the `displayName → propertyName` lookup to the correct graph node with the correct field path.
3. **Given** a node parameter containing `={{ $input.first().json.field }}`, **When** expressions are traced, **Then** the reference points to the immediate upstream node.
4. **Given** a node parameter containing `={{ $node["Schedule Trigger"].json.field }}` where "Schedule Trigger" is a display name, **When** expressions are traced, **Then** the reference resolves through the display name lookup to the correct graph node (legacy pattern).
5. **Given** an expression with dynamic key access or `$fromAI()`, **When** expressions are traced, **Then** the reference is recorded with `resolved = false`.
6. **Given** a node with deeply nested parameters, **When** expressions are traced, **Then** all expression strings within nested structures are found and parsed.

---

### User Story 3 - Detect Data Loss Through Shape-Replacing Nodes (Priority: P1)

An agent provides a workflow and the tool identifies cases where a `$json.field` reference reads from upstream data that has been replaced by an intervening shape-replacing node (e.g., an API call or credentialed node that produces entirely new output). Critically, it does NOT flag trigger nodes or initial data sources as causing data loss.

**Why this priority**: Data loss through shape replacement is the most common structural bug pattern in agent-built n8n workflows. Catching this statically — before execution — is the single highest-value finding the static analysis subsystem provides.

**Independent Test**: Can be tested with fixture workflows containing the canonical data-loss pattern (trigger -> API node -> Set node referencing `$json.field` from trigger output) and verifying correct findings are produced.

**Acceptance Scenarios**:

1. **Given** a workflow where Node C uses `$json.field` and Node B (shape-replacing, not a first data source) sits between Node A (trigger) and Node C, **When** data-loss detection runs, **Then** a `data-loss` finding with severity `error` is produced for Node C, identifying Node B as the intervening node.
2. **Given** a workflow where a trigger node produces output and the next node references `$json.field`, **When** data-loss detection runs, **Then** no data-loss finding is produced (trigger is a first data source).
3. **Given** a workflow where the first credentialed API node (with no upstream data-producing predecessor) produces output and the next node references `$json.field`, **When** data-loss detection runs, **Then** no data-loss finding is produced (first data source rule).
4. **Given** a workflow where a shape-opaque node (Code node) sits upstream, **When** data-loss detection runs, **Then** an `opaque-boundary` warning is produced instead of a data-loss error.
5. **Given** a workflow with shape-preserving nodes (If, Filter) between the data source and the consumer, **When** data-loss detection runs, **Then** the tool walks through them and applies the same logic to the node beyond.
6. **Given** a branching workflow where one backward path reaches a first data source but another does not, **When** the first-data-source rule is evaluated, **Then** the node is NOT classified as a first data source (all backward paths must satisfy the condition).

---

### User Story 4 - Check Schema Compatibility (Priority: P2)

When upstream node output schemas are available (via n8nac skills), the tool checks whether referenced fields actually exist in the schema. When schemas are not available for a given node, that node's schema check is skipped without affecting the rest of the analysis.

**Why this priority**: Schema checking adds confidence when schema data is available but is inherently optional — many nodes won't have discoverable schemas. It enhances data-loss detection but is not the primary detection mechanism.

**Independent Test**: Can be tested by providing a workflow with a node that has a known output schema and verifying that references to non-existent fields produce `schema-mismatch` warnings, while references to existing fields pass cleanly.

**Acceptance Scenarios**:

1. **Given** an upstream node with a known output schema and a downstream node referencing a field that exists in that schema, **When** schema checking runs, **Then** no finding is produced.
2. **Given** an upstream node with a known output schema and a downstream node referencing a field that does NOT exist in that schema, **When** schema checking runs, **Then** a `schema-mismatch` warning is produced.
3. **Given** an upstream node without a discoverable output schema, **When** schema checking runs, **Then** the check is skipped for that node without error.

---

### User Story 5 - Validate Node Parameters (Priority: P2)

The tool validates each node's parameters against its type definition from n8nac skills. It identifies missing required parameters and undefined credential types.

**Why this priority**: Parameter validation catches configuration errors that would otherwise only surface at execution time. It's a straightforward check that adds value but is less impactful than expression and data-loss analysis.

**Independent Test**: Can be tested by providing a workflow with nodes that have missing required parameters or invalid credential bindings and verifying that `invalid-parameter` or `missing-credentials` findings are produced.

**Acceptance Scenarios**:

1. **Given** a node with all required parameters present and valid, **When** parameter validation runs, **Then** no finding is produced.
2. **Given** a node missing a required parameter, **When** parameter validation runs, **Then** an `invalid-parameter` finding is produced identifying the missing parameter.
3. **Given** a node with an undefined credential type, **When** parameter validation runs, **Then** a `missing-credentials` finding is produced.

---

### User Story 6 - Report Opaque Boundaries (Priority: P3)

When the analysis encounters shape-opaque nodes (Code, Function, AI Transform), it emits warnings indicating that static analysis cannot determine output shape. It recommends execution-backed validation when the changed slice depends on evidence beyond an opaque boundary.

**Why this priority**: Opaque boundary reporting is informational. It doesn't catch bugs directly but guides the agent toward execution-backed validation when static analysis reaches its limits.

**Independent Test**: Can be tested by providing a workflow with a Code node and verifying that an `opaque-boundary` warning is emitted and that downstream `$json.field` references are flagged with reduced confidence.

**Acceptance Scenarios**:

1. **Given** a workflow with a Code node in the analysis path, **When** the analysis runs, **Then** an `opaque-boundary` warning is emitted for that node.
2. **Given** a `$json.field` reference downstream of a Code node, **When** data-loss detection runs, **Then** the reference is flagged as an opaque boundary warning (not a data-loss error).

---

### Edge Cases

- What happens when a workflow file is empty or contains no nodes? The tool raises a parse error (tool failure, not a workflow finding).
- How does the tool handle circular references in connections? n8n workflows are DAGs; if cycles are detected, raise a malformed workflow error.
- What happens when a node has parameters with expressions that reference themselves? Record as `unresolvable-expression` with `resolved = false`.
- How does the tool handle a workflow with only a single trigger node and no other nodes? The graph is valid but produces no static findings (no expressions to trace, no data flow to check).
- What happens when `@n8n-as-code/transformer` or `@n8n-as-code/skills` packages are not installed? Raise a typed configuration error at initialization, before any analysis begins.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST parse both TypeScript (`.ts`) and JSON (`.json`) workflow files into a `WorkflowAST` using `@n8n-as-code/transformer`.
- **FR-002**: System MUST build a `WorkflowGraph` from a `WorkflowAST`, including node map (keyed by `propertyName`), edge list, and forward/backward adjacency maps.
- **FR-003**: System MUST enforce graph invariants: every node referenced in an edge must exist; node names must be unique. Violations raise typed errors.
- **FR-004**: System MUST classify every node into exactly one of four categories: shape-preserving, shape-augmenting, shape-replacing, or shape-opaque.
- **FR-005**: System MUST classify Set nodes based on their `options.include` parameter: `'all'` = shape-augmenting; `'none'` or `'except'` = shape-replacing; `'selected'` = shape-replacing.
- **FR-006**: System MUST default unrecognized/community node types to shape-opaque classification.
- **FR-007**: System MUST build a `displayName → propertyName` index for expression resolution, since n8n expressions like `$('Schedule Trigger')` reference display names while the graph is keyed by property names.
- **FR-008**: System MUST recursively walk all node parameter values to find expression strings (values containing `={{ }}`).
- **FR-009**: System MUST parse expression references matching the four ACCESS_PATTERNS from n8n's reference parser: `$json.field`, `$('DisplayName')...json.field`, `$input...json.field`, `$node["DisplayName"].json.field`.
- **FR-010**: System MUST resolve named expression references (`$('...')` and `$node["..."]`) through the `displayName → propertyName` lookup to connect expression references to graph nodes.
- **FR-011**: System MUST record unparseable expressions (dynamic keys, `$fromAI()`, computed node names) with `resolved = false`.
- **FR-012**: System MUST detect data loss when a `$json.field` reference reads through an intervening shape-replacing node that is not a first data source.
- **FR-013**: System MUST NOT flag first data sources (triggers, initial API/credentialed nodes with no upstream data-producing predecessors) as causing data loss.
- **FR-014**: System MUST evaluate the first-data-source rule across ALL backward paths in branching graphs — a node qualifies only if every backward path satisfies the condition.
- **FR-015**: System MUST check referenced field paths against upstream node output schemas when schemas are available via `NodeSchemaProvider.getNodeSchema()` from `@n8n-as-code/skills`. Output schema discovery is limited in v1 (skills provides input parameter schemas, not output schemas); schema checking degrades gracefully per-node when unavailable.
- **FR-016**: System MUST skip schema checks per-node (not per-run) when output schemas are unavailable.
- **FR-017**: System MUST validate node parameters against type schemas from n8nac skills, flagging missing required parameters and undefined credential types.
- **FR-018**: System MUST emit `opaque-boundary` warnings for shape-opaque nodes in the analysis path.
- **FR-019**: System MUST raise a typed configuration error if `@n8n-as-code/transformer` is unavailable. `@n8n-as-code/skills` is an optional dependency — when absent, schema and parameter validation functions return empty findings without error. Configuration errors use typed error classes, not raw exceptions.
- **FR-020**: System MUST produce structured `StaticFinding[]` output, where each finding has a `kind`, `severity`, `node` (as `NodeIdentity` branded type), `message`, and `context`.
- **FR-021**: System MUST produce `ExpressionReference[]` output with node identity (branded `NodeIdentity`), parameter path, raw expression, referenced node, field path, and resolution status.
- **FR-022**: System MUST support scoped analysis — analyzing only target nodes rather than the entire workflow when a target is specified.
- **FR-023**: System MUST downgrade a data-loss finding from `error` to `warning` when a shape-replacing node has a known output schema and the referenced field exists in it.
- **FR-024**: System MUST expose the cross-subsystem contract defined in INDEX.md: `buildGraph`, `traceExpressions`, `detectDataLoss`, `checkSchemas`, and `validateNodeParams` as the public API surface.

### Key Entities

- **WorkflowGraph**: Traversable graph representation containing nodes (keyed by `propertyName`), edges, forward/backward adjacency maps, and the original AST. The primary structural output of static analysis.
- **GraphNode**: A single node in the graph with `name` (propertyName — stable graph key), `displayName` (n8n's human-readable name used in expressions), type metadata, parameters, credentials, classification, and disabled status.
- **NodeIdentity**: Branded string type (`string & { __brand: 'NodeIdentity' }`) representing a node's `propertyName`. Prevents accidental assignment from arbitrary strings.
- **StaticFinding**: A structured diagnostic finding from analysis, discriminated by `kind` (data-loss, broken-reference, invalid-parameter, unresolvable-expression, schema-mismatch, missing-credentials, opaque-boundary).
- **ExpressionReference**: A parsed expression reference linking a node parameter to a referenced upstream node and field path, with resolution status.
- **NodeClassification**: One of four categories (shape-preserving, shape-augmenting, shape-replacing, shape-opaque) describing how a node transforms its input data shape.
- **DisplayName Index**: A `displayName → propertyName` mapping built during graph construction, required for resolving expression references like `$('Schedule Trigger')` to graph nodes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The tool correctly parses and builds graphs from 100% of valid workflow files in both TypeScript and JSON formats without errors.
- **SC-002**: Node classification matches expected categories for all nodes in the known shape-preserving, shape-replacing, and shape-opaque sets, with zero misclassifications on the maintained node type sets.
- **SC-003**: Expression tracing extracts all four reference patterns (`$json`, `$('Node')`, `$input`, `$node["Name"]`) from workflow fixtures with zero missed references for supported patterns.
- **SC-004**: Data-loss detection catches the canonical bug pattern (shape-replacing node between data source and `$json.field` consumer) in test fixtures while producing zero false positives on first-data-source nodes (triggers, initial API nodes).
- **SC-005**: Schema checking runs when schemas are available and skips cleanly when not, with zero crashes or error propagation from missing schemas.
- **SC-006**: All analysis completes locally without requiring a running n8n instance.
- **SC-007**: The tool raises clear, typed configuration errors when required dependencies are missing, enabling the agent to diagnose setup issues without ambiguity.

## Assumptions

- The n8nac transformer (`@n8n-as-code/transformer`) provides a stable `WorkflowAST` with `NodeAST[]` and `ConnectionAST[]` that can be iterated to build the graph. Parser APIs (`TypeScriptParser.parseFile()`, `JsonToAstParser`) are available and documented.
- The n8nac skills package (`@n8n-as-code/skills`) exposes `NodeSchemaProvider.getNodeSchema()` for input parameter schema lookup and `WorkflowValidator` for structural validation. Output schema discovery is not available in v1; schema compatibility checking is limited to what can be inferred from parameter schemas and node type metadata.
- n8n workflows are directed acyclic graphs (DAGs). Cycles are not valid workflow structures.
- The shape-preserving node set is manually maintained and covers the commonly used n8n routing/flow-control nodes. New node types default to shape-opaque until explicitly categorized.
- Merge node is treated as shape-preserving for v1 regardless of mode.
- Sub-workflow nodes are treated as shape-opaque for v1. Cross-workflow static analysis is deferred.
- The expression parser ports ~200 lines from n8n's `extractReferencesInNodeExpressions()` without depending on the full `n8n-workflow` package.
