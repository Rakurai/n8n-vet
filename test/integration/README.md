# Integration Tests

End-to-end tests verifying n8n-vet's full pipeline against a live n8n instance.

## Prerequisites

1. **n8n instance running** — `curl http://localhost:5678/api/v1/workflows` returns 200
2. **n8n API key** — set `N8N_API_KEY` env var (Settings → API → Create API Key)
3. **n8n MCP token** — set `N8N_MCP_TOKEN` env var (Settings → MCP Server → Generate Token, audience `mcp-server-api`)
4. **n8nac CLI available** — `n8nac --version` succeeds
5. **n8nac configured** — `n8nac instance list --json` shows active instance
6. **Node.js 20+** — `node --version`
7. **Project built** — `npm run build` succeeds
8. **Dependencies installed** — `npm install`

### Environment Variables

Copy `.env.example` to `.env` and fill in your values, or set them via
`.vscode/settings.json` (terminal env injection). Both are gitignored.

| Variable | Required | Description |
|---|---|---|
| `N8N_HOST` | Yes | n8n instance URL (default: `http://localhost:5678`) |
| `N8N_API_KEY` | Yes | REST API key for seeding and MCP access workaround |
| `N8N_MCP_URL` | No | MCP server URL (default: `${N8N_HOST}/mcp-server/http`) |
| `N8N_MCP_TOKEN` | Yes | MCP server bearer token (audience `mcp-server-api`) |

> **Note:** End users of n8n-vet configure MCP servers via `claude mcp add`
> (or their client's equivalent). These env vars are only for integration
> test development.

## First-Time Setup

```bash
npm run build
npx tsx test/integration/seed.ts
git add test/integration/fixtures/
```

## Running Tests

```bash
# Check prerequisites only
npx tsx test/integration/run.ts --check

# Run all 8 scenarios
npx tsx test/integration/run.ts

# Run a single scenario
npx tsx test/integration/run.ts --scenario 04

# Verbose output (print diagnostic summaries)
npx tsx test/integration/run.ts --verbose
```

## Refreshing Fixtures

Re-run when n8n upgrades or adding new fixtures:

```bash
npx tsx test/integration/seed.ts
git diff test/integration/fixtures/
```

## Debugging Failures

1. Run failing scenario in isolation: `npx tsx test/integration/run.ts --scenario 03 --verbose`
2. Check workflow on n8n (names start with `n8n-vet-test--`)
3. Check execution history: `n8nac execution list --workflow-id <id>`
4. Failure messages include fixture name, expected outcome, and actual outcome
