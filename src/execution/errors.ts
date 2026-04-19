/**
 * Typed error classes for the execution subsystem.
 *
 * Three error categories covering distinct failure domains:
 * - Infrastructure: n8n unreachable, auth failure, MCP unavailable
 * - Precondition: workflow missing/stale, pin data unavailable
 * - Configuration: credentials missing or unresolvable
 */

// ---------------------------------------------------------------------------
// Reason unions
// ---------------------------------------------------------------------------

/** Reasons for infrastructure-level execution failures. */
export type InfrastructureReason =
  | 'unreachable'
  | 'auth-failure'
  | 'mcp-unavailable'
  | 'execution-not-found';

/** Reasons for precondition failures that require agent action. */
export type PreconditionReason =
  | 'workflow-not-found'
  | 'workflow-stale'
  | 'missing-pin-data'
  | 'execution-in-flight';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Infrastructure failure — n8n unreachable, auth failed, or MCP unavailable.
 *
 * Caller response: retry later or fix the execution environment.
 */
export class ExecutionInfrastructureError extends Error {
  override readonly name = 'ExecutionInfrastructureError' as const;
  readonly reason: InfrastructureReason;

  constructor(reason: InfrastructureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Precondition failure — the agent needs to take action before execution
 * can proceed (push workflow, provide pin data, wait for current execution).
 */
export class ExecutionPreconditionError extends Error {
  override readonly name = 'ExecutionPreconditionError' as const;
  readonly reason: PreconditionReason;

  constructor(reason: PreconditionReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Configuration error — credentials cannot be resolved from the config cascade.
 *
 * Caller response: fix the n8n/n8nac configuration.
 */
export class ExecutionConfigError extends Error {
  override readonly name = 'ExecutionConfigError' as const;

  constructor(message: string) {
    super(message);
  }
}
