# Feature Specification: n8nac Sibling Alignment

**Feature Branch**: `014-n8nac-sibling-alignment`  
**Created**: 2026-04-19  
**Status**: Draft  
**Input**: User description: "Phase 14 PRD — correct n8nac relationship model, remove dead code, fix workflowId bug, update docs and skill"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent validates a TypeScript workflow with correct execution ID (Priority: P1)

An agent edits a `.ts` workflow file and calls n8n-vet's `validate` tool. n8n-vet parses the file, runs static analysis, and returns diagnostics. If the agent then pushes the workflow via `n8nac push` and requests execution validation, n8n-vet extracts the correct n8n workflow ID from the `@workflow({ id })` metadata and uses it for MCP execution calls. The agent never needs to know about the ID distinction — n8n-vet resolves it internally.

**Why this priority**: The workflowId conflation bug means execution validation is broken today — MCP calls receive a file path instead of an n8n UUID, causing runtime failures. Fixing this unblocks all execution-layer validation.

**Independent Test**: Can be tested by parsing a `.ts` file with a `@workflow({ id: 'uuid-here' })` decorator and verifying that execution calls receive the UUID while trust/snapshot persistence uses the file path.

**Acceptance Scenarios**:

1. **Given** a `.ts` workflow file with `@workflow({ id: 'abc-123' })` metadata, **When** the agent requests execution validation, **Then** n8n-vet passes `'abc-123'` (not the file path) to MCP `test_workflow`.
2. **Given** a `.ts` workflow file with `@workflow({ id: 'abc-123' })` metadata, **When** trust state is persisted, **Then** the trust key is the project-relative file path (e.g., `workflows/my-flow.ts`), not the n8n UUID.
3. **Given** a `.ts` workflow file missing `metadata.id`, **When** the agent requests execution validation, **Then** n8n-vet returns an error diagnostic: "Workflow file missing metadata.id — cannot execute. Run n8nac push first to assign an n8n ID."
4. **Given** a `.ts` workflow file missing `metadata.id`, **When** the agent requests static-only validation, **Then** validation proceeds normally without error.

---

### User Story 2 - Agent receives clear rejection for JSON workflow files (Priority: P2)

An agent mistakenly passes a `.json` n8n export to n8n-vet. Instead of silently attempting to parse it, n8n-vet immediately rejects it with a clear error directing the user to use n8nac for workflow authoring in TypeScript.

**Why this priority**: Removing dead code eliminates confusion and enforces the correct workflow: all local workflow files are `.ts` files produced by n8nac. JSON parsing was never exercised in practice.

**Independent Test**: Can be tested by calling `parseWorkflowFile('foo.json')` and verifying it throws `MalformedWorkflowError` with a message mentioning n8nac.

**Acceptance Scenarios**:

1. **Given** a file with a `.json` extension, **When** `parseWorkflowFile()` is called, **Then** it throws `MalformedWorkflowError` with a message directing the user to n8nac for TypeScript workflow files.
2. **Given** a file with a `.ts` extension, **When** `parseWorkflowFile()` is called, **Then** parsing proceeds normally as before.
3. **Given** the codebase after this change, **When** searching for JSON parsing logic in `graph.ts`, **Then** no `parseJsonFile()` function or JSON-specific parsing code exists.

---

### User Story 3 - Agent reads skill and understands two-phase validation (Priority: P2)

An agent reads the `validate-workflow` skill documentation and clearly understands that validation happens in two phases: static analysis before `n8nac push` (no n8n instance needed), and execution validation after push (requires deployed workflow). The agent knows that `n8nac push` is its responsibility between phases, and that trust state persists across calls.

**Why this priority**: Without clear skill documentation, agents call validation at the wrong time or miss the static-first optimization. This directly impacts agent efficiency and thrash reduction.

**Independent Test**: Can be tested by reviewing the skill file for explicit mention of static validation before push, n8nac push as agent responsibility, execution validation after push, and trust persistence across calls.

**Acceptance Scenarios**:

