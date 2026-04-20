import { describe, it, expect } from 'vitest';
import { resolveTarget } from '../../src/orchestrator/resolve.js';
import { computeContentHash } from '../../src/trust/hash.js';
import type { WorkflowGraph, GraphNode, Edge } from '../../src/types/graph.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { NodeChangeSet, TrustState } from '../../src/types/trust.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';

// ── Fixtures ──────────────────────────────────────────────────────

function makeNode(name: string, displayName?: string): GraphNode {
  return {
    name,
    displayName: displayName ?? name,
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    parameters: {},
    credentials: null,
    disabled: false,
    classification: 'shape-preserving',
  };
}

function makeEdge(from: string, to: string, opts?: { isError?: boolean; fromOutput?: number }): Edge {
  return {
    from,
    fromOutput: opts?.fromOutput ?? 0,
    isError: opts?.isError ?? false,
    to,
    toInput: 0,
  };
}

/** Build a linear chain: A → B → C → D */
function linearGraph(): WorkflowGraph {
  const nodes = new Map<string, GraphNode>([
    ['A', makeNode('A', 'Trigger A')],
    ['B', makeNode('B', 'HTTP B')],
    ['C', makeNode('C', 'Set C')],
    ['D', makeNode('D', 'End D')],
  ]);

  const forward = new Map<string, Edge[]>([
    ['A', [makeEdge('A', 'B')]],
    ['B', [makeEdge('B', 'C')]],
    ['C', [makeEdge('C', 'D')]],
    ['D', []],
  ]);

  const backward = new Map<string, Edge[]>([
    ['A', []],
    ['B', [makeEdge('A', 'B')]],
    ['C', [makeEdge('B', 'C')]],
    ['D', [makeEdge('C', 'D')]],
  ]);

  const displayNameIndex = new Map<string, string>([
    ['Trigger A', 'A'],
    ['HTTP B', 'B'],
    ['Set C', 'C'],
    ['End D', 'D'],
  ]);

  return {
    nodes,
    forward,
    backward,
    displayNameIndex,
    ast: { nodes: [], connections: [] } as unknown as WorkflowAST,
  };
}

/** Build a branching graph: A → B → C, A → D → E */
function branchingGraph(): WorkflowGraph {
  const nodes = new Map<string, GraphNode>([
    ['A', makeNode('A')],
    ['B', makeNode('B')],
    ['C', makeNode('C')],
    ['D', makeNode('D')],
    ['E', makeNode('E')],
  ]);

  const forward = new Map<string, Edge[]>([
    ['A', [makeEdge('A', 'B'), makeEdge('A', 'D', { fromOutput: 1 })]],
    ['B', [makeEdge('B', 'C')]],
    ['C', []],
    ['D', [makeEdge('D', 'E')]],
    ['E', []],
  ]);

  const backward = new Map<string, Edge[]>([
    ['A', []],
    ['B', [makeEdge('A', 'B')]],
    ['C', [makeEdge('B', 'C')]],
    ['D', [makeEdge('A', 'D', { fromOutput: 1 })]],
    ['E', [makeEdge('D', 'E')]],
  ]);

  const displayNameIndex = new Map<string, string>();
  for (const [name] of nodes) displayNameIndex.set(name, name);

  return {
    nodes,
    forward,
    backward,
    displayNameIndex,
    ast: { nodes: [], connections: [] } as unknown as WorkflowAST,
  };
}

function emptyTrustState(): TrustState {
  return { workflowId: 'test', nodes: new Map(), connectionsHash: '' };
}

