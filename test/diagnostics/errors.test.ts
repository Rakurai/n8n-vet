import { describe, it, expect } from 'vitest';
import {
  classifyStaticFindings,
  classifyExecutionErrors,
  orderErrors,
  DiagnosticClassificationError,
} from '../../src/diagnostics/errors.js';
import {
  dataLossError,
  brokenRefError,
  invalidParamError,
  schemaMismatchError,
  missingCredsError,
  unresolvableExprError,
  opaqueBoundaryWarning,
  noErrorFindings,
  mixedFindings,
} from '../fixtures/diagnostics/static-findings.js';
import {
  singleNodeApiError500,
  credentialError401,
  apiErrorNoHttpCode,
  expressionError,
  cancelledExecution,
  unknownError,
  successExecution,
} from '../fixtures/diagnostics/execution-data.js';
import { nodeIdentity } from '../../src/types/identity.js';
import type { StaticFinding } from '../../src/static-analysis/types.js';

// ---------------------------------------------------------------------------
// T011: Static finding classification
// ---------------------------------------------------------------------------

describe('classifyStaticFindings', () => {
  it('classifies data-loss as wiring', () => {
    const result = classifyStaticFindings([dataLossError]);
    expect(result).toHaveLength(1);
    expect(result[0].error.classification).toBe('wiring');
    expect(result[0].source).toBe('static');
    expect(result[0].executionIndex).toBeNull();
  });

  it('classifies broken-reference as wiring', () => {
    const result = classifyStaticFindings([brokenRefError]);
    expect(result).toHaveLength(1);
    expect(result[0].error.classification).toBe('wiring');
  });

  it('classifies invalid-parameter as wiring', () => {
    const result = classifyStaticFindings([invalidParamError]);
    expect(result).toHaveLength(1);
    expect(result[0].error.classification).toBe('wiring');
  });

  it('classifies schema-mismatch as wiring', () => {
    const result = classifyStaticFindings([schemaMismatchError]);
    expect(result).toHaveLength(1);
    expect(result[0].error.classification).toBe('wiring');
  });

  it('classifies missing-credentials as credentials', () => {
    const result = classifyStaticFindings([missingCredsError]);
    expect(result).toHaveLength(1);
    expect(result[0].error.classification).toBe('credentials');
    if (result[0].error.classification === 'credentials') {
      expect(result[0].error.context.credentialType).toBe('slackOAuth2Api');
    }
  });

  it('classifies unresolvable-expression as expression', () => {
    const result = classifyStaticFindings([unresolvableExprError]);
    expect(result).toHaveLength(1);
    expect(result[0].error.classification).toBe('expression');
    if (result[0].error.classification === 'expression') {
      expect(result[0].error.context.expression).toBe('={{ $json.items[*].nested?.deep }}');
      expect(result[0].error.context.parameter).toBe('assignments.value');
    }
  });

  it('filters out warning-severity findings', () => {
    const result = classifyStaticFindings(noErrorFindings);
    expect(result).toHaveLength(0);
  });

  it('filters warnings and classifies errors from mixed findings', () => {
    const result = classifyStaticFindings(mixedFindings);
    // mixedFindings has: passFinding (warning), dataLossError, brokenRefError, opaqueBoundaryWarning, missingCredsError
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.error.classification)).toEqual([
      'wiring',
      'wiring',
      'credentials',
    ]);
  });

  it('throws on opaque-boundary with error severity', () => {
    const errorOpaque: StaticFinding = {
      ...opaqueBoundaryWarning,
      severity: 'error',
    };
    expect(() => classifyStaticFindings([errorOpaque])).toThrow(
      DiagnosticClassificationError,
    );
    expect(() => classifyStaticFindings([errorOpaque])).toThrow(
      /opaque-boundary/,
    );
  });

  it('preserves node identity on classified errors', () => {
    const result = classifyStaticFindings([dataLossError]);
    expect(result[0].error.node).toBe(dataLossError.node);
  });

  it('preserves message on classified errors', () => {
    const result = classifyStaticFindings([dataLossError]);
    expect(result[0].error.message).toBe(dataLossError.message);
  });

  it('populates wiring context for data-loss with upstream info', () => {
    const result = classifyStaticFindings([dataLossError]);
    if (result[0].error.classification === 'wiring') {
      expect(result[0].error.context.referencedNode).toBe(nodeIdentity('httpRequest'));
      expect(result[0].error.context.fieldPath).toBe('userId');
      expect(result[0].error.context.parameter).toBe('assignments');
    }
  });

  it('returns empty array for empty input', () => {
    expect(classifyStaticFindings([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T012: Execution error classification
// ---------------------------------------------------------------------------

describe('classifyExecutionErrors', () => {
  it('classifies NodeApiError with HTTP 500 as external-service', () => {
    const result = classifyExecutionErrors(singleNodeApiError500);
    expect(result).toHaveLength(1);
    expect(result[0].error.classification).toBe('external-service');
    expect(result[0].source).toBe('execution');
    expect(result[0].executionIndex).toBe(1);
  });

  it('classifies NodeApiError with HTTP 401 as credentials', () => {
    const result = classifyExecutionErrors(credentialError401);
    expect(result).toHaveLength(1);
    expect(result[0].error.classification).toBe('credentials');
  });

  it('classifies api contextKind without httpCode as external-service', () => {
    const result = classifyExecutionErrors(apiErrorNoHttpCode);
    expect(result).toHaveLength(1);
    expect(result[0].error.classification).toBe('external-service');
  });

  it('classifies ExpressionError via constructor name as expression', () => {
    const result = classifyExecutionErrors(expressionError);
    expect(result).toHaveLength(1);
    expect(result[0].error.classification).toBe('expression');
  });

  it('classifies cancellation error as cancelled', () => {
    const result = classifyExecutionErrors(cancelledExecution);
    // cancelledExecution has the error on httpRequest node + top-level error with lastNodeExecuted set
    // Since lastNodeExecuted is 'httpRequest' (not null), the top-level error path is skipped
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].error.classification).toBe('cancelled');
  });

  it('classifies other contextKind as unknown', () => {
    const result = classifyExecutionErrors(unknownError);
    expect(result).toHaveLength(1);
    expect(result[0].error.classification).toBe('unknown');
  });

  it('returns empty array for successful execution with no errors', () => {
    const result = classifyExecutionErrors(successExecution);
    expect(result).toHaveLength(0);
  });

  it('populates expression context from execution error', () => {
    const result = classifyExecutionErrors(expressionError);
    if (result[0].error.classification === 'expression') {
      expect(result[0].error.context.expression).toBe('{{ $json.contact.name }}');
      expect(result[0].error.context.parameter).toBe('value');
    }
  });

  it('populates external-service context with httpCode', () => {
    const result = classifyExecutionErrors(singleNodeApiError500);
    if (result[0].error.classification === 'external-service') {
      expect(result[0].error.context.httpCode).toBe('500');
    }
  });

  it('populates cancelled context with reason', () => {
    const result = classifyExecutionErrors(cancelledExecution);
    if (result[0].error.classification === 'cancelled') {
      expect(result[0].error.context.reason).toBe('manual');
    }
  });

  it('populates credentials context with httpCode string', () => {
    const result = classifyExecutionErrors(credentialError401);
    if (result[0].error.classification === 'credentials') {
      expect(result[0].error.context.httpCode).toBe('401');
    }
  });
});

// ---------------------------------------------------------------------------
// T013: Error ordering
// ---------------------------------------------------------------------------

describe('orderErrors', () => {
  it('puts execution errors before static errors', () => {
    const staticClassified = classifyStaticFindings([dataLossError]);
    const execClassified = classifyExecutionErrors(singleNodeApiError500);
    const combined = [...staticClassified, ...execClassified];
    const ordered = orderErrors(combined);
    expect(ordered[0].classification).toBe('external-service'); // execution
    expect(ordered[1].classification).toBe('wiring'); // static
  });

  it('orders execution errors by executionIndex ascending', () => {
    const execClassified = classifyExecutionErrors(unknownError);
    const execClassified2 = classifyExecutionErrors(expressionError);
    // unknownError: codeNode at index 3
    // expressionError: setFields at index 2
    const combined = [...execClassified, ...execClassified2];
    const ordered = orderErrors(combined);
    expect(ordered[0].classification).toBe('expression'); // index 2
    expect(ordered[1].classification).toBe('unknown'); // index 3
  });

  it('returns empty array for empty input', () => {
    expect(orderErrors([])).toEqual([]);
  });

  it('preserves order for same-source same-index errors', () => {
    const classified = classifyStaticFindings([dataLossError, missingCredsError]);
    const ordered = orderErrors(classified);
    expect(ordered).toHaveLength(2);
    // Both are static with null executionIndex, order should be stable
    expect(ordered[0].classification).toBe('wiring');
    expect(ordered[1].classification).toBe('credentials');
  });

  it('returns DiagnosticError[] without ClassifiedError wrapper', () => {
    const classified = classifyStaticFindings([dataLossError]);
    const ordered = orderErrors(classified);
    // Should not have source or executionIndex properties
    expect(ordered[0]).toHaveProperty('classification');
    expect(ordered[0]).toHaveProperty('message');
    expect(ordered[0]).not.toHaveProperty('source');
    expect(ordered[0]).not.toHaveProperty('executionIndex');
  });
});

