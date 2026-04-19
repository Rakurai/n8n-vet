/**
 * Internal types for the diagnostics subsystem — synthesis input, intermediate
 * classification, and re-exports of execution types consumed by this subsystem.
 */

import type { StaticFinding } from '../static-analysis/types.js';
import type {
  AvailableCapabilities,
  DiagnosticError,
  ErrorClassification,
  ResolvedTarget,
  ValidationMeta,
} from '../types/diagnostic.js';
import type { GuardrailDecision } from '../types/guardrail.js';
import type { TrustState } from '../types/trust.js';

// Re-export execution types consumed by diagnostics
export type {
  ExecutionData,
  NodeExecutionResult,
  ExecutionHint,
  ExecutionErrorData,
  ExecutionErrorDataBase,
  SourceInfo,
  ExecutionStatus,
} from '../execution/types.js';

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
  /** Whether static analysis was actually run (vs. skipped). Defaults to staticFindings.length > 0. */
  staticAnalysisRan?: boolean;
}

// Import for use in SynthesisInput type
import type { ExecutionData } from '../execution/types.js';

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
