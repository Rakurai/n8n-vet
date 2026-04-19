import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { interpret } from '../../src/orchestrator/interpret.js';
import type { OrchestratorDeps, ValidationRequest } from '../../src/orchestrator/types.js';
import type { WorkflowGraph, GraphNode, Edge } from '../../src/types/graph.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { TrustState, NodeChangeSet } from '../../src/types/trust.js';
import type { DiagnosticSummary, ResolvedTarget, AvailableCapabilities, ValidationMeta } from '../../src/types/diagnostic.js';
import type { GuardrailDecision } from '../../src/types/guardrail.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';

// ── Fixture builders ──────────────────────────────────────────────

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

function makeEdge(from: string, to: string): Edge {
  return { from, fromOutput: 0, isError: false, to, toInput: 0 };
}

function makeGraph(nodeNames: string[], edges: [string, string][]): WorkflowGraph {
  const nodes = new Map<string, GraphNode>();
  const displayNameIndex = new Map<string, string>();
  const forward = new Map<string, Edge[]>();
  const backward = new Map<string, Edge[]>();

  for (const name of nodeNames) {
    nodes.set(name, makeNode(name));
    displayNameIndex.set(name, name);
    forward.set(name, []);
    backward.set(name, []);
  }

  for (const [from, to] of edges) {
    const edge = makeEdge(from, to);
    forward.get(from)!.push(edge);
    backward.get(to)!.push(edge);
  }

  const nodeAsts = nodeNames.map((name) => ({
    propertyName: name,
    id: `id-${name}`,
    name,
    displayName: name,
    type: 'n8n-nodes-base.noOp',
    version: 1,
    position: [0, 0] as [number, number],
    parameters: {},
  }));

  return {
    nodes,
    forward,
    backward,
    displayNameIndex,
    ast: { nodes: nodeAsts, connections: [] } as unknown as WorkflowAST,
  };
}

function emptyTrustState(workflowId = 'test'): TrustState {
  return { workflowId, nodes: new Map(), connectionsHash: '' };
}

function passSummary(resolvedTarget: ResolvedTarget, meta: ValidationMeta): DiagnosticSummary {
  return {
    schemaVersion: 1,
    status: 'pass',
    target: resolvedTarget,
    evidenceBasis: 'static',
    executedPath: null,
    errors: [],
    nodeAnnotations: [],
    guardrailActions: [],
    hints: [],
    capabilities: { staticAnalysis: true, restApi: false, mcpTools: false },
    meta,
  };
}

function proceedDecision(): GuardrailDecision {
  return {
    action: 'proceed',
    explanation: 'No guardrail concerns',
    evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
    overridable: false,
  };
}

// ── Mock deps factory ─────────────────────────────────────────────

