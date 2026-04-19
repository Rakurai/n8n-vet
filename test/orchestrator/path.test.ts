import { describe, it, expect } from 'vitest';
import { selectPaths } from '../../src/orchestrator/path.js';
import type { WorkflowGraph, GraphNode, Edge } from '../../src/types/graph.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { SliceDefinition } from '../../src/types/slice.js';
import type { NodeChangeSet, TrustState } from '../../src/types/trust.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';

function makeNode(name: string): GraphNode {
  return {
    name,
    displayName: name,
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

function emptyTrustState(): TrustState {
  return { workflowId: 'test', nodes: new Map(), connectionsHash: '' };
}

/** Build a branching graph: A → B → C, A → D → E (output 1) */
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

/** Build a linear graph: A → B → C */
function linearGraph(): WorkflowGraph {
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

describe('selectPaths', () => {
  describe('STRATEGY.md-aligned scoring', () => {
    it('prefers paths covering changed nodes over empty paths', () => {
      const graph = branchingGraph();

      const slice: SliceDefinition = {
        nodes: new Set(['A', 'B', 'C', 'D', 'E'] as NodeIdentity[]),
        seedNodes: new Set(['B', 'C'] as NodeIdentity[]),
        entryPoints: ['A' as NodeIdentity],
        exitPoints: ['C' as NodeIdentity, 'E' as NodeIdentity],
      };

      // Path A→B→C covers 2 changed nodes (B, C). Path A→D→E covers 0.
      const changeSet: NodeChangeSet = {
        added: [],
        removed: [],
        modified: [
          { node: 'B' as NodeIdentity, changes: ['parameter'] },
          { node: 'C' as NodeIdentity, changes: ['parameter'] },
        ],
        unchanged: [],
      };

      const paths = selectPaths(slice, graph, changeSet, emptyTrustState());

      expect(paths[0]!.nodes.map(String)).toContain('B');
      expect(paths[0]!.nodes.map(String)).toContain('C');
    });

    it('gives high weight to changed opaque/shape-replacing nodes', () => {
      // Build graph where one branch has an opaque node and the other has shape-preserving
      const nodes = new Map<string, GraphNode>([
        ['A', makeNode('A')],
        ['B', { ...makeNode('B'), classification: 'shape-opaque' as const }],
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

      const graph: WorkflowGraph = {
        nodes,
        forward,
        backward,
        displayNameIndex,
        ast: { nodes: [], connections: [] } as unknown as WorkflowAST,
      };

      const slice: SliceDefinition = {
        nodes: new Set(['A', 'B', 'C', 'D', 'E'] as NodeIdentity[]),
        seedNodes: new Set(['B', 'D'] as NodeIdentity[]),
        entryPoints: ['A' as NodeIdentity],
        exitPoints: ['C' as NodeIdentity, 'E' as NodeIdentity],
      };

      // Both B (opaque) and D (preserving) changed
      const changeSet: NodeChangeSet = {
        added: [],
        removed: [],
        modified: [
          { node: 'B' as NodeIdentity, changes: ['parameter'] },
          { node: 'D' as NodeIdentity, changes: ['parameter'] },
        ],
        unchanged: [],
      };

      const paths = selectPaths(slice, graph, changeSet, emptyTrustState());

      // Path through opaque node B should rank first
      expect(paths[0]!.nodes.map(String)).toContain('B');
    });

    it('produces deterministic output for same inputs', () => {
      const graph = branchingGraph();

      const slice: SliceDefinition = {
        nodes: new Set(['A', 'B', 'C', 'D', 'E'] as NodeIdentity[]),
        seedNodes: new Set(['B'] as NodeIdentity[]),
        entryPoints: ['A' as NodeIdentity],
        exitPoints: ['C' as NodeIdentity, 'E' as NodeIdentity],
      };

      const paths1 = selectPaths(slice, graph, null, emptyTrustState());
      const paths2 = selectPaths(slice, graph, null, emptyTrustState());

      expect(paths1.map((p) => p.nodes.map(String))).toEqual(
        paths2.map((p) => p.nodes.map(String)),
      );
    });
  });

  describe('multi-path additional-greedy (T017)', () => {
    it('selects both paths when they cover different changed nodes', () => {
      const graph = branchingGraph();

      const slice: SliceDefinition = {
        nodes: new Set(['A', 'B', 'C', 'D', 'E'] as NodeIdentity[]),
        seedNodes: new Set(['B', 'D'] as NodeIdentity[]),
        entryPoints: ['A' as NodeIdentity],
        exitPoints: ['C' as NodeIdentity, 'E' as NodeIdentity],
      };

      // B is changed (path A→B→C), D is changed (path A→D→E)
      const changeSet: NodeChangeSet = {
        added: [],
        removed: [],
        modified: [
          { node: 'B' as NodeIdentity, changes: ['parameter'] },
          { node: 'D' as NodeIdentity, changes: ['parameter'] },
        ],
        unchanged: [],
      };

      const paths = selectPaths(slice, graph, changeSet, emptyTrustState());

      expect(paths.length).toBe(2);
    });

    it('does not select path that adds no new coverage', () => {
      const graph = linearGraph();

      const slice: SliceDefinition = {
        nodes: new Set(['A', 'B', 'C'] as NodeIdentity[]),
        seedNodes: new Set(['B'] as NodeIdentity[]),
        entryPoints: ['A' as NodeIdentity],
        exitPoints: ['C' as NodeIdentity],
      };

      const changeSet: NodeChangeSet = {
        added: [],
        removed: [],
        modified: [{ node: 'B' as NodeIdentity, changes: ['parameter'] }],
        unchanged: [],
      };

      const paths = selectPaths(slice, graph, changeSet, emptyTrustState());

      // Only one path exists (linear), so only 1 selected
      expect(paths.length).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('returns empty for empty slice', () => {
      const graph = linearGraph();

      const slice: SliceDefinition = {
        nodes: new Set(),
        seedNodes: new Set(),
        entryPoints: [],
        exitPoints: [],
      };

      const paths = selectPaths(slice, graph, null, emptyTrustState());
      expect(paths).toHaveLength(0);
    });

    it('handles single-node slice', () => {
      const graph = linearGraph();

      const slice: SliceDefinition = {
        nodes: new Set(['B' as NodeIdentity]),
        seedNodes: new Set(['B' as NodeIdentity]),
        entryPoints: ['B' as NodeIdentity],
        exitPoints: ['B' as NodeIdentity],
      };

      const paths = selectPaths(slice, graph, null, emptyTrustState());
      expect(paths.length).toBeGreaterThanOrEqual(1);
      expect(paths[0]!.nodes.map(String)).toEqual(['B']);
    });
  });
});
