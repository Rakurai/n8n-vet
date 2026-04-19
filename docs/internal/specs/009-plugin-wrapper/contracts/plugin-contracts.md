# Plugin Manifest Contract

The Claude Code plugin system consumes `.claude-plugin/plugin.json`. This contract defines what the plugin system expects and what n8n-vet provides.

## Schema

```json
{
  "name": "n8n-vet",
  "version": "<semver matching package.json>",
  "description": "<string>",
  "author": { "name": "<string>" },
  "repository": "<url>",
  "license": "MIT",
  "keywords": ["<string>", ...],
  "userConfig": {
    "n8n_host": {
      "description": "<string>",
      "sensitive": false
    },
    "n8n_api_key": {
      "description": "<string>",
      "sensitive": true
    }
  }
}
```

## Invariants

1. `name` must be a valid plugin identifier (lowercase, alphanumeric + hyphens).
2. `version` must be valid semver and must equal the `version` field in the root `package.json`.
3. `userConfig` keys are exported to subprocesses as `CLAUDE_PLUGIN_OPTION_<key>` env vars.
4. `sensitive: true` values are stored in the system keychain, never in plaintext on disk.
5. `sensitive: false` values are stored in `settings.json` under `pluginConfigs[n8n-vet].options`.
6. Both `userConfig` fields are optional — the plugin must function for static-only validation when unconfigured.

## MCP Server Contract

The `.mcp.json` file declares the MCP server. Template variables are resolved by the Claude Code runtime before process creation.

```json
{
  "mcpServers": {
    "n8n-vet": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/serve.js"],
      "env": {
        "N8N_HOST": "${user_config.n8n_host}",
        "N8N_API_KEY": "${user_config.n8n_api_key}",
        "N8N_VET_DATA_DIR": "${CLAUDE_PLUGIN_DATA}",
        "NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules"
      }
    }
  }
}
```

## Invariants

1. The `dist/mcp/serve.js` file must exist at `${CLAUDE_PLUGIN_ROOT}` after build.
2. When `user_config.n8n_host` or `user_config.n8n_api_key` are not set, the env var value will be empty string (not undefined). The MCP server must handle empty values as "unconfigured."
3. `N8N_VET_DATA_DIR` is the canonical env var for all persistent data paths (trust state, snapshots).
4. `NODE_PATH` ensures runtime dependencies installed in `${CLAUDE_PLUGIN_DATA}/node_modules` are resolvable.

## SessionStart Hook Contract

The `hooks/hooks.json` file declares a SessionStart hook for dependency management.

### Behavior Contract

1. On session start, compare `${CLAUDE_PLUGIN_ROOT}/package.json` with `${CLAUDE_PLUGIN_DATA}/package.json`.
2. If files differ or cached copy absent: run `npm install --production` in `${CLAUDE_PLUGIN_DATA}`, then copy `package.json`.
3. If files match: skip install (no-op).
4. On install failure: non-zero exit code surfaces as a session error. Cached `package.json` is removed so the next session retries.

## Skill Contract

The skill at `skills/validate-workflow/SKILL.md` is consumed by the Claude Code skill discovery and activation system.

### Frontmatter Contract

```yaml
name: validate-workflow         # must match directory name
description: <1024 chars max>   # trigger keywords for routing
license: MIT
compatibility: <environment description>
metadata:
  author: <string>
  version: <string>
```

### Content Contract

1. Body should be under 500 lines (token budget for skill activation).
2. Must document when and how to call `validate`, `trust_status`, `explain`.
3. Must encode bounded validation philosophy: static-first, trust reuse, guardrail respect.
