import { describe, it, expect } from 'vitest';
import { reconstructPath, PathReconstructionError } from '../../src/diagnostics/path.js';
import { nodeIdentity } from '../../src/types/identity.js';
import type { ExecutionData } from '../../src/diagnostics/types.js';
import {
  successExecution,
  multiNodePath,
  singleNodeApiError500,
} from '../fixtures/diagnostics/execution-data.js';

describe('reconstructPath', () => {
  it('returns null when executionData is null', () => {
    expect(reconstructPath(null)).toBeNull();
  });

  it('sorts by executionIndex ascending', () => {
    const path = reconstructPath(successExecution)!;
    const indices = path.map((n) => n.executionIndex);
    expect(indices).toEqual([0, 1, 2]);
  });

  it('extracts sourceOutput from previousNodeOutput', () => {
    const path = reconstructPath(multiNodePath)!;
    const codeNode = path.find(
      (n) => n.name === nodeIdentity('codeNode'),
    )!;
    expect(codeNode.sourceOutput).toBe(1);
  });

  it('path length matches nodeResults size', () => {
    const path = reconstructPath(multiNodePath)!;
    expect(path).toHaveLength(5);

    const shortPath = reconstructPath(singleNodeApiError500)!;
    expect(shortPath).toHaveLength(2);
  });

  it('first node (trigger) has sourceOutput null', () => {
    const path = reconstructPath(successExecution)!;
    expect(path[0].name).toBe(nodeIdentity('trigger'));
    expect(path[0].sourceOutput).toBeNull();
  });

  it('throws PathReconstructionError on missing structural data', () => {
    const badExec: ExecutionData = {
      status: 'success',
      lastNodeExecuted: 'test',
      error: null,
      nodeResults: new Map([
        [
          nodeIdentity('test'),
          {
            executionIndex: 0,
            status: 'success',
            executionTimeMs: 5,
            error: null,
            source: null as unknown as { previousNodeOutput: number | null },
            hints: [],
          },
        ],
      ]),
    };
    expect(() => reconstructPath(badExec)).toThrow(PathReconstructionError);
  });
});
