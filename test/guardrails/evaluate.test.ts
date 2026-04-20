import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/guardrails/evaluate.js';
import {
  branchingGraph,
  emptyTrustState,
  failedSummary,
  fullTrustState,
  largeGraph,
  linearGraph,
  makeEvaluationInput,
  narrowChanges,
  noChanges,
  nodeSet,
  partialTrustState,
  uniformHashes,
} from './fixtures.js';

describe('evaluate pipeline', () => {
  describe('Step 1: force bypass', () => {
    it('returns proceed with evidence when force is true', () => {
      const input = makeEvaluationInput({ force: true });
      const decision = evaluate(input);

      expect(decision.action).toBe('proceed');
      expect(decision.explanation).toMatch(/force/i);
      expect(decision.evidence).toBeDefined();
      expect(decision.evidence.changedNodes).toEqual([]);
      expect(decision.evidence.trustedNodes).toEqual([]);
      expect(decision.evidence.lastValidatedAt).toBeNull();
      expect(decision.evidence.fixtureChanged).toBe(false);
    });
  });

  describe('Step 2: empty target', () => {
    it('returns refuse with overridable=false when target has no nodes', () => {
      const input = makeEvaluationInput({
        targetNodes: nodeSet(),
      });
      const decision = evaluate(input);

      expect(decision.action).toBe('refuse');
      expect(decision.overridable).toBe(false);
      expect(decision.evidence).toBeDefined();
    });
  });

  describe('Step 3: test-refusal', () => {
    it('refuses when tool=test and no escalation triggers fire', () => {
      const graph = linearGraph();
      const allNames = [...graph.nodes.keys()];
      // Only change shape-preserving/augmenting nodes — no escalation triggers
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet('trigger', 'set'),
        changeSet: narrowChanges(
          [{ node: 'set', changes: ['parameter'] }],
          allNames.filter((n) => n !== 'set'),
        ),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        tool: 'test',
      });
      const decision = evaluate(input);

      expect(decision.action).toBe('refuse');
      expect(decision.explanation).toMatch(/use validate instead/i);
      expect(decision.overridable).toBe(true);
    });

    it('does not refuse when tool=validate', () => {
      const graph = linearGraph();
      const allNames = [...graph.nodes.keys()];
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet('trigger', 'set'),
        changeSet: narrowChanges(
          [{ node: 'set', changes: ['parameter'] }],
          allNames.filter((n) => n !== 'set'),
        ),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).not.toBe('refuse');
    });

    it('proceeds when tool=test and an opaque node triggers escalation', () => {
      const graph = linearGraph();
      const allNames = [...graph.nodes.keys()];
      // 'code' is shape-opaque — triggers escalation
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...allNames),
        changeSet: narrowChanges(
          [{ node: 'code', changes: ['parameter'] }],
          allNames.filter((n) => n !== 'code'),
        ),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        tool: 'test',
      });
      const decision = evaluate(input);

      expect(decision.action).not.toBe('refuse');
    });

    it('force overrides test-refusal', () => {
      const graph = linearGraph();
      const allNames = [...graph.nodes.keys()];
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet('trigger', 'set'),
        changeSet: narrowChanges(
          [{ node: 'set', changes: ['parameter'] }],
          allNames.filter((n) => n !== 'set'),
        ),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        tool: 'test',
        force: true,
      });
      const decision = evaluate(input);

      expect(decision.action).toBe('proceed');
    });
  });

  describe('Step 7: identical rerun', () => {
    it('returns refuse with overridable=true when all trusted + no changes + matching fixture', () => {
      // Use branchingGraph (10 nodes) with 6-node target (60%) to avoid broad-target warn
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      const targetNames = allNames.slice(0, 6);
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...targetNames),
        changeSet: noChanges(targetNames),
        currentHashes: uniformHashes(allNames),
        trustState: fullTrustState(allNames, { fixtureHash: 'fixture-001' }),
        fixtureHash: 'fixture-001',
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).toBe('refuse');
      expect(decision.overridable).toBe(true);
    });

    it('does not refuse when one trust-breaking change exists', () => {
      const graph = linearGraph();
      const allNames = [...graph.nodes.keys()];
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...allNames),
        changeSet: narrowChanges(
          [{ node: 'http', changes: ['parameter'] }],
          allNames.filter((n) => n !== 'http'),
        ),
        // http has a different hash from trust record
        currentHashes: uniformHashes(allNames, 'different-hash'),
        trustState: fullTrustState(allNames),
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).not.toBe('refuse');
    });

    it('does not refuse when fixture hash differs', () => {
      const graph = linearGraph();
      const allNames = [...graph.nodes.keys()];
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...allNames),
        changeSet: noChanges(allNames),
        currentHashes: uniformHashes(allNames),
        trustState: fullTrustState(allNames, { fixtureHash: 'fixture-old' }),
        fixtureHash: 'fixture-new',
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).not.toBe('refuse');
    });
  });

  describe('Step 5: DeFlaker warn', () => {
    it('warns when prior failure path does not intersect changes', () => {
      // Use branchingGraph with exactly 5-node target (narrowing needs >5)
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      const targetNames = allNames.slice(0, 5);
      // Change last target node, failure path on first three (no intersection)
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...targetNames),
        changeSet: narrowChanges(
          [{ node: targetNames[4], changes: ['parameter'] }],
          targetNames.filter((n) => n !== targetNames[4]),
        ),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        priorSummary: failedSummary([targetNames[0], targetNames[1], targetNames[2]], 'expression'),
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).toBe('warn');
      expect(decision.explanation).toMatch(/prior run failed/i);
    });

    it('does not warn when prior failure path is null', () => {
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      const targetNames = allNames.slice(0, 6);
      const summary = failedSummary([targetNames[0]], 'expression');
      summary.executedPath = null;
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...targetNames),
        changeSet: narrowChanges(
          [{ node: targetNames[5], changes: ['parameter'] }],
          targetNames.filter((n) => n !== targetNames[5]),
        ),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        priorSummary: summary,
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).not.toBe('warn');
    });

    it('does not warn when failing path intersects changes', () => {
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      const targetNames = allNames.slice(0, 6);
      // Changes on targetNames[1], failure path includes targetNames[1] → intersection
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...targetNames),
        changeSet: narrowChanges(
          [{ node: targetNames[1], changes: ['parameter'] }],
          targetNames.filter((n) => n !== targetNames[1]),
        ),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        priorSummary: failedSummary([targetNames[0], targetNames[1], targetNames[2]], 'expression'),
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).not.toBe('warn');
    });

    it('does not warn when failure is external-service', () => {
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      const targetNames = allNames.slice(0, 6);
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...targetNames),
        changeSet: narrowChanges(
          [{ node: targetNames[5], changes: ['parameter'] }],
          targetNames.filter((n) => n !== targetNames[5]),
        ),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        priorSummary: failedSummary(
          [targetNames[0], targetNames[1], targetNames[2]],
          'external-service',
        ),
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).not.toBe('warn');
    });

    it('does not warn when failure is platform', () => {
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      const targetNames = allNames.slice(0, 6);
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...targetNames),
        changeSet: narrowChanges(
          [{ node: targetNames[5], changes: ['parameter'] }],
          targetNames.filter((n) => n !== targetNames[5]),
        ),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        priorSummary: failedSummary([targetNames[0], targetNames[1], targetNames[2]], 'platform'),
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).not.toBe('warn');
    });

    it('does not warn when no prior summary exists', () => {
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      const targetNames = allNames.slice(0, 6);
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...targetNames),
        changeSet: narrowChanges(
          [{ node: targetNames[5], changes: ['parameter'] }],
          targetNames.filter((n) => n !== targetNames[5]),
        ),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        priorSummary: null,
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).not.toBe('warn');
    });
  });

  describe('Step 6: broad-target warn', () => {
    it('warns when target covers >70% of workflow (80%)', () => {
      // branchingGraph has 10 nodes; target 8 of them = 80%
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      const targetNames = allNames.slice(0, 8);
      // Provide prior trust so this isn't treated as first-ever validation
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...targetNames),
        changeSet: noChanges(targetNames),
        currentHashes: uniformHashes(allNames),
        trustState: partialTrustState([allNames[0]]),
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).toBe('warn');
      expect(decision.explanation).toMatch(/80%/);
    });

    it('does not warn when target covers 60% (below threshold)', () => {
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      // 6 out of 10 = 60%
      const targetNames = allNames.slice(0, 6);
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...targetNames),
        changeSet: noChanges(targetNames),
        currentHashes: uniformHashes(allNames),
        trustState: partialTrustState([allNames[0]]),
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).not.toBe('warn');
    });

    it('does not warn when target covers exactly 70% (threshold is strictly >)', () => {
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      // 7 out of 10 = 70% exactly
      const targetNames = allNames.slice(0, 7);
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...targetNames),
        changeSet: noChanges(targetNames),
        currentHashes: uniformHashes(allNames),
        trustState: partialTrustState([allNames[0]]),
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).not.toBe('warn');
    });

    it('does not warn on first-ever validation even at 100% coverage', () => {
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...allNames),
        changeSet: noChanges(allNames),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        tool: 'validate',
      });
      const decision = evaluate(input);

      // First-ever validation: no changed nodes, no trusted nodes → suppress warning
      expect(decision.action).not.toBe('warn');
    });
  });

  describe('Step 8: proceed (default)', () => {
    it('returns proceed with fully populated evidence when no guardrails trigger', () => {
      // Use branchingGraph (10 nodes) with 6-node target (60%) to avoid broad-target warn
      const graph = branchingGraph();
      const allNames = [...graph.nodes.keys()];
      const targetNames = allNames.slice(0, 6);
      const input = makeEvaluationInput({
        graph,
        targetNodes: nodeSet(...targetNames),
        changeSet: noChanges(targetNames),
        currentHashes: uniformHashes(allNames),
        trustState: emptyTrustState(),
        tool: 'validate',
      });
      const decision = evaluate(input);

      expect(decision.action).toBe('proceed');
      expect(decision.overridable).toBe(true);
      expect(decision.evidence.changedNodes).toEqual([]);
      expect(decision.evidence.trustedNodes).toEqual([]);
      expect(decision.evidence.lastValidatedAt).toBeNull();
      expect(decision.evidence.fixtureChanged).toBe(false);
    });
  });
});

