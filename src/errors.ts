/**
 * Surface-layer error types and mapping.
 *
 * McpError is the typed error shape returned in the response envelope when a
 * tool-level failure occurs. mapToMcpError translates domain errors thrown by
 * the library core into McpError values at the MCP/CLI boundary.
 */

import { ZodError } from 'zod';
import { SynthesisError } from './diagnostics/synthesize.js';
import {
  ExecutionConfigError,
  ExecutionInfrastructureError,
  ExecutionPreconditionError,
} from './execution/errors.js';
import { ConfigurationError, MalformedWorkflowError } from './static-analysis/errors.js';
import { TrustPersistenceError } from './trust/errors.js';

// ── McpError ─────────────────────────────────────────────────────

/** Error categories surfaced to tool consumers. */
export type McpErrorType =
  | 'workflow_not_found'
  | 'parse_error'
  | 'configuration_error'
  | 'infrastructure_error'
  | 'trust_error'
  | 'precondition_error'
  | 'internal_error';

/** Typed tool-level error returned in the response envelope. */
export interface McpError {
  type: McpErrorType;
  message: string;
}

// ── McpResponse ──────────────────────────────────────────────────

/** Response envelope wrapping all MCP tool and CLI command outputs. */
export type McpResponse<T> = { success: true; data: T } | { success: false; error: McpError };

/**
 * Map a domain error to an McpError for the response envelope.
 *
 * Called at the MCP/CLI boundary — the only place where errors are caught
 * and translated. Internal code lets errors propagate.
 */
export function mapToMcpError(error: unknown): McpError {
  // ENOENT — inline check (called only here)
  if (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  ) {
    return { type: 'workflow_not_found', message: (error as Error).message };
  }

  if (error instanceof MalformedWorkflowError) {
    return { type: 'parse_error', message: error.message };
  }

  if (error instanceof ZodError) {
    return { type: 'parse_error', message: error.message };
  }

  if (error instanceof ConfigurationError || error instanceof ExecutionConfigError) {
    return { type: 'configuration_error', message: error.message };
  }

  if (error instanceof ExecutionInfrastructureError) {
    return { type: 'infrastructure_error', message: error.message };
  }

  if (error instanceof TrustPersistenceError) {
    return { type: 'trust_error', message: error.message };
  }

  if (error instanceof ExecutionPreconditionError) {
    return { type: 'precondition_error', message: error.message };
  }

  if (error instanceof SynthesisError) {
    return { type: 'internal_error', message: error.message };
  }

  if (error instanceof Error) {
    return { type: 'internal_error', message: error.message };
  }

  return { type: 'internal_error', message: String(error) };
}
