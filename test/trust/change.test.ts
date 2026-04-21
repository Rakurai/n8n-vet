import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, parseWorkflowFile } from '../../src/static-analysis/graph.js';
import { computeChangeSet } from '../../src/trust/change.js';
import type { WorkflowGraph, GraphNode } from '../../src/types/graph.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { WorkflowAST, NodeAST } from '@n8n-as-code/transformer';

const FIXTURES_DIR = resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures/workflows',
);

async function loadLinearSimple(): Promise<WorkflowGraph> {
  const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'linear-simple.ts'));
  return buildGraph(ast);
}

/** Create a modified copy of a graph with a changed node. */
function withModifiedNode(
  graph: WorkflowGraph,
  nodeName: string,
  changes: Partial<GraphNode>,
): WorkflowGraph {
  const nodes = new Map(graph.nodes);
  const id = nodeName as NodeIdentity;
  const original = nodes.get(id)!;
  nodes.set(id, { ...original, ...changes });
  return { ...graph, nodes };
}

/** Create a modified copy of a graph with a changed NodeAST (for execution settings). */
function withModifiedAst(
  graph: WorkflowGraph,
  nodeName: string,
  astChanges: Partial<NodeAST>,
): WorkflowGraph {
  const ast: WorkflowAST = {
    ...graph.ast,
    nodes: graph.ast.nodes.map((n) =>
      n.propertyName === nodeName ? { ...n, ...astChanges } : n,
    ),
  };
  return { ...graph, ast };
}

/** Add a node to a graph. */
function withAddedNode(
  graph: WorkflowGraph,
  node: GraphNode,
  nodeAst: Partial<NodeAST>,
): WorkflowGraph {
  const nodes = new Map(graph.nodes);
  const id = node.name;
  nodes.set(id, node);
  const forward = new Map(graph.forward);
  forward.set(id, []);
  const backward = new Map(graph.backward);
  backward.set(id, []);
  const displayNameIndex = new Map(graph.displayNameIndex);
  displayNameIndex.set(node.displayName, id);
  const ast: WorkflowAST = {
    ...graph.ast,
    nodes: [
      ...graph.ast.nodes,
      {
        propertyName: node.name,
        displayName: node.displayName,
        type: node.type,
        version: node.typeVersion,
        position: [0, 0] as [number, number],
        parameters: node.parameters,
        ...nodeAst,
      } as NodeAST,
    ],
  };
  return { ...graph, nodes, forward, backward, displayNameIndex, ast };
}

/** Remove a node from a graph. */
function withRemovedNode(graph: WorkflowGraph, nodeName: string): WorkflowGraph {
  const id = nodeName as NodeIdentity;
  const nodes = new Map(graph.nodes);
  nodes.delete(id);
  const forward = new Map(graph.forward);
  forward.delete(id);
  // Remove edges pointing to this node
  for (const [key, edges] of forward) {
    forward.set(key, edges.filter((e) => e.to !== nodeName));
  }
  const backward = new Map(graph.backward);
  backward.delete(id);
  for (const [key, edges] of backward) {
    backward.set(key, edges.filter((e) => e.from !== nodeName));
  }
  const displayNameIndex = new Map(graph.displayNameIndex);
  const removedNode = graph.nodes.get(id);
  if (removedNode) displayNameIndex.delete(removedNode.displayName);
  const ast: WorkflowAST = {
    ...graph.ast,
    nodes: graph.ast.nodes.filter((n) => n.propertyName !== nodeName),
    connections: graph.ast.connections.filter(
      (c) => c.from.node !== nodeName && c.to.node !== nodeName,
    ),
  };
  return { ...graph, nodes, forward, backward, displayNameIndex, ast };
}

