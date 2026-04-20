import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/guardrails/evaluate.js';
import { assessEscalationTriggers } from '../../src/guardrails/redirect.js';
import {
  branchingGraph,
  emptyTrustState,
  linearGraph,
  makeEvaluationInput,
  makeExpressionRef,
  narrowChanges,
  nodeSet,
  uniformHashes,
} from './fixtures.js';

describe('assessEscalationTriggers', () => {
  it('all shape-preserving changes → not triggered', () => {
    const graph = linearGraph();
    const allNames = [...graph.nodes.keys()];
    // Only modify 'output' which is shape-preserving
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'output', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'output'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      tool: 'test',
    });

    const result = assessEscalationTriggers(input);
    expect(result.triggered).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('one shape-opaque change → triggered', () => {
    const graph = linearGraph();
    const allNames = [...graph.nodes.keys()];
    // 'code' is shape-opaque in linearGraph
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

    const result = assessEscalationTriggers(input);
    expect(result.triggered).toBe(true);
    expect(result.reasons.some((r) => r.includes('shape-opaque'))).toBe(true);
  });

  it('shape-replacing with downstream $json reference → triggered', () => {
    const graph = linearGraph();
    const allNames = [...graph.nodes.keys()];
    // 'http' is shape-replacing; 'set' is downstream and has $json ref
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'http', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'http'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      tool: 'test',
      expressionRefs: [makeExpressionRef('set', null, { raw: '={{ $json.data }}' })],
    });

    const result = assessEscalationTriggers(input);
    expect(result.triggered).toBe(true);
    expect(result.reasons.some((r) => r.includes('shape-replacing') && r.includes('$json'))).toBe(
      true,
    );
  });

  it('shape-replacing WITHOUT downstream $json reference → not triggered (for that trigger)', () => {
    const graph = linearGraph();
    const allNames = [...graph.nodes.keys()];
    // 'http' is shape-replacing but no downstream $json refs
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'http', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'http'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      tool: 'test',
      expressionRefs: [],
    });

    const result = assessEscalationTriggers(input);
    // shape-replacing without $json should not trigger that specific reason
    expect(result.reasons.some((r) => r.includes('shape-replacing') && r.includes('$json'))).toBe(
      false,
    );
  });

  it('sub-workflow call node changed → triggered', () => {
    const graph = branchingGraph();
    const allNames = [...graph.nodes.keys()];
    // 'subWorkflow' has type n8n-nodes-base.executeWorkflow
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'subWorkflow', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'subWorkflow'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      tool: 'test',
    });

    const result = assessEscalationTriggers(input);
    expect(result.triggered).toBe(true);
    expect(result.reasons.some((r) => r.includes('sub-workflow'))).toBe(true);
  });

  it('llmValidationRequested=true → triggered', () => {
    const graph = linearGraph();
    const allNames = [...graph.nodes.keys()];
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'output', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'output'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      tool: 'test',
      llmValidationRequested: true,
    });

    const result = assessEscalationTriggers(input);
    expect(result.triggered).toBe(true);
    expect(result.reasons.some((r) => r.includes('LLM'))).toBe(true);
  });

  it('branching node with runtime-dependent condition → triggered', () => {
    const graph = branchingGraph();
    const allNames = [...graph.nodes.keys()];
    // 'if' is a branching node; give it a ref to 'enrich' which is shape-replacing
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'if', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'if'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      tool: 'test',
      expressionRefs: [
        makeExpressionRef('if', 'enrich', { raw: '={{ $("Enrich").item.json.status }}' }),
      ],
    });

    const result = assessEscalationTriggers(input);
    expect(result.triggered).toBe(true);
    expect(result.reasons.some((r) => r.includes('Branching') && r.includes('runtime'))).toBe(true);
  });

  it('modified node with execution-setting change kind → triggered', () => {
    const graph = linearGraph();
    const allNames = [...graph.nodes.keys()];
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'output', changes: ['execution-setting'] }],
        allNames.filter((n) => n !== 'output'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      tool: 'test',
    });

    const result = assessEscalationTriggers(input);
    expect(result.triggered).toBe(true);
    expect(result.reasons.some((r) => r.includes('execution-setting'))).toBe(true);
  });

  it('static-only layer request → redirect check skipped in pipeline', () => {
    const graph = linearGraph();
    const allNames = [...graph.nodes.keys()];
    // Even with shape-opaque changes, static layer should not redirect
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'code', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'code'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      tool: 'validate',
    });

    // The pipeline should skip the test-refusal check entirely for validate tool
    const decision = evaluate(input);
    // Should not be 'refuse' from test-refusal — proceed or other action
    expect(decision.action).not.toBe('refuse');
  });

  it('unresolvable branching ref with opaque upstream → triggered', () => {
    // Build a custom graph: opaque → if → output
    // The 'if' branching node has shape-opaque upstream, so the !ref.resolved branch triggers
    const nodes = new Map<string, import('../../src/types/graph.js').GraphNode>([
      [
        'opaque',
        {
          name: 'opaque',
          displayName: 'Opaque',
          type: 'n8n-nodes-base.code',
          typeVersion: 1,
          parameters: {},
          credentials: null,
          disabled: false,
          classification: 'shape-opaque' as const,
        },
      ],
      [
        'if',
        {
          name: 'if',
          displayName: 'Check',
          type: 'n8n-nodes-base.if',
          typeVersion: 1,
          parameters: {},
          credentials: null,
          disabled: false,
          classification: 'shape-preserving' as const,
        },
      ],
      [
        'output',
        {
          name: 'output',
          displayName: 'Output',
          type: 'n8n-nodes-base.set',
          typeVersion: 1,
          parameters: {},
          credentials: null,
          disabled: false,
          classification: 'shape-preserving' as const,
        },
      ],
    ]);
    const forward = new Map([
      ['opaque', [{ from: 'opaque', fromOutput: 0, to: 'if', toInput: 0, isError: false }]],
      ['if', [{ from: 'if', fromOutput: 0, to: 'output', toInput: 0, isError: false }]],
      ['output', []],
    ]);
    const backward = new Map([
      ['opaque', []],
      ['if', [{ from: 'opaque', fromOutput: 0, to: 'if', toInput: 0, isError: false }]],
      ['output', [{ from: 'if', fromOutput: 0, to: 'output', toInput: 0, isError: false }]],
    ]);
    const graph: import('../../src/types/graph.js').WorkflowGraph = {
      nodes,
      forward,
      backward,
      displayNameIndex: new Map([
        ['Opaque', 'opaque'],
        ['Check', 'if'],
        ['Output', 'output'],
      ]),
      ast: { nodes: [], connections: [] } as unknown as import('@n8n-as-code/transformer').WorkflowAST,
    };

    const allNames = [...graph.nodes.keys()];
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'if', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'if'),
      ),
      currentHashes: uniformHashes(allNames),
      trustState: emptyTrustState(),
      tool: 'test',
      expressionRefs: [
        makeExpressionRef('if', null, { raw: '={{ $json[dynamicKey] }}' }),
      ],
    });

    const result = assessEscalationTriggers(input);
    expect(result.triggered).toBe(true);
    expect(result.reasons.some((r) => r.includes('unresolvable'))).toBe(true);
  });
});

describe('evaluate pipeline — test-refusal scenario', () => {
  it('returns refuse when tool=test and all changes are structurally analyzable', () => {
    const graph = linearGraph();
    const allNames = [...graph.nodes.keys()];
    // Only modify 'output' (shape-preserving) with structurally analyzable changes
    const input = makeEvaluationInput({
      graph,
      targetNodes: nodeSet(...allNames),
      changeSet: narrowChanges(
        [{ node: 'output', changes: ['parameter'] }],
        allNames.filter((n) => n !== 'output'),
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
});
