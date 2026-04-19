/**
 * Status determination — resolves the single top-level `status` field
 * that agents branch on in the diagnostic summary.
 */

import type { StaticFinding } from '../static-analysis/types.js';
import type { DiagnosticSummary } from '../types/diagnostic.js';
import type { GuardrailDecision } from '../types/guardrail.js';
import type { ExecutionData } from './types.js';

/**
 * Determine the overall validation status from combined evidence.
 *
 * Evaluates conditions in priority order (first match wins):
 * 1. Any guardrail `refuse` → `skipped`
 * 2. No error-severity findings and no node errors → `pass`
 * 3. At least one error-severity finding or node error → `fail`
 * 4. Infrastructure failure (execution-level error with no node errors) → `error`
 */
export function determineStatus(
  staticFindings: StaticFinding[],
  executionData: ExecutionData | null,
  guardrailDecisions: GuardrailDecision[],
): DiagnosticSummary['status'] {
  if (guardrailDecisions.some((d) => d.action === 'refuse')) {
    return 'skipped';
  }

  const hasStaticErrors = staticFindings.some(
    (f) => f.severity === 'error' && f.kind !== 'opaque-boundary',
  );

  const hasNodeErrors = executionData !== null && hasNodeLevelErrors(executionData);

  if (hasStaticErrors || hasNodeErrors) {
    return 'fail';
  }

  const hasInfrastructureError =
    executionData !== null && executionData.error !== null && !hasNodeErrors;

  if (hasInfrastructureError) {
    return 'error';
  }

  return 'pass';
}

function hasNodeLevelErrors(data: ExecutionData): boolean {
  for (const [, nodeResults] of data.nodeResults) {
    const result = nodeResults[nodeResults.length - 1];
    if (result && result.error !== null) return true;
  }
  return false;
}
