/**
 * Diagnostic output types — the canonical structured result of every validation run,
 * including error classification, node annotations, and execution metadata.
 */

import type { GuardrailDecision } from './guardrail.js';
import type { NodeIdentity } from './identity.js';
import type { ValidationLayer } from './target.js';

/** The resolved validation target after automatic or agent-specified scope resolution. */
export interface ResolvedTarget {
  /** Human-readable description of what was validated. */
  description: string;
  /** Concrete nodes in scope for this validation run. */
  nodes: NodeIdentity[];
  /** Whether the target was automatically computed or explicitly specified by the agent. */
  automatic: boolean;
}

/** A single node along the concrete execution path observed during a validation run. */
export interface PathNode {
  name: NodeIdentity;
  executionIndex: number;
  /** Index of the source output that produced input to this node, or null if this is the path entry point. */
  sourceOutput: number | null;
}

/** Base fields shared by all diagnostic error variants regardless of classification. */
export interface DiagnosticErrorBase {
  /** Error class name (e.g. 'NodeApiError', 'ExpressionError'). */
  type: string;
  /** Primary error message. */
  message: string;
  /** More detailed description, if available. */
  description: string | null;
  /** The node that produced this error, or null if not attributable to a specific node. */
  node: NodeIdentity | null;
}

/** A classified diagnostic error with classification-specific context. */
export type DiagnosticError =
  | (DiagnosticErrorBase & {
      classification: 'wiring';
      context: { parameter?: string; referencedNode?: NodeIdentity; fieldPath?: string };
    })
  | (DiagnosticErrorBase & {
      classification: 'expression';
      context: { expression?: string; parameter?: string; itemIndex?: number };
    })
  | (DiagnosticErrorBase & {
      classification: 'credentials';
      context: { credentialType?: string; httpCode?: string };
    })
  | (DiagnosticErrorBase & {
      classification: 'external-service';
      context: { httpCode?: string; errorCode?: string };
    })
  | (DiagnosticErrorBase & {
      classification: 'platform';
      context: { runIndex?: number };
    })
  | (DiagnosticErrorBase & {
      classification: 'cancelled';
      context: { reason?: string };
    })
  | (DiagnosticErrorBase & {
      classification: 'unknown';
      context: { runIndex?: number; itemIndex?: number };
    });

/** The set of valid error classification labels, derived from DiagnosticError. */
export type ErrorClassification = DiagnosticError['classification'];

/** The validation status assigned to a node in the annotation pass. */
export type NodeAnnotationStatus = 'validated' | 'trusted' | 'mocked' | 'skipped';

/** Per-node annotation recording how the node was treated during validation. */
export interface NodeAnnotation {
  node: NodeIdentity;
  status: NodeAnnotationStatus;
  /** Why this node was assigned its status. */
  reason: string;
}

/** A non-blocking informational hint, optionally attached to a specific node. */
export interface DiagnosticHint {
  node: NodeIdentity | null;
  message: string;
  severity: 'info' | 'warning' | 'danger';
}

/** Which validation capabilities are available in the current environment. */
export interface AvailableCapabilities {
  /** Static analysis is always available; no external dependencies required. */
  staticAnalysis: true;
  restApi: boolean;
  mcpTools: boolean;
}

/** Metadata about the validation run itself, independent of its results. */
export interface ValidationMeta {
  /** Unique identifier for this validation run. */
  runId: string;
  /** n8n execution ID, if this run was execution-backed. */
  executionId: string | null;
  /** Whether destinationNode was set, indicating partial execution. */
  partialExecution: boolean;
  /** Timestamp of the validation run. */
  timestamp: string;
  /** Duration of the validation run in milliseconds. */
  durationMs: number;
}

/** The canonical structured output of a completed validation run. */
export interface DiagnosticSummary {
  /** Schema version for forward compatibility. */
  schemaVersion: 1;
  status: 'pass' | 'fail' | 'error' | 'skipped';
  /** The resolved scope that was validated. */
  target: ResolvedTarget;
  /** The validation layer(s) that produced this result. */
  evidenceBasis: ValidationLayer;
  /** The ordered sequence of nodes observed during execution, or null if no execution occurred. */
  executedPath: PathNode[] | null;
  errors: DiagnosticError[];
  nodeAnnotations: NodeAnnotation[];
  guardrailActions: GuardrailDecision[];
  hints: DiagnosticHint[];
  capabilities: AvailableCapabilities;
  meta: ValidationMeta;
}