function createMockDeps(overrides?: Partial<OrchestratorDeps>): OrchestratorDeps {
  const currentGraph = makeGraph(
    ['trigger', 'httpReq', 'setNode', 'end'],
    [['trigger', 'httpReq'], ['httpReq', 'setNode'], ['setNode', 'end']],
  );

  const previousGraph = makeGraph(
    ['trigger', 'httpReq', 'setNode', 'end'],
    [['trigger', 'httpReq'], ['httpReq', 'setNode'], ['setNode', 'end']],
  );
  // Make one node different in the old graph
  previousGraph.nodes.get('setNode')!.parameters = { old: true };

  const changeSet: NodeChangeSet = {
    added: [],
    removed: [],
    modified: [{ node: 'setNode' as NodeIdentity, changes: ['parameter'] }],
    unchanged: ['trigger' as NodeIdentity, 'httpReq' as NodeIdentity, 'end' as NodeIdentity],
  };

  return {
    parseWorkflowFile: vi.fn().mockResolvedValue(currentGraph.ast),
    buildGraph: vi.fn().mockReturnValue(currentGraph),
    loadTrustState: vi.fn().mockReturnValue(emptyTrustState()),
    persistTrustState: vi.fn(),
    computeChangeSet: vi.fn().mockReturnValue(changeSet),
    invalidateTrust: vi.fn().mockImplementation((state) => state),
    recordValidation: vi.fn().mockImplementation((state) => state),
    evaluate: vi.fn().mockReturnValue(proceedDecision()),
    traceExpressions: vi.fn().mockReturnValue([]),
    detectDataLoss: vi.fn().mockReturnValue([]),
    checkSchemas: vi.fn().mockReturnValue([]),
    validateNodeParams: vi.fn().mockReturnValue([]),
    executeBounded: vi.fn().mockResolvedValue({ executionId: 'exec-1', status: 'success', error: null, partial: true }),
    executeSmoke: vi.fn().mockResolvedValue({ executionId: 'exec-1', status: 'success', error: null, partial: false }),
    getExecutionData: vi.fn().mockResolvedValue({}),
    constructPinData: vi.fn().mockReturnValue({ pinData: {}, sourceMap: {} }),
    synthesize: vi.fn().mockImplementation((input) => {
      const target = input.resolvedTarget as ResolvedTarget;
      const meta = input.meta as ValidationMeta;
      return passSummary(target, meta);
    }),
    loadSnapshot: vi.fn().mockReturnValue(previousGraph),
    saveSnapshot: vi.fn(),
    detectCapabilities: vi.fn().mockResolvedValue({
      level: 'full',
      restAvailable: true,
      mcpAvailable: false,
      mcpTools: [],
    }),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('interpret() — changed-target static-only pipeline', () => {
  const baseRequest: ValidationRequest = {
    workflowPath: '/test/workflow.ts',
    target: { kind: 'changed' },
    layer: 'static',
    force: false,
    pinData: null,
    destinationNode: null,
    destinationMode: 'inclusive',
  };

  it('produces a DiagnosticSummary for a changed-target static-only request', async () => {
    const deps = createMockDeps();

    const result = await interpret(baseRequest, deps);

    expect(result.schemaVersion).toBe(1);
    expect(result.status).toBe('pass');
  });

  it('computes changeSet from snapshot comparison', async () => {
    const deps = createMockDeps();

    await interpret(baseRequest, deps);

    expect(deps.loadSnapshot).toHaveBeenCalled();
    expect(deps.computeChangeSet).toHaveBeenCalled();
  });

  it('consults guardrails with correct evaluation input', async () => {
    const deps = createMockDeps();

    await interpret(baseRequest, deps);

    expect(deps.evaluate).toHaveBeenCalledTimes(1);
    const evalInput = vi.mocked(deps.evaluate).mock.calls[0]![0];
    expect(evalInput.layer).toBe('static');
    expect(evalInput.force).toBe(false);
  });

  it('runs static analysis with resolved nodes', async () => {
    const deps = createMockDeps();

    await interpret(baseRequest, deps);

    expect(deps.traceExpressions).toHaveBeenCalled();
    expect(deps.detectDataLoss).toHaveBeenCalled();
    expect(deps.checkSchemas).toHaveBeenCalled();
    expect(deps.validateNodeParams).toHaveBeenCalled();
  });

  it('calls synthesize with collected evidence', async () => {
    const deps = createMockDeps();

    await interpret(baseRequest, deps);

    expect(deps.synthesize).toHaveBeenCalledTimes(1);
    const synthInput = vi.mocked(deps.synthesize).mock.calls[0]![0];
    expect(synthInput.staticFindings).toBeDefined();
    expect(synthInput.guardrailDecisions).toHaveLength(1);
  });

  it('updates trust on pass', async () => {
    const deps = createMockDeps();

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('pass');
    expect(deps.recordValidation).toHaveBeenCalled();
    expect(deps.persistTrustState).toHaveBeenCalled();
  });

  it('saves snapshot on pass', async () => {
    const deps = createMockDeps();

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('pass');
    expect(deps.saveSnapshot).toHaveBeenCalled();
  });

  it('does not update trust or save snapshot on fail', async () => {
    const deps = createMockDeps({
      synthesize: vi.fn().mockReturnValue({
        schemaVersion: 1,
        status: 'fail',
        target: { description: 'test', nodes: [], automatic: false },
        evidenceBasis: 'static',
        executedPath: null,
        errors: [{ type: 'TestError', message: 'fail', description: null, node: null, classification: 'unknown', context: {} }],
        nodeAnnotations: [],
        guardrailActions: [],
        hints: [],
        capabilities: { staticAnalysis: true, restApi: false, mcpTools: false },
        meta: { runId: 'x', executionId: null, partialExecution: false, timestamp: '', durationMs: 0 },
      }),
    });

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('fail');
    expect(deps.recordValidation).not.toHaveBeenCalled();
    expect(deps.persistTrustState).not.toHaveBeenCalled();
    expect(deps.saveSnapshot).not.toHaveBeenCalled();
  });

  it('returns error diagnostic on parse failure', async () => {
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockRejectedValue(new Error('File not found')),
    });

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('error');
    expect(result.errors[0]!.message).toContain('File not found');
  });

  it('returns skipped when guardrail refuses', async () => {
    const deps = createMockDeps({
      evaluate: vi.fn().mockReturnValue({
        action: 'refuse',
        explanation: 'All nodes trusted',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: true,
      }),
    });

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('skipped');
    expect(result.guardrailActions).toHaveLength(1);
    expect(result.guardrailActions[0]!.action).toBe('refuse');
  });

});