function emptyChangeSet(): NodeChangeSet {
  return { added: [], removed: [], modified: [], unchanged: [] };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('resolveTarget', () => {
  describe('changed kind', () => {
    it('resolves single modified node with downstream propagation', () => {
      const graph = linearGraph();
      const changeSet: NodeChangeSet = {
        added: [],
        removed: [],
        modified: [{ node: 'B' as NodeIdentity, changes: ['parameter'] }],
        unchanged: ['A' as NodeIdentity, 'C' as NodeIdentity, 'D' as NodeIdentity],
      };

      const result = resolveTarget({ kind: 'changed' }, graph, changeSet, emptyTrustState());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // B is the seed; should propagate forward to C, D
      expect(result.slice.seedNodes).toContain('B');
      expect(result.slice.nodes.has('B' as NodeIdentity)).toBe(true);
      // Forward propagation reaches C and D
      expect(result.slice.nodes.has('C' as NodeIdentity)).toBe(true);
      expect(result.slice.nodes.has('D' as NodeIdentity)).toBe(true);
    });

    it('resolves multiple modified nodes', () => {
      const graph = linearGraph();
      const changeSet: NodeChangeSet = {
        added: [],
        removed: [],
        modified: [
          { node: 'B' as NodeIdentity, changes: ['parameter'] },
          { node: 'C' as NodeIdentity, changes: ['expression'] },
        ],
        unchanged: ['A' as NodeIdentity, 'D' as NodeIdentity],
      };

      const result = resolveTarget({ kind: 'changed' }, graph, changeSet, emptyTrustState());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.slice.seedNodes.has('B' as NodeIdentity)).toBe(true);
      expect(result.slice.seedNodes.has('C' as NodeIdentity)).toBe(true);
    });

    it('backward-walks to trigger when no trust boundaries', () => {
      const graph = linearGraph();
      const changeSet: NodeChangeSet = {
        added: [],
        removed: [],
        modified: [{ node: 'C' as NodeIdentity, changes: ['parameter'] }],
        unchanged: ['A' as NodeIdentity, 'B' as NodeIdentity, 'D' as NodeIdentity],
      };

      const result = resolveTarget({ kind: 'changed' }, graph, changeSet, emptyTrustState());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Should backward-walk from C to A (trigger/root)
      expect(result.slice.entryPoints).toContain('A');
    });

    it('returns empty slice when changeSet has no modifications and all nodes trusted', () => {
      const graph = linearGraph();
      const changeSet = emptyChangeSet();
      changeSet.unchanged = ['A', 'B', 'C', 'D'] as NodeIdentity[];

      // All nodes have trust records — nothing untrusted, nothing changed
      const trustState = emptyTrustState();
      for (const name of ['A', 'B', 'C', 'D']) {
        trustState.nodes.set(name as NodeIdentity, {
          contentHash: `hash-${name}`,
          validatedBy: 'run-1',
          validatedAt: '2026-01-01',
          validatedWith: 'static',
          fixtureHash: null,
        });
      }

      const result = resolveTarget({ kind: 'changed' }, graph, changeSet, trustState);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.target.nodes).toHaveLength(0);
      expect(result.target.description).toBe('No changes detected');
    });

    it('uses approximate detection when changeSet is null but trust exists', () => {
      const graph = linearGraph();
      // Trust state has records for A and B but not C and D
      const trustState = emptyTrustState();
      trustState.nodes.set('A' as NodeIdentity, {
        contentHash: 'hash-a',
        validatedBy: 'run-1',
        validatedAt: '2026-01-01',
        validatedWith: 'static',
        fixtureHash: null,
      });
      trustState.nodes.set('B' as NodeIdentity, {
        contentHash: 'hash-b',
        validatedBy: 'run-1',
        validatedAt: '2026-01-01',
        validatedWith: 'static',
        fixtureHash: null,
      });

      const result = resolveTarget({ kind: 'changed' }, graph, null, trustState);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // C and D are "new" (not in trust state), so they should be seeds
      expect(result.slice.seedNodes.has('C' as NodeIdentity)).toBe(true);
      expect(result.slice.seedNodes.has('D' as NodeIdentity)).toBe(true);
    });

    it('returns all nodes when no trust state and no changeSet', () => {
      const graph = linearGraph();

      const result = resolveTarget({ kind: 'changed' }, graph, null, emptyTrustState());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Everything is "changed" when there's no trust
      expect(result.target.nodes.length).toBe(4);
    });

    it('includes nodes with no trust record even when changeSet reports no diff', () => {
      const graph = linearGraph();
      // Trust state covers A and B only — C and D were never validated
      const trustState = emptyTrustState();
      trustState.nodes.set('A' as NodeIdentity, {
        contentHash: 'hash-a',
        validatedBy: 'run-1',
        validatedAt: '2026-01-01',
        validatedWith: 'static',
        fixtureHash: null,
      });
      trustState.nodes.set('B' as NodeIdentity, {
        contentHash: 'hash-b',
        validatedBy: 'run-1',
        validatedAt: '2026-01-01',
        validatedWith: 'static',
        fixtureHash: null,
      });

      // Snapshot diff says nothing changed (file identical to last snapshot)
      const changeSet: NodeChangeSet = { changed: [], added: [], removed: [], modified: [] };

      const result = resolveTarget({ kind: 'changed' }, graph, changeSet, trustState);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // C and D have no trust record — they must be included as seeds
      expect(result.slice.seedNodes.has('C' as NodeIdentity)).toBe(true);
      expect(result.slice.seedNodes.has('D' as NodeIdentity)).toBe(true);
      // A and B are trusted and unchanged — should not be seeds
      expect(result.slice.seedNodes.has('A' as NodeIdentity)).toBe(false);
      expect(result.slice.seedNodes.has('B' as NodeIdentity)).toBe(false);
    });
  });

  describe('nodes kind', () => {
    it('resolves valid named nodes with context', () => {
      const graph = linearGraph();

      const result = resolveTarget(
        { kind: 'nodes', nodes: ['B' as NodeIdentity] },
        graph,
        null,
        emptyTrustState(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.slice.seedNodes.has('B' as NodeIdentity)).toBe(true);
      expect(result.target.automatic).toBe(false);
    });

    it('builds slice with upstream and downstream context', () => {
      const graph = linearGraph(); // A → B → C → D

      const result = resolveTarget(
        { kind: 'nodes', nodes: ['B' as NodeIdentity] },
        graph,
        null,
        emptyTrustState(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Forward propagation: B → C → D
      expect(result.slice.nodes.has('C' as NodeIdentity)).toBe(true);
      expect(result.slice.nodes.has('D' as NodeIdentity)).toBe(true);
      // Backward walk: B → A
      expect(result.slice.nodes.has('A' as NodeIdentity)).toBe(true);
      // Entry and exit points
      expect(result.slice.entryPoints).toContain('A');
      expect(result.slice.exitPoints).toContain('D');
    });

    it('resolves multiple named nodes with merged slice', () => {
      const graph = branchingGraph(); // A → B → C, A → D → E

      const result = resolveTarget(
        { kind: 'nodes', nodes: ['B' as NodeIdentity, 'D' as NodeIdentity] },
        graph,
        null,
        emptyTrustState(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.slice.seedNodes.has('B' as NodeIdentity)).toBe(true);
      expect(result.slice.seedNodes.has('D' as NodeIdentity)).toBe(true);
      // Both branches included
      expect(result.slice.nodes.has('C' as NodeIdentity)).toBe(true);
      expect(result.slice.nodes.has('E' as NodeIdentity)).toBe(true);
    });

    it('returns error for missing nodes', () => {
      const graph = linearGraph();

      const result = resolveTarget(
        { kind: 'nodes', nodes: ['Z' as NodeIdentity] },
        graph,
        null,
        emptyTrustState(),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorMessage).toContain('Z');
    });

    it('returns error for empty nodes list', () => {
      const graph = linearGraph();

      const result = resolveTarget(
        { kind: 'nodes', nodes: [] },
        graph,
        null,
        emptyTrustState(),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorMessage).toContain('Empty');
    });

    it('stops propagation at trusted boundaries during node-targeted validation', () => {
      const graph = linearGraph(); // A → B → C → D

      // With empty trust state, propagation reaches all nodes
      const resultNoTrust = resolveTarget(
        { kind: 'nodes', nodes: ['B' as NodeIdentity] },
        graph,
        null,
        emptyTrustState(),
      );
      expect(resultNoTrust.ok).toBe(true);
      if (!resultNoTrust.ok) return;
      // Without trust, all nodes are in the slice (A, B, C, D)
      expect(resultNoTrust.slice.nodes.size).toBe(4);

      // Now trust boundary node C with a matching content hash.
      // When C is trusted, forward propagation from B stops at C,
      // so D is not reached — slice should be smaller than 4.
      const trustState = emptyTrustState();
      const nodeC = graph.nodes.get('C')!;
      const hashC = computeContentHash(nodeC, graph.ast);

      trustState.nodes.set('C' as NodeIdentity, {
        contentHash: hashC,
        validatedBy: 'run-1',
        validatedAt: '2026-01-01',
        validatedWith: 'static',
        fixtureHash: null,
      });

      // With trusted C, forward propagation stops at C, so D is excluded
      const resultWithTrust = resolveTarget(
        { kind: 'nodes', nodes: ['B' as NodeIdentity] },
        graph,
        null,
        trustState,
      );
      expect(resultWithTrust.ok).toBe(true);
      if (!resultWithTrust.ok) return;
      expect(resultWithTrust.slice.nodes.size).toBeLessThan(4);
    });

    it('returns error listing all missing nodes', () => {
      const graph = linearGraph();

      const result = resolveTarget(
        { kind: 'nodes', nodes: ['X' as NodeIdentity, 'Y' as NodeIdentity] },
        graph,
        null,
        emptyTrustState(),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errorMessage).toContain('X');
      expect(result.errorMessage).toContain('Y');
    });
  });

  describe('workflow kind', () => {
    it('returns all graph nodes', () => {
      const graph = linearGraph();

      const result = resolveTarget({ kind: 'workflow' }, graph, null, emptyTrustState());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.target.nodes.length).toBe(4);
      expect(result.slice.nodes.size).toBe(4);
    });

    it('identifies entry and exit points', () => {
      const graph = linearGraph();

      const result = resolveTarget({ kind: 'workflow' }, graph, null, emptyTrustState());

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.slice.entryPoints).toContain('A');
      expect(result.slice.exitPoints).toContain('D');
    });
  });
});
