# Quickstart: Audit Findings Remediation

## Prerequisites
- Node.js 20+
- Live n8n instance at `localhost:5678` (for API contract verification)
- n8n source at `../n8n` (for reference)

## Build & Test
```bash
npm install
npm run build     # tsc
npm test          # vitest run
```

## Verify REST API contracts
```bash
# Trigger a workflow execution and inspect the response shape
curl -X POST http://localhost:5678/api/v1/workflows/{id}/run \
  -H "X-N8N-API-KEY: {key}" \
  -H "Content-Type: application/json" \
  -d '{"destinationNode":{"nodeName":"...","mode":"inclusive"},"pinData":{}}'

# Get execution data
curl http://localhost:5678/api/v1/executions/{id}?includeData=true \
  -H "X-N8N-API-KEY: {key}"
```

## Lint
```bash
npx biome check src/
npx biome check --write src/  # auto-fix
```

## Key files for each severity tier
- **S0**: `src/orchestrator/interpret.ts`, `src/execution/rest-client.ts`, `src/trust/change.ts`, `src/trust/trust.ts`, `src/trust/persistence.ts`
- **S1**: `src/types/graph.ts`, `src/orchestrator/snapshots.ts`, `src/execution/mcp-client.ts`, `src/execution/capabilities.ts`, `src/execution/lock.ts`, `src/execution/pin-data.ts`
- **S2**: `src/orchestrator/resolve.ts`, `src/guardrails/evaluate.ts`, `src/orchestrator/path.ts`, `src/guardrails/evidence.ts`, `src/static-analysis/expressions.ts`, `src/static-analysis/graph.ts`, `src/static-analysis/node-sets.ts`, `src/mcp/server.ts`, `src/errors.ts`
