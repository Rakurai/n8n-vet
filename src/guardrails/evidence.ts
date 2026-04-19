/**
 * Evidence assembly — populates GuardrailEvidence for every guardrail decision.
 *
 * Evidence is always fully populated; no fields are null or undefined
 * (except lastValidatedAt which is null when no nodes are trusted).
 */

import { isTrusted } from '../trust/trust.js';
import type { GuardrailEvidence } from '../types/guardrail.js';
import type { NodeIdentity } from '../types/identity.js';
import type { ChangeKind } from '../types/trust.js';
import type { EvaluationInput } from './types.js';

const TRUST_PRESERVING: ReadonlySet<ChangeKind> = new Set(['position-only', 'metadata-only']);

/**
 * Assemble evidence for a guardrail decision from the evaluation input.
 *
 * Identifies which target nodes changed (trust-breaking), which are still
 * trusted, the most recent validation timestamp, and whether fixtures changed.
 */
export function assembleEvidence(input: EvaluationInput): GuardrailEvidence {
  const { targetNodes, changeSet, trustState, currentHashes, fixtureHash } = input;

  const changedNodes: NodeIdentity[] = [];
  for (const node of changeSet.added) {
    if (targetNodes.has(node)) {
      changedNodes.push(node);
    }
  }
  for (const node of changeSet.removed) {
    if (targetNodes.has(node)) {
      changedNodes.push(node);
    }
  }
  for (const mod of changeSet.modified) {
    if (!targetNodes.has(mod.node)) continue;
    const isTrustPreserving = mod.changes.every((c) => TRUST_PRESERVING.has(c));
    if (!isTrustPreserving) {
      changedNodes.push(mod.node);
    }
  }

  const trustedNodes: NodeIdentity[] = [];
  let lastValidatedAt: string | null = null;
  let fixtureChanged = false;

  for (const nodeId of targetNodes) {
    const hash = currentHashes.get(nodeId);
    if (hash && isTrusted(trustState, nodeId, hash)) {
      trustedNodes.push(nodeId);

      const record = trustState.nodes.get(nodeId);
      if (record) {
        if (lastValidatedAt === null || record.validatedAt > lastValidatedAt) {
          lastValidatedAt = record.validatedAt;
        }
        if (!fixtureChanged && record.fixtureHash !== null && record.fixtureHash !== fixtureHash) {
          fixtureChanged = true;
        }
      }
    }
  }

  return {
    changedNodes,
    trustedNodes,
    lastValidatedAt,
    fixtureChanged,
  };
}
