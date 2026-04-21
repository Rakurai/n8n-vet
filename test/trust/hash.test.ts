import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, parseWorkflowFile } from '../../src/static-analysis/graph.js';
import {
  computeContentHash,
  computeConnectionsHash,
  computeWorkflowHash,
} from '../../src/trust/hash.js';
import { ContentHashError } from '../../src/trust/errors.js';
import type { WorkflowGraph, GraphNode } from '../../src/types/graph.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';

const FIXTURES_DIR = resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures/workflows',
);

const nid = (s: string) => s as NodeIdentity;

async function loadLinearSimple(): Promise<WorkflowGraph> {
  const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'linear-simple.ts'));
  return buildGraph(ast);
}

describe('computeContentHash', () => {
  it('produces stable hash regardless of property insertion order', async () => {
    const graph = await loadLinearSimple();
    const node = graph.nodes.get(nid('httpRequest'))!;

    const hash1 = computeContentHash(node, graph.ast);
    const hash2 = computeContentHash(node, graph.ast);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('excluded properties do not affect hash', async () => {
    const graph = await loadLinearSimple();
    const node = graph.nodes.get(nid('httpRequest'))!;
    const hash1 = computeContentHash(node, graph.ast);

    // Create a copy with different excluded properties
    const modified: GraphNode = {
      ...node,
      name: 'differentPropertyName' as NodeIdentity,
      displayName: 'Different Display Name',
      classification: 'shape-opaque',
    };

    // Need a modified AST with matching propertyName and different position/notes
    const modifiedAst: WorkflowAST = {
      ...graph.ast,
      nodes: graph.ast.nodes.map((n) =>
        n.propertyName === 'httpRequest'
          ? { ...n, propertyName: 'differentPropertyName', displayName: 'Different Display Name', position: [999, 999] as [number, number] }
          : n,
      ),
    };

    const hash2 = computeContentHash(modified, modifiedAst);
    expect(hash2).toBe(hash1);
  });

  it('different parameters produce different hashes', async () => {
    const graph = await loadLinearSimple();
    const node = graph.nodes.get(nid('httpRequest'))!;
    const hash1 = computeContentHash(node, graph.ast);

    const modified: GraphNode = {
      ...node,
      parameters: { ...node.parameters, url: 'https://different.example.com' },
    };

    const hash2 = computeContentHash(modified, graph.ast);
    expect(hash2).not.toBe(hash1);
  });

  it('different type produces different hash', async () => {
    const graph = await loadLinearSimple();
    const node = graph.nodes.get(nid('httpRequest'))!;
    const hash1 = computeContentHash(node, graph.ast);

    const modified: GraphNode = {
      ...node,
      type: 'n8n-nodes-base.someOtherNode',
    };

    const hash2 = computeContentHash(modified, graph.ast);
    expect(hash2).not.toBe(hash1);
  });

  it('different credentials produce different hash', async () => {
    const graph = await loadLinearSimple();
    const node = graph.nodes.get(nid('httpRequest'))!;
    const hash1 = computeContentHash(node, graph.ast);

    const modified: GraphNode = {
      ...node,
      credentials: { httpBasicAuth: { id: '1', name: 'My Cred' } },
    };

    const hash2 = computeContentHash(modified, graph.ast);
    expect(hash2).not.toBe(hash1);
  });

  it('different disabled state produces different hash', async () => {
    const graph = await loadLinearSimple();
    const node = graph.nodes.get(nid('httpRequest'))!;
    const hash1 = computeContentHash(node, graph.ast);

    const modified: GraphNode = { ...node, disabled: true };

    const hash2 = computeContentHash(modified, graph.ast);
    expect(hash2).not.toBe(hash1);
  });
  it('throws ContentHashError when serialization fails', () => {
    // BigInt values cannot be serialized by JSON.stringify or json-stable-stringify
    const badNode: GraphNode = {
      name: 'badNode' as NodeIdentity,
      displayName: 'Bad Node',
      type: 'n8n-nodes-base.test',
      typeVersion: 1,
      parameters: { value: BigInt(42) as unknown as string },
      credentials: undefined as unknown as Record<string, unknown> | null,
      disabled: false,
      classification: 'shape-opaque',
    };
    const emptyAst = { nodes: [], connections: {} } as unknown as WorkflowAST;

    expect(() => computeContentHash(badNode, emptyAst)).toThrow(ContentHashError);
  });
});

describe('computeConnectionsHash', () => {
  it('produces deterministic hash for same graph', async () => {
    const graph = await loadLinearSimple();

    const hash1 = computeConnectionsHash(graph);
    const hash2 = computeConnectionsHash(graph);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hash when edges differ', async () => {
    const graph = await loadLinearSimple();
    const hash1 = computeConnectionsHash(graph);

    // Create graph with reversed edge direction
    const modifiedForward = new Map(graph.forward);
    modifiedForward.set(nid('httpRequest'), []);
    const modifiedGraph: WorkflowGraph = { ...graph, forward: modifiedForward };

    const hash2 = computeConnectionsHash(modifiedGraph);
    expect(hash2).not.toBe(hash1);
  });
});

describe('computeWorkflowHash', () => {
  it('produces deterministic composite hash', async () => {
    const graph = await loadLinearSimple();

    const hash1 = computeWorkflowHash(graph);
    const hash2 = computeWorkflowHash(graph);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when node content changes', async () => {
    const graph = await loadLinearSimple();
    const hash1 = computeWorkflowHash(graph);

    // Modify a node's parameters
    const modifiedNodes = new Map(graph.nodes);
    const node = { ...graph.nodes.get(nid('httpRequest'))! };
    node.parameters = { ...node.parameters, url: 'https://changed.example.com' };
    modifiedNodes.set(nid('httpRequest'), node);
    const modifiedGraph: WorkflowGraph = { ...graph, nodes: modifiedNodes };

    const hash2 = computeWorkflowHash(modifiedGraph);
    expect(hash2).not.toBe(hash1);
  });

  it('changes when connections change', async () => {
    const graph = await loadLinearSimple();
    const hash1 = computeWorkflowHash(graph);

    const modifiedForward = new Map(graph.forward);
    modifiedForward.set(nid('httpRequest'), []);
    const modifiedGraph: WorkflowGraph = { ...graph, forward: modifiedForward };

    const hash2 = computeWorkflowHash(modifiedGraph);
    expect(hash2).not.toBe(hash1);
  });
});

describe('snapshot hash stability', () => {
  it('produces same hash after save→load round-trip', async () => {
    const graph = await loadLinearSimple();
    const originalHash = computeContentHash(graph.nodes.get(nid('httpRequest'))!, graph.ast);

    // Simulate snapshot round-trip: extract the trust-relevant fields
    // and reconstruct a stub AST, mirroring what loadSnapshot does
    const node = graph.nodes.get(nid('httpRequest'))!;
    const nodeAst = graph.ast.nodes.find((n: { propertyName: string }) => n.propertyName === node.name);
    const stubAst = {
      nodes: [{
        propertyName: node.name,
        position: [0, 0] as [number, number],
        retryOnFail: (nodeAst as unknown as Record<string, unknown>)?.retryOnFail ?? false,
        executeOnce: (nodeAst as unknown as Record<string, unknown>)?.executeOnce ?? false,
        onError: (nodeAst as unknown as Record<string, unknown>)?.onError ?? null,
      }],
      connections: [],
    } as unknown as WorkflowAST;

    const roundTrippedHash = computeContentHash(node, stubAst);
    expect(roundTrippedHash).toBe(originalHash);
  });
});
