/**
 * Unit tests for per-node result extraction.
 *
 * Covers: success node, error node with each contextKind,
 * source lineage, hints, no raw output data in result.
 */

import { describe, it, expect } from 'vitest';
import { nodeIdentity } from '../../src/types/identity.js';
import { extractExecutionData, classifyError } from '../../src/execution/results.js';
import type { RawResultData } from '../../src/execution/results.js';

// ---------------------------------------------------------------------------
// extractExecutionData
// ---------------------------------------------------------------------------

describe('extractExecutionData', () => {
  it('extracts a successful single-node execution', () => {
    const raw = {
      runData: {
        httpRequest: [{
          startTime: 1000,
          executionTime: 250,
          executionStatus: 'success',
        }],
      },
      lastNodeExecuted: 'httpRequest',
    } as unknown as RawResultData;

    const data = extractExecutionData(raw, 'success');
    const nodeId = nodeIdentity('httpRequest');
    expect(data.nodeResults.get(nodeId)).toHaveLength(1);
    expect(data.nodeResults.get(nodeId)![0]!.status).toBe('success');
    expect(data.nodeResults.get(nodeId)![0]!.executionTimeMs).toBe(250);
    expect(data.error).toBeNull();
    expect(data.lastNodeExecuted).toBe('httpRequest');
  });

  it('extracts error node with source lineage', () => {
    const raw = {
      runData: {
        httpRequest: [{
          startTime: 1000,
          executionTime: 100,
          executionStatus: 'error',
          error: {
            message: 'Request failed',
            name: 'NodeApiError',
            httpCode: '500',
          },
          source: [{
            previousNode: 'trigger',
            previousNodeOutput: 0,
            previousNodeRun: 0,
          }],
        }],
      },
      lastNodeExecuted: 'httpRequest',
      error: {
        message: 'Request failed',
        name: 'NodeApiError',
        httpCode: '500',
      },
    } as unknown as RawResultData;

    const data = extractExecutionData(raw, 'error');
    const nodeId = nodeIdentity('httpRequest');
    const result = data.nodeResults.get(nodeId)![0]!;

    expect(result.status).toBe('error');
    expect(result.error).not.toBeNull();
    expect(result.error!.contextKind).toBe('api');
    expect(result.source).not.toBeNull();
    expect(result.source!.previousNode).toBe('trigger');
    expect(data.error).not.toBeNull();
  });

  it('extracts hints from node runs', () => {
    const raw = {
      runData: {
        transform: [{
          startTime: 1000,
          executionTime: 15,
          hints: [
            { message: 'Consider batch operations', level: 'warning' },
            { message: 'Large dataset detected' },
          ],
        }],
      },
    } as unknown as RawResultData;

    const data = extractExecutionData(raw, 'success');
    const nodeId = nodeIdentity('transform');
    const result = data.nodeResults.get(nodeId)![0]!;

    expect(result.hints).toHaveLength(2);
    expect(result.hints[0]!.message).toBe('Consider batch operations');
    expect(result.hints[0]!.severity).toBe('warning');
    expect(result.hints[1]!.severity).toBe('info');
  });

  it('filters to requested nodeNames', () => {
    const raw = {
      runData: {
        nodeA: [{ startTime: 0, executionTime: 10 }],
        nodeB: [{ startTime: 0, executionTime: 20 }],
        nodeC: [{ startTime: 0, executionTime: 30 }],
      },
    } as unknown as RawResultData;

    const data = extractExecutionData(raw, 'success', ['nodeA', 'nodeC']);
    expect(data.nodeResults.size).toBe(2);
    expect(data.nodeResults.has(nodeIdentity('nodeA'))).toBe(true);
    expect(data.nodeResults.has(nodeIdentity('nodeC'))).toBe(true);
    expect(data.nodeResults.has(nodeIdentity('nodeB'))).toBe(false);
  });

  it('handles multiple execution attempts per node', () => {
    const raw = {
      runData: {
        retryNode: [
          { startTime: 0, executionTime: 100, executionStatus: 'error', error: { message: 'Timeout', name: 'NodeApiError', httpCode: '504' } },
          { startTime: 100, executionTime: 200 },
        ],
      },
    } as unknown as RawResultData;

    const data = extractExecutionData(raw, 'success');
    const nodeId = nodeIdentity('retryNode');
    expect(data.nodeResults.get(nodeId)).toHaveLength(2);
    expect(data.nodeResults.get(nodeId)![0]!.status).toBe('error');
    expect(data.nodeResults.get(nodeId)![1]!.status).toBe('success');
  });

  it('handles null source entries', () => {
    const raw = {
      runData: {
        trigger: [{
          startTime: 0,
          executionTime: 5,
          source: [null],
        }],
      },
    } as unknown as RawResultData;

    const data = extractExecutionData(raw, 'success');
    const result = data.nodeResults.get(nodeIdentity('trigger'))![0]!;
    expect(result.source).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  it('classifies API error by httpCode', () => {
    const error = classifyError({
      message: 'Rate limited',
      name: 'NodeApiError',
      httpCode: '429',
      context: { errorCode: 'RATE_LIMITED' },
    });

    expect(error.contextKind).toBe('api');
    if (error.contextKind === 'api') {
      expect(error.context.httpCode).toBe('429');
      expect(error.context.errorCode).toBe('RATE_LIMITED');
    }
  });

  it('classifies cancellation by name', () => {
    const error = classifyError({
      message: 'Execution cancelled',
      name: 'ExecutionCancelledError',
    });

    expect(error.contextKind).toBe('cancellation');
  });

  it('classifies cancellation by context reason', () => {
    const error = classifyError({
      message: 'Timed out',
      name: 'SomeError',
      context: { reason: 'timeout' },
    });

    expect(error.contextKind).toBe('cancellation');
    if (error.contextKind === 'cancellation') {
      expect(error.context.reason).toBe('timeout');
    }
  });

  it('classifies expression error', () => {
    const error = classifyError({
      message: 'Cannot read property',
      name: 'ExpressionError',
      node: { name: 'setValues' },
      context: { expressionType: 'tmpl', parameter: 'value' },
    });

    expect(error.contextKind).toBe('expression');
    expect(error.node).toBe('setValues');
    if (error.contextKind === 'expression') {
      expect(error.context.expressionType).toBe('tmpl');
    }
  });

  it('falls through to "other" for unknown errors', () => {
    const error = classifyError({
      message: 'Something failed',
      name: 'NodeOperationError',
      context: { runIndex: 0, itemIndex: 3 },
    });

    expect(error.contextKind).toBe('other');
    if (error.contextKind === 'other') {
      expect(error.context.runIndex).toBe(0);
      expect(error.context.itemIndex).toBe(3);
    }
  });

  it('handles missing name gracefully', () => {
    const error = classifyError({ message: 'Unknown' });
    expect(error.type).toBe('UnknownError');
    expect(error.contextKind).toBe('other');
  });
});
