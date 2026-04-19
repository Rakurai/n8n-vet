# Phase 9 — Plugin Wrapper

## Goal

Claude Code plugin that bundles the MCP server and provides skills, hooks, and user configuration. The plugin is the primary distribution mechanism for agent consumption — it handles dependency installation, credential management, trust state storage, and skill-based teaching of the product's validation philosophy.

## Context Files

| File | Role |
|------|------|
| `docs/reference/INDEX.md` | Shared types: `TrustState`, `DiagnosticSummary`, `AgentTarget`, `ValidationLayer` |
| `docs/reference/mcp-surface.md` | MCP server this plugin bundles — `validate`, `trust_status`, `explain` tools |
| `docs/CODING.md` | TypeScript rules — fail-fast, contract-driven, no fallbacks, no phantom implementations |
| `docs/CONCEPTS.md` | Shared vocabulary — workflow slice, workflow path, trusted boundary, guardrail, diagnostic summary |
| `docs/VISION.md` | Product philosophy — bounded validation, locality, guardrails as core identity |
| `docs/PRD.md` | Product requirements — agent is the user, structured output, guardrailed experience |

## Scope

**In scope:**
- Plugin manifest (`plugin.json`) with user configuration for n8n host and API key
- MCP server configuration (`.mcp.json`) wiring stdio transport to the bundled server
- SessionStart hook for dependency installation when `package.json` changes
- Validation skill that teaches the agent when and how to call MCP tools
- Trust state storage with dual-mode path resolution (plugin vs standalone)
- CLI binary available as a bare command when the plugin is active

**Out of scope:**
- MCP server implementation (Phase 8)
- MCP tool behavior and request interpretation internals (Phases 7-8)
- Trust state format, invalidation rules, or change detection logic (Phase 3)
- Static analysis, execution, guardrail, or diagnostic internals (Phases 2-6)

## Inputs and Outputs

### Plugin manifest (`plugin.json`)

**Input (user configuration):**
- `n8n_host: string` — n8n instance URL. Non-sensitive. Stored in plaintext config.
- `n8n_api_key: string` — n8n API key. Sensitive. Stored in keychain, never plaintext.

**Output:**
- Plugin metadata: name (`n8n-vet`), version (synced with `package.json`), description, author, repository, keywords
- User config schema declaring both fields with sensitivity annotations

### MCP server config (`.mcp.json`)

**Input:**
- `CLAUDE_PLUGIN_ROOT` — plugin installation root, provided by Claude Code runtime
- `n8n_host` and `n8n_api_key` from user config

**Output:**
- stdio transport configuration: `node ${CLAUDE_PLUGIN_ROOT}/dist/mcp/serve.js`
- Environment variables `N8N_HOST` and `N8N_API_KEY` passed from user config to the server process

### SessionStart hook

**Input:**
- `package.json` at plugin root
- `${CLAUDE_PLUGIN_DATA}/package.json` — cached copy from last install

**Output:**
- Fresh `npm install` into `${CLAUDE_PLUGIN_DATA}` when `package.json` differs from cached copy
- Updated cached `package.json` after successful install
- `NODE_PATH=${CLAUDE_PLUGIN_DATA}/node_modules` set for MCP server runtime

### Trust state storage

**Input:**
- `CLAUDE_PLUGIN_DATA` environment variable (present when running as plugin, absent standalone)

**Output:**
- Plugin mode: trust state persisted in `${CLAUDE_PLUGIN_DATA}/trust/`
- Standalone mode: trust state persisted in `.n8n-vet/` in project root

### CLI binary (`bin/n8n-vet`)

**Input:**
- CLI arguments matching the secondary CLI surface defined in `docs/reference/mcp-surface.md`

**Output:**
- Symlink or wrapper invoking `dist/cli/index.js`
- Available as bare command in Claude Code's Bash tool when plugin is active
- Also usable standalone via `npx n8n-vet`

## Behavior

### 1. Plugin manifest

The manifest at `.claude-plugin/plugin.json` declares:

- **name**: `n8n-vet`
- **version**: read from `package.json` at build time. The manifest version and package version are the same value — no independent versioning.
- **userConfig**: two fields:
  - `n8n_host` — marked non-sensitive. Prompted on first use. Stored in Claude Code's plaintext config under `pluginConfigs[n8n-vet].options`.
  - `n8n_api_key` — marked sensitive. Prompted on first use. Stored in the system keychain (~2KB total limit shared with OAuth tokens). Never written to disk in plaintext.
  - Both values are available as `${user_config.n8n_host}` / `${user_config.n8n_api_key}` in MCP/hook configs, and exported as `CLAUDE_PLUGIN_OPTION_n8n_host` / `CLAUDE_PLUGIN_OPTION_n8n_api_key` env vars to subprocesses.
- **Standard metadata**: description, author, repository URL, keywords for discoverability.

No separate dev/prod configurations. One manifest serves all environments.

**Plugin caching note:** Installed plugins are cached in `~/.claude/plugins/cache/`. The `${CLAUDE_PLUGIN_ROOT}` path changes on each plugin update. All mutable state (trust, node_modules) must go through `${CLAUDE_PLUGIN_DATA}`, which persists across updates. Files written to `${CLAUDE_PLUGIN_ROOT}` will be lost on update.

### 2. MCP server wiring

The `.mcp.json` file at plugin root configures a single MCP server:

- **Transport**: stdio
- **Command**: `node ${CLAUDE_PLUGIN_ROOT}/dist/mcp/serve.js`
- **Environment**: `N8N_HOST` and `N8N_API_KEY` populated from user config values

