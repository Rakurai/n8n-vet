/**
 * Two-phase execution polling with exponential backoff.
 *
 * Phase 1: Lightweight status-only polling (no execution data).
 * Phase 2: Single data retrieval call with node filter + truncation.
 *
 * Timeout returns ExecutionData with status 'canceled' and
 * contextKind 'cancellation', reason 'timeout' — normal return, not thrown.
 */

import type { NodeIdentity } from '../types/identity.js';
import type { ExecutionData, ExecutionStatus } from './types.js';
import {
  isTerminalStatus,
  POLL_INITIAL_DELAY_MS,
  POLL_BACKOFF_FACTOR,
  POLL_MAX_DELAY_MS,
  POLL_TIMEOUT_MS,
  POLL_TRUNCATE_DATA,
} from './types.js';

// ---------------------------------------------------------------------------
// Polling strategy interface
// ---------------------------------------------------------------------------

/** Status check result from a polling strategy. */
export interface PollStatusResult {
  status: ExecutionStatus;
  finished: boolean;
}

/**
 * Strategy for polling execution status and retrieving data.
 *
 * Two implementations: REST-only (getExecutionStatus/getExecutionData)
 * and MCP (get_execution with includeData flag). Selected based on
 * detected capabilities, not fallback.
 */
export interface PollingStrategy {
  /** Check execution status (lightweight, no data). */
  checkStatus(executionId: string): Promise<PollStatusResult>;

  /** Retrieve full execution data for specific nodes. */
  retrieveData(
    executionId: string,
    nodeNames: NodeIdentity[],
    truncateData: number,
  ): Promise<ExecutionData>;
}

// ---------------------------------------------------------------------------
// Poll for completion (T011)
// ---------------------------------------------------------------------------

/**
 * Poll an execution until terminal status, then retrieve filtered data.
 *
 * Backoff sequence: 1s, 2s, 4s, 8s, 15s, 15s, ...
 * Timeout (5 min): returns ExecutionData with status 'canceled',
 * contextKind 'cancellation', reason 'timeout'.
 */
export async function pollForCompletion(
  executionId: string,
  nodeNames: NodeIdentity[],
  strategy: PollingStrategy,
): Promise<ExecutionData> {
  const startTime = Date.now();
  let delay = POLL_INITIAL_DELAY_MS;

  // Phase 1: Status-only polling
  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= POLL_TIMEOUT_MS) {
      return timeoutResult();
    }

    await sleep(delay);

    const { status } = await strategy.checkStatus(executionId);

    if (isTerminalStatus(status)) {
      break;
    }

    delay = Math.min(delay * POLL_BACKOFF_FACTOR, POLL_MAX_DELAY_MS);
  }

  // Phase 2: Single data retrieval
  return strategy.retrieveData(executionId, nodeNames, POLL_TRUNCATE_DATA);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build timeout result — normal return, not a thrown error. */
function timeoutResult(): ExecutionData {
  return {
    nodeResults: new Map(),
    lastNodeExecuted: null,
    error: {
      type: 'ExecutionTimeoutError',
      message: `Execution polling timed out after ${POLL_TIMEOUT_MS / 1000} seconds`,
      description: null,
      node: null,
      contextKind: 'cancellation',
      context: { reason: 'timeout' },
    },
    status: 'canceled',
  };
}