describe('interpret() — nodes-target pipeline (US2)', () => {
  it('scopes validation to named nodes and their context', async () => {
    const deps = createMockDeps();

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'nodes', nodes: ['httpReq' as NodeIdentity, 'setNode' as NodeIdentity] },
      layer: 'static',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    };

    const result = await interpret(request, deps);

    expect(result.status).toBe('pass');
    // Synthesize should have been called with a target containing the named nodes
    const synthInput = vi.mocked(deps.synthesize).mock.calls[0]![0];
    const targetNodes = synthInput.resolvedTarget.nodes.map(String);
    expect(targetNodes).toContain('httpReq');
    expect(targetNodes).toContain('setNode');
  });

  it('returns error for nonexistent node name', async () => {
    const deps = createMockDeps();

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'nodes', nodes: ['nonexistent' as NodeIdentity] },
      layer: 'static',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    };

    const result = await interpret(request, deps);

    expect(result.status).toBe('error');
    expect(result.errors[0]!.message).toContain('nonexistent');
  });

  it('returns error for empty nodes list', async () => {
    const deps = createMockDeps();

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'nodes', nodes: [] },
      layer: 'static',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    };

    const result = await interpret(request, deps);

    expect(result.status).toBe('error');
    expect(result.errors[0]!.message).toContain('Empty');
  });
});

describe('interpret() — workflow-target with guardrail narrowing (US3)', () => {
  it('narrows workflow target when guardrail returns narrow', async () => {
    const deps = createMockDeps({
      evaluate: vi.fn().mockReturnValue({
        action: 'narrow',
        explanation: 'Most nodes unchanged, narrowing to changed slice',
        evidence: { changedNodes: ['setNode' as NodeIdentity], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: true,
        narrowedTarget: {
          kind: 'slice' as const,
          slice: {
            nodes: new Set(['setNode' as NodeIdentity, 'end' as NodeIdentity]),
            seedNodes: new Set(['setNode' as NodeIdentity]),
            entryPoints: ['setNode' as NodeIdentity],
            exitPoints: ['end' as NodeIdentity],
          },
        },
      }),
    });

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'workflow' },
      layer: 'static',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    };

    const result = await interpret(request, deps);

    expect(result.status).toBe('pass');
    const synthInput = vi.mocked(deps.synthesize).mock.calls[0]![0];
    expect(synthInput.resolvedTarget.description).toContain('Narrowed');
  });

  it('overrides narrowing when force is true', async () => {
    const deps = createMockDeps({
      evaluate: vi.fn().mockReturnValue({
        action: 'narrow',
        explanation: 'Would narrow',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: true,
        narrowedTarget: {
          kind: 'slice' as const,
          slice: {
            nodes: new Set(['setNode' as NodeIdentity]),
            seedNodes: new Set(['setNode' as NodeIdentity]),
            entryPoints: ['setNode' as NodeIdentity],
            exitPoints: ['setNode' as NodeIdentity],
          },
        },
      }),
    });

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'workflow' },
      layer: 'static',
      force: true,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    };

    const result = await interpret(request, deps);

    expect(result.status).toBe('pass');
    const synthInput = vi.mocked(deps.synthesize).mock.calls[0]![0];
    expect(synthInput.resolvedTarget.description).not.toContain('Narrowed');
  });

  it('includes guardrail decision in summary guardrailActions', async () => {
    const deps = createMockDeps({
      evaluate: vi.fn().mockReturnValue({
        action: 'narrow',
        explanation: 'Narrowing',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: true,
        narrowedTarget: {
          kind: 'slice' as const,
          slice: {
            nodes: new Set(['setNode' as NodeIdentity]),
            seedNodes: new Set(['setNode' as NodeIdentity]),
            entryPoints: ['setNode' as NodeIdentity],
            exitPoints: ['setNode' as NodeIdentity],
          },
        },
      }),
    });

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'workflow' },
      layer: 'static',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    };

    const result = await interpret(request, deps);

    // guardrailActions is populated by synthesize, which gets the decisions
    const synthInput = vi.mocked(deps.synthesize).mock.calls[0]![0];
    expect(synthInput.guardrailDecisions).toHaveLength(1);
    expect(synthInput.guardrailDecisions[0]!.action).toBe('narrow');
  });
});

