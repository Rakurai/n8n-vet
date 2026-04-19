/**
 * Unit tests for MCP client.
 *
 * Covers: test_workflow invocation with pinData and triggerNodeName,
 * get_execution with includeData/nodeNames/truncateData,
 * prepare_test_pin_data response parsing, MCP unavailable error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionInfrastructureError, ExecutionPreconditionError } from '../../src/execution/errors.js';
import { releaseExecutionLock } from '../../src/execution/lock.js';

// ---------------------------------------------------------------------------
// Mock MCP tool caller type
// ---------------------------------------------------------------------------

type McpToolCaller = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

import {
  TestWorkflowResponseSchema,
  GetExecutionResponseSchema,
  PreparePinDataResponseSchema,
  executeSmoke,
  getExecution,
  preparePinData,
} from '../../src/execution/mcp-client.js';

// ---------------------------------------------------------------------------
// MCP Zod schemas (T018)
// ---------------------------------------------------------------------------

describe('TestWorkflowResponseSchema', () => {
  it('parses successful test_workflow response', () => {
    const result = TestWorkflowResponseSchema.parse({
      executionId: 'exec-456',
      status: 'success',
    });
    expect(result.executionId).toBe('exec-456');
    expect(result.status).toBe('success');
  });

  it('accepts null executionId', () => {
    const result = TestWorkflowResponseSchema.parse({
      executionId: null,
      status: 'error',
      error: 'Workflow has no trigger',
    });
    expect(result.executionId).toBeNull();
  });
});

describe('GetExecutionResponseSchema', () => {
  it('parses status-only response', () => {
    const result = GetExecutionResponseSchema.parse({
      execution: {
        id: 'exec-789',
        workflowId: 'wf-123',
        mode: 'manual',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        stoppedAt: null,
      },
    });
    expect(result.execution!.status).toBe('running');
  });

  it('parses null execution (not found)', () => {
    const result = GetExecutionResponseSchema.parse({
      execution: null,
      error: 'Execution not found',
    });
    expect(result.execution).toBeNull();
  });
});

describe('PreparePinDataResponseSchema', () => {
  it('parses schema coverage response', () => {
    const result = PreparePinDataResponseSchema.parse({
      nodeSchemasToGenerate: {
        httpRequest: { type: 'object', properties: { id: { type: 'number' } } },
      },
      nodesWithoutSchema: ['codeNode'],
      nodesSkipped: ['disabledNode'],
      coverage: {
        withSchemaFromExecution: 3,
        withSchemaFromDefinition: 1,
        withoutSchema: 1,
        skipped: 1,
        total: 6,
      },
    });

    expect(Object.keys(result.nodeSchemasToGenerate)).toHaveLength(1);
    expect(result.nodesWithoutSchema).toEqual(['codeNode']);
    expect(result.coverage.total).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// executeSmoke (T017)
// ---------------------------------------------------------------------------

describe('executeSmoke', () => {
  afterEach(() => {
    releaseExecutionLock();
  });

  it('returns ExecutionResult for successful execution', async () => {
    const callTool = vi.fn().mockResolvedValue({ executionId: 'e1', status: 'success' });
    const result = await executeSmoke('wf-1', {}, callTool);

    expect(result.executionId).toBe('e1');
    expect(result.status).toBe('success');
    expect(result.partial).toBe(false);
    expect(result.error).toBeNull();
  });

  it('includes triggerNodeName in callTool args when provided', async () => {
    const callTool = vi.fn().mockResolvedValue({ executionId: 'e2', status: 'success' });
    await executeSmoke('wf-1', {}, callTool, 'myTrigger');

    expect(callTool).toHaveBeenCalledWith('test_workflow', {
      workflowId: 'wf-1',
      pinData: {},
      triggerNodeName: 'myTrigger',
    });
  });

  it('does not include triggerNodeName in args when omitted', async () => {
    const callTool = vi.fn().mockResolvedValue({ executionId: 'e3', status: 'success' });
    await executeSmoke('wf-1', {}, callTool);

    const calledArgs = callTool.mock.calls[0][1] as Record<string, unknown>;
    expect('triggerNodeName' in calledArgs).toBe(false);
  });

  it('returns error field populated for error status response', async () => {
    const callTool = vi.fn().mockResolvedValue({
      executionId: null,
      status: 'error',
      error: 'No trigger',
    });
    const result = await executeSmoke('wf-1', {}, callTool);

    expect(result.error).not.toBeNull();
    expect(result.error!.message).toBe('No trigger');
    expect(result.executionId).toBe('');
  });

  it('throws ExecutionInfrastructureError(mcp-unavailable) when callTool throws', async () => {
    const callTool = vi.fn().mockRejectedValue(new Error('connection refused'));
    await expect(executeSmoke('wf-1', {}, callTool)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ExecutionInfrastructureError && err.reason === 'mcp-unavailable',
    );
  });

  it('throws ExecutionPreconditionError(execution-in-flight) when lock is already held', async () => {
    // First call holds the lock — never resolves during this test
    const callTool = vi.fn().mockImplementation(() => new Promise(() => {}));
    void executeSmoke('wf-1', {}, callTool);

    const callTool2 = vi.fn().mockResolvedValue({ executionId: 'e4', status: 'success' });
    await expect(executeSmoke('wf-1', {}, callTool2)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ExecutionPreconditionError && err.reason === 'execution-in-flight',
    );
  });
});

// ---------------------------------------------------------------------------
// getExecution (T018)
// ---------------------------------------------------------------------------

describe('getExecution', () => {
  const baseExecution = {
    id: 'exec-1',
    workflowId: 'wf-1',
    mode: 'manual',
    status: 'success',
    startedAt: '2026-01-01T00:00:00.000Z',
    stoppedAt: '2026-01-01T00:00:01.000Z',
  };

  it('returns status only when includeData is not set', async () => {
    const callTool = vi.fn().mockResolvedValue({ execution: baseExecution });
    const result = await getExecution('wf-1', 'exec-1', callTool);

    expect(result.status).toBe('success');
    expect(result.data).toBeUndefined();
    expect(callTool).toHaveBeenCalledWith('get_execution', {
      workflowId: 'wf-1',
      executionId: 'exec-1',
    });
  });

  it('returns data when includeData is true and runData is present', async () => {
    const dataPayload = {
      resultData: {
        runData: {
          httpNode: [
            {
              startTime: 1000,
              executionTime: 50,
              executionStatus: 'success',
            },
          ],
        },
        lastNodeExecuted: 'httpNode',
      },
    };
    const callTool = vi.fn().mockResolvedValue({ execution: baseExecution, data: dataPayload });
    const result = await getExecution('wf-1', 'exec-1', callTool, { includeData: true });

    expect(result.status).toBe('success');
    expect(result.data).toBeDefined();
    expect(callTool).toHaveBeenCalledWith('get_execution', {
      workflowId: 'wf-1',
      executionId: 'exec-1',
      includeData: true,
    });
  });

  it('throws ExecutionInfrastructureError(execution-not-found) when execution is null', async () => {
    const callTool = vi.fn().mockResolvedValue({ execution: null, error: 'Execution not found' });
    await expect(getExecution('wf-1', 'exec-1', callTool)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ExecutionInfrastructureError && err.reason === 'execution-not-found',
    );
  });

  it('throws ExecutionInfrastructureError(mcp-unavailable) when callTool throws', async () => {
    const callTool = vi.fn().mockRejectedValue(new Error('MCP offline'));
    await expect(getExecution('wf-1', 'exec-1', callTool)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ExecutionInfrastructureError && err.reason === 'mcp-unavailable',
    );
  });
});

// ---------------------------------------------------------------------------
// preparePinData (T019)
// ---------------------------------------------------------------------------

describe('preparePinData', () => {
  const validResponse = {
    nodeSchemasToGenerate: {
      httpRequest: { type: 'object' },
    },
    nodesWithoutSchema: ['codeNode'],
    nodesSkipped: ['disabledNode'],
    coverage: {
      withSchemaFromExecution: 2,
      withSchemaFromDefinition: 1,
      withoutSchema: 1,
      skipped: 1,
      total: 5,
    },
  };

  it('returns parsed PreparePinDataResult on success', async () => {
    const callTool = vi.fn().mockResolvedValue(validResponse);
    const result = await preparePinData('wf-1', callTool);

    expect(callTool).toHaveBeenCalledWith('prepare_test_pin_data', { workflowId: 'wf-1' });
    expect(result.coverage.total).toBe(5);
    expect(result.nodesWithoutSchema).toEqual(['codeNode']);
    expect(result.nodesSkipped).toEqual(['disabledNode']);
    expect(Object.keys(result.nodeSchemasToGenerate)).toHaveLength(1);
  });

  it('throws ExecutionInfrastructureError(mcp-unavailable) when callTool throws', async () => {
    const callTool = vi.fn().mockRejectedValue(new Error('tool not registered'));
    await expect(preparePinData('wf-1', callTool)).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof ExecutionInfrastructureError && err.reason === 'mcp-unavailable',
    );
  });
});
