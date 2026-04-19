# Feature Specification: Shared Cross-Subsystem Types

**Feature Branch**: `001-shared-types`  
**Created**: 2026-04-18  
**Status**: Draft  
**Input**: User description: "Phase 1 — Shared types: All cross-subsystem types from INDEX.md exist as TypeScript source, importable by every subsystem."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Subsystem Developer Imports Shared Types (Priority: P1)

A developer building any downstream subsystem (static analysis, trust, guardrails, execution, diagnostics, or request interpretation) imports shared type definitions from a central `types` module. They get correct type-checking, autocompletion, and compile-time guarantees that their data structures conform to the cross-subsystem contracts defined in the specification index.

**Why this priority**: Every other phase depends on these types existing and being correct. Without importable shared types, no subsystem can be built. This is the foundational dependency for the entire project.

**Independent Test**: Can be fully tested by importing each type into a test file, constructing values of each type, and verifying the project compiles successfully. Delivers the shared vocabulary that all subsequent phases build on.

**Acceptance Scenarios**:

1. **Given** the shared types module exists, **When** a developer imports `WorkflowGraph`, `GraphNode`, `Edge`, and `NodeClassification`, **Then** they can construct valid instances and the project compiles without errors.
2. **Given** the shared types module exists, **When** a developer imports `SliceDefinition`, `PathDefinition`, and `ValidationTarget`, **Then** they can construct values representing workflow regions and validation targets that compile correctly.
3. **Given** the shared types module exists, **When** a developer imports `TrustState`, `NodeChangeSet`, and `GuardrailDecision`, **Then** they can construct values representing trust records, change sets, and guardrail outcomes that compile correctly.

---

### User Story 2 - Discriminated Unions Narrow Correctly (Priority: P1)

A developer uses TypeScript's narrowing on discriminated union types (`GuardrailDecision`, `DiagnosticError`, `ValidationTarget`, `AgentTarget`) and gets correct type inference in each branch. For example, when checking `decision.action === 'narrow'`, TypeScript knows `narrowedTarget` exists. When checking `error.classification === 'expression'`, TypeScript knows `context.expression` exists.

**Why this priority**: Discriminated unions are a core design decision (per the constitution: "discriminated unions over optional fields"). If narrowing does not work, consumers will need unsafe casts or redundant checks, violating the contract-driven boundaries principle.

**Independent Test**: Can be tested with type-level assertion tests that verify discriminant narrowing produces the expected type in each branch. No runtime code needed.

**Acceptance Scenarios**:

1. **Given** a `GuardrailDecision` value, **When** the developer narrows on `action === 'narrow'`, **Then** TypeScript infers the `narrowedTarget` field is present and typed as `ValidationTarget`.
2. **Given** a `DiagnosticError` value, **When** the developer narrows on `classification === 'expression'`, **Then** TypeScript infers the `context` field contains `expression`, `parameter`, and `itemIndex` properties.
3. **Given** a `ValidationTarget` value, **When** the developer narrows on `kind === 'slice'`, **Then** TypeScript infers the `slice` field is present and typed as `SliceDefinition`.

---

### User Story 3 - Branded NodeIdentity Prevents Accidental String Assignment (Priority: P2)

A developer attempts to pass a plain string where a `NodeIdentity` is expected and gets a compile-time error. This prevents accidental misuse where arbitrary strings (display names, user input, etc.) are treated as node identifiers without explicit conversion.

**Why this priority**: The branded type is a safety mechanism that prevents a class of bugs (wrong-string-kind bugs). Important but secondary to having the types exist at all.

**Independent Test**: Can be tested with a type-level assertion that verifies a plain `string` is not assignable to `NodeIdentity`.

**Acceptance Scenarios**:

1. **Given** a function that accepts `NodeIdentity`, **When** a developer passes a plain `string` literal, **Then** TypeScript reports a compile-time type error.
2. **Given** a `NodeIdentity` value, **When** a developer passes it where a `string` is expected, **Then** the assignment succeeds (branded types are structurally compatible with their base type in the consuming direction).

---

### Edge Cases