describe('interpret() — guardrail routing (US4 T012)', () => {
  const baseRequest: ValidationRequest = {
    workflowPath: '/test/workflow.ts',
    target: { kind: 'changed' },
    layer: 'static',
    force: false,
    pinData: null,
    destinationNode: null,
    destinationMode: 'inclusive',
  };

  it('refuse: returns skipped, no static/execution runs', async () => {
    const deps = createMockDeps({
      evaluate: vi.fn().mockReturnValue({
        action: 'refuse',
        explanation: 'All trusted',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: true,
      }),
    });

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('skipped');
    expect(deps.detectDataLoss).not.toHaveBeenCalled();
    expect(deps.checkSchemas).not.toHaveBeenCalled();
  });

  it('redirect: changes effectiveLayer to static, no execution', async () => {
    const deps = createMockDeps({
      evaluate: vi.fn().mockReturnValue({
        action: 'redirect',
        explanation: 'Redirecting to static',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: true,
        redirectedLayer: 'static' as const,
      }),
    });

    const request = { ...baseRequest, layer: 'both' as const };
    const result = await interpret(request, deps);

    expect(result.status).toBe('pass');
    expect(deps.detectDataLoss).toHaveBeenCalled();
    expect(deps.executeBounded).not.toHaveBeenCalled();
    expect(deps.executeSmoke).not.toHaveBeenCalled();
  });

  it('warn: proceeds normally', async () => {
    const deps = createMockDeps({
      evaluate: vi.fn().mockReturnValue({
        action: 'warn',
        explanation: 'Broad target warning',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: false,
      }),
    });

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('pass');
    expect(deps.detectDataLoss).toHaveBeenCalled();
  });

  it('proceed: no changes to target or layer', async () => {
    const deps = createMockDeps();

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('pass');
  });

  it('force flag overrides refusal', async () => {
    const deps = createMockDeps({
      evaluate: vi.fn().mockReturnValue({
        action: 'refuse',
        explanation: 'Would refuse',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: true,
      }),
    });

    const request = { ...baseRequest, force: true };
    const result = await interpret(request, deps);

    expect(result.status).toBe('pass');
  });
});

