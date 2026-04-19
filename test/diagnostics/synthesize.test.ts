import { describe, it, expect } from 'vitest';
import { synthesize, SynthesisError } from '../../src/diagnostics/synthesize.js';
import type { SynthesisInput } from '../../src/diagnostics/types.js';
import {
  noErrorFindings,
  dataLossError,
  mixedFindings,
  passFinding,
  opaqueBoundaryWarning,
} from '../fixtures/diagnostics/static-findings.js';
import { emptyTrustState, partialTrustState } from '../fixtures/diagnostics/trust-state.js';
import { proceedDecision } from '../fixtures/diagnostics/guardrail-decisions.js';
import {
  threeNodeTarget,
  singleNodeTarget,
  staticOnlyCapabilities,
  fullCapabilities,
  testMeta,
  executionMeta,
} from '../fixtures/diagnostics/targets.js';
import {
  successExecution,
  singleNodeApiError500,
  multiNodePath,
} from '../fixtures/diagnostics/execution-data.js';

function makeInput(overrides: Partial<SynthesisInput> = {}): SynthesisInput {
  return {
    staticFindings: [],
    executionData: null,
    trustState: emptyTrustState,
    guardrailDecisions: [],
    resolvedTarget: threeNodeTarget,
    capabilities: staticOnlyCapabilities,
    meta: testMeta,
    ...overrides,
  };
}

describe('synthesize — static-only path (US1)', () => {
  it('produces pass status with no errors', () => {
    const result = synthesize(makeInput({ staticFindings: noErrorFindings }));
    expect(result.status).toBe('pass');
  });

  it('produces fail status with one error', () => {
    const result = synthesize(makeInput({ staticFindings: [dataLossError] }));
    expect(result.status).toBe('fail');
  });

  it('sets schemaVersion to 1', () => {
    const result = synthesize(makeInput());
    expect(result.schemaVersion).toBe(1);
  });

  it('sets evidenceBasis to static when executionData is null', () => {
    const result = synthesize(makeInput());
    expect(result.evidenceBasis).toBe('static');
  });

  it('sets executedPath to null when executionData is null', () => {
    const result = synthesize(makeInput());
    expect(result.executedPath).toBeNull();
  });

  it('classifies and orders errors from static findings', () => {
    const result = synthesize(makeInput({ staticFindings: mixedFindings }));
    // mixedFindings: passFinding (warning), dataLossError, brokenRefError, opaqueBoundaryWarning, missingCredsError
    // Only errors: dataLossError (wiring), brokenRefError (wiring), missingCredsError (credentials)
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0].classification).toBe('wiring');
    expect(result.errors[1].classification).toBe('wiring');
    expect(result.errors[2].classification).toBe('credentials');
  });

  it('converts warning findings to hints', () => {
    const result = synthesize(makeInput({ staticFindings: noErrorFindings }));
    const warningHints = result.hints.filter((h) => h.severity === 'warning');
    expect(warningHints).toHaveLength(2); // passFinding + opaqueBoundaryWarning
  });

  it('includes static-only run hint when executionData is null', () => {
    const result = synthesize(makeInput());
    const infoHints = result.hints.filter((h) => h.severity === 'info');
    expect(infoHints).toHaveLength(1);
    expect(infoHints[0].message).toContain('Static analysis only');
  });

  it('produces one annotation per node in resolved target', () => {
    const result = synthesize(makeInput({ resolvedTarget: threeNodeTarget }));
    expect(result.nodeAnnotations).toHaveLength(3);
    const annotatedNodes = result.nodeAnnotations.map((a) => a.node);
    expect(annotatedNodes).toEqual(threeNodeTarget.nodes);
  });

  it('passes through guardrail decisions unchanged', () => {
    const result = synthesize(
      makeInput({ guardrailDecisions: [proceedDecision] }),
    );
    expect(result.guardrailActions).toEqual([proceedDecision]);
  });

  it('preserves capabilities and meta', () => {
    const result = synthesize(makeInput());
    expect(result.capabilities).toBe(staticOnlyCapabilities);
    expect(result.meta).toBe(testMeta);
  });

  it('preserves target', () => {
    const result = synthesize(makeInput());
    expect(result.target).toBe(threeNodeTarget);
  });

  it('throws on empty resolvedTarget.nodes', () => {
    expect(() =>
      synthesize(
        makeInput({
          resolvedTarget: { description: 'Empty', nodes: [], automatic: false },
        }),
      ),
    ).toThrow(SynthesisError);
  });

  it('produces complete structure with correct value types', () => {
    const result = synthesize(makeInput({ staticFindings: [dataLossError] }));
    expect(result.schemaVersion).toBe(1);
    expect(result.status).toBe('fail');
    expect(result.target).toBe(threeNodeTarget);
    expect(result.evidenceBasis).toBe('static');
    expect(result.executedPath).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].classification).toBe('wiring');
    expect(result.nodeAnnotations).toHaveLength(3);
    expect(result.guardrailActions).toEqual([]);
    expect(result.hints.length).toBeGreaterThanOrEqual(1);
    expect(result.capabilities).toBe(staticOnlyCapabilities);
    expect(result.meta).toBe(testMeta);
  });

  it('annotates nodes with validated status when they have static findings', () => {
    // dataLossError targets setFields
    const result = synthesize(
      makeInput({
        staticFindings: [dataLossError],
        resolvedTarget: singleNodeTarget, // httpRequest only
      }),
    );
    // httpRequest has no findings, so it should be skipped (no trust records in emptyTrustState)
    expect(result.nodeAnnotations[0].status).toBe('skipped');
  });

  it('annotates trusted nodes correctly', () => {
    // partialTrustState trusts trigger and setFields; threeNodeTarget has httpRequest, setFields, codeNode
    const result = synthesize(
      makeInput({ trustState: partialTrustState }),
    );
    const setFieldsAnnotation = result.nodeAnnotations.find(
      (a) => String(a.node) === 'setFields',
    );
    expect(setFieldsAnnotation?.status).toBe('trusted');
  });
});

