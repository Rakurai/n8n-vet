# Integration Tests

End-to-end tests verifying n8n-vet's full pipeline against a live n8n instance.

## Prerequisites

1. **n8n instance running** — `curl http://localhost:5678/api/v1/workflows` returns 200
2. **n8n API key** — set `N8N_API_KEY` env var or configure via n8nac
3. **n8nac CLI available** — `n8nac --version` succeeds
4. **n8nac configured** — `n8nac config` shows correct host
5. **Node.js 20+** — `node --version`
6. **Project built** — `npm run build` succeeds
7. **Dependencies installed** — `npm install`

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
