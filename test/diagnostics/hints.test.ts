import { describe, it, expect } from 'vitest';
import { collectHints } from '../../src/diagnostics/hints.js';
import {
  noErrorFindings,
  dataLossError,
  mixedFindings,
  passFinding,
  opaqueBoundaryWarning,
} from '../fixtures/diagnostics/static-findings.js';
import {
  successExecution,
  multiNodePath,
  redactedNodeExecution,
  singleNodeApiError500,
} from '../fixtures/diagnostics/execution-data.js';

// ---------------------------------------------------------------------------
// T: Warning-severity static findings become warning hints
// ---------------------------------------------------------------------------

describe('collectHints', () => {
  it('converts warning-severity findings to warning hints', () => {
    const hints = collectHints(noErrorFindings, null);
    const warningHints = hints.filter((h) => h.severity === 'warning');
    expect(warningHints).toHaveLength(2);
    expect(warningHints[0].node).toBe(passFinding.node);
    expect(warningHints[0].message).toBe(passFinding.message);
    expect(warningHints[1].node).toBe(opaqueBoundaryWarning.node);
    expect(warningHints[1].message).toBe(opaqueBoundaryWarning.message);
  });

  it('does not convert error-severity findings to hints', () => {
    const hints = collectHints([dataLossError], null);
    const warningHints = hints.filter((h) => h.severity === 'warning');
    expect(warningHints).toHaveLength(0);
    // Should only have the static-only info hint
    expect(hints).toHaveLength(1);
    expect(hints[0].severity).toBe('info');
  });

  it('includes static-only info hint when executionData is null', () => {
    const hints = collectHints(noErrorFindings, null);
    const infoHints = hints.filter((h) => h.severity === 'info');
    expect(infoHints).toHaveLength(1);
    expect(infoHints[0].message).toMatch(/static analysis only/i);
  });

  it('returns single static-only info hint for empty findings and null executionData', () => {
    const hints = collectHints([], null);
    expect(hints).toHaveLength(1);
    expect(hints[0].severity).toBe('info');
    expect(hints[0].message).toMatch(/static analysis only/i);
  });

  it('converts execution runtime hints to info-severity hints', () => {
    const hints = collectHints([], multiNodePath);
    // multiNodePath has hints on httpRequest (1), ifNode (1), codeNode (2) = 4 total
    const infoHints = hints.filter((h) => h.severity === 'info');
    expect(infoHints).toHaveLength(4);
    expect(infoHints[0].message).toBe(
      'Rate limit header indicates 12 remaining requests',
    );
    expect(infoHints[1].message).toBe('All items routed to true branch');
    expect(infoHints[2].message).toBe('Output contains 3 items');
    expect(infoHints[3].message).toBe('Execution used 12 MB heap memory');
  });

  it('does not include static-only hint when executionData is non-null', () => {
    const hints = collectHints([], successExecution);
    const staticOnlyHints = hints.filter((h) =>
      h.message.includes('static analysis only'),
    );
    expect(staticOnlyHints).toHaveLength(0);
  });

  it('only converts warnings to hints from mixed findings, not errors', () => {
    const hints = collectHints(mixedFindings, null);
    const warningHints = hints.filter((h) => h.severity === 'warning');
    // mixedFindings: passFinding (warning), dataLossError (error), brokenRefError (error),
    // opaqueBoundaryWarning (warning), missingCredsError (error) => 2 warnings
    expect(warningHints).toHaveLength(2);
    expect(warningHints[0].message).toBe(passFinding.message);
    expect(warningHints[1].message).toBe(opaqueBoundaryWarning.message);
  });
});

// ---------------------------------------------------------------------------
// T035: Redacted execution data hints
// ---------------------------------------------------------------------------

describe('collectHints — redacted execution data', () => {
  it('emits danger-severity hint for redacted node (executionTimeMs === 0 with error)', () => {
    const hints = collectHints([], redactedNodeExecution);
    const dangerHints = hints.filter((h) => h.severity === 'danger');
    expect(dangerHints).toHaveLength(1);
    expect(dangerHints[0].message).toMatch(/redacted/i);
    expect(dangerHints[0].message).toContain('httpRequest');
    expect(dangerHints[0].severity).toBe('danger');
  });

  it('does not emit danger hints for non-redacted nodes (executionTimeMs > 0)', () => {
    const hints = collectHints([], singleNodeApiError500);
    const dangerHints = hints.filter((h) => h.severity === 'danger');
    expect(dangerHints).toHaveLength(0);
  });
});
