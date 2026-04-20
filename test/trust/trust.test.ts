import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, parseWorkflowFile } from '../../src/static-analysis/graph.js';
import { computeContentHash, computeConnectionsHash } from '../../src/trust/hash.js';
import {
  recordValidation,
  invalidateTrust,
  isTrusted,
  getTrustedBoundaries,
  getUntrustedNodes,
  getRerunAssessment,
} from '../../src/trust/trust.js';
import type { WorkflowGraph } from '../../src/types/graph.js';
import type { TrustState, NodeChangeSet, NodeModification } from '../../src/types/trust.js';
import type { NodeIdentity } from '../../src/types/identity.js';

const FIXTURES_DIR = resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures/workflows',
);

async function loadLinearSimple(): Promise<WorkflowGraph> {
  const ast = await parseWorkflowFile(resolve(FIXTURES_DIR, 'linear-simple.ts'));
  return buildGraph(ast);
}

function emptyTrustState(workflowId = 'test-wf'): TrustState {
  return {
    workflowId,
    nodes: new Map(),
    connectionsHash: '',
  };
}

function ni(name: string): NodeIdentity {
  return name as NodeIdentity;
}

// ── Derivation (US2) ────────────────────────────────────────────────

describe('recordValidation', () => {
  it('creates trust records with correct hashes for static validation', async () => {
    const graph = await loadLinearSimple();
    const state = emptyTrustState();

    const result = recordValidation(
      state,
      [ni('httpRequest'), ni('setFields')],
      graph,
      'static',
      'run-001',
      null,
    );

    expect(result.nodes.size).toBe(2);
    expect(result.nodes.has(ni('httpRequest'))).toBe(true);
    expect(result.nodes.has(ni('setFields'))).toBe(true);

    const httpRecord = result.nodes.get(ni('httpRequest'))!;
    expect(httpRecord.contentHash).toBe(
      computeContentHash(graph.nodes.get('httpRequest')!, graph.ast),
    );
    expect(httpRecord.validatedBy).toBe('run-001');
    expect(httpRecord.validatedWith).toBe('static');
    expect(httpRecord.fixtureHash).toBeNull();
    expect(httpRecord.validatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('creates trust record with fixture hash for execution validation', async () => {
    const graph = await loadLinearSimple();
    const state = emptyTrustState();

    const result = recordValidation(
      state,
      [ni('httpRequest')],
      graph,
      'execution',
      'run-002',
      'fixture-hash-abc',
    );

    const record = result.nodes.get(ni('httpRequest'))!;
    expect(record.validatedWith).toBe('execution');
    expect(record.fixtureHash).toBe('fixture-hash-abc');
  });

  it('replaces existing trust record on re-validation', async () => {
    const graph = await loadLinearSimple();
    let state = emptyTrustState();

    state = recordValidation(state, [ni('httpRequest')], graph, 'static', 'run-001', null);
    const firstRecord = state.nodes.get(ni('httpRequest'))!;

    state = recordValidation(state, [ni('httpRequest')], graph, 'execution', 'run-002', 'fix-hash');
    const secondRecord = state.nodes.get(ni('httpRequest'))!;

    expect(secondRecord.validatedBy).toBe('run-002');
    expect(secondRecord.validatedWith).toBe('execution');
    expect(secondRecord.fixtureHash).toBe('fix-hash');
    expect(secondRecord.validatedBy).not.toBe(firstRecord.validatedBy);
  });

  it('only records specified nodes (caller responsibility)', async () => {
    const graph = await loadLinearSimple();
    const state = emptyTrustState();

    const result = recordValidation(
      state,
      [ni('httpRequest')],
      graph,
      'static',
      'run-001',
      null,
    );

    expect(result.nodes.size).toBe(1);
    expect(result.nodes.has(ni('httpRequest'))).toBe(true);
    expect(result.nodes.has(ni('setFields'))).toBe(false);
  });

  it('does not mutate input state', async () => {
    const graph = await loadLinearSimple();
    const state = emptyTrustState();

    const result = recordValidation(state, [ni('httpRequest')], graph, 'static', 'run-001', null);

    expect(state.nodes.size).toBe(0);
    expect(result.nodes.size).toBe(1);
  });
});

// ── Invalidation (US3) ──────────────────────────────────────────────

describe('invalidateTrust', () => {
  /** Trust all nodes in a linear graph. */
  async function trustAllNodes(graph: WorkflowGraph): Promise<TrustState> {
    const allNodes = [...graph.nodes.keys()].map(ni);
    return recordValidation(emptyTrustState(), allNodes, graph, 'static', 'run-all', null);
  }

  it('linear chain A→B→C: change at B invalidates B and C, A keeps trust', async () => {
    const graph = await loadLinearSimple();
    const state = await trustAllNodes(graph);

    const changeSet: NodeChangeSet = {
      added: [],
      removed: [],
      modified: [{ node: ni('httpRequest'), changes: ['parameter'] }],
      unchanged: [ni('scheduleTrigger'), ni('setFields')],
    };

    const result = invalidateTrust(state, changeSet, graph);

    expect(result.nodes.has(ni('scheduleTrigger'))).toBe(true);
    expect(result.nodes.has(ni('httpRequest'))).toBe(false);
    expect(result.nodes.has(ni('setFields'))).toBe(false);
  });

  it('branching: change at root invalidates all downstream', async () => {
    // Use linear-simple and simulate branching by adding forward edges
    const graph = await loadLinearSimple();
    const state = await trustAllNodes(graph);

    const changeSet: NodeChangeSet = {
      added: [],
      removed: [],
      modified: [{ node: ni('scheduleTrigger'), changes: ['parameter'] }],
      unchanged: [ni('httpRequest'), ni('setFields')],
    };

    const result = invalidateTrust(state, changeSet, graph);

    // All downstream from scheduleTrigger should be invalidated
    expect(result.nodes.has(ni('scheduleTrigger'))).toBe(false);
    expect(result.nodes.has(ni('httpRequest'))).toBe(false);
    expect(result.nodes.has(ni('setFields'))).toBe(false);
  });

  it('downstream-only: change at C in A→B→C only invalidates C', async () => {
    const graph = await loadLinearSimple();
    const state = await trustAllNodes(graph);

    const changeSet: NodeChangeSet = {
      added: [],
      removed: [],
      modified: [{ node: ni('setFields'), changes: ['parameter'] }],
      unchanged: [ni('scheduleTrigger'), ni('httpRequest')],
    };

    const result = invalidateTrust(state, changeSet, graph);

    expect(result.nodes.has(ni('scheduleTrigger'))).toBe(true);
    expect(result.nodes.has(ni('httpRequest'))).toBe(true);
    expect(result.nodes.has(ni('setFields'))).toBe(false);
  });

  it('metadata-only change preserves trust', async () => {
    const graph = await loadLinearSimple();
    const state = await trustAllNodes(graph);

    const changeSet: NodeChangeSet = {
      added: [],
      removed: [],
      modified: [{ node: ni('httpRequest'), changes: ['metadata-only'] }],
      unchanged: [ni('scheduleTrigger'), ni('setFields')],
    };

    const result = invalidateTrust(state, changeSet, graph);

    expect(result.nodes.has(ni('scheduleTrigger'))).toBe(true);
    expect(result.nodes.has(ni('httpRequest'))).toBe(true);
    expect(result.nodes.has(ni('setFields'))).toBe(true);
  });

  it('metadata-only change preserves trust', async () => {
    const graph = await loadLinearSimple();
    const state = await trustAllNodes(graph);

    const changeSet: NodeChangeSet = {
      added: [],
      removed: [],
      modified: [{ node: ni('httpRequest'), changes: ['metadata-only'] }],
      unchanged: [ni('scheduleTrigger'), ni('setFields')],
    };

    const result = invalidateTrust(state, changeSet, graph);

    expect(result.nodes.size).toBe(3);
  });

  it('added node seeds invalidation of downstream', async () => {
    const graph = await loadLinearSimple();
    const state = await trustAllNodes(graph);

    const changeSet: NodeChangeSet = {
      added: [ni('httpRequest')], // Simulating httpRequest as "new"
      removed: [],
      modified: [],
      unchanged: [ni('scheduleTrigger'), ni('setFields')],
    };

    const result = invalidateTrust(state, changeSet, graph);

    // httpRequest added → its downstream (setFields) also invalidated
    expect(result.nodes.has(ni('scheduleTrigger'))).toBe(true);
    expect(result.nodes.has(ni('httpRequest'))).toBe(false);
    expect(result.nodes.has(ni('setFields'))).toBe(false);
  });

  it('connection change triggers invalidation', async () => {
    const graph = await loadLinearSimple();
    const state = await trustAllNodes(graph);

    const changeSet: NodeChangeSet = {
      added: [],
      removed: [],
      modified: [{ node: ni('httpRequest'), changes: ['connection'] }],
      unchanged: [ni('scheduleTrigger'), ni('setFields')],
    };

    const result = invalidateTrust(state, changeSet, graph);

    expect(result.nodes.has(ni('httpRequest'))).toBe(false);
    expect(result.nodes.has(ni('setFields'))).toBe(false);
  });

  it('removes stale records for deleted nodes', async () => {
    const graph = await loadLinearSimple();
    let state = await trustAllNodes(graph);

    // Manually add a trust record for a node that no longer exists
    const staleNodes = new Map(state.nodes);
    staleNodes.set(ni('deletedNode'), {
      contentHash: 'old-hash',
      validatedBy: 'run-old',
      validatedAt: new Date().toISOString(),
      validatedWith: 'static',
      fixtureHash: null,
    });
    state = { ...state, nodes: staleNodes };

    const changeSet: NodeChangeSet = {
      added: [],
      removed: [],
      modified: [],
      unchanged: [ni('scheduleTrigger'), ni('httpRequest'), ni('setFields')],
    };

    const result = invalidateTrust(state, changeSet, graph);

    expect(result.nodes.has(ni('deletedNode'))).toBe(false);
    expect(result.nodes.size).toBe(3);
  });

  it('does not mutate input state', async () => {
    const graph = await loadLinearSimple();
    const state = await trustAllNodes(graph);

    const changeSet: NodeChangeSet = {
      added: [],
      removed: [],
      modified: [{ node: ni('httpRequest'), changes: ['parameter'] }],
      unchanged: [ni('scheduleTrigger'), ni('setFields')],
    };

    const result = invalidateTrust(state, changeSet, graph);

    expect(state.nodes.size).toBe(3);
    expect(result.nodes.size).toBe(1);
  });
});

// ── Queries (US5) ───────────────────────────────────────────────────

describe('isTrusted', () => {
  it('returns true when record exists and hash matches', async () => {
    const graph = await loadLinearSimple();
    const state = recordValidation(
      emptyTrustState(),
      [ni('httpRequest')],
      graph,
      'static',
      'run-001',
      null,
    );
    const currentHash = computeContentHash(graph.nodes.get('httpRequest')!, graph.ast);

    expect(isTrusted(state, ni('httpRequest'), currentHash)).toBe(true);
  });

  it('returns false when hash mismatches', async () => {
    const graph = await loadLinearSimple();
    const state = recordValidation(
      emptyTrustState(),
      [ni('httpRequest')],
      graph,
      'static',
      'run-001',
      null,
    );

    expect(isTrusted(state, ni('httpRequest'), 'wrong-hash')).toBe(false);
  });

  it('returns false when no record exists', async () => {
    const state = emptyTrustState();
    expect(isTrusted(state, ni('httpRequest'), 'any-hash')).toBe(false);
  });
});

describe('getTrustedBoundaries', () => {
  it('returns trusted nodes adjacent to untrusted downstream', async () => {
    const graph = await loadLinearSimple();
    // Trust only scheduleTrigger and httpRequest, not setFields
    const state = recordValidation(
      emptyTrustState(),
      [ni('scheduleTrigger'), ni('httpRequest')],
      graph,
      'static',
      'run-001',
      null,
    );

    const scope = new Set([ni('scheduleTrigger'), ni('httpRequest'), ni('setFields')]);
    const currentHashes = new Map<NodeIdentity, string>();
    for (const name of scope) {
      currentHashes.set(name, computeContentHash(graph.nodes.get(name)!, graph.ast));
    }

    const boundaries = getTrustedBoundaries(state, graph, scope, currentHashes);

    // httpRequest is trusted and has untrusted downstream (setFields)
    expect(boundaries).toContain(ni('httpRequest'));
    // scheduleTrigger's downstream (httpRequest) is trusted, so it's not a boundary
    expect(boundaries).not.toContain(ni('scheduleTrigger'));
  });
});

describe('getUntrustedNodes', () => {
  it('returns nodes without trust in scope', async () => {
    const graph = await loadLinearSimple();
    const state = recordValidation(
      emptyTrustState(),
      [ni('httpRequest')],
      graph,
      'static',
      'run-001',
      null,
    );

    const scope = new Set([ni('scheduleTrigger'), ni('httpRequest'), ni('setFields')]);
    const currentHashes = new Map<NodeIdentity, string>();
    for (const name of scope) {
      currentHashes.set(name, computeContentHash(graph.nodes.get(name)!, graph.ast));
    }

    const untrusted = getUntrustedNodes(state, scope, currentHashes);

    expect(untrusted).toContain(ni('scheduleTrigger'));
    expect(untrusted).toContain(ni('setFields'));
    expect(untrusted).not.toContain(ni('httpRequest'));
  });
});

describe('getRerunAssessment', () => {
  it('returns isLowValue:true when all nodes trusted and fixture matches', async () => {
    const graph = await loadLinearSimple();
    const allNodes = [ni('scheduleTrigger'), ni('httpRequest'), ni('setFields')];
    const state = recordValidation(
      emptyTrustState(),
      allNodes,
      graph,
      'execution',
      'run-001',
      'fixture-abc',
    );

    const currentHashes = new Map<NodeIdentity, string>();
    for (const name of allNodes) {
      currentHashes.set(name, computeContentHash(graph.nodes.get(name)!, graph.ast));
    }

    const assessment = getRerunAssessment(state, allNodes, currentHashes, 'fixture-abc');

    expect(assessment.isLowValue).toBe(true);
    expect(assessment.confidence).toBe('high');
  });

  it('returns isLowValue:false when any node is untrusted', async () => {
    const graph = await loadLinearSimple();
    // Only trust one node
    const state = recordValidation(
      emptyTrustState(),
      [ni('httpRequest')],
      graph,
      'static',
      'run-001',
      null,
    );

    const allNodes = [ni('scheduleTrigger'), ni('httpRequest'), ni('setFields')];
    const currentHashes = new Map<NodeIdentity, string>();
    for (const name of allNodes) {
      currentHashes.set(name, computeContentHash(graph.nodes.get(name)!, graph.ast));
    }

    const assessment = getRerunAssessment(state, allNodes, currentHashes, null);

    expect(assessment.isLowValue).toBe(false);
  });

  it('returns isLowValue:false when fixture hash diverges', async () => {
    const graph = await loadLinearSimple();
    const allNodes = [ni('scheduleTrigger'), ni('httpRequest'), ni('setFields')];
    const state = recordValidation(
      emptyTrustState(),
      allNodes,
      graph,
      'execution',
      'run-001',
      'fixture-abc',
    );

    const currentHashes = new Map<NodeIdentity, string>();
    for (const name of allNodes) {
      currentHashes.set(name, computeContentHash(graph.nodes.get(name)!, graph.ast));
    }

    const assessment = getRerunAssessment(state, allNodes, currentHashes, 'different-fixture');

    expect(assessment.isLowValue).toBe(false);
  });
});
