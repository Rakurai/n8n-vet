# Quickstart: Static Analysis Subsystem

## What this subsystem does

Parses n8n workflow files (TypeScript or JSON) into a traversable graph, classifies nodes by how they affect data shape, traces expression references, and detects structural bugs (data loss, broken references, missing parameters) — all locally, without a running n8n instance.

## Prerequisites

- Node.js 20+
- `@n8n-as-code/transformer` installed (required)
- `@n8n-as-code/skills` installed (optional — enables parameter validation)

## Usage

```typescript
import { buildGraph, traceExpressions, detectDataLoss, parseWorkflowFile } from './static-analysis/graph.js';

// 1. Parse a workflow file
const ast = await parseWorkflowFile('./my-workflow.ts');

// 2. Build the graph
const graph = buildGraph(ast);

// 3. Get all node identities in scope
const allNodes = [...graph.nodes.keys()].map(nodeIdentity);

// 4. Trace expression references
const refs = traceExpressions(graph, allNodes);

// 5. Detect data loss
const findings = detectDataLoss(graph, refs, allNodes);
```

## Running tests

```bash
npm test -- --run test/static-analysis/
```

## Key files

| File | Purpose |
|------|---------|
| `src/static-analysis/graph.ts` | Graph construction from WorkflowAST |
| `src/static-analysis/classify.ts` | Node classification (shape-preserving/augmenting/replacing/opaque) |
| `src/static-analysis/expressions.ts` | Expression reference extraction |
| `src/static-analysis/data-loss.ts` | Data-loss-through-replacement detection |
| `src/static-analysis/schemas.ts` | Schema compatibility checking |
| `src/static-analysis/params.ts` | Node parameter validation |
| `src/static-analysis/errors.ts` | MalformedWorkflowError, ConfigurationError |
| `src/static-analysis/node-sets.ts` | Known node type classification sets |
