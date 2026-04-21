/**
 * Tests for CLI output formatting functions.
 */

import { describe, it, expect } from 'vitest';
import {
  formatDiagnosticSummary,
  formatTrustStatus,
  formatGuardrailExplanation,
  formatMcpError,
} from '../../src/cli/format.js';
import type { DiagnosticSummary, ResolvedTarget, ValidationMeta } from '../../src/types/diagnostic.js';
import type { TrustStatusReport } from '../../src/types/surface.js';
import type { GuardrailExplanation } from '../../src/types/surface.js';
import type { McpError } from '../../src/errors.js';
import type { NodeIdentity } from '../../src/types/identity.js';

// ── Fixtures ──────────────────────────────────────────────────────

function makeMeta(): ValidationMeta {
  return {
    runId: 'run-1',
    executionId: null,
    timestamp: '2026-01-01T00:00:00Z',
    durationMs: 42,
  };
}

function makeTarget(): ResolvedTarget {
  return { description: 'changed nodes', nodes: ['nodeA' as NodeIdentity], automatic: true };
}

function makeSummary(status: DiagnosticSummary['status']): DiagnosticSummary {
  return {
    schemaVersion: 1,
    status,
    target: makeTarget(),
    evidenceBasis: 'static',
    executedPath: null,
    errors: [],
    nodeAnnotations: [],
    guardrailActions: [],
    hints: [],
    capabilities: { staticAnalysis: true, mcpTools: false },
    meta: makeMeta(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('formatDiagnosticSummary', () => {
  it('includes status for pass', () => {
    const output = formatDiagnosticSummary(makeSummary('pass'));
    expect(output).toContain('PASS');
    expect(output).toContain('static');
    expect(output).toContain('run-1');
  });

  it('includes status for fail', () => {
    const output = formatDiagnosticSummary(makeSummary('fail'));
    expect(output).toContain('FAIL');
  });

  it('includes status for error', () => {
    const output = formatDiagnosticSummary(makeSummary('error'));
    expect(output).toContain('ERROR');
  });

  it('includes status for skipped', () => {
    const output = formatDiagnosticSummary(makeSummary('skipped'));
    expect(output).toContain('SKIPPED');
  });

  it('formats errors when present', () => {
    const summary = makeSummary('fail');
    summary.errors = [{
      classification: 'wiring',
      type: 'NodeApiError',
      message: 'Missing input',
      description: null,
      node: 'nodeA' as NodeIdentity,
      context: {},
    }];
    const output = formatDiagnosticSummary(summary);
    expect(output).toContain('wiring');
    expect(output).toContain('Missing input');
    expect(output).toContain('nodeA');
  });

  it('formats guardrail actions when present', () => {
    const summary = makeSummary('pass');
    summary.guardrailActions = [{
      action: 'warn',
      explanation: 'Broad target detected',
      evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
      overridable: true,
    }];
    const output = formatDiagnosticSummary(summary);
    expect(output).toContain('warn');
    expect(output).toContain('Broad target detected');
  });
});

describe('formatTrustStatus', () => {
  it('formats mixed trusted/untrusted nodes', () => {
    const report: TrustStatusReport = {
      workflowId: 'wf-1',
      totalNodes: 3,
      trustedNodes: [{
        name: 'trigger' as NodeIdentity,
        validatedAt: '2026-01-01T00:00:00Z',
        validatedWith: 'static',
        contentUnchanged: true,
      }],
      untrustedNodes: [{
        name: 'httpReq' as NodeIdentity,
        reason: 'no prior validation',
      }, {
        name: 'setNode' as NodeIdentity,
        reason: 'content changed since last validation',
      }],
      changedSinceLastValidation: ['httpReq' as NodeIdentity],
    };
    const output = formatTrustStatus(report);
    expect(output).toContain('wf-1');
    expect(output).toContain('3 nodes');
    expect(output).toContain('trigger');
    expect(output).toContain('httpReq');
    expect(output).toContain('no prior validation');
    expect(output).toContain('content changed');
  });
});

describe('formatGuardrailExplanation', () => {
  it('formats proceed decision', () => {
    const explanation: GuardrailExplanation = {
      guardrailDecision: {
        action: 'proceed',
        explanation: 'All good',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: false,
      },
      targetResolution: { resolvedNodes: ['nodeA' as NodeIdentity], selectedPath: [], automatic: true },
      capabilities: { staticAnalysis: true, mcpTools: false },
    };
    const output = formatGuardrailExplanation(explanation);
    expect(output).toContain('PROCEED');
    expect(output).toContain('All good');
    expect(output).toContain('auto-resolved');
  });

  it('formats warn decision with override hint', () => {
    const explanation: GuardrailExplanation = {
      guardrailDecision: {
        action: 'warn',
        explanation: 'Broad target',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: true,
      },
      targetResolution: { resolvedNodes: [], selectedPath: [], automatic: false },
      capabilities: { staticAnalysis: true, mcpTools: false },
    };
    const output = formatGuardrailExplanation(explanation);
    expect(output).toContain('WARN');
    expect(output).toContain('--force');
  });

  it('formats narrow decision', () => {
    const explanation: GuardrailExplanation = {
      guardrailDecision: {
        action: 'narrow',
        explanation: 'Narrowing target',
        evidence: { changedNodes: [], trustedNodes: [], lastValidatedAt: null, fixtureChanged: false },
        overridable: false,
        narrowedTarget: { kind: 'nodes', nodes: ['a' as NodeIdentity] },
      },
      targetResolution: { resolvedNodes: ['a' as NodeIdentity, 'b' as NodeIdentity], selectedPath: [], automatic: true },
      capabilities: { staticAnalysis: true, mcpTools: false },
    };
    const output = formatGuardrailExplanation(explanation);
    expect(output).toContain('NARROW');
  });
});

describe('formatMcpError', () => {
  it('formats workflow_not_found', () => {
    const error: McpError = { type: 'workflow_not_found', message: 'File not found' };
    const output = formatMcpError(error);
    expect(output).toContain('workflow_not_found');
    expect(output).toContain('File not found');
  });

  it('formats parse_error', () => {
    const error: McpError = { type: 'parse_error', message: 'Bad JSON' };
    const output = formatMcpError(error);
    expect(output).toContain('parse_error');
  });

  it('formats internal_error', () => {
    const error: McpError = { type: 'internal_error', message: 'Unexpected' };
    const output = formatMcpError(error);
    expect(output).toContain('internal_error');
  });
});
