import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, parseWorkflowFile } from '../../src/static-analysis/graph.js';
import { MalformedWorkflowError } from '../../src/static-analysis/errors.js';
import { createBrokenRefAST } from '../fixtures/workflows/malformed-broken-ref.js';
import { createDuplicateNamesAST } from '../fixtures/workflows/malformed-duplicate-names.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';

const FIXTURES_DIR = resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures/workflows',
);

describe('buildGraph', () => {
  it('builds graph from TS fixture', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'linear-simple.ts'));
    const graph = buildGraph(ast);

    expect(graph.nodes.size).toBe(3);
    expect(graph.nodes.has('scheduleTrigger')).toBe(true);
    expect(graph.nodes.has('httpRequest')).toBe(true);
    expect(graph.nodes.has('setFields')).toBe(true);

    // Forward adjacency
    const triggerEdges = graph.forward.get('scheduleTrigger')!;
    expect(triggerEdges).toHaveLength(1);
    expect(triggerEdges[0].to).toBe('httpRequest');

    const httpEdges = graph.forward.get('httpRequest')!;
    expect(httpEdges).toHaveLength(1);
    expect(httpEdges[0].to).toBe('setFields');

    // Backward adjacency
    const httpBackward = graph.backward.get('httpRequest')!;
    expect(httpBackward).toHaveLength(1);
    expect(httpBackward[0].from).toBe('scheduleTrigger');

    // displayNameIndex
    expect(graph.displayNameIndex.get('Schedule Trigger')).toBe('scheduleTrigger');
    expect(graph.displayNameIndex.get('HTTP Request')).toBe('httpRequest');
    expect(graph.displayNameIndex.get('Set Fields')).toBe('setFields');
  });

  it('builds graph from JSON fixture', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'linear-simple.json'));
    const graph = buildGraph(ast);

    expect(graph.nodes.size).toBe(3);
    expect(graph.displayNameIndex.size).toBe(3);
  });

  it('builds graph from branching fixture', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'branching-if.ts'));
    const graph = buildGraph(ast);

    // checkValue (If node) has 2 forward edges: out(0) and out(1)
    const checkValueEdges = graph.forward.get('checkValue')!;
    expect(checkValueEdges).toHaveLength(2);

    // truePath and falsePath each have 1 backward edge from checkValue
    const trueBackward = graph.backward.get('truePath')!;
    expect(trueBackward).toHaveLength(1);
    expect(trueBackward[0].from).toBe('checkValue');

    const falseBackward = graph.backward.get('falsePath')!;
    expect(falseBackward).toHaveLength(1);
    expect(falseBackward[0].from).toBe('checkValue');
  });

  it('handles single trigger edge case', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'single-trigger.ts'));
    const graph = buildGraph(ast);

    expect(graph.nodes.size).toBe(1);
    expect(graph.forward.get('webhookTrigger')).toEqual([]);
    expect(graph.backward.get('webhookTrigger')).toEqual([]);
    expect(graph.displayNameIndex.size).toBe(1);
  });

  it('classifies nodes correctly', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'linear-simple.ts'));
    const graph = buildGraph(ast);

    expect(graph.nodes.get('scheduleTrigger')!.classification).toBe('shape-replacing');
    expect(graph.nodes.get('httpRequest')!.classification).toBe('shape-replacing');
    expect(graph.nodes.get('setFields')!.classification).toBe('shape-augmenting');
  });

  it('throws MalformedWorkflowError for broken connection refs', () => {
    expect(() => buildGraph(createBrokenRefAST())).toThrow(MalformedWorkflowError);
  });

  it('throws MalformedWorkflowError for duplicate names', () => {
    expect(() => buildGraph(createDuplicateNamesAST())).toThrow(MalformedWorkflowError);
  });

  it('constructs graph with cycles without enforcement', () => {
    const cyclicAST: WorkflowAST = {
      metadata: {
        id: 'cyclic-001',
        name: 'Cyclic Test',
        active: false,
      },
      nodes: [
        {
          propertyName: 'nodeA',
          displayName: 'Node A',
          type: 'n8n-nodes-base.noOp',
          version: 1,
          position: [100, 200],
          parameters: {},
        },
        {
          propertyName: 'nodeB',
          displayName: 'Node B',
          type: 'n8n-nodes-base.noOp',
          version: 1,
          position: [300, 200],
          parameters: {},
        },
      ],
      connections: [
        { from: { node: 'nodeA', output: 0 }, to: { node: 'nodeB', input: 0 } },
        { from: { node: 'nodeB', output: 0 }, to: { node: 'nodeA', input: 0 } },
      ],
    };

    const graph = buildGraph(cyclicAST);

    // Graph should have both edges despite the cycle
    const aForward = graph.forward.get('nodeA')!;
    expect(aForward).toHaveLength(1);
    expect(aForward[0].to).toBe('nodeB');

    const bForward = graph.forward.get('nodeB')!;
    expect(bForward).toHaveLength(1);
    expect(bForward[0].to).toBe('nodeA');
  });
});

describe('parseWorkflowFile', () => {
  it('parses .ts file', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'linear-simple.ts'));

    expect(ast.nodes).toHaveLength(3);
  });

  it('parses .json file', async () => {
    const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'linear-simple.json'));

    expect(ast.nodes).toHaveLength(3);
  });

  it('throws MalformedWorkflowError for unsupported extension', async () => {
    await expect(parseWorkflowFile('workflow.yaml')).rejects.toThrow(
      MalformedWorkflowError,
    );
  });
});