- What happens when a type references another shared type (e.g., `GuardrailEvidence` referencing `NodeIdentity`)? All shared types must be importable from a single module entry point so circular references are avoided.
- What happens when a consumer needs to construct a `NodeIdentity` from a raw string? A type-safe factory or assertion function must be available.
- What happens when `WorkflowAST` from the n8nac transformer is referenced? The type must be imported from the external dependency, not redefined.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide all shared types defined in the specification index (`docs/reference/INDEX.md`) as importable TypeScript type definitions.
- **FR-002**: The system MUST organize types in a `src/types/` directory with a barrel export (index file) that re-exports all public types.
- **FR-003**: The system MUST define `NodeIdentity` as a branded string type that prevents accidental assignment from plain strings.
- **FR-004**: The system MUST provide a factory function to create `NodeIdentity` values from strings. The factory MUST reject empty strings by throwing a typed error.
- **FR-005**: The system MUST define all discriminated unions (`GuardrailDecision`, `DiagnosticError`, `ValidationTarget`, `AgentTarget`) such that TypeScript's control-flow narrowing works correctly on the discriminant field.
- **FR-006**: The system MUST define `NodeClassification` as a string literal union type (`'shape-preserving' | 'shape-augmenting' | 'shape-replacing' | 'shape-opaque'`).
- **FR-007**: The system MUST define `ValidationLayer` as a string literal union type (`'static' | 'execution' | 'both'`).
- **FR-008**: The system MUST define `ChangeKind` as a string literal union type with all eight change kinds, distinguishing trust-breaking from trust-preserving kinds.
- **FR-009**: The system MUST define `ErrorClassification` as a derived type from the `DiagnosticError` discriminant.
- **FR-010**: The system MUST reference `WorkflowAST` from the `@n8n-as-code/transformer` package rather than redefining it.
- **FR-011**: The system MUST compile under strict TypeScript settings (strict mode, no implicit any, no unused locals).
- **FR-012**: The system MUST include type-level tests that verify discriminated union narrowing and branded type safety.

### Key Entities

- **WorkflowGraph**: The central traversable graph representation of a workflow, containing nodes, forward/backward adjacency maps, and the original AST. Used by static analysis, trust, guardrails, and orchestration.
- **GraphNode**: A single node in the workflow graph with identity, type metadata, parameters, credentials, disabled state, and classification.
- **Edge**: A directed connection between two nodes, including output/input indices and error-output flag.
- **NodeIdentity**: A branded string type representing the stable identifier for a node within a graph (the property name from n8nac).
- **SliceDefinition**: A bounded region of the graph relevant to a change or validation, with seed nodes, entry points, and exit points.
- **PathDefinition**: An ordered execution route through a slice, the concrete unit of validation.
- **AgentTarget / ValidationTarget**: What the agent requests vs. what the system resolves as the validation scope.
- **ValidationLayer**: Which evidence layer (static, execution, both) is used.
- **TrustState / NodeTrustRecord**: Per-workflow trust records tracking what has been validated, by what layer, and when.
- **NodeChangeSet / NodeModification / ChangeKind**: The result of diffing two workflow snapshots at node granularity.
- **GuardrailDecision / GuardrailAction / GuardrailEvidence**: The outcome of guardrail evaluation, including the action taken, explanation, and supporting evidence.
- **DiagnosticSummary**: The canonical output of every validation run, with status, errors, annotations, path, hints, capabilities, and metadata.
- **DiagnosticError / ErrorClassification**: Classified errors with context varying by classification (wiring, expression, credentials, external-service, platform, cancelled, unknown).
- **NodeAnnotation / DiagnosticHint**: Per-node validation status and runtime hints.
- **AvailableCapabilities / ValidationMeta**: Metadata about what capabilities were available and details of the validation run itself.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All type definitions from the specification index compile successfully under strict TypeScript settings with zero errors.
- **SC-002**: Every discriminated union type narrows correctly in type-level tests, covering all variants of each union.
- **SC-003**: The branded `NodeIdentity` type rejects plain string assignment in type-level tests.
- **SC-004**: All shared types are importable from the package entry point (`src/index.ts`).
- **SC-005**: No runtime code is required for this phase — all deliverables are pure type definitions (with the exception of the `NodeIdentity` factory/assertion function).
- **SC-006**: Downstream subsystem developers can start building against these types immediately upon phase completion, with no missing or mismatched type references.

## Assumptions

- The `@n8n-as-code/transformer` package is installed and provides the `WorkflowAST`, `NodeAST`, and `ConnectionAST` types needed by `WorkflowGraph`. If these types are not yet available, temporary type stubs may be used as a stop-gap, documented as requiring replacement.
- The type definitions faithfully transcribe the canonical definitions in `docs/reference/INDEX.md`. Any intentional deviations are documented with rationale.
- Types internal to individual subsystem specs (e.g., `ExpressionReference`, `PinData`, `ValidationRequest`) are explicitly out of scope for this phase and will be defined in their respective subsystem phases.
