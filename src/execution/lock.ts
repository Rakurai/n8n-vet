/**
 * Session-level execution lock preventing concurrent executions.
 *
 * Both executeBounded (REST) and executeSmoke (MCP) must check
 * this lock before starting. Second call while first is in-flight
 * throws ExecutionPreconditionError with reason 'execution-in-flight'.
 *
 * The lock includes a timestamp and configurable expiry to handle
 * stale locks from crashed processes. Injectable for test isolation.
 */

import { ExecutionPreconditionError } from './errors.js';

/** Default lock expiry in milliseconds (5 minutes). */
const DEFAULT_LOCK_EXPIRY_MS = 5 * 60 * 1000;

interface LockState {
  inFlight: boolean;
  acquiredAt: number;
}

let lockState: LockState = { inFlight: false, acquiredAt: 0 };
let lockExpiryMs = DEFAULT_LOCK_EXPIRY_MS;

/**
 * Configure the lock expiry duration.
 * Primarily for test isolation.
 */
export function setLockExpiry(ms: number): void {
  lockExpiryMs = ms;
}

/**
 * Reset lock state. For test isolation only.
 */
export function resetLockState(): void {
  lockState = { inFlight: false, acquiredAt: 0 };
  lockExpiryMs = DEFAULT_LOCK_EXPIRY_MS;
}

/**
 * Acquire the execution lock. Throws if another execution is in-flight
 * and the lock has not expired.
 */
export function acquireExecutionLock(): void {
  if (lockState.inFlight) {
    const elapsed = Date.now() - lockState.acquiredAt;
    if (elapsed < lockExpiryMs) {
      throw new ExecutionPreconditionError(
        'execution-in-flight',
        'Another execution is already in progress. Wait for it to complete before starting a new one.',
      );
    }
    // Stale lock — auto-release
    lockState = { inFlight: false, acquiredAt: 0 };
  }
  lockState = { inFlight: true, acquiredAt: Date.now() };
}

/**
 * Release the execution lock. Must be called in a finally block
 * after execution completes or fails.
 */
export function releaseExecutionLock(): void {
  lockState = { inFlight: false, acquiredAt: 0 };
}

/**
 * Run a function while holding the execution lock.
 * Automatically acquires before and releases after (including on error).
 */
export async function withExecutionLock<T>(fn: () => Promise<T>): Promise<T> {
  acquireExecutionLock();
  try {
    return await fn();
  } finally {
    releaseExecutionLock();
  }
}
