import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSnapshot, saveSnapshot } from '../../src/orchestrator/snapshots.js';
import { deriveWorkflowId } from '../../src/orchestrator/types.js';
import type { WorkflowGraph, GraphNode, Edge } from '../../src/types/graph.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';

const TEST_DIR = join(resolve('.'), '.scratch/test-snapshots');

const nid = (s: string) => s as NodeIdentity;

function makeNode(name: string): GraphNode {
  return {
    name: name as NodeIdentity,
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
  return { from: from as NodeIdentity, fromOutput: 0, isError: false, to: to as NodeIdentity, toInput: 0 };
}

function testGraph(): WorkflowGraph {
  const nodes = new Map<NodeIdentity, GraphNode>([
    ['A' as NodeIdentity, makeNode('A')],
    ['B' as NodeIdentity, makeNode('B')],
    ['C' as NodeIdentity, makeNode('C')],
  ]);

  const forward = new Map<NodeIdentity, Edge[]>([
    ['A' as NodeIdentity, [makeEdge('A', 'B')]],
    ['B' as NodeIdentity, [makeEdge('B', 'C')]],
    ['C' as NodeIdentity, []],
  ]);

  const backward = new Map<NodeIdentity, Edge[]>([
    ['A' as NodeIdentity, []],
    ['B' as NodeIdentity, [makeEdge('A', 'B')]],
    ['C' as NodeIdentity, [makeEdge('B', 'C')]],
  ]);

  const displayNameIndex = new Map<string, NodeIdentity>([
    ['Display A', 'A' as NodeIdentity],
    ['Display B', 'B' as NodeIdentity],
    ['Display C', 'C' as NodeIdentity],
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
    expect(loaded.nodes.has(nid('A'))).toBe(true);
    expect(loaded.nodes.has(nid('B'))).toBe(true);
    expect(loaded.nodes.has(nid('C'))).toBe(true);

    const nodeA = loaded.nodes.get(nid('A'))!;
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
    expect(loaded.forward.get(nid('A'))).toHaveLength(1);
    expect(loaded.forward.get(nid('A'))![0]!.to).toBe('B');
    expect(loaded.forward.get(nid('B'))).toHaveLength(1);
    expect(loaded.forward.get(nid('B'))![0]!.to).toBe('C');
    expect(loaded.forward.get(nid('C'))).toHaveLength(0);

    // Backward: B←A, C←B
    expect(loaded.backward.get(nid('B'))).toHaveLength(1);
    expect(loaded.backward.get(nid('B'))![0]!.from).toBe('A');
    expect(loaded.backward.get(nid('C'))).toHaveLength(1);
    expect(loaded.backward.get(nid('C'))![0]!.from).toBe('B');
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
  it('produces consistent results for the same path', () => {
    const id1 = deriveWorkflowId('/home/user/project/workflow.ts');
    const id2 = deriveWorkflowId('/home/user/project/workflow.ts');
    expect(id1).toBe(id2);
  });

  it('resolves relative paths to project-relative form', () => {
    const id = deriveWorkflowId('./relative/path.ts');
    expect(id).toBe('relative/path.ts');
  });

  it('produces different IDs for different paths', () => {
    const id1 = deriveWorkflowId('/a/b.ts');
    const id2 = deriveWorkflowId('/a/c.ts');
    expect(id1).not.toBe(id2);
  });
});

describe('snapshot N8N_PROCTOR_DATA_DIR resolution', () => {
  const ENV_KEY = 'N8N_PROCTOR_DATA_DIR';
  const CUSTOM_DIR = join(resolve('.'), '.scratch/test-snapshots-env');
  let originalEnv: string | undefined;

  function cleanup() {
    if (existsSync(CUSTOM_DIR)) {
      rmSync(CUSTOM_DIR, { recursive: true, force: true });
    }
    const defaultDir = join(resolve('.'), '.n8n-proctor/snapshots');
    if (existsSync(defaultDir)) {
      rmSync(defaultDir, { recursive: true, force: true });
    }
  }

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnv;
    }
    cleanup();
  });

  it('uses N8N_PROCTOR_DATA_DIR/snapshots/ when env var is set', () => {
    originalEnv = process.env[ENV_KEY];
    process.env[ENV_KEY] = CUSTOM_DIR;

    const graph = testGraph();
    saveSnapshot('env-test-1', graph);
    const expectedPath = join(CUSTOM_DIR, 'snapshots');
    expect(existsSync(expectedPath)).toBe(true);

    const loaded = loadSnapshot('env-test-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes.size).toBe(3);
  });

  it('uses .n8n-proctor/snapshots when N8N_PROCTOR_DATA_DIR is absent', () => {
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];

    const graph = testGraph();
    saveSnapshot('env-test-2', graph);
    const defaultDir = join(resolve('.'), '.n8n-proctor/snapshots');
    expect(existsSync(defaultDir)).toBe(true);

    const loaded = loadSnapshot('env-test-2');
    expect(loaded).not.toBeNull();
  });
});
