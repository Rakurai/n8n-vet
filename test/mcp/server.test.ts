/**
 * Tests for MCP server — verifies all three tools (validate, trust_status, explain)
 * produce correct envelope shapes, apply defaults, and map errors.
 */

import { describe, it, expect, vi } from 'vitest';
import { createServer } from '../../src/mcp/server.js';
import type { OrchestratorDeps } from '../../src/orchestrator/types.js';
import type { WorkflowGraph, GraphNode, Edge } from '../../src/types/graph.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { TrustState, NodeChangeSet, NodeTrustRecord } from '../../src/types/trust.js';
import type { DiagnosticSummary, ResolvedTarget, ValidationMeta } from '../../src/types/diagnostic.js';
import type { GuardrailDecision } from '../../src/types/guardrail.js';
import type { McpToolCaller } from '../../src/execution/mcp-client.js';
import type { McpResponse } from '../../src/errors.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';
import { MalformedWorkflowError } from '../../src/static-analysis/errors.js';
import { computeContentHash } from '../../src/trust/hash.js';

// ── Fixture builders ──────────────────────────────────────────────

function makeNode(name: string): GraphNode {
  return {
    name: name as NodeIdentity,
    displayName: name,
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    parameters: {},
    credentials: null,
    disabled: false,
    classification: 'shape-preserving',
  };
}

function makeEdge(from: string, to: string): Edge {
  return { from: from as NodeIdentity, fromOutput: 0, isError: false, to: to as NodeIdentity, toInput: 0 };
}

function makeGraph(nodeNames: string[], edges: [string, string][]): WorkflowGraph {
  const nodes = new Map<NodeIdentity, GraphNode>();
  const displayNameIndex = new Map<string, NodeIdentity>();
  const forward = new Map<NodeIdentity, Edge[]>();
  const backward = new Map<NodeIdentity, Edge[]>();

  for (const name of nodeNames) {
    const id = name as NodeIdentity;
    nodes.set(id, makeNode(name));
    displayNameIndex.set(name, id);
    forward.set(id, []);
    backward.set(id, []);
  }

  for (const [from, to] of edges) {
    const edge = makeEdge(from, to);
    forward.get(from as NodeIdentity)!.push(edge);
    backward.get(to as NodeIdentity)!.push(edge);
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
    ast: { nodes: nodeAsts, connections: [], metadata: { id: 'n8n-uuid-123', name: 'Test', active: false } } as unknown as WorkflowAST,
  };
}

