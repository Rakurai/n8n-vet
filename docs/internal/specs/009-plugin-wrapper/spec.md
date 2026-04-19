# Feature Specification: Plugin Wrapper

**Feature Branch**: `009-plugin-wrapper`  
**Created**: 2026-04-19  
**Status**: Draft  
**Input**: User description: "Phase 9 plugin wrapper. Claude Code plugin that bundles the MCP server and provides skills, hooks, and user configuration."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Plugin Installation and MCP Tool Access (Priority: P1)

A developer installs the n8n-vet plugin into Claude Code. After installation, the agent automatically has access to the three MCP tools (`validate`, `trust_status`, `explain`) without any manual configuration of the MCP server. The plugin handles all wiring between Claude Code and the bundled MCP server.

**Why this priority**: Without the plugin loading and exposing MCP tools, no other plugin functionality is usable. This is the foundational integration that makes n8n-vet accessible to agents within Claude Code.

**Independent Test**: Can be fully tested by loading the plugin into Claude Code and verifying that all three MCP tools appear in the tool list and respond to invocations.

**Acceptance Scenarios**:

1. **Given** a fresh Claude Code session with the plugin directory available, **When** the user loads the plugin (`claude --plugin-dir .`), **Then** the MCP server starts via stdio transport and the tools `validate`, `trust_status`, and `explain` appear in the available tool list.
2. **Given** the plugin is loaded, **When** the agent calls any of the three MCP tools with valid input, **Then** the tool returns a structured response matching the defined response envelope format.
3. **Given** the plugin is loaded but the MCP server process fails to start, **When** the agent attempts to call an MCP tool, **Then** a clear error is surfaced in the Claude Code session indicating the server failed.

---

### User Story 2 - Automatic Dependency Installation (Priority: P1)

When a developer starts a new Claude Code session with the plugin active, the plugin automatically ensures its runtime dependencies are installed. If the plugin has been updated (new `package.json`), dependencies are reinstalled without manual intervention. If dependencies are already current, the session starts without delay.

**Why this priority**: The plugin cannot function without its dependencies. Automatic installation removes a manual setup step that would break the zero-configuration promise of plugin distribution.

**Independent Test**: Can be fully tested by starting a session with an empty plugin data directory and verifying dependencies are installed, then starting another session and verifying the install is skipped.

**Acceptance Scenarios**:

1. **Given** a new Claude Code session where `${CLAUDE_PLUGIN_DATA}/package.json` does not exist, **When** the session starts, **Then** the SessionStart hook runs `npm install` and copies `package.json` to the plugin data directory.
2. **Given** a session where the cached `package.json` matches the plugin's current `package.json`, **When** the session starts, **Then** the hook skips installation and the session starts without running `npm install`.
3. **Given** a session where the plugin's `package.json` has changed since the last install, **When** the session starts, **Then** the hook detects the difference, runs `npm install`, and updates the cached copy.
4. **Given** a session where `npm install` fails, **When** the session starts, **Then** the hook raises a visible error in the Claude Code session rather than silently continuing.

---

### User Story 3 - User Configuration for n8n Connection (Priority: P2)

A developer using the plugin for the first time is prompted to provide their n8n instance URL and API key. The URL is stored in plaintext configuration. The API key is stored securely in the system keychain. These values are automatically passed to the MCP server process as environment variables on every session.

**Why this priority**: n8n connection details are required for execution-backed validation. Without them, the plugin can only perform static analysis. Secure credential storage is essential for trust and adoption.

**Independent Test**: Can be fully tested by loading the plugin for the first time, providing configuration values, and verifying the MCP server receives them as environment variables.

**Acceptance Scenarios**:

1. **Given** a first-time plugin load with no existing configuration, **When** the plugin initializes, **Then** the plugin loads successfully and static-only validation is immediately available without prompting for credentials.
2. **Given** no n8n credentials are configured, **When** the agent requests execution-backed validation, **Then** the system returns a clear error indicating credentials are required and how to configure them.
2. **Given** the user has provided both configuration values, **When** the MCP server starts, **Then** it receives `N8N_HOST` and `N8N_API_KEY` as environment variables populated from the stored configuration.
3. **Given** the user has previously configured the plugin, **When** a new session starts, **Then** the stored values are automatically used without re-prompting.
4. **Given** the API key is stored, **When** examining the plugin's plaintext configuration files, **Then** the API key does not appear in any plaintext file on disk.

---

### User Story 4 - Agent Learns Validation Workflow via Skill (Priority: P2)

An agent working on an n8n workflow discovers the validation skill, which teaches it the product's validation philosophy: target specific changed nodes, use static analysis first, check trust before validating, and understand guardrail decisions before force-overriding.

