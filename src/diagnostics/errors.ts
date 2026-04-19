/**
 * Error extraction, classification, and ordering for the diagnostics subsystem.
 *
 * Classifies errors from two sources — static findings and execution data — into
 * the unified `DiagnosticError` type, then orders them for the final summary.
 */

import type { NodeIdentity } from '../types/identity.js';
import type { DiagnosticError, ErrorClassification } from '../types/diagnostic.js';
import type { StaticFinding } from '../static-analysis/types.js';
import type {
  ExecutionData,
  ExecutionErrorData,
  ClassifiedError,
  StaticKindClassificationMap,
  StaticFindingErrorKind,
} from './types.js';

// ---------------------------------------------------------------------------
// Static finding classification
// ---------------------------------------------------------------------------

const STATIC_KIND_MAP: StaticKindClassificationMap = {
  'data-loss': 'wiring',
  'broken-reference': 'wiring',
  'invalid-parameter': 'wiring',
  'schema-mismatch': 'wiring',
  'missing-credentials': 'credentials',
  'unresolvable-expression': 'expression',
};

/**
 * Classify error-severity static findings into `ClassifiedError` entries.
 *
 * Warning-severity findings are filtered out (they become hints, not errors).
 * Raises if an `opaque-boundary` finding arrives with `severity: 'error'` —
 * that combination is unexpected per the static analysis spec.
 */
export function classifyStaticFindings(findings: StaticFinding[]): ClassifiedError[] {
  const result: ClassifiedError[] = [];

  for (const finding of findings) {
    if (finding.severity === 'warning') {
      continue;
    }

    if (finding.kind === 'opaque-boundary') {
      throw new DiagnosticClassificationError(
        `Unexpected error-severity opaque-boundary finding on node "${finding.node}". ` +
          'opaque-boundary findings must have severity "warning".',
      );
    }

    const classification = STATIC_KIND_MAP[finding.kind as StaticFindingErrorKind];
    const error = buildStaticDiagnosticError(finding, classification);
    result.push({ error, source: 'static', executionIndex: null });
  }

  return result;
}

function buildStaticDiagnosticError(
  finding: StaticFinding,
  classification: ErrorClassification,
): DiagnosticError {
  const base = {
    type: finding.kind,
    message: finding.message,
    description: null,
    node: finding.node,
  };

  switch (classification) {
    case 'wiring': {
      let wiringCtx: DiagnosticError & { classification: 'wiring' } extends { context: infer C } ? C : never;
      switch (finding.kind) {
        case 'data-loss':
          wiringCtx = {
            referencedNode: finding.context.upstreamNode,
            fieldPath: finding.context.fieldPath,
            parameter: finding.context.parameter,
          };
          break;
        case 'broken-reference':
          wiringCtx = {
            referencedNode: finding.context.referencedNode as NodeIdentity,
            parameter: finding.context.parameter,
          };
          break;
        case 'invalid-parameter':
          wiringCtx = { parameter: finding.context.parameter };
          break;
        case 'schema-mismatch':
          wiringCtx = {
            referencedNode: finding.context.upstreamNode,
            fieldPath: finding.context.fieldPath,
            parameter: finding.context.parameter,
          };
          break;
        default:
          wiringCtx = {};
      }
      return {
        ...base,
        classification: 'wiring',
        context: wiringCtx,
      };
    }
    case 'expression': {
      const exprCtx = finding.kind === 'unresolvable-expression'
        ? { expression: finding.context.expression, parameter: finding.context.parameter }
        : {};
      return {
        ...base,
        classification: 'expression',
        context: exprCtx,
      };
    }
    case 'credentials': {
      const credCtx = finding.kind === 'missing-credentials'
        ? { credentialType: finding.context.credentialType }
        : {};
      return {
        ...base,
        classification: 'credentials',
        context: credCtx,
      };
    }
    default:
      throw new DiagnosticClassificationError(
        `Static findings cannot produce classification "${classification}"`,
      );
  }
}

// ---------------------------------------------------------------------------
// Execution error classification
// ---------------------------------------------------------------------------

/**
 * Classify execution errors into `ClassifiedError` entries.
 *
 * Uses a two-tier strategy:
 * 1. Constructor name matching (when the error `type` field is a known n8n class)
 * 2. `contextKind` discriminant fallback (for serialized errors without constructor names)
 */
export function classifyExecutionErrors(data: ExecutionData): ClassifiedError[] {
  const result: ClassifiedError[] = [];

  for (const [node, nodeResult] of data.nodeResults) {
    if (nodeResult.error === null) continue;

    const classification = classifyExecutionError(nodeResult.error);
    const error = buildExecutionDiagnosticError(nodeResult.error, node, classification);
    result.push({ error, source: 'execution', executionIndex: nodeResult.executionIndex });
  }

  if (data.error !== null && data.lastNodeExecuted === null) {
    const classification = classifyExecutionError(data.error);
    const error = buildExecutionDiagnosticError(data.error, null, classification);
    result.push({ error, source: 'execution', executionIndex: null });
  }

  return result;
}

