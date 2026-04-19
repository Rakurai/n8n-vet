import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, parseWorkflowFile } from '../../src/static-analysis/graph.js';
import { traceExpressions } from '../../src/static-analysis/expressions.js';
import { detectDataLoss } from '../../src/static-analysis/data-loss.js';
import { nodeIdentity } from '../../src/types/identity.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { WorkflowGraph } from '../../src/types/graph.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';
import type { ExpressionReference } from '../../src/static-analysis/types.js';
import type { NodeSchemaProvider } from '../../src/static-analysis/schemas.js';

const FIXTURES_DIR = resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures/workflows',
);

function allNodeIds(graph: { nodes: Map<string, unknown> }): NodeIdentity[] {
  return [...graph.nodes.keys()].map(nodeIdentity);
}

function makeGraph(
  nodes: Array<{
    name: string;
    displayName: string;
    type: string;
    classification: string;
    predecessors?: string[];
  }>,
): WorkflowGraph {
  const nodeMap = new Map();
  const displayNameIndex = new Map();
  const forward = new Map<string, unknown[]>();
  const backward = new Map<string, unknown[]>();

  for (const n of nodes) {
    nodeMap.set(n.name, {
      name: n.name,
      displayName: n.displayName,
      type: n.type,
      typeVersion: 1,
      parameters: {},
      credentials: null,
      disabled: false,
      classification: n.classification,
    });
    displayNameIndex.set(n.displayName, n.name);
    forward.set(n.name, []);
    backward.set(n.name, []);
  }

  for (const n of nodes) {
    if (n.predecessors) {
      for (const pred of n.predecessors) {
        const edge = {
          from: pred,
          fromOutput: 0,
          isError: false,
          to: n.name,
          toInput: 0,
        };
        forward.get(pred)!.push(edge);
        backward.get(n.name)!.push(edge);
      }
    }
  }

  return {
    nodes: nodeMap,
    forward,
    backward,
    displayNameIndex,
    ast: {
      metadata: { id: 'test', name: 'Test', active: false },
      nodes: [],
      connections: [],
    } as unknown as WorkflowAST,
  } as unknown as WorkflowGraph;
}