describe('interpret() — execution-backed validation (US4 T014)', () => {
  beforeEach(() => {
    process.env['N8N_HOST'] = 'http://localhost:5678';
    process.env['N8N_API_KEY'] = 'test-api-key';
  });

  afterEach(() => {
    delete process.env['N8N_HOST'];
    delete process.env['N8N_API_KEY'];
  });

  it('runs both static and execution for layer:both', async () => {
    const deps = createMockDeps({
      detectCapabilities: vi.fn().mockResolvedValue({
        level: 'full',
        restAvailable: true,
        mcpAvailable: false,
        mcpTools: [],
      }),
    });

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'changed' },
      layer: 'both',
      force: false,
      pinData: null,
      destinationNode: 'end',
      destinationMode: 'inclusive',
    };

    const result = await interpret(request, deps);

    expect(result.status).toBe('pass');
    expect(deps.detectDataLoss).toHaveBeenCalled();
    expect(deps.executeBounded).toHaveBeenCalled();
  });

  it('runs execution only for layer:execution', async () => {
    const deps = createMockDeps({
      detectCapabilities: vi.fn().mockResolvedValue({
        level: 'full',
        restAvailable: true,
        mcpAvailable: false,
        mcpTools: [],
      }),
    });

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'changed' },
      layer: 'execution',
      force: false,
      pinData: null,
      destinationNode: 'end',
      destinationMode: 'inclusive',
    };

    const result = await interpret(request, deps);

    expect(result.status).toBe('pass');
    expect(deps.detectDataLoss).not.toHaveBeenCalled();
    expect(deps.executeBounded).toHaveBeenCalled();
  });

  it('redirect from both to static means no execution', async () => {
    const deps = createMockDeps({
      evaluate: vi.fn().mockReturnValue({
        action: 'redirect',
        explanation: 'Redirect to static',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: true,
        redirectedLayer: 'static' as const,
      }),
    });

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'changed' },
      layer: 'both',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    };

    const result = await interpret(request, deps);

    expect(result.status).toBe('pass');
    expect(deps.executeBounded).not.toHaveBeenCalled();
    expect(deps.executeSmoke).not.toHaveBeenCalled();
  });

  it('uses inclusive/exclusive destination mode', async () => {
    const deps = createMockDeps({
      detectCapabilities: vi.fn().mockResolvedValue({
        level: 'full',
        restAvailable: true,
        mcpAvailable: false,
        mcpTools: [],
      }),
    });

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'changed' },
      layer: 'execution',
      force: false,
      pinData: null,
      destinationNode: 'setNode',
      destinationMode: 'exclusive',
    };

    await interpret(request, deps);

    expect(deps.executeBounded).toHaveBeenCalledWith(
      expect.any(String),
      'setNode',
      expect.any(Object),
      expect.any(Object),
      'exclusive',
    );
  });

  it('returns error on execution failure', async () => {
    const deps = createMockDeps({
      detectCapabilities: vi.fn().mockResolvedValue({
        level: 'full',
        restAvailable: true,
        mcpAvailable: false,
        mcpTools: [],
      }),
      executeBounded: vi.fn().mockRejectedValue(new Error('Connection refused')),
    });

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'changed' },
      layer: 'execution',
      force: false,
      pinData: null,
      destinationNode: 'end',
      destinationMode: 'inclusive',
    };

    const result = await interpret(request, deps);

    expect(result.status).toBe('error');
    expect(result.errors[0]!.message).toContain('Connection refused');
  });
});

