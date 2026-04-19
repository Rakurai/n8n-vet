/**
 * Tests for CLI command functions — verify envelope shapes, defaults, and error mapping.
 */

import { describe, it, expect, vi } from 'vitest';
import { runValidate, runTrust, runExplain } from '../../src/cli/commands.js';
import type { ValidateOptions, ExplainOptions } from '../../src/cli/commands.js';
import type { OrchestratorDeps } from '../../src/orchestrator/types.js';
import type { WorkflowGraph, GraphNode, Edge } from '../../src/types/graph.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { TrustState, NodeChangeSet } from '../../src/types/trust.js';
import type { DiagnosticSummary, ResolvedTarget, ValidationMeta } from '../../src/types/diagnostic.js';
import type { GuardrailDecision } from '../../src/types/guardrail.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';
import { MalformedWorkflowError } from '../../src/static-analysis/errors.js';

// ── Fixture builders ──────────────────────────────────────────────

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

function makeGraph(nodeNames: string[]): WorkflowGraph {
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

function emptyTrustState(): TrustState {
  return { workflowId: 'test', nodes: new Map(), connectionsHash: '' };
}

function proceedDecision(): GuardrailDecision {
  return {
    action: 'proceed',
    explanation: 'No guardrail concerns',
    evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
    overridable: false,
  };
}

function passSummary(): DiagnosticSummary {
  const target: ResolvedTarget = { description: 'test', nodes: [], automatic: true };
  const meta: ValidationMeta = {
    runId: 'run-1',
    executionId: null,
    timestamp: '2026-01-01T00:00:00Z',
    durationMs: 10,
  };
  return {
    schemaVersion: 1,
    status: 'pass',
    target,
    evidenceBasis: 'static',
    executedPath: null,
    errors: [],
    nodeAnnotations: [],
    guardrailActions: [],
    hints: [],
    capabilities: { staticAnalysis: true, mcpTools: false },
    meta,
  };
}

function createMockDeps(overrides?: Partial<OrchestratorDeps>): OrchestratorDeps {
  const graph = makeGraph(['trigger', 'httpReq']);
  const changeSet: NodeChangeSet = {
    added: [],
    removed: [],
    modified: [],
    unchanged: ['trigger' as NodeIdentity, 'httpReq' as NodeIdentity],
  };

  return {
    parseWorkflowFile: vi.fn().mockResolvedValue(graph.ast),
    buildGraph: vi.fn().mockReturnValue(graph),
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
    executeSmoke: vi.fn().mockResolvedValue({ executionId: 'exec-1', status: 'success', error: null }),
    constructPinData: vi.fn().mockReturnValue({ pinData: {}, sourceMap: {} }),
    synthesize: vi.fn().mockReturnValue(passSummary()),
    loadSnapshot: vi.fn().mockReturnValue(graph),
    saveSnapshot: vi.fn(),
    detectCapabilities: vi.fn().mockResolvedValue({
      level: 'mcp',
      mcpAvailable: false,
      mcpTools: [],
    }),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('runValidate', () => {
  const defaultOptions: ValidateOptions = {
    target: { kind: 'changed' },
    layer: 'static',
    force: false,
  };

  it('returns success envelope with DiagnosticSummary', async () => {
    const deps = createMockDeps();
    const result = await runValidate('/test/wf.ts', defaultOptions, deps);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe(1);
      expect(result.data.status).toBe('pass');
    }
  });

  it('returns error envelope when interpret throws unexpectedly', async () => {
    // interpret() normally catches errors, but if something truly unexpected happens
    // (e.g., deps itself throws synchronously), runValidate's catch block handles it
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockImplementation(() => { throw new TypeError('null ref'); }),
    });
    const result = await runValidate('/test/wf.ts', defaultOptions, deps);

    // interpret() catches parse errors internally, so this returns a success envelope
    // with status:'error' rather than a failure envelope
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('error');
    }
  });
});

describe('runTrust', () => {
  it('returns TrustStatusReport envelope', async () => {
    const deps = createMockDeps();
    const result = await runTrust('/test/wf.ts', deps);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalNodes).toBe(2);
      expect(result.data.untrustedNodes).toHaveLength(2);
    }
  });

  it('returns error envelope on parse failure', async () => {
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockRejectedValue(new MalformedWorkflowError('bad')),
    });
    const result = await runTrust('/bad.ts', deps);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('parse_error');
    }
  });
});

describe('runExplain', () => {
  const defaultOptions: ExplainOptions = {
    target: { kind: 'changed' },
    layer: 'static',
  };

  it('returns GuardrailExplanation envelope', async () => {
    const deps = createMockDeps();
    const result = await runExplain('/test/wf.ts', defaultOptions, deps);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.guardrailDecision.action).toBe('proceed');
      expect(result.data.targetResolution.automatic).toBe(true);
      expect(result.data.capabilities.staticAnalysis).toBe(true);
    }
  });

  it('resolves explicit node target', async () => {
    const deps = createMockDeps();
    const options: ExplainOptions = {
      target: { kind: 'nodes', nodes: ['trigger' as NodeIdentity] },
      layer: 'static',
    };
    const result = await runExplain('/test/wf.ts', options, deps);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetResolution.automatic).toBe(false);
      expect(result.data.targetResolution.resolvedNodes).toEqual(['trigger']);
    }
  });

  it('returns error envelope on failure', async () => {
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const result = await runExplain('/bad.ts', defaultOptions, deps);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('internal_error');
    }
  });
});
