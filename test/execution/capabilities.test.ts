/**
 * Unit tests for capability detection.
 *
 * Covers: n8n reachable + auth = rest-only, n8n + auth + MCP = full,
 * unreachable → infrastructure error, auth failure → infrastructure error,
 * workflow not found → precondition error with push advice,
 * toAvailableCapabilities mapper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DetectedCapabilities, CapabilityLevel } from '../../src/execution/types.js';
import { toAvailableCapabilities, detectCapabilities } from '../../src/execution/capabilities.js';
import { ExecutionInfrastructureError, ExecutionPreconditionError } from '../../src/execution/errors.js';

// ---------------------------------------------------------------------------
// toAvailableCapabilities mapper
// ---------------------------------------------------------------------------

describe('toAvailableCapabilities', () => {
  it('maps full capabilities', () => {
    const detected: DetectedCapabilities = {
      level: 'full',
      restAvailable: true,
      mcpAvailable: true,
      mcpTools: ['test_workflow', 'get_execution', 'prepare_test_pin_data'],
    };

    const available = toAvailableCapabilities(detected);
    expect(available).toEqual({
      staticAnalysis: true,
      restApi: true,
      mcpTools: true,
    });
  });

  it('maps rest-only capabilities', () => {
    const detected: DetectedCapabilities = {
      level: 'rest-only',
      restAvailable: true,
      mcpAvailable: false,
      mcpTools: [],
    };

    const available = toAvailableCapabilities(detected);
    expect(available).toEqual({
      staticAnalysis: true,
      restApi: true,
      mcpTools: false,
    });
  });

  it('maps static-only capabilities', () => {
    const detected: DetectedCapabilities = {
      level: 'static-only',
      restAvailable: false,
      mcpAvailable: false,
      mcpTools: [],
    };

    const available = toAvailableCapabilities(detected);
    expect(available).toEqual({
      staticAnalysis: true,
      restApi: false,
      mcpTools: false,
    });
  });
});

// ---------------------------------------------------------------------------
// DetectedCapabilities type contracts
// ---------------------------------------------------------------------------

describe('DetectedCapabilities type', () => {
  it('represents full capability with all MCP tools', () => {
    const caps: DetectedCapabilities = {
      level: 'full',
      restAvailable: true,
      mcpAvailable: true,
      mcpTools: ['test_workflow', 'get_execution', 'prepare_test_pin_data'],
    };
    expect(caps.level).toBe('full');
    expect(caps.mcpTools).toHaveLength(3);
  });

  it('level corresponds to available surfaces', () => {
    const levels: Array<[CapabilityLevel, boolean, boolean]> = [
      ['full', true, true],
      ['rest-only', true, false],
      ['static-only', false, false],
    ];

    for (const [level, rest, mcp] of levels) {
      const caps: DetectedCapabilities = {
        level,
        restAvailable: rest,
        mcpAvailable: mcp,
        mcpTools: mcp ? ['test_workflow'] : [],
      };
      expect(caps.restAvailable).toBe(rest);
      expect(caps.mcpAvailable).toBe(mcp);
    }
  });
});

// ---------------------------------------------------------------------------
// detectCapabilities — integration-style unit tests with fetch mocked
// ---------------------------------------------------------------------------

describe('detectCapabilities', () => {
  const TEST_HOST = 'http://localhost:5678';
  const TEST_API_KEY = 'test-api-key';

  beforeEach(() => {
    process.env['N8N_HOST'] = TEST_HOST;
    process.env['N8N_API_KEY'] = TEST_API_KEY;
  });

  afterEach(() => {
    delete process.env['N8N_HOST'];
    delete process.env['N8N_API_KEY'];
    vi.restoreAllMocks();
  });

  it('REST available, no MCP → level rest-only', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    const result = await detectCapabilities();

    expect(result.level).toBe('rest-only');
    expect(result.restAvailable).toBe(true);
    expect(result.mcpAvailable).toBe(false);
    expect(result.mcpTools).toEqual([]);
  });

  it('REST + MCP available → level full', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    const callTool = vi.fn().mockResolvedValue({ content: [] });

    const result = await detectCapabilities({ callTool });

    expect(result.level).toBe('full');
    expect(result.restAvailable).toBe(true);
    expect(result.mcpAvailable).toBe(true);
    expect(result.mcpTools).toEqual([
      'test_workflow',
      'get_execution',
      'prepare_test_pin_data',
    ]);
  });

  it('fetch throws → throws ExecutionInfrastructureError unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(detectCapabilities()).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ExecutionInfrastructureError && err.reason === 'unreachable',
    );
  });

  it('fetch returns 401 → throws ExecutionInfrastructureError auth-failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );

    await expect(detectCapabilities()).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ExecutionInfrastructureError && err.reason === 'auth-failure',
    );
  });

  it('workflow not found → throws ExecutionPreconditionError workflow-not-found', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // First call: probe succeeds
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    // Second call: workflow check returns 404
    fetchSpy.mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );

    await expect(detectCapabilities({ workflowId: 'wf-123' })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ExecutionPreconditionError && err.reason === 'workflow-not-found',
    );
  });

  it('MCP tools partially available → mcpTools has only responding tools', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    const callTool = vi.fn()
      .mockResolvedValueOnce({ content: [] })   // test_workflow — available
      .mockResolvedValueOnce({ content: [] })   // get_execution — available
      .mockRejectedValueOnce(new Error('tool not found')); // prepare_test_pin_data — unavailable

    const result = await detectCapabilities({ callTool });

    expect(result.mcpTools).toEqual(['test_workflow', 'get_execution']);
    expect(result.mcpAvailable).toBe(true);
  });

  it('network error during workflow check → throws ExecutionInfrastructureError unreachable', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // First call: probe succeeds
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    // Second call: network fails
    fetchSpy.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(detectCapabilities({ workflowId: 'wf-456' })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ExecutionInfrastructureError && err.reason === 'unreachable',
    );
  });
});