describe('computeChangeSet', () => {
  it('short-circuits with empty changes on identical graphs', async () => {
    const graph = await loadLinearSimple();
    const changeSet = computeChangeSet(graph, graph);

    expect(changeSet.added).toHaveLength(0);
    expect(changeSet.removed).toHaveLength(0);
    expect(changeSet.modified).toHaveLength(0);
    expect(changeSet.unchanged).toHaveLength(3);
  });

  it('detects parameter change', async () => {
    const previous = await loadLinearSimple();
    const current = withModifiedNode(previous, 'httpRequest', {
      parameters: { url: 'https://changed.example.com', method: 'POST' },
    });

    const changeSet = computeChangeSet(previous, current);

    expect(changeSet.modified).toHaveLength(1);
    expect(changeSet.modified[0].node).toBe('httpRequest');
    expect(changeSet.modified[0].changes).toContain('parameter');
    expect(changeSet.unchanged).toHaveLength(2);
  });

  it('detects expression change', async () => {
    const previous = await loadLinearSimple();
    // setFields has expression: '={{ $json.data }}'
    const current = withModifiedNode(previous, 'setFields', {
      parameters: {
        assignments: {
          assignments: [
            { name: 'processed', value: '={{ $json.newData }}', type: 'string' },
          ],
        },
      },
    });

    const changeSet = computeChangeSet(previous, current);

    expect(changeSet.modified).toHaveLength(1);
    expect(changeSet.modified[0].node).toBe('setFields');
    expect(changeSet.modified[0].changes).toContain('expression');
    expect(changeSet.modified[0].changes).toContain('parameter');
  });

  it('detects type-version change', async () => {
    const previous = await loadLinearSimple();
    const current = withModifiedNode(previous, 'httpRequest', {
      typeVersion: 5,
    });

    const changeSet = computeChangeSet(previous, current);

    expect(changeSet.modified).toHaveLength(1);
    expect(changeSet.modified[0].changes).toContain('type-version');
  });

  it('detects credential change', async () => {
    const previous = await loadLinearSimple();
    const current = withModifiedNode(previous, 'httpRequest', {
      credentials: { httpBasicAuth: { id: '1', name: 'New Cred' } },
    });

    const changeSet = computeChangeSet(previous, current);

    expect(changeSet.modified).toHaveLength(1);
    expect(changeSet.modified[0].changes).toContain('credential');
  });

  it('detects execution-setting change', async () => {
    const previous = await loadLinearSimple();
    const current = withModifiedAst(previous, 'httpRequest', {
      retryOnFail: true,
    });

    const changeSet = computeChangeSet(previous, current);

    expect(changeSet.modified).toHaveLength(1);
    expect(changeSet.modified[0].changes).toContain('execution-setting');
  });

  it('ignores position-only change (cosmetic, not tracked)', async () => {
    const previous = await loadLinearSimple();
    // Only change AST position — content hash stays the same since position is excluded
    const ast: WorkflowAST = {
      ...previous.ast,
      nodes: previous.ast.nodes.map((n) =>
        n.propertyName === 'httpRequest'
          ? { ...n, position: [999, 999] as [number, number] }
          : n,
      ),
    };
    const current: WorkflowGraph = { ...previous, ast };

    const changeSet = computeChangeSet(previous, current);

    // Position changes are cosmetic — node should be unchanged
    expect(changeSet.unchanged).toHaveLength(3);
    expect(changeSet.modified).toHaveLength(0);
  });

  it('detects connection change on content-unchanged node', async () => {
    const previous = await loadLinearSimple();
    // Add an extra edge from httpRequest to scheduleTrigger (weird but tests connection change)
    const forward = new Map(previous.forward);
    const httpEdges = [...(forward.get('httpRequest' as NodeIdentity) ?? [])];
    httpEdges.push({
      from: 'httpRequest' as NodeIdentity,
      fromOutput: 1,
      isError: false,
      to: 'scheduleTrigger' as NodeIdentity,
      toInput: 0,
    });
    forward.set('httpRequest' as NodeIdentity, httpEdges);
    const current: WorkflowGraph = { ...previous, forward };

    const changeSet = computeChangeSet(previous, current);

    const connectionMods = changeSet.modified.filter((m) =>
      m.changes.includes('connection'),
    );
    expect(connectionMods.length).toBeGreaterThanOrEqual(1);
  });

  it('detects incoming (backward) edge change on content-unchanged node', async () => {
    const previous = await loadLinearSimple();
    // Add an extra connection: scheduleTrigger → setFields (new incoming edge for setFields)
    // Must update both forward and backward adjacency for consistency
    const forward = new Map(previous.forward);
    const triggerForwardEdges = [...(forward.get('scheduleTrigger' as NodeIdentity) ?? [])];
    triggerForwardEdges.push({
      from: 'scheduleTrigger' as NodeIdentity,
      fromOutput: 0,
      isError: false,
      to: 'setFields' as NodeIdentity,
      toInput: 1,
    });
    forward.set('scheduleTrigger' as NodeIdentity, triggerForwardEdges);

    const backward = new Map(previous.backward);
    const setFieldsBackEdges = [...(backward.get('setFields' as NodeIdentity) ?? [])];
    setFieldsBackEdges.push({
      from: 'scheduleTrigger' as NodeIdentity,
      fromOutput: 0,
      isError: false,
      to: 'setFields' as NodeIdentity,
      toInput: 1,
    });
    backward.set('setFields' as NodeIdentity, setFieldsBackEdges);
    const current: WorkflowGraph = { ...previous, forward, backward };

    const changeSet = computeChangeSet(previous, current);

    // setFields should be flagged as modified with connection change
    // because it now has a new incoming edge
    const connectionMods = changeSet.modified.filter((m) =>
      m.node === 'setFields' && m.changes.includes('connection'),
    );
    expect(connectionMods).toHaveLength(1);
  });

  it('detects added node', async () => {
    const previous = await loadLinearSimple();
    const newNode: GraphNode = {
      name: 'newNode' as NodeIdentity,
      displayName: 'New Node',
      type: 'n8n-nodes-base.noOp',
      typeVersion: 1,
      parameters: {},
      credentials: null,
      disabled: false,
      classification: 'shape-preserving',
    };
    const current = withAddedNode(previous, newNode, {});

    const changeSet = computeChangeSet(previous, current);

    expect(changeSet.added).toContain('newNode');
    expect(changeSet.unchanged).toHaveLength(3);
  });

  it('detects removed node', async () => {
    const previous = await loadLinearSimple();
    const current = withRemovedNode(previous, 'setFields');

    const changeSet = computeChangeSet(previous, current);

    expect(changeSet.removed).toContain('setFields');
    // httpRequest loses its edge to setFields → connection change
    expect(changeSet.unchanged).toHaveLength(1);
    expect(changeSet.unchanged[0]).toBe('scheduleTrigger');
  });

  it('detects rename (removed+added with identical content)', async () => {
    const previous = await loadLinearSimple();
    const originalNode = previous.nodes.get('httpRequest' as NodeIdentity)!;
    const originalAst = previous.ast.nodes.find((n) => n.propertyName === 'httpRequest')!;

    // Remove original, add renamed copy with same type/version/parameters
    let current = withRemovedNode(previous, 'httpRequest');
    const renamedNode: GraphNode = {
      ...originalNode,
      name: 'renamedHttp' as NodeIdentity,
      displayName: 'Renamed HTTP',
    };
    current = withAddedNode(current, renamedNode, {
      type: originalAst.type,
      version: originalAst.version,
      ...(originalAst.credentials !== undefined ? { credentials: originalAst.credentials } : {}),
      ...(originalAst.retryOnFail !== undefined ? { retryOnFail: originalAst.retryOnFail } : {}),
      ...(originalAst.executeOnce !== undefined ? { executeOnce: originalAst.executeOnce } : {}),
      ...(originalAst.onError !== undefined ? { onError: originalAst.onError } : {}),
    });

    const changeSet = computeChangeSet(previous, current);

    // Rename detection: the removed+added pair with identical content should
    // result in neither appearing in added or removed
    expect(changeSet.added).not.toContain('renamedHttp');
    expect(changeSet.removed).not.toContain('httpRequest');
    // They should appear as modified with metadata-only change
    const renameMod = changeSet.modified.find(
      (m) => m.node === 'renamedHttp' || m.node === 'httpRequest',
    );
    expect(renameMod).toBeDefined();
    expect(renameMod!.changes).toContain('rename');
  });

  it('classifies multiple simultaneous change kinds on single node', async () => {
    const previous = await loadLinearSimple();
    let current = withModifiedNode(previous, 'httpRequest', {
      parameters: { url: '={{ $json.url }}', method: 'POST' },
      credentials: { httpBasicAuth: { id: '1', name: 'Cred' } },
      typeVersion: 5,
    });

    const changeSet = computeChangeSet(previous, current);

    const mod = changeSet.modified.find((m) => m.node === 'httpRequest');
    expect(mod).toBeDefined();
    expect(mod!.changes).toContain('parameter');
    expect(mod!.changes).toContain('expression');
    expect(mod!.changes).toContain('credential');
    expect(mod!.changes).toContain('type-version');
  });

  it('handles empty graph comparison', () => {
    const emptyAst: WorkflowAST = {
      metadata: { id: '', name: '', active: false },
      nodes: [],
      connections: [],
    } as unknown as WorkflowAST;
    const emptyGraph: WorkflowGraph = {
      nodes: new Map(),
      forward: new Map(),
      backward: new Map(),
      displayNameIndex: new Map(),
      ast: emptyAst,
    };

    const changeSet = computeChangeSet(emptyGraph, emptyGraph);

    expect(changeSet.added).toHaveLength(0);
    expect(changeSet.removed).toHaveLength(0);
    expect(changeSet.modified).toHaveLength(0);
    expect(changeSet.unchanged).toHaveLength(0);
  });
});
