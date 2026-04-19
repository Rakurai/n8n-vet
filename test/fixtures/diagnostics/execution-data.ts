/**
 * Test fixtures for execution data consumed by the diagnostics subsystem.
 *
 * Each export provides a pre-built `ExecutionData` instance representing a
 * specific execution scenario — success paths, API errors, expression errors,
 * cancellations, multi-node paths with hints, and redacted data.
 */

import type {
  ExecutionData,
  ExecutionErrorData,
  NodeExecutionResult,
} from '../../../src/diagnostics/types.js';
import { nodeIdentity } from '../../../src/types/identity.js';

// ---------------------------------------------------------------------------
// Shared node identities
// ---------------------------------------------------------------------------

const trigger = nodeIdentity('trigger');
const httpRequest = nodeIdentity('httpRequest');
const setFields = nodeIdentity('setFields');
const ifNode = nodeIdentity('ifNode');
const codeNode = nodeIdentity('codeNode');

// ---------------------------------------------------------------------------
// Helper — build a successful node result with defaults
// ---------------------------------------------------------------------------

function successResult(
  executionIndex: number,
  executionTimeMs: number = 10,
  previousNodeOutput: number | null = null,
): NodeExecutionResult {
  return {
    executionIndex,
    status: 'success',
    executionTimeMs,
    error: null,
    source: { previousNodeOutput },
    hints: [],
  };
}

// ---------------------------------------------------------------------------
// 1. successExecution — 3 nodes all succeeded
// ---------------------------------------------------------------------------

export const successExecution: ExecutionData = {
  status: 'success',
  lastNodeExecuted: 'setFields',
  error: null,
  nodeResults: new Map([
    [trigger, successResult(0, 5)],
    [httpRequest, successResult(1, 120, 0)],
    [setFields, successResult(2, 8, 0)],
  ]),
};

// ---------------------------------------------------------------------------
// 2. singleNodeApiError500 — one node failed with HTTP 500
// ---------------------------------------------------------------------------

const apiError500: ExecutionErrorData = {
  contextKind: 'api',
  type: 'NodeApiError',
  message: 'Internal Server Error',
  description: 'The upstream service returned an HTTP 500 response',
  node: 'httpRequest',
  httpCode: 500,
};

export const singleNodeApiError500: ExecutionData = {
  status: 'error',
  lastNodeExecuted: 'httpRequest',
  error: apiError500,
  nodeResults: new Map([
    [trigger, successResult(0, 4)],
    [
      httpRequest,
      {
        executionIndex: 1,
        status: 'error',
        executionTimeMs: 250,
        error: apiError500,
        source: { previousNodeOutput: 0 },
        hints: [],
      },
    ],
  ]),
};

// ---------------------------------------------------------------------------
// 3. credentialError401 — HTTP 401 authentication failure
// ---------------------------------------------------------------------------

const apiError401: ExecutionErrorData = {
  contextKind: 'api',
  type: 'NodeApiError',
  message: 'Unauthorized',
  description: 'The API key or credentials are invalid or expired',
  node: 'httpRequest',
  httpCode: 401,
};

export const credentialError401: ExecutionData = {
  status: 'error',
  lastNodeExecuted: 'httpRequest',
  error: apiError401,
  nodeResults: new Map([
    [trigger, successResult(0, 3)],
    [
      httpRequest,
      {
        executionIndex: 1,
        status: 'error',
        executionTimeMs: 85,
        error: apiError401,
        source: { previousNodeOutput: 0 },
        hints: [],
      },
    ],
  ]),
};

// ---------------------------------------------------------------------------
// 4. apiErrorNoHttpCode — network failure, no httpCode
// ---------------------------------------------------------------------------

const networkError: ExecutionErrorData = {
  contextKind: 'api',
  type: 'NodeApiError',
  message: 'ECONNREFUSED',
  description: 'Could not connect to the remote host',
  node: 'httpRequest',
};

export const apiErrorNoHttpCode: ExecutionData = {
  status: 'error',
  lastNodeExecuted: 'httpRequest',
  error: networkError,
  nodeResults: new Map([
    [trigger, successResult(0, 2)],
    [
      httpRequest,
      {
        executionIndex: 1,
        status: 'error',
        executionTimeMs: 3000,
        error: networkError,
        source: { previousNodeOutput: 0 },
        hints: [],
      },
    ],
  ]),
};

// ---------------------------------------------------------------------------
// 5. expressionError — expression evaluation failure
// ---------------------------------------------------------------------------