1. **Given** the updated skill file, **When** an agent reads it, **Then** it finds explicit instructions for static validation (before push, no n8n instance required).
2. **Given** the updated skill file, **When** an agent reads it, **Then** it finds explicit mention that `n8nac push` is the agent's responsibility between validation phases.
3. **Given** the updated skill file, **When** an agent reads it, **Then** it finds explicit instructions for execution validation (after push, requires deployed workflow).
4. **Given** the updated skill file, **When** an agent reads it, **Then** it finds description of trust persistence — static trust carries forward to execution validation.

---

### User Story 4 - Developer sets up n8n-vet from a fresh clone (Priority: P3)

A new developer clones the repository, follows the README, and gets n8n-vet running. The README clearly lists prerequisites, setup steps, and explains which validation layers work without external dependencies versus which require setup.

**Why this priority**: Without setup documentation, onboarding requires reading source code. This is a friction point but doesn't block existing users.

**Independent Test**: Can be tested by following the README on a fresh machine with Node >= 20 and verifying that `npm install`, `npm run build`, and `npm test` succeed.

**Acceptance Scenarios**:

1. **Given** a fresh clone with Node >= 20, **When** `npm install`, `npm run build`, and `npm test` are run, **Then** all steps complete with zero errors.
2. **Given** the README, **When** a developer reads it, **Then** they find a Prerequisites section listing Node >= 20, n8n instance (for execution), and n8nac (for authoring).
3. **Given** the README, **When** a developer reads it, **Then** they find a Setup section with clone, install, build, and `.env` configuration steps.
4. **Given** `package.json`, **When** inspected, **Then** no `file:` or `link:` dependency references exist and `@n8n-as-code/skills` is not present.

---

### User Story 5 - Documentation accurately describes n8nac as a sibling tool (Priority: P3)

A reader of the project documentation encounters a consistent description: n8nac is a sibling tool coordinated by the agent, not a wrapped dependency. The only package dependency is `@n8n-as-code/transformer` for parsing `.ts` files.

**Why this priority**: Documentation accuracy is important for project understanding but doesn't affect runtime behavior.

**Independent Test**: Can be tested by searching documentation for stale references (ConfigService, skills integration, n8nac-as-dependency) and verifying zero false claims remain.

**Acceptance Scenarios**:

1. **Given** `docs/DESIGN.md`, **When** read, **Then** it describes n8nac as a sibling tool with `@n8n-as-code/transformer` as the only package dependency.
2. **Given** `docs/TECH.md`, **When** read, **Then** it does not list `@n8n-as-code/skills` or reference ConfigService.
3. **Given** `docs/SCOPE.md`, **When** read, **Then** it explicitly lists n8nac wrapping as a non-goal.
4. **Given** `docs/CONCEPTS.md`, **When** read, **Then** it defines two-phase validation as shared vocabulary.
5. **Given** all documentation files, **When** searched for stale n8nac-as-dependency references, **Then** zero false claims are found.

---

### Edge Cases

