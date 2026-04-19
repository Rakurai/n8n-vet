/**
 * Session-level execution lock preventing concurrent executions.
 *
 * Both executeBounded (REST) and executeSmoke (MCP) must check
 * this lock before starting. Second call while first is in-flight
 * throws ExecutionPreconditionError with reason 'execution-in-flight'.
 */

import { ExecutionPreconditionError } from './errors.js';

let executionInFlight = false;

/**
 * Acquire the execution lock. Throws if another execution is in-flight.
 */
export function acquireExecutionLock(): void {
  if (executionInFlight) {
    throw new ExecutionPreconditionError(
      'execution-in-flight',
      'Another execution is already in progress. Wait for it to complete before starting a new one.',
    );
  }
  executionInFlight = true;
}

/**
 * Release the execution lock. Must be called in a finally block
 * after execution completes or fails.
 */
export function releaseExecutionLock(): void {
  executionInFlight = false;
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
