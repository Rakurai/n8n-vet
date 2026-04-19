# Data Model: Plugin Wrapper

This phase introduces no new domain entities. The plugin wrapper is a configuration and integration layer over existing subsystems. This document describes the configuration data shapes that the plugin system manages.

## Plugin Manifest Schema

The plugin manifest at `.claude-plugin/plugin.json` declares the plugin's identity and configuration interface.

**Fields**:
- `name` (string): Plugin identifier. Value: `n8n-vet`.
- `version` (string): Must equal `package.json` version. Semver format.
- `description` (string): Human-readable summary.
- `author` (object): `{ name: string }`.
- `repository` (string): Repository URL.
- `license` (string): `MIT`.
- `keywords` (string[]): Discoverability tags.
- `userConfig` (object): User-configurable values. Two fields:
  - `n8n_host` — `{ description: string, sensitive: false }`. Stored in plaintext config.
  - `n8n_api_key` — `{ description: string, sensitive: true }`. Stored in system keychain.

**Relationships**: The `version` field is derived from `package.json` at build/publish time. No runtime sync — version is set once during plugin packaging.

## MCP Server Configuration

The `.mcp.json` file declares the MCP server process and its environment.

**Fields**:
- `mcpServers.n8n-vet.command` (string): `node`
- `mcpServers.n8n-vet.args` (string[]): `["${CLAUDE_PLUGIN_ROOT}/dist/mcp/serve.js"]`
- `mcpServers.n8n-vet.env` (object): Environment variables passed to the server process:
  - `N8N_HOST` — from `${user_config.n8n_host}`. May be empty if not configured.
  - `N8N_API_KEY` — from `${user_config.n8n_api_key}`. May be empty if not configured.
  - `N8N_VET_DATA_DIR` — from `${CLAUDE_PLUGIN_DATA}`. Persistent data directory.
  - `NODE_PATH` — from `${CLAUDE_PLUGIN_DATA}/node_modules`. Runtime dependency resolution.

## Trust State Storage Paths

Trust state and snapshot storage location depends on runtime context:

| Mode | Detection | Trust path | Snapshot path |
|------|-----------|------------|---------------|
| Plugin | `N8N_VET_DATA_DIR` env var present | `${N8N_VET_DATA_DIR}/trust-state.json` | `${N8N_VET_DATA_DIR}/snapshots/{workflowId}.json` |
| Standalone | `N8N_VET_DATA_DIR` absent | `.n8n-vet/trust-state.json` | `.n8n-vet/snapshots/{workflowId}.json` |

**Note**: Trust persistence already resolves via `N8N_VET_DATA_DIR`. Snapshot persistence needs alignment (see research.md R6).

## Skill Frontmatter Schema

The skill at `skills/validate-workflow/SKILL.md` uses agentskills.io frontmatter.

**Required fields**:
- `name` (string): `validate-workflow`. Must match directory name.
- `description` (string): Up to 1024 chars. Contains trigger keywords for routing.

**Optional fields**:
- `license` (string): `MIT`
- `compatibility` (string): Target environment description.
- `metadata` (object): `{ author: string, version: string }`.
