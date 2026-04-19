/**
 * Typed error classes for the execution subsystem.
 *
 * Two error categories covering distinct failure domains:
 * - Infrastructure: n8n unreachable, MCP unavailable
 * - Precondition: workflow missing/stale, pin data unavailable
 */

// ---------------------------------------------------------------------------
// Reason unions
// ---------------------------------------------------------------------------

/** Reasons for infrastructure-level execution failures. */
export type InfrastructureReason = 'unreachable' | 'mcp-unavailable' | 'execution-not-found';

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
