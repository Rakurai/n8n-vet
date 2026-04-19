/**
 * Internal types for the static analysis subsystem — findings, expression references, and analysis results.
 */

import type { WorkflowGraph } from '../types/graph.js';
import type { NodeIdentity } from '../types/identity.js';

// ---------------------------------------------------------------------------
// Expression references
// ---------------------------------------------------------------------------

/** Parsed reference extracted from a node parameter expression. */
export interface ExpressionReference {
  /** Node containing the expression. */
  node: NodeIdentity;
  /** Parameter path (dot-separated for nested params). */
  parameter: string;
  /** Raw expression string. */
  raw: string;
  /** Resolved upstream node, or null if unresolvable. */
  referencedNode: NodeIdentity | null;
  /** Dot-separated field path (e.g. `name.first`), or null. */
  fieldPath: string | null;
  /** Whether the reference was successfully resolved. */
  resolved: boolean;
}

// ---------------------------------------------------------------------------
// Finding context shapes (internal to the union)
// ---------------------------------------------------------------------------

interface DataLossContext {
  upstreamNode: NodeIdentity;
  fieldPath: string;
  parameter: string;
}

interface BrokenReferenceContext {
  referencedNode: string;
  parameter: string;
  expression: string;
}

interface InvalidParameterContext {
  parameter: string;
  expected?: string | undefined;
}

interface UnresolvableExpressionContext {
  parameter: string;
  expression: string;
}

interface SchemaMismatchContext {
  upstreamNode: NodeIdentity;
  fieldPath: string;
  parameter: string;
}

interface MissingCredentialsContext {
  credentialType: string;
}

interface OpaqueBoundaryContext {
  opaqueNode: NodeIdentity;
}

// ---------------------------------------------------------------------------
// Static finding (discriminated union on `kind`)
// ---------------------------------------------------------------------------

/** A single diagnostic produced by static analysis, discriminated on `kind`. */
export type StaticFinding =
  | {
      node: NodeIdentity;
      severity: 'error' | 'warning';
      message: string;
      kind: 'data-loss';
      context: DataLossContext;
    }
  | {
      node: NodeIdentity;
      severity: 'error' | 'warning';
      message: string;
      kind: 'broken-reference';
      context: BrokenReferenceContext;
    }
  | {
      node: NodeIdentity;
      severity: 'error' | 'warning';
      message: string;
      kind: 'invalid-parameter';
      context: InvalidParameterContext;
    }
  | {
      node: NodeIdentity;
      severity: 'error' | 'warning';
      message: string;
      kind: 'unresolvable-expression';
      context: UnresolvableExpressionContext;
    }
  | {
      node: NodeIdentity;
      severity: 'error' | 'warning';
      message: string;
      kind: 'schema-mismatch';
      context: SchemaMismatchContext;
    }
  | {
      node: NodeIdentity;
      severity: 'error' | 'warning';
      message: string;
      kind: 'missing-credentials';
      context: MissingCredentialsContext;
    }
  | {
      node: NodeIdentity;
      severity: 'error' | 'warning';
      message: string;
      kind: 'opaque-boundary';
      context: OpaqueBoundaryContext;
    };

// ---------------------------------------------------------------------------
// Top-level analysis result
// ---------------------------------------------------------------------------

/** Top-level output combining all static analysis outputs. */
export interface StaticAnalysisResult {
  graph: WorkflowGraph;
  findings: StaticFinding[];
  references: ExpressionReference[];
}
