import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/guardrails/evaluate.js';
import { computeNarrowedTarget } from '../../src/guardrails/narrow.js';
import {
  emptyTrustState,
  largeGraph,
  linearGraph,
  makeEvaluationInput,
  narrowChanges,
  nid,
  nodeSet,
  partialTrustState,
  uniformHashes,
} from './fixtures.js';

describe('computeNarrowedTarget', () => {
  it('narrows a 15-node graph with 2 changed nodes', () => {
    const graph = largeGraph();
    const allNames = [...graph.nodes.keys()];
    // Trust most nodes except c, d, e so BFS stops at trusted boundaries
    const trustedNames = allNames.filter((n) => !['c', 'd', 'e'].includes(n));
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [
          { node: 'c', changes: ['parameter'] },
          { node: 'd', changes: ['expression'] },
        ],
        allNames.filter((n) => n !== 'c' && n !== 'd'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: partialTrustState(trustedNames),
    });

    const result = computeNarrowedTarget(input);

    expect(result).not.toBeNull();
    const narrowed = result as NonNullable<typeof result>;
    expect(narrowed.kind).toBe('slice');
    if (narrowed.kind === 'slice') {
      // Must contain the seed nodes
      expect(narrowed.slice.nodes.has(nid('c'))).toBe(true);
      expect(narrowed.slice.nodes.has(nid('d'))).toBe(true);
      // Must be a proper subset of the original
      expect(narrowed.slice.nodes.size).toBeLessThan(allNames.length);
      // Seed nodes must be in seedNodes
      expect(narrowed.slice.seedNodes.has(nid('c'))).toBe(true);
      expect(narrowed.slice.seedNodes.has(nid('d'))).toBe(true);
    }
  });

  it('does NOT narrow a 5-node graph (threshold: must be MORE than 5)', () => {
    const graph = linearGraph();
    const allNames = [...graph.nodes.keys()];
    // 5 nodes, threshold is >5
    expect(allNames.length).toBe(5);

    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'http', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'http'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
    });

    const result = computeNarrowedTarget(input);
    expect(result).toBeNull();
  });

  it('returns null when propagation reaches all target nodes (no size reduction)', () => {
    const graph = largeGraph();
    const allNames = [...graph.nodes.keys()];
    // Change many nodes so the ratio is still <20% but BFS reaches everything
    // because nothing is trusted to stop propagation
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'trigger', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'trigger'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
    });

    const result = computeNarrowedTarget(input);
    // BFS forward from trigger should reach all nodes in a linear graph
    expect(result).toBeNull();
  });

  it('never includes nodes outside the original target', () => {
    const graph = largeGraph();
    const allNames = [...graph.nodes.keys()];
    // Target only the middle portion of the graph
    const targetNames = ['c', 'd', 'e', 'f', 'g', 'h'];
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...targetNames),
      changeSet: narrowChanges(
        [{ node: 'd', changes: ['parameter'] }],
        targetNames.filter((n) => n !== 'd'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
    });

    const result = computeNarrowedTarget(input);
    if (result && result.kind === 'slice') {
      for (const nodeId of result.slice.nodes) {
        expect(targetNames).toContain(nodeId as string);
      }
    }
  });

  it('narrowed target is always non-empty when changes exist', () => {
    const graph = largeGraph();
    const allNames = [...graph.nodes.keys()];
    // Trust most nodes so narrowing is effective
    const trustedNames = allNames.filter((n) => n !== 'e' && n !== 'f');
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'e', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'e'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: partialTrustState(trustedNames),
    });

    const result = computeNarrowedTarget(input);
    if (result && result.kind === 'slice') {
      expect(result.slice.nodes.size).toBeGreaterThan(0);
    }
  });
});

describe('evaluate pipeline — narrow scenario', () => {
  it('returns narrow decision when broad target has narrow changes', () => {
    const graph = largeGraph();
    const allNames = [...graph.nodes.keys()];
    const trustedNames = allNames.filter((n) => n !== 'e' && n !== 'f');
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'e', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'e'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: partialTrustState(trustedNames),
      // Use validate tool to skip redirect check, isolating narrowing behavior
      tool: 'validate',
    });

    const decision = evaluate(input);
    expect(decision.action).toBe('narrow');
    if (decision.action === 'narrow') {
      expect(decision.narrowedTarget.kind).toBe('slice');
      expect(decision.explanation).toMatch(/narrow/i);
    }
  });
});