function classifyExecutionError(error: ExecutionErrorData): ErrorClassification {
  const byConstructor = classifyByConstructorName(error.type);
  if (byConstructor !== null) return byConstructor;

  return classifyByContextKind(error);
}

function classifyByConstructorName(type: string): ErrorClassification | null {
  if (type.includes('Cancelled')) return 'cancelled';
  if (type === 'ExpressionError') return 'expression';
  if (type === 'WorkflowOperationError' || type === 'WorkflowActivationError') return 'platform';
  if (type === 'WorkflowConfigurationError') return 'wiring';
  if (type === 'NodeSslError') return 'external-service';
  if (type === 'NodeApiError') return null; // need httpCode — fall through to contextKind
  if (type === 'NodeOperationError') return null; // need more context — fall through
  return null;
}

function classifyByContextKind(error: ExecutionErrorData): ErrorClassification {
  switch (error.contextKind) {
    case 'cancellation':
      return 'cancelled';
    case 'expression':
      return 'expression';
    case 'api':
      return classifyApiError(error);
    case 'other':
      return 'unknown';
  }
}

function classifyApiError(error: ExecutionErrorData & { contextKind: 'api' }): ErrorClassification {
  if (error.httpCode === undefined) return 'external-service';

  const code = error.httpCode;
  if (code === 401 || code === 403) return 'credentials';
  if (code >= 400 && code < 500) return 'wiring';
  if (code >= 500) return 'external-service';

  return 'external-service';
}

function buildExecutionDiagnosticError(
  error: ExecutionErrorData,
  node: NodeIdentity | null,
  classification: ErrorClassification,
): DiagnosticError {
  const base = {
    type: error.type,
    message: error.message,
    description: error.description,
    node,
  };

  switch (classification) {
    case 'wiring':
      return { ...base, classification: 'wiring', context: {} };
    case 'expression':
      return {
        ...base,
        classification: 'expression',
        context: error.contextKind === 'expression'
          ? buildExpressionErrorContext(error)
          : {},
      };
    case 'credentials':
      return {
        ...base,
        classification: 'credentials',
        context: error.contextKind === 'api' && error.httpCode !== undefined
          ? { httpCode: String(error.httpCode) }
          : {},
      };
    case 'external-service':
      return {
        ...base,
        classification: 'external-service',
        context: error.contextKind === 'api'
          ? buildExternalServiceContext(error)
          : {},
      };
    case 'platform':
      return { ...base, classification: 'platform', context: {} };
    case 'cancelled':
      return {
        ...base,
        classification: 'cancelled',
        context: error.contextKind === 'cancellation' && error.reason !== undefined
          ? { reason: error.reason }
          : {},
      };
    case 'unknown':
      return { ...base, classification: 'unknown', context: {} };
  }
}

// ---------------------------------------------------------------------------
// Error ordering
// ---------------------------------------------------------------------------

/**
 * Order classified errors for the final summary.
 *
 * Sort order:
 * 1. Source: execution errors before static errors
 * 2. Execution order: earliest failing node first (by executionIndex, ascending)
 */
export function orderErrors(errors: ClassifiedError[]): DiagnosticError[] {
  const sorted = [...errors].sort((a, b) => {
    const aRank = a.source === 'execution' ? 0 : 1;
    const bRank = b.source === 'execution' ? 0 : 1;
    const sourceOrder = aRank - bRank;
    if (sourceOrder !== 0) return sourceOrder;

    const aIndex = a.executionIndex ?? Number.MAX_SAFE_INTEGER;
    const bIndex = b.executionIndex ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });

  return sorted.map((c) => c.error);
}

// ---------------------------------------------------------------------------
// Context builders for execution errors (exactOptionalPropertyTypes-safe)
// ---------------------------------------------------------------------------

function buildExpressionErrorContext(
  error: ExecutionErrorData & { contextKind: 'expression' },
): { expression?: string; parameter?: string; itemIndex?: number } {
  const ctx: { expression?: string; parameter?: string; itemIndex?: number } = {};
  if (error.expression !== undefined) ctx.expression = error.expression;
  if (error.parameter !== undefined) ctx.parameter = error.parameter;
  if (error.itemIndex !== undefined) ctx.itemIndex = error.itemIndex;
  return ctx;
}

function buildExternalServiceContext(
  error: ExecutionErrorData & { contextKind: 'api' },
): { httpCode?: string; errorCode?: string } {
  const ctx: { httpCode?: string; errorCode?: string } = {};
  if (error.httpCode !== undefined) ctx.httpCode = String(error.httpCode);
  if (error.errorCode !== undefined) ctx.errorCode = error.errorCode;
  return ctx;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** Typed error for classification failures in the diagnostics subsystem. */
export class DiagnosticClassificationError extends Error {
  override readonly name = 'DiagnosticClassificationError' as const;
}
