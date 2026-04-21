/**
 * Tests for the execution lock lifecycle — acquire, release, contention,
 * stale recovery, and the withExecutionLock wrapper.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  acquireExecutionLock,
  releaseExecutionLock,
  resetLockState,
  setLockExpiry,
  withExecutionLock,
} from '../../src/execution/lock.js';
import { ExecutionPreconditionError } from '../../src/execution/errors.js';

beforeEach(() => {
  resetLockState();
});

describe('acquireExecutionLock', () => {
  it('acquires when idle', () => {
    expect(() => acquireExecutionLock()).not.toThrow();
  });

  it('throws ExecutionPreconditionError on contention', () => {
    acquireExecutionLock();
    try {
      acquireExecutionLock();
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ExecutionPreconditionError);
      expect((err as ExecutionPreconditionError).reason).toBe('execution-in-flight');
    }
  });
});

describe('releaseExecutionLock', () => {
  it('allows re-acquire after release', () => {
    acquireExecutionLock();
    releaseExecutionLock();
    expect(() => acquireExecutionLock()).not.toThrow();
  });
});

describe('stale lock recovery', () => {
  it('auto-releases expired lock', async () => {
    setLockExpiry(1);
    acquireExecutionLock();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(() => acquireExecutionLock()).not.toThrow();
  });
});

describe('withExecutionLock', () => {
  it('acquires lock, runs callback, and releases', async () => {
    const result = await withExecutionLock(async () => 'done');
    expect(result).toBe('done');
    // Lock is released — re-acquire should succeed
    expect(() => acquireExecutionLock()).not.toThrow();
  });

  it('releases lock on callback error', async () => {
    await expect(
      withExecutionLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Lock is released — re-acquire should succeed
    expect(() => acquireExecutionLock()).not.toThrow();
  });
});

describe('resetLockState', () => {
  it('clears lock state', () => {
    acquireExecutionLock();
    resetLockState();
    expect(() => acquireExecutionLock()).not.toThrow();
  });
});
