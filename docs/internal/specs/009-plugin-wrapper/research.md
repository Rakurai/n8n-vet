# Research: Plugin Wrapper

## R1: Plugin Manifest and User Configuration

**Decision**: Use existing `.claude-plugin/plugin.json` structure with `userConfig` supporting `sensitive` annotations.

**Rationale**: Claude Code's plugin system directly supports `userConfig` fields with `sensitive: boolean`. Non-sensitive values go to `settings.json`; sensitive values go to the system keychain (~2KB limit). This is exactly what n8n-vet needs for `n8n_host` (plaintext) and `n8n_api_key` (keychain).

**Alternatives considered**: None — this is the documented plugin API.

**Key finding**: Sensitive config values are exported as `CLAUDE_PLUGIN_OPTION_<KEY>` env vars to subprocesses, and `${user_config.KEY}` template vars work in `.mcp.json` env fields.

## R2: Mutable State Storage

**Decision**: All mutable state (trust, snapshots, node_modules) goes to `${CLAUDE_PLUGIN_DATA}`. Never write to `${CLAUDE_PLUGIN_ROOT}`.

**Rationale**: `CLAUDE_PLUGIN_ROOT` changes on every plugin update (it's a cached copy in `~/.claude/plugins/cache/`). `CLAUDE_PLUGIN_DATA` persists at `~/.claude/plugins/data/{id}/` across updates. Deleted only on plugin uninstall.

**Alternatives considered**: Using `CLAUDE_PLUGIN_ROOT` for node_modules — rejected because root is ephemeral.

**Key finding**: Trust persistence already respects `N8N_VET_DATA_DIR` env var. `.mcp.json` already sets `N8N_VET_DATA_DIR=${CLAUDE_PLUGIN_DATA}`. Snapshot module also accepts `dataDir` parameter but the orchestrator currently calls it without `dataDir` — snapshots use the same `N8N_VET_DATA_DIR` env var resolution internally (via hardcoded `.n8n-vet/snapshots` default, overrideable by adjusting the call). This needs verification that the orchestrator passes the data dir correctly in plugin mode.

## R3: SessionStart Hook Behavior

**Decision**: Use `hooks/hooks.json` with a `SessionStart` hook that diffs `package.json` and conditionally runs `npm install`.

**Rationale**: Claude Code fires `SessionStart` when a session begins or resumes. The hook runs as a shell command. The existing hook uses `diff -q` to compare package.json files.

**Current concern**: The existing hook uses compound shell commands (`||`, `&&`) which violates the CLAUDE.md shell rules for the agent's own Bash calls. However, `hooks.json` commands are executed by the Claude Code runtime, not by the agent's Bash tool — so the compound command restriction does not apply here. The hook is correct as-is for its execution context.

**Key refinement needed**: The hook deletes the cached `package.json` on `npm install` failure (`rm -f`), which means the next session will retry. This is reasonable behavior — not a silent failure, but the error messaging could be clearer. The Claude Code hook system surfaces non-zero exit codes as errors in the session.

## R4: Skill Format Compliance

**Decision**: Use `skills/validate-workflow/SKILL.md` with agentskills.io-compliant frontmatter.

**Rationale**: Required fields are `name` (lowercase+hyphens, matches directory) and `description` (up to 1024 chars with trigger keywords). Optional: `license`, `compatibility`, `metadata`.

**Key finding**: The existing SKILL.md already has correct frontmatter. The body is 60 lines — well under the 500-line recommendation. Progressive disclosure is naturally achieved: frontmatter for routing, body for activation.

## R5: CLI Binary and PATH

**Decision**: Create `bin/n8n-vet` as the plugin-hosted CLI entry point.

**Rationale**: Claude Code automatically adds `bin/` from the plugin root to the Bash tool's PATH. Files there are invokable as bare commands.

**Key finding**: `package.json` already declares `"bin": { "n8n-vet": "./dist/cli/index.js" }`, which handles `npx` standalone use. The `bin/n8n-vet` file in the plugin root needs to be a Node.js wrapper script (with shebang) pointing to `dist/cli/index.js` for the plugin-hosted PATH case.

## R6: Snapshot Path Resolution in Plugin Mode

**Decision**: Verify that snapshots are stored under `${CLAUDE_PLUGIN_DATA}` when running as a plugin.

**Rationale**: The snapshot module defaults to `.n8n-vet/snapshots` and accepts an optional `dataDir`. The orchestrator calls `loadSnapshot(workflowId)` and `saveSnapshot(workflowId, graph)` without `dataDir`. The trust module resolves via `N8N_VET_DATA_DIR` env var. Snapshots need the same resolution to avoid writing to the ephemeral plugin root.

**Finding**: The snapshot module's `snapshotPath` function uses `dataDir ?? SNAPSHOTS_DIR` where `SNAPSHOTS_DIR = '.n8n-vet/snapshots'`. It does NOT check `N8N_VET_DATA_DIR` env var like trust persistence does. This is a gap — snapshots will write to `.n8n-vet/snapshots` relative to CWD instead of to `${CLAUDE_PLUGIN_DATA}/snapshots/` in plugin mode.

**Required fix**: Align the snapshot module's path resolution with trust persistence by checking `process.env.N8N_VET_DATA_DIR` when no explicit `dataDir` is provided. Alternatively, have the orchestrator pass the data dir through.

## R7: Optional n8n Credentials (Static-Only Mode)

**Decision**: Plugin loads and static validation works without n8n credentials configured.

**Rationale**: Per clarification in the spec, the plugin must allow immediate static-only use. Execution-backed validation returns a typed configuration error when credentials are missing.

**Finding**: The execution capabilities module (`src/execution/capabilities.ts`) already detects n8n reachability and reports capability levels. The MCP server needs to handle `undefined`/empty `N8N_HOST` and `N8N_API_KEY` env vars gracefully, returning a configuration error when execution is requested but credentials are absent.
