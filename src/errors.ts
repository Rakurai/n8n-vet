/**
 * Surface-layer error types and mapping.
 *
 * McpError is the typed error shape returned in the response envelope when a
 * tool-level failure occurs. mapToMcpError translates domain errors thrown by
 * the library core into McpError values at the MCP/CLI boundary.
 */

import { ZodError } from 'zod';
import { SynthesisError } from './diagnostics/synthesize.js';
import { ExecutionInfrastructureError, ExecutionPreconditionError } from './execution/errors.js';
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

/** Maximum message length before truncation (content portion). */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Sanitize a message for inclusion in an error envelope.
 * Strips control characters (< 0x20 except \n and \t) and truncates
 * to 500 characters with a ` [truncated]` suffix when exceeded.
 */
export function sanitizeMessage(msg: string): string {
  // Strip control characters (codepoints < 0x20) except \n (0x0A) and \t (0x09)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control chars for sanitization
  const cleaned = msg.replace(/[\x00-\x08\x0B-\x1F]/g, '');
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    return `${cleaned.slice(0, MAX_MESSAGE_LENGTH)} [truncated]`;
  }
  return cleaned;
}

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
    return { type: 'workflow_not_found', message: sanitizeMessage((error as Error).message) };
  }

  if (error instanceof MalformedWorkflowError) {
    return { type: 'parse_error', message: sanitizeMessage(error.message) };
  }

  if (error instanceof ZodError) {
    return { type: 'parse_error', message: sanitizeMessage(error.message) };
  }

  if (error instanceof ConfigurationError) {
    return { type: 'configuration_error', message: sanitizeMessage(error.message) };
  }

  if (error instanceof ExecutionInfrastructureError) {
    return { type: 'infrastructure_error', message: sanitizeMessage(error.message) };
  }

  if (error instanceof TrustPersistenceError) {
    return { type: 'trust_error', message: sanitizeMessage(error.message) };
  }

  if (error instanceof ExecutionPreconditionError) {
    return { type: 'precondition_error', message: sanitizeMessage(error.message) };
  }

  if (error instanceof SynthesisError) {
    return { type: 'internal_error', message: sanitizeMessage(error.message) };
  }

  if (error instanceof Error) {
    return { type: 'internal_error', message: sanitizeMessage(error.message) };
  }

  return { type: 'internal_error', message: sanitizeMessage(String(error)) };
}
