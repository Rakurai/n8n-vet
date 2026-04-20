/**
 * Tests for assembleEvidence — guardrail evidence assembly.
 */

import { describe, it, expect } from 'vitest';
import { assembleEvidence } from '../../src/guardrails/evidence.js';
import type { EvaluationInput } from '../../src/guardrails/types.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import { nodeIdentity } from '../../src/types/identity.js';
import type { TrustState, NodeTrustRecord, NodeChangeSet } from '../../src/types/trust.js';
import type { WorkflowGraph } from '../../src/types/graph.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';

function makeInput(overrides?: Partial<EvaluationInput>): EvaluationInput {
  const graph: WorkflowGraph = {
    nodes: new Map(),
    forward: new Map(),
    backward: new Map(),
    displayNameIndex: new Map(),
    ast: { nodes: [], connections: [] } as unknown as WorkflowAST,
  };

  return {
    target: { kind: 'changed' },
    targetNodes: new Set<NodeIdentity>(),
    layer: 'static',
    force: false,
    trustState: { workflowId: 'test', nodes: new Map(), connectionsHash: '' },
    changeSet: { added: [], removed: [], modified: [], unchanged: [] },
    graph,
    currentHashes: new Map(),
    priorSummary: null,
    expressionRefs: [],
    llmValidationRequested: false,
    fixtureHash: null,
    ...overrides,
  };
}

describe('assembleEvidence', () => {
  it('returns empty evidence when no target nodes', () => {
    const evidence = assembleEvidence(makeInput());
    expect(evidence.changedNodes).toEqual([]);
    expect(evidence.trustedNodes).toEqual([]);
    expect(evidence.lastValidatedAt).toBeNull();
    expect(evidence.fixtureChanged).toBe(false);
  });

  it('identifies added nodes as changed', () => {
    const a = nodeIdentity('a');
    const evidence = assembleEvidence(makeInput({
      targetNodes: new Set([a]),
      changeSet: { added: [a], removed: [], modified: [], unchanged: [] },
    }));
    expect(evidence.changedNodes).toEqual([a]);
  });

  it('identifies removed nodes as changed', () => {
    const a = nodeIdentity('a');
    const evidence = assembleEvidence(makeInput({
      targetNodes: new Set([a]),
      changeSet: { added: [], removed: [a], modified: [], unchanged: [] },
    }));
    expect(evidence.changedNodes).toEqual([a]);
  });

  it('identifies trust-breaking modifications as changed', () => {
    const a = nodeIdentity('a');
    const evidence = assembleEvidence(makeInput({
      targetNodes: new Set([a]),
      changeSet: {
        added: [],
        removed: [],
        modified: [{ node: a, changes: ['parameter'] }],
        unchanged: [],
      },
    }));
    expect(evidence.changedNodes).toEqual([a]);
  });

  it('does not count metadata-only changes as changed', () => {
    const a = nodeIdentity('a');
    const evidence = assembleEvidence(makeInput({
      targetNodes: new Set([a]),
      changeSet: {
        added: [],
        removed: [],
        modified: [{ node: a, changes: ['metadata-only'] }],
        unchanged: [],
      },
    }));
    expect(evidence.changedNodes).toEqual([]);
  });

  it('identifies trusted nodes with matching hashes', () => {
    const a = nodeIdentity('a');
    const trustState: TrustState = {
      workflowId: 'test',
      nodes: new Map([[a, {
        contentHash: 'hash-a',
        validatedBy: 'run-1',
        validatedAt: '2026-01-01T00:00:00Z',
        validatedWith: 'static',
        fixtureHash: null,
      } as NodeTrustRecord]]),
      connectionsHash: '',
    };

    const evidence = assembleEvidence(makeInput({
      targetNodes: new Set([a]),
      trustState,
      currentHashes: new Map([[a, 'hash-a']]),
    }));
    expect(evidence.trustedNodes).toEqual([a]);
    expect(evidence.lastValidatedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('detects fixture change', () => {
    const a = nodeIdentity('a');
    const trustState: TrustState = {
      workflowId: 'test',
      nodes: new Map([[a, {
        contentHash: 'hash-a',
        validatedBy: 'run-1',
        validatedAt: '2026-01-01T00:00:00Z',
        validatedWith: 'static',
        fixtureHash: 'old-fixture-hash',
      } as NodeTrustRecord]]),
      connectionsHash: '',
    };

    const evidence = assembleEvidence(makeInput({
      targetNodes: new Set([a]),
      trustState,
      currentHashes: new Map([[a, 'hash-a']]),
      fixtureHash: 'new-fixture-hash',
    }));
    expect(evidence.fixtureChanged).toBe(true);
  });
});