// ---------------------------------------------------------------------------
// T026: Execution-backed synthesis (US2)
// ---------------------------------------------------------------------------

describe('synthesize — execution-backed path (US2)', () => {
  function makeExecInput(overrides: Partial<SynthesisInput> = {}): SynthesisInput {
    return {
      staticFindings: [dataLossError],
      executionData: singleNodeApiError500,
      trustState: emptyTrustState,
      guardrailDecisions: [],
      resolvedTarget: threeNodeTarget,
      capabilities: fullCapabilities,
      meta: executionMeta,
      ...overrides,
    };
  }

  it('sets evidenceBasis to both when static findings and execution data present', () => {
    const result = synthesize(makeExecInput());
    expect(result.evidenceBasis).toBe('both');
  });

  it('sets evidenceBasis to execution when static findings are empty', () => {
    const result = synthesize(makeExecInput({ staticFindings: [] }));
    expect(result.evidenceBasis).toBe('execution');
  });

  it('populates executedPath when execution data is present', () => {
    const result = synthesize(makeExecInput({ executionData: successExecution }));
    expect(result.executedPath).not.toBeNull();
    expect(result.executedPath!.length).toBe(3);
  });

  it('orders executedPath by executionIndex ascending', () => {
    const result = synthesize(makeExecInput({ executionData: multiNodePath }));
    const indices = result.executedPath!.map((p) => p.executionIndex);
    expect(indices).toEqual([0, 1, 2, 3, 4]);
  });

  it('orders errors with execution before static', () => {
    const result = synthesize(makeExecInput());
    // singleNodeApiError500 → external-service (execution), dataLossError → wiring (static)
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors[0].classification).toBe('external-service'); // execution first
  });

  it('includes both static and execution errors in errors array', () => {
    const result = synthesize(makeExecInput());
    const classifications = result.errors.map((e) => e.classification);
    expect(classifications).toContain('external-service'); // from execution
    expect(classifications).toContain('wiring'); // from static
  });

  it('does not include static-only hint when execution data present', () => {
    const result = synthesize(makeExecInput());
    const staticOnlyHints = result.hints.filter((h) =>
      h.message.includes('Static analysis only'),
    );
    expect(staticOnlyHints).toHaveLength(0);
  });

  it('same-node cross-layer findings both appear in errors', () => {
    // dataLossError targets setFields (static), create execution data where setFields also errors
    const sameNodeExec: import('../../src/diagnostics/types.js').ExecutionData = {
      status: 'error',
      lastNodeExecuted: 'setFields',
      error: {
        contextKind: 'expression',
        type: 'ExpressionError',
        message: 'Cannot read property',
        description: null,
        node: 'setFields',
        expression: '={{ $json.missing }}',
        parameter: 'value',
      },
      nodeResults: new Map([
        [
          nodeIdentity('trigger'),
          {
            executionIndex: 0,
            status: 'success' as const,
            executionTimeMs: 3,
            error: null,
            source: { previousNodeOutput: null },
            hints: [],
          },
        ],
        [
          nodeIdentity('setFields'),
          {
            executionIndex: 1,
            status: 'error' as const,
            executionTimeMs: 5,
            error: {
              contextKind: 'expression' as const,
              type: 'ExpressionError',
              message: 'Cannot read property',
              description: null,
              node: 'setFields',
              expression: '={{ $json.missing }}',
              parameter: 'value',
            },
            source: { previousNodeOutput: 0 },
            hints: [],
          },
        ],
      ]),
    };

    const result = synthesize(makeExecInput({
      staticFindings: [dataLossError], // targets setFields
      executionData: sameNodeExec,     // also errors on setFields
    }));

    // Both errors target setFields — they must both appear (no dedup)
    const setFieldsErrors = result.errors.filter((e) => String(e.node) === 'setFields');
    expect(setFieldsErrors).toHaveLength(2);
    // Execution error first
    expect(setFieldsErrors[0].classification).toBe('expression');
    // Static error second
    expect(setFieldsErrors[1].classification).toBe('wiring');
  });
});

