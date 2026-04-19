/**
 * Guardrail evaluation outcomes — decisions, actions, and evidence for validation request gating.
 */

import type { NodeIdentity } from './identity.js';
import type { ValidationTarget, ValidationLayer } from './target.js';

/** Base fields shared by all guardrail decisions. */
export interface GuardrailDecisionBase {
  /** Human/agent-readable explanation of why this action was taken. */
  explanation: string;
  /** Concrete evidence supporting the decision. */
  evidence: GuardrailEvidence;
  /** Whether the agent can override with a force flag. */
  overridable: boolean;
}

/**
 * Discriminated union of all possible guardrail decisions.
 *
 * Discriminant field is `action`. Variants with additional fields
 * carry only the data required for that action.
 */
export type GuardrailDecision =
  | (GuardrailDecisionBase & { action: 'proceed' })
  | (GuardrailDecisionBase & { action: 'warn' })
  | (GuardrailDecisionBase & { action: 'narrow'; narrowedTarget: ValidationTarget })
  | (GuardrailDecisionBase & { action: 'redirect'; redirectedLayer: ValidationLayer })
  | (GuardrailDecisionBase & { action: 'refuse' });

/** Derived union of all valid guardrail action discriminants. */
export type GuardrailAction = GuardrailDecision['action'];

/** Concrete evidence used to support a guardrail decision. */
export interface GuardrailEvidence {
  /** Nodes in the requested target that changed. */
  changedNodes: NodeIdentity[];
  /** Nodes still trusted from prior validation. */
  trustedNodes: NodeIdentity[];
  /** Timestamp of the last successful validation, or null if none recorded. */
  lastValidatedAt: string | null;
  /** Whether fixture or pin-data changed since last validation. */
  fixtureChanged: boolean;
}
