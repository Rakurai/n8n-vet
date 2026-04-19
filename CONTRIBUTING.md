# Contributing to n8n-vet

## Prerequisites

- Node.js >= 20
- A running n8n instance (default: `http://localhost:5678`)
- [n8nac](https://github.com/EtienneLescot/n8n-as-code) CLI installed and configured
- n8n API key (Settings → API → Create API Key)
- n8n MCP server token (Settings → MCP Server → Generate Token, audience `mcp-server-api`)

## Getting Started

```sh
git clone <repo-url> && cd n8n-vet
npm install
npm run build
```

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | TypeScript compilation |
| `npm test` | Run unit tests (vitest) |
| `npm run test:watch` | Watch mode |
| `npm run test:integration` | Integration tests against live n8n |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | Lint with Biome |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format with Biome |

## Environment Variables

Copy `.env.example` to `.env` and fill in values, or use `.vscode/settings.json`
(terminal env injection). Both are gitignored.

| Variable | Required | Description |
|----------|----------|-------------|
| `N8N_HOST` | Yes | n8n instance URL (default: `http://localhost:5678`) |
| `N8N_API_KEY` | Yes | REST API key — used only for seeding and the `availableInMCP` workaround |
| `N8N_MCP_URL` | No | MCP server URL (default: `${N8N_HOST}/mcp-server/http`) |
| `N8N_MCP_TOKEN` | Yes | MCP server bearer token (audience `mcp-server-api`) |

## MCP Server Configuration

n8n-vet needs two MCP servers available at runtime:

1. **n8n-mcp** — n8n's built-in MCP server for workflow execution
2. **n8nac** — n8n-as-code's MCP server for workflow authoring

End users configure these via their MCP client:

```sh
# Claude Code
claude mcp add n8n-mcp --transport http --url http://localhost:5678/mcp-server/http
claude mcp add n8nac -- npx --yes n8nac mcp

# VS Code (settings.json) — add to mcp.servers
```

For integration testing, the env vars above are used instead.

## Integration Tests

Integration tests run against a live n8n instance. They exercise the full
pipeline: parse → graph → trust → target → guardrails → analysis → execution → diagnostics.

### First-Time Setup

```sh
# 1. Set env vars (see above)
# 2. Configure n8nac to point at your n8n instance
n8nac instance add --yes --host $N8N_HOST --api-key $N8N_API_KEY --project-index 1

# 3. Seed test workflows on n8n
npm run build
npx tsx test/integration/seed.ts

# 4. Commit the fixtures (they're static git-distributed artifacts)
git add test/integration/fixtures/
```

### Running

```sh
npm run test:integration              # All 9 scenarios
npx tsx test/integration/run.ts --scenario 02   # Single scenario
npx tsx test/integration/run.ts --verbose        # With diagnostic output
npx tsx test/integration/run.ts --check          # Prerequisites only
```

### Adding a New Fixture

1. Add the workflow definition to `test/integration/seed.ts` in the `FIXTURES` object
2. Run `npx tsx test/integration/seed.ts --fixture <name>` to create and pull it
3. Set `availableInMCP: true` in the pulled `.ts` file's `settings`
4. Add the fixture name to `manifest.json` (seed.ts does this automatically)
5. Write a scenario in `test/integration/scenarios/`
6. Register the scenario in `test/integration/run.ts`

### The `availableInMCP` Workaround

n8n requires `availableInMCP: true` in workflow settings for MCP tool calls to work.
Older n8nac versions strip this flag on push. The integration test setup detects this
and re-enables it via REST API if needed, caching the result in
`test/integration/fixtures/.local-state.json` (gitignored).

This is the **only** use of the n8n REST API in n8n-vet. It will be removed when the
minimum supported n8nac version preserves the flag.

## Project Structure

```
src/
  static-analysis/    Graph parsing, expression tracing, schema validation
  trust/              Content hashing, change detection, trust persistence
  guardrails/         Proceed/narrow/redirect/refuse decisions
  execution/          MCP client for test_workflow / get_execution
  diagnostics/        Structured summaries from static + execution results
  orchestrator/       Request interpretation, path selection, snapshots
  mcp/                MCP server (validate, trust_status, explain tools)
  cli/                CLI commands
  types/              Shared domain types
test/
  integration/        End-to-end tests against live n8n
    fixtures/         Seeded workflow .ts files (committed)
    lib/              Test infrastructure (setup, MCP client, helpers)
    scenarios/        Individual test scenarios
docs/                 Design docs, specs, research
```

## Code Discipline

- **Strict TypeScript, ESM** — `"type": "module"` in package.json
- **Fail-fast** — no defensive fallbacks. Let errors raise.
- **Contract-driven** — validate at boundaries, trust internally
- **No over-engineering** — only make changes that are directly necessary
- **Comments** — explain intent or invariants only. Don't narrate obvious operations.

See [docs/CODING.md](docs/CODING.md) for the full coding standard.