describe('full pipeline integration — deterministic evaluation order', () => {
  // All tests use branchingGraph (10 nodes) as the shared fixture

  it('Step 1 wins over all: force=true → proceed even with empty target conditions', () => {
    const input = makeEvaluationInput({
      graph: branchingGraph(),
      force: true,
      targetNodes: nodeSet(), // empty target would normally refuse
    });
    expect(evaluate(input).action).toBe('proceed');
  });

  it('Step 2 wins over Steps 3-8: empty target → refuse regardless of trust state', () => {
    const graph = branchingGraph();
    const allNames = [...graph.nodes.keys()];
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(),
      trustState: fullTrustState(allNames, { fixtureHash: 'f' }),
      fixtureHash: 'f',
    });
    const decision = evaluate(input);
    expect(decision.action).toBe('refuse');
    expect(decision.overridable).toBe(false);
  });

  it('Step 3 wins over Steps 4-8: test-refusal fires when tool=test and no escalation triggers', () => {
    const graph = branchingGraph();
    const allNames = [...graph.nodes.keys()];
    // All nodes are shape-preserving/augmenting — no escalation triggers
    const targetNames = allNames.filter(
      (n) => !['subWorkflow', 'enrich'].includes(n),
    );
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...targetNames),
      changeSet: narrowChanges(
        [{ node: 'validate', changes: ['parameter'] }],
        targetNames.filter((n) => n !== 'validate'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      tool: 'test',
    });
    const decision = evaluate(input);
    expect(decision.action).toBe('refuse');
    expect(decision.explanation).toMatch(/use validate instead/i);
    expect(decision.overridable).toBe(true);
  });

  it('Step 4 wins over Steps 5-8: narrow fires before DeFlaker and warnings', () => {
    const graph = largeGraph();
    const allNames = [...graph.nodes.keys()];
    // 1-2 changes out of 15 nodes on static layer → narrow should fire
    // Trust most nodes so narrowing has a clear boundary
    const trustedNames = allNames.filter((n) => !['e'].includes(n));
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'e', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'e'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: partialTrustState(trustedNames),
      tool: 'validate',
    });
    expect(evaluate(input).action).toBe('narrow');
  });

  it('Step 5 wins over Steps 6-8: narrowing fires before DeFlaker', () => {
    const graph = largeGraph();
    const allNames = [...graph.nodes.keys()];
    const trustedNames = allNames.filter((n) => !['e', 'f'].includes(n));
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'e', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'e'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: partialTrustState(trustedNames),
      // Prior failure that would trigger DeFlaker if reached
      priorSummary: failedSummary(['trigger', 'a', 'b'], 'expression'),
      tool: 'validate',
    });
    expect(evaluate(input).action).toBe('narrow');
  });

  it('Step 6 wins over Steps 7-8: DeFlaker warn fires before broad-target warn', () => {
    // 5-node target on 10-node graph = 50% (no broad-target warn)
    // but with DeFlaker condition met
    const graph = branchingGraph();
    const allNames = [...graph.nodes.keys()];
    const targetNames = allNames.slice(0, 5);
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...targetNames),
      changeSet: narrowChanges(
        [{ node: targetNames[4], changes: ['parameter'] }],
        targetNames.filter((n) => n !== targetNames[4]),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      priorSummary: failedSummary([targetNames[0], targetNames[1]], 'expression'),
      tool: 'validate',
    });
    expect(evaluate(input).action).toBe('warn');
  });

  it('Step 7 fires when 6 does not: broad-target warn without DeFlaker', () => {
    const graph = branchingGraph();
    const allNames = [...graph.nodes.keys()];
    const targetNames = allNames.slice(0, 8); // 80% coverage
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...targetNames),
      changeSet: noChanges(targetNames),
      currentHashes: uniformHashes(allNames),
      trustState: partialTrustState([allNames[0]]),
      priorSummary: null,
      tool: 'validate',
    });
    expect(evaluate(input).action).toBe('warn');
  });

  it('Step 8: proceed when no guardrails trigger', () => {
    const graph = branchingGraph();
    const allNames = [...graph.nodes.keys()];
    const targetNames = allNames.slice(0, 6); // 60% — no broad-target warn
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...targetNames),
      changeSet: noChanges(targetNames),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      priorSummary: null,
      tool: 'validate',
    });
    const decision = evaluate(input);
    expect(decision.action).toBe('proceed');
    expect(decision.evidence).toBeDefined();
  });
});