**Why this priority**: The skill is the primary mechanism for teaching agents how to use n8n-vet effectively. Without it, agents would rely solely on tool descriptions and likely fall into broad, wasteful validation patterns.

**Independent Test**: Can be fully tested by verifying the skill appears in `/help`, activating it, and confirming it provides actionable guidance for common validation patterns.

**Acceptance Scenarios**:

1. **Given** the plugin is loaded, **When** the agent queries available skills, **Then** the `validate-workflow` skill is listed and discoverable.
2. **Given** the agent activates the skill, **When** reading the skill content, **Then** it contains guidance for at least these patterns: validating specific changed nodes, running a smoke test, checking trust status, and understanding guardrail refusals.
3. **Given** the agent has read the skill, **When** it needs to validate a workflow change, **Then** the skill content guides it toward bounded targets and static-first layer selection rather than whole-workflow execution.

---

### User Story 5 - Trust State Persistence Across Sessions (Priority: P2)

Trust state accumulated during validation persists between Claude Code sessions. When the developer starts a new session and validates a workflow, previously trusted unchanged nodes are recognized as trusted, avoiding redundant revalidation.

**Why this priority**: Trust persistence is essential to the product's value proposition of reducing redundant reruns. Without it, every session starts from zero trust, forcing full revalidation each time.

**Independent Test**: Can be fully tested by running a validation in one session, ending the session, starting a new session, and verifying that trust status reflects the prior validation.

**Acceptance Scenarios**:

1. **Given** a plugin session where validation has been run and trust state recorded, **When** the session ends and a new session begins, **Then** calling `trust_status` shows the previously trusted nodes.
2. **Given** the plugin is running (CLAUDE_PLUGIN_DATA is set), **When** trust state is written, **Then** it is stored in `${CLAUDE_PLUGIN_DATA}/` (the trust subsystem controls exact file layout within the data directory).
3. **Given** n8n-vet is running standalone (no CLAUDE_PLUGIN_DATA), **When** trust state is written, **Then** it is stored in `.n8n-vet/` in the project root.

---

### User Story 6 - CLI Access Within Plugin Sessions (Priority: P3)

A developer debugging a validation issue can use the `n8n-vet` command directly in Claude Code's Bash tool without path qualification. The CLI provides the same validation capabilities as the MCP tools but with human-readable formatted output.

**Why this priority**: The CLI is a secondary, debug-oriented interface. It provides value for development workflows and troubleshooting but is not required for the primary agent-driven workflow.

**Independent Test**: Can be fully tested by running `n8n-vet validate <workflow>` in the Bash tool during a plugin session and verifying human-readable output.

**Acceptance Scenarios**:

1. **Given** the plugin is active, **When** the user runs `n8n-vet validate <workflow.ts>` in the Bash tool, **Then** the command executes and returns human-readable formatted output.
2. **Given** the plugin is not installed, **When** the user runs `npx n8n-vet validate <workflow.ts>`, **Then** the command works identically to the plugin-hosted version.
3. **Given** the user passes `--json` to the CLI, **When** the command completes, **Then** the output is identical JSON to what the MCP tool would return.

---

### Edge Cases

- What happens when the plugin is loaded but the MCP server binary is missing or corrupted? The plugin must surface a clear error, not silently fail.
- What happens when `CLAUDE_PLUGIN_DATA` points to a read-only directory? The SessionStart hook must raise a visible error.
- What happens when the system keychain is unavailable for storing the API key? The plugin must inform the user that secure storage is required.
- What happens when the agent requests execution-backed validation but no n8n credentials are configured? The system must return a typed configuration error, not silently skip execution.
- What happens when the plugin version changes between sessions? The SessionStart hook detects the `package.json` change and reinstalls dependencies.
- What happens when multiple Claude Code sessions use the same plugin data directory concurrently? Trust state writes should not corrupt each other (last-write-wins is acceptable for v1).

## Clarifications

### Session 2026-04-19

