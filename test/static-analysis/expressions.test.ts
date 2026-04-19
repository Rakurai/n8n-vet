import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, parseWorkflowFile } from '../../src/static-analysis/graph.js';
import { traceExpressions } from '../../src/static-analysis/expressions.js';
import { nodeIdentity } from '../../src/types/identity.js';
import type { WorkflowGraph } from '../../src/types/graph.js';

const FIXTURES_DIR = resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures/workflows',
);

function makeGraph(
  nodes: Array<{
    name: string;
    displayName: string;
    type: string;
    parameters: Record<string, unknown>;
  }>,
): WorkflowGraph {
  const nodeMap = new Map();
  const displayNameIndex = new Map();
  for (const n of nodes) {
    nodeMap.set(n.name, {
      name: n.name,
      displayName: n.displayName,
      type: n.type,
      typeVersion: 1,
      parameters: n.parameters,
      credentials: null,
      disabled: false,
      classification: 'shape-opaque' as const,
    });
    displayNameIndex.set(n.displayName, n.name);
  }
  return {
    nodes: nodeMap,
    forward: new Map(),
    backward: new Map(),
    displayNameIndex,
    ast: { metadata: { id: 'test', name: 'Test', active: false }, nodes: [], connections: [] },
  };
}

describe('traceExpressions', () => {
  it('detects $json.field reference', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'linear-simple.ts'));
    const graph = buildGraph(ast);

    const refs = traceExpressions(graph, [nodeIdentity('setFields')]);

    expect(refs).toHaveLength(1);
    expect(refs[0].fieldPath).toBe('data');
    expect(refs[0].referencedNode).toBeNull();
    expect(refs[0].resolved).toBe(true);
  });

  it('detects $(\'DisplayName\') reference', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'explicit-references.ts'));
    const graph = buildGraph(ast);

    const refs = traceExpressions(graph, [nodeIdentity('combineData')]);
    const explicitRef = refs.find((r) => r.raw.includes("$('Fetch API')"));

    expect(explicitRef).toBeDefined();
    expect(explicitRef!.referencedNode).toEqual(nodeIdentity('fetchApi'));
    expect(explicitRef!.fieldPath).toBe('name');
    expect(explicitRef!.resolved).toBe(true);
  });

  it('detects $input reference', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'explicit-references.ts'));
    const graph = buildGraph(ast);

    const refs = traceExpressions(graph, [nodeIdentity('combineData')]);
    const inputRef = refs.find((r) => r.raw.includes('$input'));

    expect(inputRef).toBeDefined();
    expect(inputRef!.referencedNode).toBeNull();
    expect(inputRef!.fieldPath).toBe('source');
    expect(inputRef!.resolved).toBe(true);
  });

  it('detects $node["DisplayName"] reference', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'explicit-references.ts'));
    const graph = buildGraph(ast);

    const refs = traceExpressions(graph, [nodeIdentity('combineData')]);
    const nodeRef = refs.find((r) => r.raw.includes('$node["Fetch API"]'));

    expect(nodeRef).toBeDefined();
    expect(nodeRef!.referencedNode).toEqual(nodeIdentity('fetchApi'));
    expect(nodeRef!.fieldPath).toBe('name');
    expect(nodeRef!.resolved).toBe(true);
  });

  it('returns all 4 patterns from combineData', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'explicit-references.ts'));
    const graph = buildGraph(ast);

    const refs = traceExpressions(graph, [nodeIdentity('combineData')]);

    expect(refs.length).toBeGreaterThanOrEqual(4);
  });

  it('handles nested parameters', () => {
    const graph = makeGraph([
      {
        name: 'nested',
        displayName: 'Nested Node',
        type: 'n8n-nodes-base.set',
        parameters: {
          outer: {
            inner: {
              value: '={{ $json.deep }}',
            },
          },
        },
      },
    ]);

    const refs = traceExpressions(graph, [nodeIdentity('nested')]);

    expect(refs).toHaveLength(1);
    expect(refs[0].parameter).toBe('outer.inner.value');
    expect(refs[0].fieldPath).toBe('deep');
    expect(refs[0].resolved).toBe(true);
  });

  it('records unresolvable display names', () => {
    const graph = makeGraph([
      {
        name: 'badRef',
        displayName: 'Bad Ref',
        type: 'n8n-nodes-base.set',
        parameters: {
          value: "={{ $('NonExistent Node').first().json.field }}",
        },
      },
    ]);

    const refs = traceExpressions(graph, [nodeIdentity('badRef')]);

    expect(refs).toHaveLength(1);
    expect(refs[0].resolved).toBe(false);
    expect(refs[0].referencedNode).toBeNull();
  });

  it('records $fromAI() as unresolvable', () => {
    const graph = makeGraph([
      {
        name: 'aiNode',
        displayName: 'AI Node',
        type: 'n8n-nodes-base.set',
        parameters: {
          value: '={{ $fromAI("fieldName", "description") }}',
        },
      },
    ]);

    const refs = traceExpressions(graph, [nodeIdentity('aiNode')]);

    const fromAiRef = refs.find((r) => r.raw.includes('$fromAI'));
    expect(fromAiRef).toBeDefined();
    expect(fromAiRef!.resolved).toBe(false);
    expect(fromAiRef!.referencedNode).toBeNull();
    expect(fromAiRef!.fieldPath).toBeNull();
  });

  it('records dynamic bracket access as unresolvable', () => {
    const graph = makeGraph([
      {
        name: 'dynNode',
        displayName: 'Dynamic Node',
        type: 'n8n-nodes-base.set',
        parameters: {
          value: '={{ $json[variableName] }}',
        },
      },
    ]);

    const refs = traceExpressions(graph, [nodeIdentity('dynNode')]);

    const dynamicRef = refs.find((r) => r.raw.includes('$json['));
    expect(dynamicRef).toBeDefined();
    expect(dynamicRef!.resolved).toBe(false);
    expect(dynamicRef!.fieldPath).toBeNull();
  });
});
