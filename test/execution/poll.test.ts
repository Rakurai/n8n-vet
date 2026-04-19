/**
 * Unit tests for execution polling.
 *
 * Covers: isTerminalStatus, backoff sequence, pollForCompletion (status loop,
 * timeout behavior, phase transition from status-only to data retrieval).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isTerminalStatus,
  TERMINAL_STATUSES,
  POLL_INITIAL_DELAY_MS,
  POLL_BACKOFF_FACTOR,
  POLL_MAX_DELAY_MS,
  POLL_TIMEOUT_MS,
  POLL_TRUNCATE_DATA,
} from '../../src/execution/types.js';
import type { ExecutionStatus, ExecutionData, NodeExecutionResult } from '../../src/execution/types.js';
import { pollForCompletion } from '../../src/execution/poll.js';
import type { PollingStrategy, PollStatusResult } from '../../src/execution/poll.js';
import { nodeIdentity } from '../../src/types/identity.js';

// ---------------------------------------------------------------------------
// Terminal status detection
// ---------------------------------------------------------------------------

describe('isTerminalStatus', () => {
  it.each<[ExecutionStatus, boolean]>([
    ['success', true],
    ['error', true],
    ['crashed', true],
    ['canceled', true],
    ['waiting', false],
    ['running', false],
    ['new', false],
    ['unknown', false],
  ])('isTerminalStatus(%s) === %s', (status, expected) => {
    expect(isTerminalStatus(status)).toBe(expected);
  });

  it('TERMINAL_STATUSES contains exactly 4 entries', () => {
    expect(TERMINAL_STATUSES.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Backoff sequence calculation
// ---------------------------------------------------------------------------

describe('backoff sequence', () => {
  it('produces correct delay sequence: 1s, 2s, 4s, 8s, 15s, 15s, ...', () => {
    const delays: number[] = [];
    let delay = POLL_INITIAL_DELAY_MS;

    for (let i = 0; i < 8; i++) {
      delays.push(delay);
      delay = Math.min(delay * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY_MS);
    }

    expect(delays).toEqual([
      1000,   // 1s
      2000,   // 2s
      4000,   // 4s
      8000,   // 8s
      15000,  // 15s (capped)
      15000,  // 15s
      15000,  // 15s
      15000,  // 15s
    ]);
  });

  it('total time within timeout for reasonable poll count', () => {
    let total = 0;
    let delay = POLL_INITIAL_DELAY_MS;
    let polls = 0;

    while (total < POLL_TIMEOUT_MS) {
      total += delay;
      delay = Math.min(delay * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY_MS);
      polls++;
    }

    // Should take 20+ polls to exhaust the 5-minute timeout
    expect(polls).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// pollForCompletion
// ---------------------------------------------------------------------------

describe('pollForCompletion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeStrategy(
    statusResults: PollStatusResult[],
    dataResult: ExecutionData,
  ): PollingStrategy {
    let callIndex = 0;
    return {
      checkStatus: vi.fn(async () => {
        const result = statusResults[callIndex];
        if (!result) throw new Error(`Unexpected checkStatus call #${callIndex}`);
        callIndex++;
        return result;
      }),
      retrieveData: vi.fn(async () => dataResult),
    };
  }

  const successData: ExecutionData = {
    nodeResults: new Map([[nodeIdentity('Node1'), [{
      executionIndex: 0,
      status: 'success',
      executionTimeMs: 100,
      error: null,
      source: null,
      hints: [],
    }]]]),
    lastNodeExecuted: 'Node1',
    error: null,
    status: 'success',
  };

  it('polls until terminal status then retrieves data', async () => {
    const strategy = makeStrategy(
      [
        { status: 'running', finished: false },
        { status: 'running', finished: false },
        { status: 'success', finished: true },
      ],
      successData,
    );

    const promise = pollForCompletion('exec-1', [nodeIdentity('Node1')], strategy);

    // Advance through sleep delays: 1s, 2s, 4s
    await vi.advanceTimersByTimeAsync(1000); // 1st poll
    await vi.advanceTimersByTimeAsync(2000); // 2nd poll
    await vi.advanceTimersByTimeAsync(4000); // 3rd poll (terminal)

    const result = await promise;

    expect(strategy.checkStatus).toHaveBeenCalledTimes(3);
    expect(strategy.retrieveData).toHaveBeenCalledTimes(1);
    expect(strategy.retrieveData).toHaveBeenCalledWith('exec-1', [nodeIdentity('Node1')], POLL_TRUNCATE_DATA);
    expect(result.status).toBe('success');
    expect(result.nodeResults.size).toBe(1);
  });

  it('returns immediately after first poll if already terminal', async () => {
    const strategy = makeStrategy(
      [{ status: 'error', finished: true }],
      { ...successData, status: 'error' },
    );

    const promise = pollForCompletion('exec-2', [], strategy);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(strategy.checkStatus).toHaveBeenCalledTimes(1);
    expect(strategy.retrieveData).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('error');
  });

  it('returns timeout result when polling exceeds timeout', async () => {
    // Strategy that always returns running — never reaches terminal
    const neverFinishes: PollingStrategy = {
      checkStatus: vi.fn(async () => ({ status: 'running' as ExecutionStatus, finished: false })),
      retrieveData: vi.fn(async () => successData),
    };

    const promise = pollForCompletion('exec-3', [], neverFinishes);

    // Advance well past the 5-minute timeout
    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + 60_000);

    const result = await promise;

    expect(result.status).toBe('canceled');
    expect(result.error).not.toBeNull();
    expect(result.error!.contextKind).toBe('cancellation');
    if (result.error!.contextKind === 'cancellation') {
      expect(result.error!.context.reason).toBe('timeout');
    }
    expect(neverFinishes.retrieveData).not.toHaveBeenCalled();
  });

  it('passes through nodeNames to retrieveData', async () => {
    const nodes = [nodeIdentity('A'), nodeIdentity('B')];
    const strategy = makeStrategy(
      [{ status: 'success', finished: true }],
      successData,
    );

    const promise = pollForCompletion('exec-4', nodes, strategy);
    await vi.advanceTimersByTimeAsync(1000);

    await promise;
    expect(strategy.retrieveData).toHaveBeenCalledWith('exec-4', nodes, POLL_TRUNCATE_DATA);
  });
});
