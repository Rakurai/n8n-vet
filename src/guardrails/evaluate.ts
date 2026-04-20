/**
 * Guardrail evaluation pipeline — the main entry point for guardrail decisions.
 *
 * Runs a fixed two-tier evaluation: precondition checks followed by guardrail
 * actions. First non-proceed action wins. Every decision includes fully
 * populated GuardrailEvidence.
 *
 * Evaluation order (STRATEGY.md guardrail action order):
 *   1. Force bypass
 *   2. Empty target → refuse (precondition)
 *   3. Test-refusal: tool='test' with no escalation triggers → refuse
 *   4. Narrow broad scope
 *   5. DeFlaker warn
 *   6. Broad-target warn
 *   7. Identical rerun → refuse (overridable)
 *   8. Proceed
 */

import { getRerunAssessment } from '../trust/trust.js';
import type { GuardrailDecision } from '../types/guardrail.js';
import { assembleEvidence } from './evidence.js';
import { computeNarrowedTarget } from './narrow.js';
import { assessEscalationTriggers } from './redirect.js';
import { checkDeFlaker, extractPriorRunContext } from './rerun.js';
import type { EvaluationInput } from './types.js';
import { BROAD_TARGET_WARN_RATIO } from './types.js';

/**
 * Evaluate a validation request and return a guardrail decision.
 *
 * Pure synchronous function — no side effects, no I/O.
 */
export function evaluate(input: EvaluationInput): GuardrailDecision {
  const evidence = assembleEvidence(input);

  // Step 1: Force bypass
  if (input.force) {
    return {
      action: 'proceed',
      explanation: 'Force flag set — bypassing all guardrails.',
      evidence,
      overridable: true,
    };
  }

  // Step 2: Empty target (precondition)
  // With B2 fix, this only fires when all nodes are trusted AND unchanged.
  // Still overridable — the user may want to force re-validation.
  if (input.targetNodes.size === 0) {
    const totalNodes = input.graph.nodes.size;
    const trustedCount = input.trustState.nodes.size;
    const untrustedCount = totalNodes - trustedCount;

    let explanation = 'No changes detected — nothing to validate.';
    if (untrustedCount > 0) {
      explanation += ` ${untrustedCount} untrusted node(s) exist — use kind:'nodes' or kind:'workflow' to target them.`;
    } else if (trustedCount > 0) {
      explanation += ` All ${trustedCount} node(s) are trusted. Use force:true to re-validate.`;
    }

    return {
      action: 'refuse',
      explanation,
      evidence,
      overridable: true,
    };
  }

  // Step 3: Test-refusal — when tool='test' and no escalation triggers fire, refuse
  if (input.tool === 'test') {
    const escalation = assessEscalationTriggers(input);
    if (!escalation.triggered) {
      return {
        action: 'refuse',
        explanation: 'All changes are structurally analyzable -- use validate instead.',
        evidence,
        overridable: true,
      };
    }
  }

  // Step 4: Narrow broad scope
  const narrowedTarget = computeNarrowedTarget(input, evidence);
  if (narrowedTarget) {
    return {
      action: 'narrow',
      explanation: `Target narrowed from ${input.targetNodes.size} to ${narrowedTarget.kind === 'slice' ? narrowedTarget.slice.nodes.size : '?'} nodes — focusing on the changed region and its dependents.`,
      evidence,
      overridable: true,
      narrowedTarget,
    };
  }

  // Step 5: DeFlaker warn
  const priorContext = extractPriorRunContext(input.priorSummary);
  if (priorContext) {
    const changedSet = new Set(evidence.changedNodes);
    if (checkDeFlaker(priorContext, changedSet)) {
      return {
        action: 'warn',
        explanation:
          'Prior run failed on a path that does not intersect current changes — rerun may be unrelated to your modifications.',
        evidence,
        overridable: true,
      };
    }
  }

  // Step 6: Broad-target warn (suppress on first-ever validation — no prior state to narrow against)
  const isFirstValidation =
    evidence.changedNodes.length === 0 && evidence.trustedNodes.length === 0;
  if (
    !isFirstValidation &&
    input.targetNodes.size / input.graph.nodes.size > BROAD_TARGET_WARN_RATIO
  ) {
    return {
      action: 'warn',
      explanation: `Target covers ${Math.round((input.targetNodes.size / input.graph.nodes.size) * 100)}% of workflow nodes — consider narrowing to the changed region.`,
      evidence,
      overridable: true,
    };
  }

  // Step 7: Identical rerun → refuse
  const rerunAssessment = getRerunAssessment(
    input.trustState,
    [...input.targetNodes],
    input.currentHashes,
    input.fixtureHash,
  );
  if (rerunAssessment.isLowValue) {
    return {
      action: 'refuse',
      explanation: `Identical rerun — ${rerunAssessment.reason}. Use force to override.`,
      evidence,
      overridable: true,
    };
  }

  // Step 8: Proceed — no guardrail triggered
  return {
    action: 'proceed',
    explanation: 'No guardrails triggered — proceeding with validation.',
    evidence,
    overridable: true,
  };
}