const exprError: ExecutionErrorData = {
  contextKind: 'expression',
  type: 'ExpressionError',
  message: 'Cannot read properties of undefined (reading "name")',
  description: 'Expression referenced a property that does not exist on the input item',
  node: 'setFields',
  expression: '{{ $json.contact.name }}',
  parameter: 'value',
  itemIndex: 0,
};

export const expressionError: ExecutionData = {
  status: 'error',
  lastNodeExecuted: 'setFields',
  error: exprError,
  nodeResults: new Map([
    [trigger, successResult(0, 3)],
    [httpRequest, successResult(1, 95, 0)],
    [
      setFields,
      {
        executionIndex: 2,
        status: 'error',
        executionTimeMs: 4,
        error: exprError,
        source: { previousNodeOutput: 0 },
        hints: [],
      },
    ],
  ]),
};

// ---------------------------------------------------------------------------
// 6. cancelledExecution — execution cancelled
// ---------------------------------------------------------------------------

const cancellationError: ExecutionErrorData = {
  contextKind: 'cancellation',
  type: 'ExecutionCancelledError',
  message: 'Execution was cancelled',
  description: null,
  node: null,
  reason: 'user-requested',
};

export const cancelledExecution: ExecutionData = {
  status: 'cancelled',
  lastNodeExecuted: 'httpRequest',
  error: cancellationError,
  nodeResults: new Map([
    [trigger, successResult(0, 3)],
    [
      httpRequest,
      {
        executionIndex: 1,
        status: 'error',
        executionTimeMs: 5200,
        error: cancellationError,
        source: { previousNodeOutput: 0 },
        hints: [],
      },
    ],
  ]),
};

// ---------------------------------------------------------------------------
// 7. unknownError — catch-all error kind
// ---------------------------------------------------------------------------

const otherError: ExecutionErrorData = {
  contextKind: 'other',
  type: 'UnknownError',
  message: 'An unexpected internal error occurred',
  description: null,
  node: 'codeNode',
};

export const unknownError: ExecutionData = {
  status: 'error',
  lastNodeExecuted: 'codeNode',
  error: otherError,
  nodeResults: new Map([
    [trigger, successResult(0, 2)],
    [httpRequest, successResult(1, 140, 0)],
    [setFields, successResult(2, 6, 0)],
    [
      codeNode,
      {
        executionIndex: 3,
        status: 'error',
        executionTimeMs: 15,
        error: otherError,
        source: { previousNodeOutput: 0 },
        hints: [],
      },
    ],
  ]),
};

// ---------------------------------------------------------------------------
// 8. multiNodePath — 5 nodes with varying indices, sources, and hints
// ---------------------------------------------------------------------------

export const multiNodePath: ExecutionData = {
  status: 'success',
  lastNodeExecuted: 'codeNode',
  error: null,
  nodeResults: new Map([
    [trigger, successResult(0, 3)],
    [
      httpRequest,
      {
        executionIndex: 1,
        status: 'success',
        executionTimeMs: 210,
        error: null,
        source: { previousNodeOutput: 0 },
        hints: [{ message: 'Rate limit header indicates 12 remaining requests' }],
      },
    ],
    [
      setFields,
      {
        executionIndex: 2,
        status: 'success',
        executionTimeMs: 7,
        error: null,
        source: { previousNodeOutput: 0 },
        hints: [],
      },
    ],
    [
      ifNode,
      {
        executionIndex: 3,
        status: 'success',
        executionTimeMs: 2,
        error: null,
        source: { previousNodeOutput: 0 },
        hints: [{ message: 'All items routed to true branch' }],
      },
    ],
    [
      codeNode,
      {
        executionIndex: 4,
        status: 'success',
        executionTimeMs: 45,
        error: null,
        source: { previousNodeOutput: 1 },
        hints: [
          { message: 'Output contains 3 items' },
          { message: 'Execution used 12 MB heap memory' },
        ],
      },
    ],
  ]),
};

// ---------------------------------------------------------------------------
// 9. redactedNodeExecution — node error with redacted execution data
// ---------------------------------------------------------------------------

const redactedError: ExecutionErrorData = {
  contextKind: 'api',
  type: 'NodeApiError',
  message: 'Execution data redacted',
  description: null,
  node: 'httpRequest',
  httpCode: 500,
};

export const redactedNodeExecution: ExecutionData = {
  status: 'error',
  lastNodeExecuted: 'httpRequest',
  error: redactedError,
  nodeResults: new Map([
    [trigger, successResult(0, 3)],
    [
      httpRequest,
      {
        executionIndex: 1,
        status: 'error',
        executionTimeMs: 0,
        error: redactedError,
        source: { previousNodeOutput: 0 },
        hints: [],
      },
    ],
  ]),
};