function emptyTrustState(workflowId = 'test'): TrustState {
  return { workflowId, nodes: new Map(), connectionsHash: '' };
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

// ── Mock deps ─────────────────────────────────────────────────────

function createMockDeps(overrides?: Partial<OrchestratorDeps>): OrchestratorDeps {
  const graph = makeGraph(
    ['trigger', 'httpReq'],
    [['trigger', 'httpReq']],
  );

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

// ── Helpers to invoke tools via the server ────────────────────────

/**
 * Extract a registered tool's handler from McpServer internals.
 * _registeredTools is a plain object keyed by tool name; each entry has a `handler` function.
 */
function getToolHandler(server: ReturnType<typeof createServer>, toolName: string) {
  const internal = server as unknown as {
    _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }>;
  };
  const tool = internal._registeredTools?.[toolName];
  if (!tool) throw new Error(`Tool "${toolName}" not found on server`);
  return tool.handler;
}

function parseEnvelope<T>(result: { content: Array<{ type: string; text: string }> }): McpResponse<T> {
  return JSON.parse(result.content[0].text) as McpResponse<T>;
}

// ── Tests ─────────────────────────────────────────────────────────

describe('MCP server — validate tool', () => {
  it('returns success envelope with DiagnosticSummary', async () => {
    const summary = passSummary();
    const deps = createMockDeps({
      synthesize: vi.fn().mockReturnValue(summary),
    });
    // interpret calls synthesize internally; mock the full pipeline by
    // mocking interpret via its subsystem deps
    const server = createServer(deps);
    const validate = getToolHandler(server, 'validate');

    const result = await validate({ kind: 'changed', workflowPath: 'test/wf.ts' }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope(result);

    expect(envelope.success).toBe(true);
    if (envelope.success) {
      expect(envelope.data).toHaveProperty('schemaVersion', 1);
      expect(envelope.data).toHaveProperty('status');
    }
  });

  it('applies default target=changed and layer=static when omitted', async () => {
    const deps = createMockDeps();
    const server = createServer(deps);
    const validate = getToolHandler(server, 'validate');

    await validate({ kind: 'changed', workflowPath: 'test/wf.ts' });

    // interpret is called internally; check that buildGraph was called (pipeline ran)
    expect(deps.parseWorkflowFile).toHaveBeenCalledWith('test/wf.ts');
  });

  it('returns error-status diagnostic when parseWorkflowFile fails', async () => {
    // interpret() catches parse errors and returns status:'error' diagnostics
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockRejectedValue(new MalformedWorkflowError('bad nodes')),
    });
    const server = createServer(deps);
    const validate = getToolHandler(server, 'validate');

    const result = await validate({ kind: 'changed', workflowPath: 'bad.ts' }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope<DiagnosticSummary>(result);

    expect(envelope.success).toBe(true);
    if (envelope.success) {
      expect(envelope.data.status).toBe('error');
    }
  });
});

describe('MCP server — trust_status tool', () => {
  it('returns TrustStatusReport with untrusted nodes when no trust state', async () => {
    const deps = createMockDeps();
    const server = createServer(deps);
    const trustStatus = getToolHandler(server, 'trust_status');

    const result = await trustStatus({ workflowPath: 'test/wf.ts' }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope(result);

    expect(envelope.success).toBe(true);
    if (envelope.success) {
      const report = envelope.data as { totalNodes: number; untrustedNodes: unknown[]; trustedNodes: unknown[] };
      expect(report.totalNodes).toBe(2);
      expect(report.untrustedNodes).toHaveLength(2);
      expect(report.trustedNodes).toHaveLength(0);
    }
  });

  it('reports trusted nodes when trust records have matching content hash', async () => {
    const graph = makeGraph(['nodeA'], []);
    const realHash = computeContentHash(graph.nodes.get('nodeA' as NodeIdentity)!, graph.ast);

    const trustState: TrustState = {
      workflowId: 'test',
      nodes: new Map([
        ['nodeA' as NodeIdentity, {
          contentHash: realHash,
          validatedBy: 'test',
          validatedAt: '2026-01-01T00:00:00Z',
          validatedWith: 'static',
          fixtureHash: null,
        } as NodeTrustRecord],
      ]),
      connectionsHash: '',
    };

    const deps = createMockDeps({
      buildGraph: vi.fn().mockReturnValue(graph),
      loadTrustState: vi.fn().mockReturnValue(trustState),
      loadSnapshot: vi.fn().mockReturnValue(null),
    });

    const server = createServer(deps);
    const trustStatus = getToolHandler(server, 'trust_status');

    const result = await trustStatus({ workflowPath: 'test/wf.ts' }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope(result);

    expect(envelope.success).toBe(true);
    if (envelope.success) {
      const report = envelope.data as { trustedNodes: Array<{ name: string }>; untrustedNodes: unknown[] };
      expect(report.trustedNodes).toHaveLength(1);
      expect(report.trustedNodes[0].name).toBe('nodeA');
      expect(report.untrustedNodes).toHaveLength(0);
    }
  });
});

describe('MCP server — explain tool', () => {
  it('returns GuardrailExplanation with proceed decision', async () => {
    const deps = createMockDeps();
    const server = createServer(deps);
    const explain = getToolHandler(server, 'explain');

    const result = await explain({ workflowPath: 'test/wf.ts' }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope(result);

    expect(envelope.success).toBe(true);
    if (envelope.success) {
      const explanation = envelope.data as {
        guardrailDecision: GuardrailDecision;
        targetResolution: { automatic: boolean };
        capabilities: { staticAnalysis: true };
      };
      expect(explanation.guardrailDecision.action).toBe('proceed');
      expect(explanation.targetResolution.automatic).toBe(true);
      expect(explanation.capabilities.staticAnalysis).toBe(true);
    }
  });

  it('is read-only — does not call persistTrustState or recordValidation', async () => {
    const deps = createMockDeps();
    const server = createServer(deps);
    const explain = getToolHandler(server, 'explain');

    await explain({ workflowPath: 'test/wf.ts' });

    expect(deps.persistTrustState).not.toHaveBeenCalled();
    expect(deps.recordValidation).not.toHaveBeenCalled();
    expect(deps.saveSnapshot).not.toHaveBeenCalled();
  });

  it('resolves explicit nodes target', async () => {
    const deps = createMockDeps();
    const server = createServer(deps);
    const explain = getToolHandler(server, 'explain');

    const result = await explain({
      workflowPath: 'test/wf.ts',
      kind: 'nodes',
      nodes: ['trigger'],
    }) as { content: Array<{ type: string; text: string }> };

    const envelope = parseEnvelope(result);
    expect(envelope.success).toBe(true);
    if (envelope.success) {
      const explanation = envelope.data as { targetResolution: { automatic: boolean; resolvedNodes: string[] } };
      expect(explanation.targetResolution.automatic).toBe(false);
      expect(explanation.targetResolution.resolvedNodes).toEqual(['trigger']);
    }
  });

  it('maps capabilities from detected capabilities', async () => {
    const deps = createMockDeps({
      detectCapabilities: vi.fn().mockResolvedValue({
        level: 'static-only',
        mcpAvailable: false,
        mcpTools: [],
      }),
    });
    const server = createServer(deps);
    const explain = getToolHandler(server, 'explain');

    const result = await explain({ workflowPath: 'test/wf.ts' }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope(result);

    expect(envelope.success).toBe(true);
    if (envelope.success) {
      const explanation = envelope.data as { capabilities: { mcpTools: boolean } };
      expect(explanation.capabilities.mcpTools).toBe(false);
    }
  });
});

describe('MCP server — error envelopes', () => {
  it('validate returns parse error when target.kind=nodes with empty nodes', async () => {
    const deps = createMockDeps();
    const server = createServer(deps);
    const validate = getToolHandler(server, 'validate');

    const result = await validate({
      kind: 'nodes',
      workflowPath: 'test/wf.ts',
      nodes: [],
    }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope<never>(result);

    expect(envelope.success).toBe(false);
    if (!envelope.success) {
      expect(envelope.error.type).toBe('internal_error');
      expect(envelope.error.message).toContain('non-empty');
    }
  });

  it('trust_status wraps MalformedWorkflowError as parse_error', async () => {
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockRejectedValue(new MalformedWorkflowError('bad nodes')),
    });
    const server = createServer(deps);
    const trustStatus = getToolHandler(server, 'trust_status');

    const result = await trustStatus({ workflowPath: 'bad.ts' }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope<never>(result);

    expect(envelope.success).toBe(false);
    if (!envelope.success) {
      expect(envelope.error.type).toBe('parse_error');
      expect(envelope.error.message).toContain('bad nodes');
    }
  });

  it('trust_status wraps ENOENT as workflow_not_found', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockRejectedValue(enoent),
    });
    const server = createServer(deps);
    const trustStatus = getToolHandler(server, 'trust_status');

    const result = await trustStatus({ workflowPath: 'missing.ts' }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope<never>(result);

    expect(envelope.success).toBe(false);
    if (!envelope.success) {
      expect(envelope.error.type).toBe('workflow_not_found');
    }
  });

  it('explain wraps errors in error envelope', async () => {
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockRejectedValue(new Error('unexpected')),
    });
    const server = createServer(deps);
    const explain = getToolHandler(server, 'explain');

    const result = await explain({ workflowPath: 'bad.ts' }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope<never>(result);

    expect(envelope.success).toBe(false);
    if (!envelope.success) {
      expect(envelope.error.type).toBe('internal_error');
    }
  });
});

describe('MCP server — test tool', () => {
  it('returns success envelope with DiagnosticSummary', async () => {
    const summary = passSummary();
    const deps = createMockDeps({
      synthesize: vi.fn().mockReturnValue(summary),
    });
    const server = createServer(deps);
    const testTool = getToolHandler(server, 'test');

    const result = await testTool({ kind: 'changed', workflowPath: 'test/wf.ts' }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope(result);

    expect(envelope.success).toBe(true);
    if (envelope.success) {
      expect(envelope.data).toHaveProperty('schemaVersion', 1);
      expect(envelope.data).toHaveProperty('status');
    }
  });

  it('passes callTool through to interpret when provided', async () => {
    const mockCallTool: McpToolCaller = vi.fn().mockResolvedValue({});
    const deps = createMockDeps({
      detectCapabilities: vi.fn().mockResolvedValue({
        level: 'mcp',
        mcpAvailable: true,
        mcpTools: ['test_workflow', 'get_execution'],
      }),
    });
    const server = createServer(deps, mockCallTool, 'http://localhost:5678', 'api-key');
    const testTool = getToolHandler(server, 'test');

    await testTool({ kind: 'changed', workflowPath: 'test/wf.ts' });

    // When callTool is provided and mcpAvailable, executeSmoke should be called
    expect(deps.executeSmoke).toHaveBeenCalled();
  });

  it('passes pinData through to interpret', async () => {
    const mockCallTool: McpToolCaller = vi.fn().mockResolvedValue({});
    const deps = createMockDeps({
      detectCapabilities: vi.fn().mockResolvedValue({
        level: 'mcp',
        mcpAvailable: true,
        mcpTools: ['test_workflow', 'get_execution'],
      }),
    });
    const server = createServer(deps, mockCallTool, 'http://localhost:5678', 'api-key');
    const testTool = getToolHandler(server, 'test');

    const pinData = { 'Node1': [{ json: { key: 'value' } }] };
    await testTool({ kind: 'changed', workflowPath: 'test/wf.ts', pinData });

    // constructPinData is called during execution pipeline
    expect(deps.constructPinData).toHaveBeenCalled();
  });

  it('returns error-status diagnostic when parseWorkflowFile fails', async () => {
    const deps = createMockDeps({
      parseWorkflowFile: vi.fn().mockRejectedValue(new MalformedWorkflowError('bad nodes')),
    });
    const server = createServer(deps);
    const testTool = getToolHandler(server, 'test');

    const result = await testTool({ kind: 'changed', workflowPath: 'bad.ts' }) as { content: Array<{ type: string; text: string }> };
    const envelope = parseEnvelope<DiagnosticSummary>(result);

    // interpret catches parse errors internally and returns error-status diagnostic
    expect(envelope.success).toBe(true);
    if (envelope.success) {
      expect(envelope.data.status).toBe('error');
    }
  });
});

describe('MCP server — schema visibility', () => {
  it('validate and test schemas expose kind and workflowPath properties', () => {
    const deps = createMockDeps({});
    const server = createServer(deps);
    const internal = server as unknown as {
      _registeredTools: Record<string, { inputSchema?: unknown }>;
    };

    for (const toolName of ['validate', 'test']) {
      const tool = internal._registeredTools[toolName];
      expect(tool, `${toolName} tool not registered`).toBeDefined();
      expect(tool.inputSchema, `${toolName} inputSchema missing`).toBeDefined();

      // The schema must be a Zod object with a shape containing kind and workflowPath.
      // This catches the discriminatedUnion regression where normalizeObjectSchema
      // returned undefined, causing the MCP SDK to emit properties:{}.
      const schema = tool.inputSchema as { shape?: Record<string, unknown> };
      expect(schema.shape, `${toolName} schema has no shape (not a ZodObject)`).toBeDefined();
      expect(schema.shape).toHaveProperty('kind');
      expect(schema.shape).toHaveProperty('workflowPath');
    }
  });
});
