/**
 * Hint collection for the diagnostics subsystem.
 *
 * Converts warning-severity static findings and execution runtime hints
 * into unified DiagnosticHint entries for the final summary.
 */

import type { DiagnosticHint } from '../types/diagnostic.js';
import type { StaticFinding } from '../static-analysis/types.js';
import type { ExecutionData } from './types.js';

/**
 * Collect hints from all evidence layers.
 *
 * Sources:
 * - Static findings with severity 'warning' → DiagnosticHint with severity 'warning'
 * - Execution runtime hints → DiagnosticHint with severity 'info'
 * - When executionData is null → single info hint noting execution may catch additional issues
 */
export function collectHints(
  staticFindings: StaticFinding[],
  executionData: ExecutionData | null,
): DiagnosticHint[] {
  const hints: DiagnosticHint[] = [];

  collectStaticWarningHints(staticFindings, hints);

  if (executionData !== null) {
    collectExecutionHints(executionData, hints);
  } else {
    hints.push(staticOnlyRunHint());
  }

  return hints;
}

function collectStaticWarningHints(
  findings: StaticFinding[],
  out: DiagnosticHint[],
): void {
  for (const finding of findings) {
    if (finding.severity === 'warning') {
      out.push({
        node: finding.node,
        message: finding.message,
        severity: 'warning',
      });
    }
  }
}

function collectExecutionHints(
  data: ExecutionData,
  out: DiagnosticHint[],
): void {
  for (const [node, result] of data.nodeResults) {
    for (const hint of result.hints) {
      out.push({
        node,
        message: hint.message,
        severity: 'info',
      });
    }

    if (result.executionTimeMs === 0 && result.error !== null) {
      out.push({
        node,
        message: `Execution data for node "${node}" was redacted — error classification may be incomplete`,
        severity: 'danger',
      });
    }
  }
}

function staticOnlyRunHint(): DiagnosticHint {
  return {
    node: null,
    message: 'Static analysis only — execution may catch additional issues not visible to static checks.',
    severity: 'info',
  };
}
