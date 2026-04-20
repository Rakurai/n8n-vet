/**
 * Human-readable output formatting for CLI commands.
 *
 * Uses direct ANSI escape codes for color (Node 20 compatible).
 * Each formatter takes a typed result and returns a printable string.
 */

import type { McpError } from '../errors.js';
import type { DiagnosticSummary } from '../types/diagnostic.js';
import type { TrustStatusReport } from '../types/surface.js';
import type { GuardrailExplanation } from '../types/surface.js';

// ── ANSI helpers ────────────────────────────────────────────────

/** Detect whether color should be suppressed (NO_COLOR env or non-TTY stdout). */
const NO_COLOR = 'NO_COLOR' in process.env || !process.stdout.isTTY;

const RESET = NO_COLOR ? '' : '\x1b[0m';
const BOLD = NO_COLOR ? '' : '\x1b[1m';
const DIM = NO_COLOR ? '' : '\x1b[2m';
const RED = NO_COLOR ? '' : '\x1b[31m';
const GREEN = NO_COLOR ? '' : '\x1b[32m';
const YELLOW = NO_COLOR ? '' : '\x1b[33m';
const CYAN = NO_COLOR ? '' : '\x1b[36m';

function statusColor(status: string): string {
  switch (status) {
    case 'pass':
      return GREEN;
    case 'fail':
    case 'error':
      return RED;
    case 'skipped':
      return YELLOW;
    default:
      return '';
  }
}

// ── DiagnosticSummary ───────────────────────────────────────────

export function formatDiagnosticSummary(summary: DiagnosticSummary): string {
  const lines: string[] = [];
  const color = statusColor(summary.status);

  lines.push(`${BOLD}Status:${RESET} ${color}${summary.status.toUpperCase()}${RESET}`);
  lines.push(`${BOLD}Evidence:${RESET} ${summary.evidenceBasis}`);
  lines.push(
    `${BOLD}Target:${RESET} ${summary.target.description} (${summary.target.nodes.length} nodes${summary.target.automatic ? ', auto' : ''})`,
  );

  if (summary.errors.length > 0) {
    lines.push('');
    lines.push(`${BOLD}${RED}Errors (${summary.errors.length}):${RESET}`);
    for (const err of summary.errors) {
      const node = err.node ? ` [${err.node}]` : '';
      lines.push(`  ${RED}${err.classification}${RESET}${node}: ${err.message}`);
    }
  }

  if (summary.nodeAnnotations.length > 0) {
    lines.push('');
    lines.push(`${BOLD}Nodes:${RESET}`);
    for (const ann of summary.nodeAnnotations) {
      lines.push(`  ${ann.node}: ${ann.status} — ${ann.reason}`);
    }
  }

  if (summary.guardrailActions.length > 0) {
    lines.push('');
    lines.push(`${BOLD}Guardrails:${RESET}`);
    for (const g of summary.guardrailActions) {
      lines.push(`  ${CYAN}${g.action}${RESET}: ${g.explanation}`);
    }
  }

  if (summary.hints.length > 0) {
    lines.push('');
    lines.push(`${BOLD}Hints:${RESET}`);
    for (const h of summary.hints) {
      const sev = h.severity === 'danger' ? RED : h.severity === 'warning' ? YELLOW : DIM;
      const node = h.node ? `[${h.node}] ` : '';
      lines.push(`  ${sev}${node}${h.message}${RESET}`);
    }
  }

  lines.push('');
  lines.push(`${DIM}run=${summary.meta.runId} duration=${summary.meta.durationMs}ms${RESET}`);

  return lines.join('\n');
}

// ── TrustStatusReport ───────────────────────────────────────────

export function formatTrustStatus(report: TrustStatusReport): string {
  const lines: string[] = [];

  lines.push(`${BOLD}Workflow:${RESET} ${report.workflowId} (${report.totalNodes} nodes)`);

  if (report.trustedNodes.length > 0) {
    lines.push('');
    lines.push(`${BOLD}${GREEN}Trusted (${report.trustedNodes.length}):${RESET}`);
    for (const n of report.trustedNodes) {
      const unchanged = n.contentUnchanged ? '' : ` ${YELLOW}(content changed)${RESET}`;
      lines.push(
        `  ${GREEN}✓${RESET} ${n.name} — ${n.validatedWith} at ${n.validatedAt}${unchanged}`,
      );
    }
  }

  if (report.untrustedNodes.length > 0) {
    lines.push('');
    lines.push(`${BOLD}${RED}Untrusted (${report.untrustedNodes.length}):${RESET}`);
    for (const n of report.untrustedNodes) {
      lines.push(`  ${RED}✗${RESET} ${n.name} — ${n.reason}`);
    }
  }

  if (report.changedSinceLastValidation.length > 0) {
    lines.push('');
    lines.push(
      `${BOLD}Changed since last validation:${RESET} ${report.changedSinceLastValidation.join(', ')}`,
    );
  }

  return lines.join('\n');
}

// ── GuardrailExplanation ────────────────────────────────────────

export function formatGuardrailExplanation(explanation: GuardrailExplanation): string {
  const lines: string[] = [];
  const d = explanation.guardrailDecision;

  const actionColor = d.action === 'proceed' ? GREEN : d.action === 'refuse' ? RED : YELLOW;
  lines.push(`${BOLD}Decision:${RESET} ${actionColor}${d.action.toUpperCase()}${RESET}`);
  lines.push(`${BOLD}Explanation:${RESET} ${d.explanation}`);

  if (d.overridable) {
    lines.push(`${DIM}(overridable with --force)${RESET}`);
  }

  const tr = explanation.targetResolution;
  lines.push('');
  lines.push(
    `${BOLD}Target:${RESET} ${tr.resolvedNodes.length} nodes${tr.automatic ? ' (auto-resolved)' : ''}`,
  );
  if (tr.resolvedNodes.length > 0) {
    lines.push(`  ${tr.resolvedNodes.join(', ')}`);
  }

  const cap = explanation.capabilities;
  lines.push('');
  lines.push(`${BOLD}Capabilities:${RESET} static=${cap.staticAnalysis} mcp=${cap.mcpTools}`);

  return lines.join('\n');
}

// ── McpError ────────────────────────────────────────────────────

export function formatMcpError(error: McpError): string {
  return `${RED}${BOLD}Error${RESET} ${RED}[${error.type}]:${RESET} ${error.message}`;
}
