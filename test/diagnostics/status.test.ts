import { describe, it, expect } from 'vitest';
import { determineStatus } from '../../src/diagnostics/status.js';
import {
  noErrorFindings,
  dataLossError,
} from '../fixtures/diagnostics/static-findings.js';
import { singleNodeApiError500 } from '../fixtures/diagnostics/execution-data.js';
import {
  refuseDecision,
  proceedDecision,
} from '../fixtures/diagnostics/guardrail-decisions.js';
import { nodeIdentity } from '../../src/types/identity.js';
import type { ExecutionData } from '../../src/diagnostics/types.js';

describe('determineStatus', () => {
  it('returns skipped when guardrail refuses', () => {
    expect(determineStatus([], null, [refuseDecision])).toBe('skipped');
  });

  it('returns pass when findings are warnings only and no execution errors', () => {
    expect(determineStatus(noErrorFindings, null, [proceedDecision])).toBe('pass');
  });

  it('returns fail when static findings include an error-severity finding', () => {
    expect(determineStatus([dataLossError], null, [])).toBe('fail');
  });

  it('returns fail when execution data contains a node error', () => {
    expect(determineStatus([], singleNodeApiError500, [])).toBe('fail');
  });

  it('returns pass when all inputs are empty', () => {
    expect(determineStatus([], null, [])).toBe('pass');
  });

  it('returns skipped when refuse decision coexists with static errors', () => {
    expect(determineStatus([dataLossError], null, [refuseDecision])).toBe('skipped');
  });

  it('returns error for infrastructure failure (execution error with no node errors)', () => {
    const infraFailure: ExecutionData = {
      status: 'error',
      lastNodeExecuted: null,
      error: {
        contextKind: 'other',
        type: 'WorkflowActivationError',
        message: 'Failed to initialize workflow',
        description: null,
        node: null,
      },
      nodeResults: new Map(),
    };
    expect(determineStatus([], infraFailure, [])).toBe('error');
  });
});
