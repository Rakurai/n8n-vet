import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSnapshot, saveSnapshot } from '../../src/orchestrator/snapshots.js';
import type { WorkflowGraph, GraphNode, Edge } from '../../src/types/graph.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';

const SCRATCH = join(resolve('.'), '.scratch/test-snapshot-path');
const DEFAULT_DIR = join(resolve('.'), '.n8n-proctor/snapshots');
const ENV_KEY = 'N8N_PROCTOR_DATA_DIR';

function makeGraph(): WorkflowGraph {
  const node: GraphNode = {
    name: 'A' as NodeIdentity,
    displayName: 'Display A',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    parameters: {},
    credentials: null,
    disabled: false,
    classification: 'shape-preserving',
  };

  const nodes = new Map<NodeIdentity, GraphNode>([['A' as NodeIdentity, node]]);
  const forward = new Map<NodeIdentity, Edge[]>([['A' as NodeIdentity, []]]);
  const backward = new Map<NodeIdentity, Edge[]>([['A' as NodeIdentity, []]]);
  const displayNameIndex = new Map<string, NodeIdentity>([['Display A', 'A' as NodeIdentity]]);

  return {
    nodes,
    forward,
    backward,
    displayNameIndex,
    ast: { nodes: [], connections: [] } as unknown as WorkflowAST,
  };
}

describe('snapshot path resolution (N8N_PROCTOR_DATA_DIR)', () => {
  let originalEnv: string | undefined;

  function cleanup() {
    if (existsSync(SCRATCH)) rmSync(SCRATCH, { recursive: true, force: true });
    // Clean only test snapshots from default dir
    const testFile1 = join(DEFAULT_DIR, 'snap-env-test.json');
    const testFile2 = join(DEFAULT_DIR, 'snap-default-test.json');
    if (existsSync(testFile1)) rmSync(testFile1);
    if (existsSync(testFile2)) rmSync(testFile2);
  }

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    cleanup();
  });

  it('writes snapshots under N8N_PROCTOR_DATA_DIR/snapshots/ when env var is set', () => {
    originalEnv = process.env[ENV_KEY];
    process.env[ENV_KEY] = SCRATCH;

    const graph = makeGraph();
    saveSnapshot('snap-env-test', graph);

    const snapshotsDir = join(SCRATCH, 'snapshots');
    expect(existsSync(snapshotsDir)).toBe(true);

    const loaded = loadSnapshot('snap-env-test');
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes.size).toBe(1);
  });

  it('writes snapshots under .n8n-proctor/snapshots/ when N8N_PROCTOR_DATA_DIR is absent', () => {
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];

    const graph = makeGraph();
    saveSnapshot('snap-default-test', graph);

    expect(existsSync(DEFAULT_DIR)).toBe(true);

    const loaded = loadSnapshot('snap-default-test');
    expect(loaded).not.toBeNull();
  });
});