describe('detectDataLoss', () => {
  it('detects canonical data-loss pattern', async () => {
    const ast = await parseWorkflowFile(
      resolve(FIXTURES_DIR, 'data-loss-bug.ts'),
    );
    const graph = buildGraph(ast);
    const targets = allNodeIds(graph);
    const refs = traceExpressions(graph, targets);
    const findings = detectDataLoss(graph, refs, targets);

    const dataLossFindings = findings.filter((f) => f.kind === 'data-loss');
    expect(dataLossFindings.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag first data source (trigger with no predecessors)', () => {
    const graph = makeGraph([
      {
        name: 'trigger',
        displayName: 'Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        classification: 'shape-replacing',
      },
      {
        name: 'setNode',
        displayName: 'Set Node',
        type: 'n8n-nodes-base.set',
        classification: 'shape-augmenting',
        predecessors: ['trigger'],
      },
    ]);

    const ref: ExpressionReference = {
      node: nodeIdentity('setNode'),
      parameter: 'value',
      raw: '={{ $json.field }}',
      referencedNode: null,
      fieldPath: 'field',
      resolved: true,
    };

    const findings = detectDataLoss(
      graph,
      [ref],
      [nodeIdentity('setNode')],
    );

    const dataLossFindings = findings.filter((f) => f.kind === 'data-loss');
    expect(dataLossFindings).toHaveLength(0);
  });

  it('walks through shape-preserving nodes without flagging', () => {
    const graph = makeGraph([
      {
        name: 'trigger',
        displayName: 'Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        classification: 'shape-replacing',
      },
      {
        name: 'ifNode',
        displayName: 'If',
        type: 'n8n-nodes-base.if',
        classification: 'shape-preserving',
        predecessors: ['trigger'],
      },
      {
        name: 'setNode',
        displayName: 'Set Node',
        type: 'n8n-nodes-base.set',
        classification: 'shape-augmenting',
        predecessors: ['ifNode'],
      },
    ]);

    const ref: ExpressionReference = {
      node: nodeIdentity('setNode'),
      parameter: 'value',
      raw: '={{ $json.field }}',
      referencedNode: null,
      fieldPath: 'field',
      resolved: true,
    };

    const findings = detectDataLoss(
      graph,
      [ref],
      [nodeIdentity('setNode')],
    );

    const dataLossFindings = findings.filter((f) => f.kind === 'data-loss');
    expect(dataLossFindings).toHaveLength(0);
  });

  it('emits opaque-boundary warning for Code nodes', async () => {
    const ast = await parseWorkflowFile(
      resolve(FIXTURES_DIR, 'code-node-opaque.ts'),
    );
    const graph = buildGraph(ast);
    const targets = [nodeIdentity('useTransformed')];
    const refs = traceExpressions(graph, targets);
    const findings = detectDataLoss(graph, refs, targets);

    const opaqueFindings = findings.filter(
      (f) => f.kind === 'opaque-boundary',
    );
    expect(opaqueFindings.length).toBeGreaterThanOrEqual(1);

    const dataLossFindings = findings.filter((f) => f.kind === 'data-loss');
    expect(dataLossFindings).toHaveLength(0);
  });

  it('bypasses data-loss check for explicit named references', async () => {
    const ast = await parseWorkflowFile(
      resolve(FIXTURES_DIR, 'explicit-references.ts'),
    );
    const graph = buildGraph(ast);
    const targets = [nodeIdentity('combineData')];
    const refs = traceExpressions(graph, targets);

    const explicitRefs = refs.filter(
      (r) => r.referencedNode !== null && r.resolved,
    );
    expect(explicitRefs.length).toBeGreaterThanOrEqual(1);

    const findings = detectDataLoss(graph, refs, targets);

    const dataLossForExplicit = findings.filter(
      (f) =>
        f.kind === 'data-loss' &&
        'parameter' in f.context &&
        explicitRefs.some((r) => r.parameter === f.context.parameter),
    );
    expect(dataLossForExplicit).toHaveLength(0);
  });

  it('emits broken-reference for explicit ref to missing node', () => {
    const graph = makeGraph([
      {
        name: 'someNode',
        displayName: 'Some Node',
        type: 'n8n-nodes-base.set',
        classification: 'shape-augmenting',
      },
    ]);

    const ref: ExpressionReference = {
      node: nodeIdentity('someNode'),
      parameter: 'value',
      raw: "$('Missing Node').first().json.name",
      referencedNode: nodeIdentity('missingNode'),
      fieldPath: 'name',
      resolved: true,
    };

    const findings = detectDataLoss(
      graph,
      [ref],
      [nodeIdentity('someNode')],
    );

    const brokenRefs = findings.filter((f) => f.kind === 'broken-reference');
    expect(brokenRefs).toHaveLength(1);
    expect(brokenRefs[0].message).toContain('missingNode');
  });

  it('downgrades data-loss to warning when schema contains the field', () => {
    const graph = makeGraph([
      {
        name: 'trigger',
        displayName: 'Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        classification: 'shape-replacing',
      },
      {
        name: 'apiNode',
        displayName: 'API Node',
        type: 'n8n-nodes-base.httpRequest',
        classification: 'shape-replacing',
        predecessors: ['trigger'],
      },
      {
        name: 'setNode',
        displayName: 'Set Node',
        type: 'n8n-nodes-base.set',
        classification: 'shape-augmenting',
        predecessors: ['apiNode'],
      },
    ]);

    const ref: ExpressionReference = {
      node: nodeIdentity('setNode'),
      parameter: 'value',
      raw: '={{ $json.name }}',
      referencedNode: null,
      fieldPath: 'name',
      resolved: true,
    };

    const provider: NodeSchemaProvider = {
      getNodeSchema(nodeType: string) {
        if (nodeType === 'n8n-nodes-base.httpRequest') {
          return { properties: { name: { type: 'string' } } };
        }
        return undefined;
      },
    };

    const findings = detectDataLoss(
      graph,
      [ref],
      [nodeIdentity('setNode')],
      provider,
    );

    const dataLossFindings = findings.filter((f) => f.kind === 'data-loss');
    expect(dataLossFindings).toHaveLength(1);
    expect(dataLossFindings[0].severity).toBe('warning');
  });

  it('keeps data-loss as error when schema does not contain the field', () => {
    const graph = makeGraph([
      {
        name: 'trigger',
        displayName: 'Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        classification: 'shape-replacing',
      },
      {
        name: 'apiNode',
        displayName: 'API Node',
        type: 'n8n-nodes-base.httpRequest',
        classification: 'shape-replacing',
        predecessors: ['trigger'],
      },
      {
        name: 'setNode',
        displayName: 'Set Node',
        type: 'n8n-nodes-base.set',
        classification: 'shape-augmenting',
        predecessors: ['apiNode'],
      },
    ]);

    const ref: ExpressionReference = {
      node: nodeIdentity('setNode'),
      parameter: 'value',
      raw: '={{ $json.nonExistent }}',
      referencedNode: null,
      fieldPath: 'nonExistent',
      resolved: true,
    };

    const provider: NodeSchemaProvider = {
      getNodeSchema(nodeType: string) {
        if (nodeType === 'n8n-nodes-base.httpRequest') {
          return { properties: { name: { type: 'string' } } };
        }
        return undefined;
      },
    };

    const findings = detectDataLoss(
      graph,
      [ref],
      [nodeIdentity('setNode')],
      provider,
    );

    const dataLossFindings = findings.filter((f) => f.kind === 'data-loss');
    expect(dataLossFindings).toHaveLength(1);
    expect(dataLossFindings[0].severity).toBe('error');
  });
});