describe('interpret() — trust persistence across runs (US5 T015)', () => {
  const baseRequest: ValidationRequest = {
    workflowPath: '/test/workflow.ts',
    target: { kind: 'changed' },
    layer: 'static',
    force: false,
    pinData: null,
    destinationNode: null,
    destinationMode: 'inclusive',
  };

  it('records trust and persists on pass', async () => {
    const deps = createMockDeps();

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('pass');
    expect(deps.recordValidation).toHaveBeenCalledTimes(1);
    expect(deps.persistTrustState).toHaveBeenCalledTimes(1);
    expect(deps.saveSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not update trust or snapshot on fail', async () => {
    const deps = createMockDeps({
      synthesize: vi.fn().mockReturnValue({
        schemaVersion: 1,
        status: 'fail',
        target: { description: 'test', nodes: [], automatic: false },
        evidenceBasis: 'static',
        executedPath: null,
        errors: [{ type: 'TestError', message: 'test fail', description: null, node: null, classification: 'unknown', context: {} }],
        nodeAnnotations: [],
        guardrailActions: [],
        hints: [],
        capabilities: { staticAnalysis: true, restApi: false, mcpTools: false },
        meta: { runId: 'x', executionId: null, partialExecution: false, timestamp: '', durationMs: 0 },
      }),
    });

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('fail');
    expect(deps.recordValidation).not.toHaveBeenCalled();
    expect(deps.persistTrustState).not.toHaveBeenCalled();
    expect(deps.saveSnapshot).not.toHaveBeenCalled();
  });

  it('does not update trust on guardrail refusal (skipped)', async () => {
    const deps = createMockDeps({
      evaluate: vi.fn().mockReturnValue({
        action: 'refuse',
        explanation: 'Refused',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: true,
      }),
    });

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('skipped');
    expect(deps.recordValidation).not.toHaveBeenCalled();
    expect(deps.persistTrustState).not.toHaveBeenCalled();
    expect(deps.saveSnapshot).not.toHaveBeenCalled();
  });

  it('recordValidation receives validated node identities', async () => {
    const deps = createMockDeps();

    await interpret(baseRequest, deps);

    const recordCall = vi.mocked(deps.recordValidation).mock.calls[0]!;
    const validatedNodes = recordCall[1];
    // Validated nodes should be the resolved target nodes
    expect(validatedNodes.length).toBeGreaterThan(0);
  });
});

describe('interpret() — multi-path validation (US6 T020)', () => {
  it('runs static analysis for each path when multiple paths selected', async () => {
    // Create a branching graph: trigger → B → C, trigger → D → end
    const branchGraph = makeGraph(
      ['trigger', 'B', 'C', 'D', 'end'],
      [['trigger', 'B'], ['B', 'C'], ['trigger', 'D'], ['D', 'end']],
    );
    // Make trigger have two outputs
    branchGraph.forward.set('trigger', [
      makeEdge('trigger', 'B'),
      { ...makeEdge('trigger', 'D'), fromOutput: 1 },
    ]);

    const changeSet: NodeChangeSet = {
      added: [],
      removed: [],
      modified: [
        { node: 'B' as NodeIdentity, changes: ['parameter'] },
        { node: 'D' as NodeIdentity, changes: ['parameter'] },
      ],
      unchanged: ['trigger' as NodeIdentity, 'C' as NodeIdentity, 'end' as NodeIdentity],
    };

    const deps = createMockDeps({
      buildGraph: vi.fn().mockReturnValue(branchGraph),
      computeChangeSet: vi.fn().mockReturnValue(changeSet),
      loadSnapshot: vi.fn().mockReturnValue(branchGraph),
    });

    const request: ValidationRequest = {
      workflowPath: '/test/workflow.ts',
      target: { kind: 'changed' },
      layer: 'static',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    };

    await interpret(request, deps);

    // With multi-path (B on one branch, D on another),
    // detectDataLoss should be called once per path (2 paths) for static analysis
    const dataLossCallCount = vi.mocked(deps.detectDataLoss).mock.calls.length;
    expect(dataLossCallCount).toBe(2);
  });
});

describe('interpret() — error conditions (T022)', () => {
  const baseRequest: ValidationRequest = {
    workflowPath: '/test/workflow.ts',
    target: { kind: 'changed' },
    layer: 'static',
    force: false,
    pinData: null,
    destinationNode: null,
    destinationMode: 'inclusive',
  };

  it('returns error diagnostic when workflow file not found', async () => {
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
    });

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('error');
    expect(result.errors[0]!.message).toContain('ENOENT');
  });

  it('returns error diagnostic on malformed workflow parse failure', async () => {
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockRejectedValue(new Error('SyntaxError: unexpected token')),
    });

    const result = await interpret(baseRequest, deps);

    expect(result.status).toBe('error');
    expect(result.errors[0]!.message).toContain('SyntaxError');
  });

  it('returns error diagnostic when execution fails to start', async () => {
    process.env['N8N_HOST'] = 'http://localhost:5678';
    process.env['N8N_API_KEY'] = 'test-api-key';
    try {
      const deps = createMockDeps({
        detectCapabilities: vi.fn().mockResolvedValue({
          level: 'full',
          restAvailable: true,
          mcpAvailable: false,
          mcpTools: [],
        }),
        executeBounded: vi.fn().mockRejectedValue(new Error('Workflow not found on n8n')),
      });

      const request: ValidationRequest = {
        ...baseRequest,
        layer: 'execution',
        destinationNode: 'end',
      };

      const result = await interpret(request, deps);

      expect(result.status).toBe('error');
      expect(result.errors[0]!.message).toContain('Workflow not found');
    } finally {
      delete process.env['N8N_HOST'];
      delete process.env['N8N_API_KEY'];
    }
  });

  it('propagates static analysis internal errors (does not catch)', async () => {
    const deps = createMockDeps({
      traceExpressions: vi.fn().mockImplementation(() => {
        throw new Error('Internal static analysis bug');
      }),
    });

    // traceExpressions is called in step 5 (guardrail evaluation input),
    // which will throw before we even get to static analysis
    await expect(interpret(baseRequest, deps)).rejects.toThrow('Internal static analysis bug');
  });

  it('error diagnostic includes valid meta with runId', async () => {
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockRejectedValue(new Error('fail')),
    });

    const result = await interpret(baseRequest, deps);

    expect(result.meta.runId).toBeDefined();
    expect(result.meta.runId.length).toBeGreaterThan(0);
    expect(result.meta.timestamp).toBeDefined();
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });
});