- Q: Should the plugin require n8n credentials before any functionality is available, or allow static-only use without them? → A: Allow static-only use immediately; prompt for credentials only when execution-backed validation is requested.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Plugin MUST declare a manifest with name, version, description, and user configuration schema at `.claude-plugin/plugin.json`.
- **FR-002**: Plugin manifest version MUST match the project's package version. There MUST NOT be independent versioning.
- **FR-003**: Plugin MUST declare two user configuration fields: `n8n_host` (non-sensitive) and `n8n_api_key` (sensitive, stored in keychain). Both fields are optional at plugin load time -- the plugin MUST be usable for static-only validation without them.
- **FR-003a**: When execution-backed validation is requested and n8n credentials are not configured, the system MUST return a clear error indicating that credentials are required for execution and guiding the user to configure them.
- **FR-004**: Plugin MUST configure an MCP server via `.mcp.json` using stdio transport that starts the bundled MCP server process.
- **FR-005**: MCP server configuration MUST pass `N8N_HOST` and `N8N_API_KEY` environment variables from user configuration to the server process.
- **FR-006**: Plugin MUST define a SessionStart hook that compares `package.json` against a cached copy and runs `npm install` when they differ.
- **FR-007**: SessionStart hook MUST copy `package.json` to the plugin data directory after successful installation.
- **FR-008**: SessionStart hook MUST raise a visible error if dependency installation fails. It MUST NOT silently continue with missing dependencies.
- **FR-009**: SessionStart hook MUST skip installation when the cached `package.json` matches the current one.
- **FR-010**: Plugin MUST provide a validation skill at `skills/validate-workflow/SKILL.md` that teaches agents when and how to call the MCP tools.
- **FR-011**: The validation skill MUST encode the product's validation philosophy: bounded targets, static-first layer selection, trust reuse, and guardrail understanding.
- **FR-012**: The validation skill frontmatter MUST comply with the agentskills.io specification: `name`, `description` (with trigger keywords), `license`, `compatibility`, and `metadata` fields.
- **FR-013**: Trust state MUST be stored in `${CLAUDE_PLUGIN_DATA}/` when running as a plugin and in `.n8n-vet/` when running standalone. The trust subsystem controls exact file layout within the data directory.
- **FR-014**: Runtime mode (plugin vs standalone) MUST be detected by checking the presence of the `CLAUDE_PLUGIN_DATA` environment variable.
- **FR-015**: Plugin MUST provide a CLI binary at `bin/n8n-vet` that is available as a bare command in Claude Code's Bash tool when the plugin is active.
- **FR-016**: The CLI binary MUST also work standalone via `npx n8n-vet`.
- **FR-017**: All mutable state (trust data, installed dependencies) MUST be stored in `${CLAUDE_PLUGIN_DATA}`, never in `${CLAUDE_PLUGIN_ROOT}`, because the plugin root is replaced on each update.

### Key Entities

- **Plugin Manifest**: Declares the plugin identity, version, and user configuration schema. Consumed by the Claude Code plugin system.
- **User Configuration**: Two values (`n8n_host`, `n8n_api_key`) that connect the plugin to a specific n8n instance. The host is non-sensitive; the API key is sensitive and keychain-stored.
- **Validation Skill**: A structured document that teaches agents the product's validation workflow and tool usage patterns. Loaded on-demand when the agent activates it.
- **SessionStart Hook**: An automated process that ensures runtime dependencies are installed before the plugin's MCP server needs them.
- **Trust State Store**: Persistent validation confidence data whose storage location depends on runtime context (plugin or standalone).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Plugin loads successfully on the first attempt in a fresh Claude Code session with no prior setup beyond providing n8n connection details.
- **SC-002**: All three MCP tools are accessible to the agent within 10 seconds of session start (after initial dependency installation).
- **SC-003**: Dependency installation runs only when `package.json` has changed, not on every session start.
- **SC-004**: Agent can discover and activate the validation skill without reading external documentation.
- **SC-005**: Trust state persists across sessions -- a node validated in session N is reported as trusted in session N+1 when unchanged.
- **SC-006**: Sensitive credentials (API key) are never stored in plaintext on disk.
- **SC-007**: The CLI command `n8n-vet` is usable both inside plugin sessions (bare command) and outside (via `npx`).
- **SC-008**: The validation skill content stays under 500 lines, keeping startup token cost low while providing actionable guidance for common validation patterns.

## Assumptions

- The Claude Code plugin system supports `plugin.json` manifests with `userConfig` fields including sensitivity annotations.
- The `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` environment variables are reliably provided by the Claude Code runtime.
- The system keychain is available on the target platform for storing sensitive configuration values.
- The agentskills.io skill specification is the correct format for Claude Code skill discovery and activation.
- The MCP server from Phase 8 is complete and functional before this phase begins.
- The `bin/` directory in the plugin root is automatically added to the Bash tool's PATH by the Claude Code plugin system.

## Dependencies

- **Phase 8 (MCP Surface + CLI)**: The MCP server and CLI implementations that this plugin wraps must be complete.
- **Phase 3 (Trust & Change)**: The trust subsystem must support configurable storage paths for dual-mode (plugin vs standalone) operation.
- **Claude Code Plugin System**: The host environment that loads the manifest, manages user configuration, and provides runtime environment variables.
