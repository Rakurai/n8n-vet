/**
 * Typed assertion helpers for integration test scenarios.
 *
 * Each function throws with a descriptive message on failure.
 * Operates on n8n-vet's DiagnosticSummary and TrustStatusReport types.
 */

import type { DiagnosticSummary, ErrorClassification } from '../../../src/types/diagnostic.js';
import type { GuardrailAction } from '../../../src/types/guardrail.js';
import type { TrustStatusReport } from '../../../src/types/surface.js';

export function assertStatus(
  summary: DiagnosticSummary,
  expected: 'pass' | 'fail' | 'error' | 'skipped',
  fixture?: string,
): void {
  if (summary.status !== expected) {
    const ctx = fixture ? ` [fixture: ${fixture}]` : '';
    throw new Error(
      `Expected status '${expected}', got '${summary.status}'${ctx}`,
    );
  }
}

export function assertFindingPresent(
  summary: DiagnosticSummary,
  classification: ErrorClassification,
  fixture?: string,
): void {
  const match = summary.errors.find(e => e.classification === classification);
  if (!match) {
    const found = summary.errors.map(e => e.classification).join(', ') || 'none';
    const ctx = fixture ? ` [fixture: ${fixture}]` : '';
    throw new Error(
      `Expected finding with classification '${classification}', found: [${found}]${ctx}`,
    );
  }
}

export function assertNoFindings(summary: DiagnosticSummary, fixture?: string): void {
  if (summary.errors.length > 0) {
    const found = summary.errors.map(e => `${e.classification}: ${e.message}`).join('; ');
    const ctx = fixture ? ` [fixture: ${fixture}]` : '';
    throw new Error(`Expected no findings, but got ${summary.errors.length}: ${found}${ctx}`);
  }
}

export function assertTrusted(status: TrustStatusReport, nodeName: string, fixture?: string): void {
  const match = status.trustedNodes.find(n => n.name === nodeName);
  if (!match) {
    const trusted = status.trustedNodes.map(n => n.name).join(', ') || 'none';
    const ctx = fixture ? ` [fixture: ${fixture}]` : '';
    throw new Error(
      `Expected node '${nodeName}' to be trusted. Trusted nodes: [${trusted}]${ctx}`,
    );
  }
}

export function assertUntrusted(status: TrustStatusReport, nodeName: string, fixture?: string): void {
  const match = status.untrustedNodes.find(n => n.name === nodeName);
  if (!match) {
    const untrusted = status.untrustedNodes.map(n => n.name).join(', ') || 'none';
    const ctx = fixture ? ` [fixture: ${fixture}]` : '';
    throw new Error(
      `Expected node '${nodeName}' to be untrusted. Untrusted nodes: [${untrusted}]${ctx}`,
    );
  }
}

export function assertGuardrailAction(
  summary: DiagnosticSummary,
  kind: GuardrailAction,
  fixture?: string,
): void {
  const match = summary.guardrailActions.find(d => d.action === kind);
  if (!match) {
    const found = summary.guardrailActions.map(d => d.action).join(', ') || 'none';
    const ctx = fixture ? ` [fixture: ${fixture}]` : '';
    throw new Error(
      `Expected guardrail action '${kind}', found: [${found}]${ctx}`,
    );
  }
}