- What happens when a `.ts` file has an empty `metadata.id` (empty string)? Treated the same as missing — error diagnostic for execution layer.
- What happens when a file has no extension? `parseWorkflowFile()` rejects it with `MalformedWorkflowError`.
- What happens when `metadata.id` contains whitespace only? Treated as missing — error diagnostic for execution layer.
- What happens when the agent requests `layer: 'both'` with missing `metadata.id`? Static analysis proceeds and returns results; execution portion returns an error diagnostic. Both are included in the response.
- What happens when `.env.example` references env vars that don't exist in code? Verification ensures `.env.example` documents exactly the env vars the code actually reads.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST reject `.json` files in `parseWorkflowFile()` with a `MalformedWorkflowError` directing the user to n8nac.
- **FR-002**: System MUST remove `parseJsonFile()` and all JSON-specific parsing logic from `graph.ts`.
- **FR-003**: System MUST extract `n8nWorkflowId` from `WorkflowAST.metadata.id` for all MCP execution calls.
- **FR-004**: System MUST use the file-path-based `workflowFileId` for trust state persistence, snapshot storage, and pin data cache keys.
- **FR-005**: System MUST return an error diagnostic when execution validation is requested but `metadata.id` is missing or empty.
- **FR-006**: System MUST allow static-only validation to proceed without `metadata.id`.
- **FR-007**: The skill file MUST describe two-phase validation: static (before push) and execution (after push).
- **FR-008**: The skill file MUST identify `n8nac push` as the agent's responsibility between validation phases.
- **FR-009**: The skill file MUST describe trust persistence across validation calls.
- **FR-010**: README MUST include a Prerequisites section listing Node >= 20, n8n instance, and n8nac.
- **FR-011**: README MUST include a Setup section with clone, install, build, and `.env` configuration steps.
- **FR-012**: `package.json` MUST NOT contain `@n8n-as-code/skills` in any dependency field.
- **FR-013**: `package.json` MUST NOT contain `file:` or `link:` dependency references.
- **FR-014**: Documentation MUST describe n8nac as a sibling tool, not a wrapped dependency.
- **FR-015**: Documentation MUST NOT reference ConfigService or `@n8n-as-code/skills` as integrated dependencies.
- **FR-016**: `docs/SCOPE.md` MUST list n8nac wrapping as an explicit non-goal.
- **FR-017**: `docs/CONCEPTS.md` MUST define two-phase validation as shared vocabulary.
- **FR-018**: `npm install`, `npm run build`, and `npm test` MUST succeed on a fresh clone with Node >= 20.

### Key Entities

- **workflowFileId**: Project-relative file path (e.g., `workflows/my-flow.ts`). Used for trust state persistence, snapshot storage, and pin data cache keys. Derived from `deriveWorkflowId()`. Stable across n8n instance changes.
- **n8nWorkflowId**: n8n platform identifier (UUID or numeric string) from `WorkflowAST.metadata.id`. Used for MCP execution calls. Assigned by n8n when the workflow is first pushed via `n8nac push`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero JSON parsing code exists in the source tree after completion.
- **SC-002**: All MCP execution calls use the n8n workflow ID from AST metadata, verified by test assertions.
- **SC-003**: Trust and snapshot persistence uses file-path IDs, verified by test assertions.
- **SC-004**: Missing `metadata.id` with execution-layer request produces a clear, actionable error diagnostic 100% of the time.
- **SC-005**: The skill file contains explicit references to all three phases (static, push, execution) of the validation workflow.
- **SC-006**: All documentation files pass a grep audit for stale n8nac-as-dependency references (zero false claims).
- **SC-007**: README contains Prerequisites and Setup sections that enable a new developer to set up without reading source code.
- **SC-008**: `npm install`, `npm run build`, and `npm test` succeed on a fresh clone with zero errors.
- **SC-009**: `npm run typecheck`, `npm test`, and `npm run lint` all pass at zero errors after all changes.

## Assumptions

- `@n8n-as-code/transformer` is published to npm and resolves correctly. No `file:` reference is needed.
- `WorkflowAST.metadata.id` is a string field populated by the `@workflow({ id })` decorator. It may be `undefined` or empty for workflows not yet pushed to n8n.
- Integration tests (`npm run test:integration`) are excluded from the fresh-clone success criterion — they require a running n8n instance.
- `@n8n-as-code/skills` is confirmed unused (no imports) and can be safely removed from `package.json`.
- All documentation files referenced in the PRD exist and are editable.

## Scope Boundaries

### In Scope

- Remove JSON parsing dead code from `graph.ts`
- Fix workflowId conflation bug in orchestrator/execution pipeline
- Update skill documentation for two-phase validation
- Correct documentation to reflect sibling tool model
- Add setup documentation to README
- Remove `@n8n-as-code/skills` from `package.json`
- Verify fresh-clone build/test pipeline

### Out of Scope

- Changes to n8nac itself
- Changes to the `@n8n-as-code/transformer` package
- New validation features or analysis rules
- Changes to the MCP server protocol or tool signatures
- Performance optimization of existing validation
- n8n instance provisioning or configuration automation