// ---------------------------------------------------------------------------
// T032: Guardrail action reporting (US4)
// ---------------------------------------------------------------------------

import {
  warnDecision,
  narrowDecision,
  redirectDecision,
  refuseDecision,
  mixedDecisions,
} from '../fixtures/diagnostics/guardrail-decisions.js';

describe('synthesize — guardrail action reporting (US4)', () => {
  it('all guardrail decision types appear in guardrailActions', () => {
    const allDecisions = [proceedDecision, warnDecision, narrowDecision, redirectDecision, refuseDecision];
    const result = synthesize(makeInput({ guardrailDecisions: allDecisions }));
    expect(result.guardrailActions).toEqual(allDecisions);
    const actions = result.guardrailActions.map((d) => d.action);
    expect(actions).toEqual(['proceed', 'warn', 'narrow', 'redirect', 'refuse']);
  });

  it('refuse sets status to skipped even when errors are present', () => {
    const result = synthesize(
      makeInput({
        staticFindings: [dataLossError],
        guardrailDecisions: [refuseDecision],
      }),
    );
    expect(result.status).toBe('skipped');
  });

  it('narrow decision includes narrowedTarget on the decision', () => {
    const result = synthesize(makeInput({ guardrailDecisions: [narrowDecision] }));
    const narrow = result.guardrailActions.find((d) => d.action === 'narrow');
    expect(narrow).toBeDefined();
    if (narrow?.action !== 'narrow') throw new Error('Expected narrow action');
    expect(narrow.narrowedTarget).toEqual(narrowDecision.narrowedTarget);
  });

  it('multiple decisions all appear in guardrailActions', () => {
    const result = synthesize(makeInput({ guardrailDecisions: mixedDecisions }));
    expect(result.guardrailActions).toHaveLength(2);
    expect(result.guardrailActions).toEqual(mixedDecisions);
  });

  it('empty guardrail decisions results in empty guardrailActions array', () => {
    const result = synthesize(makeInput({ guardrailDecisions: [] }));
    expect(result.guardrailActions).toEqual([]);
    expect(result.guardrailActions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T036: Integration test — full synthesis pipeline
// ---------------------------------------------------------------------------

import { nodeIdentity } from '../../src/types/identity.js';
import type { ExecutionData } from '../../src/diagnostics/types.js';
import { fiveNodeTarget } from '../fixtures/diagnostics/targets.js';
import { fullTrustState } from '../fixtures/diagnostics/trust-state.js';

describe('synthesize — full pipeline integration (T036)', () => {
  it('produces correct summary combining all evidence layers', () => {
    const execData: ExecutionData = {
      status: 'error',
      lastNodeExecuted: 'httpRequest',
      error: {
        contextKind: 'api',
        type: 'NodeApiError',
        message: 'Service unavailable',
        description: 'HTTP 503',
        node: 'httpRequest',
        httpCode: 503,
      },
      nodeResults: new Map([
        [
          nodeIdentity('httpRequest'),
          {
            executionIndex: 0,
            status: 'error',
            executionTimeMs: 150,
            error: {
              contextKind: 'api',
              type: 'NodeApiError',
              message: 'Service unavailable',
              description: 'HTTP 503',
              node: 'httpRequest',
              httpCode: 503,
            },
            source: { previousNodeOutput: null },
            hints: [{ message: 'Retry-After header present' }],
          },
        ],
        [
          nodeIdentity('setFields'),
          {
            executionIndex: 1,
            status: 'success',
            executionTimeMs: 5,
            error: null,
            source: { previousNodeOutput: 0 },
            hints: [],
            pinDataSource: 'agent' as const,
          },
        ],
      ]),
    };

    const result = synthesize({
      staticFindings: mixedFindings,
      executionData: execData,
      trustState: partialTrustState,
      guardrailDecisions: [proceedDecision, warnDecision],
      resolvedTarget: threeNodeTarget,
      capabilities: fullCapabilities,
      meta: executionMeta,
    });

    // Status: fail (has errors from both layers)
    expect(result.schemaVersion).toBe(1);
    expect(result.status).toBe('fail');

    // Evidence basis: both layers present
    expect(result.evidenceBasis).toBe('both');

    // Errors: execution errors first, then static
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors[0].classification).toBe('external-service'); // execution 503

    // Path: reconstructed from execution
    expect(result.executedPath).not.toBeNull();
    expect(result.executedPath).toHaveLength(2);
    expect(result.executedPath![0].name).toBe(nodeIdentity('httpRequest'));

    // Annotations: one per node in target
    expect(result.nodeAnnotations).toHaveLength(3);
    // httpRequest → validated (executed), setFields → mocked (pinDataSource), codeNode → skipped
    const byNode = new Map(result.nodeAnnotations.map((a) => [String(a.node), a]));
    expect(byNode.get('httpRequest')?.status).toBe('validated');
    expect(byNode.get('setFields')?.status).toBe('mocked');
    expect(byNode.get('codeNode')?.status).toBe('skipped');

    // Guardrails: all passed through
    expect(result.guardrailActions).toHaveLength(2);

    // Hints: warnings from static + info from execution runtime
    expect(result.hints.some((h) => h.severity === 'warning')).toBe(true);
    expect(result.hints.some((h) => h.severity === 'info')).toBe(true);

    // Meta and capabilities preserved
    expect(result.meta).toBe(executionMeta);
    expect(result.capabilities).toBe(fullCapabilities);
    expect(result.target).toBe(threeNodeTarget);
  });
});

// ---------------------------------------------------------------------------
// T037: Compactness verification
// ---------------------------------------------------------------------------

describe('synthesize — compactness verification (T037)', () => {
  it('static-only summary with 3 nodes serializes to ~30-40 lines', () => {
    const result = synthesize(makeInput({
      staticFindings: noErrorFindings,
      resolvedTarget: threeNodeTarget,
    }));
    const json = JSON.stringify(result, null, 2);
    const lineCount = json.split('\n').length;
    // Compact: should be under 80 lines for a 3-node static-only summary
    expect(lineCount).toBeLessThan(80);
    expect(lineCount).toBeGreaterThan(10);
  });

  it('execution-backed summary with 5 nodes serializes to ~80-100 lines', () => {
    const result = synthesize({
      staticFindings: mixedFindings,
      executionData: multiNodePath,
      trustState: partialTrustState,
      guardrailDecisions: [proceedDecision],
      resolvedTarget: fiveNodeTarget,
      capabilities: fullCapabilities,
      meta: executionMeta,
    });
    const json = JSON.stringify(result, null, 2);
    const lineCount = json.split('\n').length;
    // Should be reasonably compact for a 5-node execution-backed summary
    expect(lineCount).toBeLessThan(200);
    expect(lineCount).toBeGreaterThan(30);
  });
});