The MCP server exposes the three tools defined in `docs/reference/mcp-surface.md`: `validate`, `trust_status`, `explain`. Tool descriptions are minimal — the skill is the primary teaching surface for agent behavior.

### 3. Dependency installation hook

A SessionStart hook defined in `hooks/hooks.json`:

1. Compare `package.json` at plugin root against `${CLAUDE_PLUGIN_DATA}/package.json`
2. If the files differ (or the cached copy does not exist), run `npm install --prefix ${CLAUDE_PLUGIN_DATA}` using the plugin's `package.json`
3. Copy `package.json` to `${CLAUDE_PLUGIN_DATA}/package.json` after successful install
4. Set `NODE_PATH=${CLAUDE_PLUGIN_DATA}/node_modules` so the MCP server process resolves runtime dependencies from the plugin data directory

The hook runs at session start. No manual install step is required. If `npm install` fails, the hook raises an error that surfaces in the Claude Code session — it does not silently continue with missing dependencies.

### 4. Validation skill

The skill at `skills/validate-workflow/SKILL.md` is the primary mechanism for teaching the agent how to use n8n-vet. It encodes the product's validation philosophy in agent-consumable form.

**Skill format compliance (agentskills.io spec):**

The SKILL.md frontmatter must include:
- `name: validate-workflow` — required, must match the directory name, lowercase+hyphens only
- `description` — required, up to 1024 chars, should include trigger keywords that help agents decide when to activate (e.g., "validate", "n8n", "workflow", "debug", "test", "data flow", "execution failure")
- `license: MIT` — matches the project license
- `compatibility: Designed for Claude Code` — declares the target environment
- `metadata` — author and version for attribution

The frontmatter `name` field controls the skill's invocation name within the plugin namespace: `/n8n-vet:validate-workflow`.

**Progressive disclosure (agentskills.io recommendation):**
- Frontmatter (~100 tokens): loaded at startup for all skills, used for routing
- SKILL.md body (<5000 tokens recommended): loaded when the skill is activated
- Additional reference files (if needed): loaded on demand

Keep the main SKILL.md under 500 lines. If detailed reference material is needed (e.g., full DiagnosticSummary field reference), move it to a `references/` subdirectory.

**What the skill teaches:**
- When to call `validate` — after a meaningful batch of edits, not after every tiny change
- When to call `trust_status` — to understand what is already trusted before requesting validation
- When to call `explain` — to understand guardrail decisions before force-overriding
- Target selection patterns: `{ kind: 'nodes', nodes: [...] }` for specific nodes, `{ kind: 'changed' }` for whatever changed, `{ kind: 'workflow' }` only when genuinely needed
- Layer selection: `static` first (cheap, local), `execution` when runtime evidence is needed, `both` for thorough validation
- Trust reuse: check trust status, validate only what changed, let the system narrow scope

**Common patterns the skill encodes:**
- "I changed node X, validate it" — target specific nodes, static first
- "Run a smoke test" — target workflow, execution layer
- "Check what's trusted" — call trust_status before deciding what to validate
- "The guardrail refused my request" — call explain, then decide whether to force

The skill is the primary teaching surface. MCP tool descriptions remain minimal (name, parameter schema, one-line description). The skill carries the behavioral guidance.

### 5. Trust state storage path resolution

Trust state storage location depends on runtime context:

- **Plugin mode** (detected by `CLAUDE_PLUGIN_DATA` env var present): `${CLAUDE_PLUGIN_DATA}/trust/`
- **Standalone mode** (detected by `CLAUDE_PLUGIN_DATA` env var absent): `.n8n-vet/` in the project root

Detection is a single env var check at initialization. The trust subsystem receives the resolved path — it does not perform mode detection itself.

Both modes use the same trust state format and file structure. The only difference is the root directory.

### 6. CLI binary

`bin/n8n-vet` is a symlink or thin wrapper that invokes `dist/cli/index.js`.

- When the plugin is active in Claude Code, files in `bin/` are added to the Bash tool's PATH. The binary is available as a bare command (`n8n-vet validate workflow.ts`) without path qualification.
- When installed standalone (`npm install -g n8n-vet` or `npx n8n-vet`), the binary works identically.
- The CLI surface is secondary to the MCP surface — it exists for development and debugging, not agent consumption.

## Acceptance Criteria

- `claude --plugin-dir .` loads the plugin without errors
- MCP tools (`validate`, `trust_status`, `explain`) appear in the tool list after plugin load
- Skill appears in `/help` and is discoverable by the agent
- SessionStart hook runs `npm install` when `package.json` changes between sessions
- SessionStart hook skips install when `package.json` has not changed
- SessionStart hook raises a visible error if `npm install` fails
- Trust state persists in `${CLAUDE_PLUGIN_DATA}/trust/` when running as a plugin
- Trust state persists in `.n8n-vet/` when running standalone (no `CLAUDE_PLUGIN_DATA`)
- Standalone `npx n8n-vet` works without the plugin infrastructure
- `userConfig` prompts for `n8n_host` and `n8n_api_key` on first use
- Sensitive config (`n8n_api_key`) stored in keychain, not plaintext
- Non-sensitive config (`n8n_host`) stored in plaintext config
- Plugin version matches `package.json` version

## Decisions

1. **Single plugin manifest.** No separate dev/prod configurations. One manifest serves all environments.
2. **SessionStart hook handles dependency management.** No manual install step. The hook diffs `package.json` and installs when needed.
3. **Skill is the primary teaching surface.** MCP tool descriptions are minimal (schema + one-line). The skill carries behavioral guidance, validation philosophy, and common usage patterns. This separation keeps tool schemas stable while allowing teaching content to evolve independently.
