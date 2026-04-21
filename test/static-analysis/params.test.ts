import { describe, it, expect } from 'vitest';
import { validateNodeParams } from '../../src/static-analysis/params.js';
import { nodeIdentity } from '../../src/types/identity.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { WorkflowGraph, GraphNode } from '../../src/types/graph.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';
import type { NodeSchemaProvider } from '../../src/static-analysis/schemas.js';

function makeGraph(nodes: Array<{name: string; type: string; parameters: Record<string, unknown>; credentials?: Record<string, unknown> | null}>): WorkflowGraph {
  const nodeMap = new Map<NodeIdentity, GraphNode>();
  const displayNameIndex = new Map<string, NodeIdentity>();
  for (const n of nodes) {
    const id = n.name as NodeIdentity;
    nodeMap.set(id, {
      name: id, displayName: n.name, type: n.type,
      typeVersion: 1, parameters: n.parameters,
      credentials: n.credentials ?? null,
      disabled: false, classification: 'shape-replacing' as const,
    });
    displayNameIndex.set(n.name, id);
  }
  return {
    nodes: nodeMap, forward: new Map(), backward: new Map(),
    displayNameIndex,
    ast: { metadata: { id: 'test', name: 'Test', active: false }, nodes: [], connections: [] } as unknown as WorkflowAST,
  };
}

describe('validateNodeParams', () => {
  it('returns empty when no schemaProvider', () => {
    const graph = makeGraph([
      { name: 'httpRequest', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'http://example.com' } },
    ]);
    const ids: NodeIdentity[] = [nodeIdentity('httpRequest')];

    const findings = validateNodeParams(graph, ids);

    expect(findings).toEqual([]);
  });

  it('no finding when all params present', () => {
    const graph = makeGraph([
      { name: 'httpRequest', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'http://example.com', method: 'GET' } },
    ]);
    const ids: NodeIdentity[] = [nodeIdentity('httpRequest')];
    const provider: NodeSchemaProvider = {
      getNodeSchema(nodeType: string) {
        if (nodeType === 'n8n-nodes-base.httpRequest') {
          return {
            properties: {
              url: { required: true },
              method: { required: true },
            },
          };
        }
        return undefined;
      },
    };

    const findings = validateNodeParams(graph, ids, provider);

    expect(findings).toEqual([]);
  });

  it('invalid-parameter when required param missing', () => {
    const graph = makeGraph([
      { name: 'httpRequest', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'http://example.com' } },
    ]);
    const ids: NodeIdentity[] = [nodeIdentity('httpRequest')];
    const provider: NodeSchemaProvider = {
      getNodeSchema(nodeType: string) {
        if (nodeType === 'n8n-nodes-base.httpRequest') {
          return {
            properties: {
              url: { required: true },
              method: { required: true },
            },
          };
        }
        return undefined;
      },
    };

    const findings = validateNodeParams(graph, ids, provider);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'invalid-parameter',
      severity: 'warning',
    });
  });

  it('skips when schema unavailable', () => {
    const graph = makeGraph([
      { name: 'httpRequest', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'http://example.com' } },
    ]);
    const ids: NodeIdentity[] = [nodeIdentity('httpRequest')];
    const provider: NodeSchemaProvider = {
      getNodeSchema() {
        return undefined;
      },
    };

    const findings = validateNodeParams(graph, ids, provider);

    expect(findings).toEqual([]);
  });

  it('skips unknown node type', () => {
    const graph = makeGraph([
      { name: 'custom', type: 'custom-nodes.unknown', parameters: { foo: 'bar' } },
    ]);
    const ids: NodeIdentity[] = [nodeIdentity('custom')];
    const provider: NodeSchemaProvider = {
      getNodeSchema(nodeType: string) {
        if (nodeType === 'n8n-nodes-base.httpRequest') {
          return { properties: { url: { required: true } } };
        }
        return undefined;
      },
    };

    const findings = validateNodeParams(graph, ids, provider);

    expect(findings).toEqual([]);
  });
});
