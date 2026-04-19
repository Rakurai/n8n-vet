/**
 * Internal types for the diagnostics subsystem — synthesis input, intermediate
 * classification, and execution data interfaces consumed from upstream subsystems.
 */

import type { NodeIdentity } from '../types/identity.js';
import type { TrustState } from '../types/trust.js';
import type { GuardrailDecision } from '../types/guardrail.js';
import type {
  ResolvedTarget,
  DiagnosticError,
  AvailableCapabilities,
  ValidationMeta,
  ErrorClassification,
} from '../types/diagnostic.js';
import type { StaticFinding } from '../static-analysis/types.js';

// ---------------------------------------------------------------------------
// Synthesis input
// ---------------------------------------------------------------------------

/** The single input object for the `synthesize()` public API. */
export interface SynthesisInput {
  staticFindings: StaticFinding[];
  executionData: ExecutionData | null;
  trustState: TrustState;
  guardrailDecisions: GuardrailDecision[];
  resolvedTarget: ResolvedTarget;
  capabilities: AvailableCapabilities;
  meta: ValidationMeta;
}

// ---------------------------------------------------------------------------
// Execution data (temporary — move to src/execution/types.ts in Phase 5)
// ---------------------------------------------------------------------------

/** Per-run execution results from the n8n instance. */
export interface ExecutionData {
  status: 'success' | 'error' | 'cancelled';
  lastNodeExecuted: string | null;
  error: ExecutionErrorData | null;
  nodeResults: Map<NodeIdentity, NodeExecutionResult>;
}

/** Per-node execution result with timing, error, and source information. */
export interface NodeExecutionResult {
  executionIndex: number;
  status: 'success' | 'error';
  executionTimeMs: number;
  error: ExecutionErrorData | null;
  source: { previousNodeOutput: number | null };
  hints: NodeExecutionHint[];
  /** Present when this node's execution used pin data instead of live input. */
  pinDataSource?: 'agent' | 'execution-history' | 'schema' | 'stub';
}

/** Runtime hint emitted by n8n during node execution. */
export interface NodeExecutionHint {
  message: string;
}

/**
 * Execution error data, discriminated on `contextKind`.
 *
 * When constructor names are available in the error, the `type` field carries
 * the class name (e.g. 'NodeApiError'). When unavailable (serialized errors),
 * classification falls back to `contextKind`.
 */
export type ExecutionErrorData =
  | {
      contextKind: 'api';
      type: string;
      message: string;
      description: string | null;
      node: string | null;
      httpCode?: number;
      errorCode?: string;
    }
  | {
      contextKind: 'cancellation';
      type: string;
      message: string;
      description: string | null;
      node: string | null;
      reason?: string;
    }
  | {
      contextKind: 'expression';
      type: string;
      message: string;
      description: string | null;
      node: string | null;
      expression?: string;
      parameter?: string;
      itemIndex?: number;
    }
  | {
      contextKind: 'other';
      type: string;
      message: string;
      description: string | null;
      node: string | null;
    };

// ---------------------------------------------------------------------------
// Classification intermediates
// ---------------------------------------------------------------------------

/** Intermediate representation during error extraction before final ordering. */
export interface ClassifiedError {
  error: DiagnosticError;
  source: 'static' | 'execution';
  executionIndex: number | null;
}

/**
 * The six static finding kinds eligible for error classification.
 * `opaque-boundary` is excluded — it is always a warning routed to hints.
 */
export type StaticFindingErrorKind =
  | 'data-loss'
  | 'broken-reference'
  | 'invalid-parameter'
  | 'schema-mismatch'
  | 'missing-credentials'
  | 'unresolvable-expression';

/** Maps error-eligible static finding kinds to DiagnosticError classifications. */
export type StaticKindClassificationMap = Record<StaticFindingErrorKind, ErrorClassification>;
