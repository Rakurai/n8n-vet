import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSnapshot, saveSnapshot } from '../../src/orchestrator/snapshots.js';
import { deriveWorkflowId } from '../../src/orchestrator/types.js';
import type { WorkflowGraph, GraphNode, Edge } from '../../src/types/graph.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';

const TEST_DIR = join(resolve('.'), '.scratch/test-snapshots');

function makeNode(name: string): GraphNode {
  return {
    name,
    displayName: `Display ${name}`,
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    parameters: { key: 'value' },
    credentials: null,
    disabled: false,
    classification: 'shape-preserving',
  };
}

function makeEdge(from: string, to: string): Edge {
  return { from, fromOutput: 0, isError: false, to, toInput: 0 };
}

function testGraph(): WorkflowGraph {
  const nodes = new Map<string, GraphNode>([
    ['A', makeNode('A')],
    ['B', makeNode('B')],
    ['C', makeNode('C')],
  ]);

  const forward = new Map<string, Edge[]>([
    ['A', [makeEdge('A', 'B')]],
    ['B', [makeEdge('B', 'C')]],
    ['C', []],
  ]);

  const backward = new Map<string, Edge[]>([
    ['A', []],
    ['B', [makeEdge('A', 'B')]],
    ['C', [makeEdge('B', 'C')]],
  ]);

  const displayNameIndex = new Map<string, string>([
    ['Display A', 'A'],
    ['Display B', 'B'],
    ['Display C', 'C'],
  ]);

  return {
    nodes,
    forward,
    backward,
    displayNameIndex,
    ast: { nodes: [], connections: [] } as unknown as WorkflowAST,
  };
}

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('snapshot round-trip', () => {
  it('saveSnapshot writes valid JSON that loadSnapshot can read', () => {
    const graph = testGraph();
    const workflowId = 'test-workflow-1';

    saveSnapshot(workflowId, graph, TEST_DIR);
    const loaded = loadSnapshot(workflowId, TEST_DIR);

    expect(loaded).not.toBeNull();
  });

  it('reconstructs equivalent WorkflowGraph (nodes Map)', () => {
    const graph = testGraph();
    const workflowId = 'test-workflow-2';

    saveSnapshot(workflowId, graph, TEST_DIR);
    const loaded = loadSnapshot(workflowId, TEST_DIR)!;

    expect(loaded.nodes.size).toBe(3);
    expect(loaded.nodes.has('A')).toBe(true);
    expect(loaded.nodes.has('B')).toBe(true);
    expect(loaded.nodes.has('C')).toBe(true);

    const nodeA = loaded.nodes.get('A')!;
    expect(nodeA.name).toBe('A');
    expect(nodeA.displayName).toBe('Display A');
    expect(nodeA.type).toBe('n8n-nodes-base.noOp');
    expect(nodeA.parameters).toEqual({ key: 'value' });
  });

  it('reconstructs forward/backward adjacency', () => {
    const graph = testGraph();
    const workflowId = 'test-workflow-3';

    saveSnapshot(workflowId, graph, TEST_DIR);
    const loaded = loadSnapshot(workflowId, TEST_DIR)!;

    // Forward: A→B, B→C
    expect(loaded.forward.get('A')).toHaveLength(1);
    expect(loaded.forward.get('A')![0]!.to).toBe('B');
    expect(loaded.forward.get('B')).toHaveLength(1);
    expect(loaded.forward.get('B')![0]!.to).toBe('C');
    expect(loaded.forward.get('C')).toHaveLength(0);

    // Backward: B←A, C←B
    expect(loaded.backward.get('B')).toHaveLength(1);
    expect(loaded.backward.get('B')![0]!.from).toBe('A');
    expect(loaded.backward.get('C')).toHaveLength(1);
    expect(loaded.backward.get('C')![0]!.from).toBe('B');
  });

  it('reconstructs displayNameIndex', () => {
    const graph = testGraph();
    const workflowId = 'test-workflow-4';

    saveSnapshot(workflowId, graph, TEST_DIR);
    const loaded = loadSnapshot(workflowId, TEST_DIR)!;

    expect(loaded.displayNameIndex.get('Display A')).toBe('A');
    expect(loaded.displayNameIndex.get('Display B')).toBe('B');
  });

  it('returns null for missing file', () => {
    const loaded = loadSnapshot('nonexistent', TEST_DIR);
    expect(loaded).toBeNull();
  });

  it('throws on corrupt JSON (fail-fast)', () => {
    mkdirSync(TEST_DIR, { recursive: true });
    const safeName = encodeURIComponent('corrupt-workflow');
    writeFileSync(join(TEST_DIR, `${safeName}.json`), 'not valid json', 'utf-8');

    expect(() => loadSnapshot('corrupt-workflow', TEST_DIR)).toThrow();
  });
});

describe('deriveWorkflowId', () => {
  it('produces consistent results for the same absolute path', () => {
    const id1 = deriveWorkflowId('/home/user/project/workflow.ts');
    const id2 = deriveWorkflowId('/home/user/project/workflow.ts');
    expect(id1).toBe(id2);
  });

  it('resolves relative paths to absolute', () => {
    const id = deriveWorkflowId('./relative/path.ts');
    expect(id).toMatch(/^\//);
  });

  it('produces different IDs for different paths', () => {
    const id1 = deriveWorkflowId('/a/b.ts');
    const id2 = deriveWorkflowId('/a/c.ts');
    expect(id1).not.toBe(id2);
  });
});
