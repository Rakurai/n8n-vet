/**
 * Narrowing algorithm — reduces a broad validation target to the smallest
 * useful scope around changed nodes.
 *
 * Seeds from trust-breaking changed nodes, then BFS forward and backward
 * through the graph, stopping at trusted-unchanged nodes or target boundaries.
 * Returns null when narrowing would not reduce the scope.
 */

import { isTrusted } from '../trust/trust.js';
import type { GuardrailEvidence } from '../types/guardrail.js';
import type { NodeIdentity } from '../types/identity.js';
import type { ValidationTarget } from '../types/target.js';
import { assembleEvidence } from './evidence.js';
import type { EvaluationInput } from './types.js';
import { NARROW_MAX_CHANGED_RATIO, NARROW_MIN_TARGET_NODES } from './types.js';

/**
 * Compute a narrowed validation target from the evaluation input.
 *
 * Returns a `ValidationTarget` with `kind: 'slice'` when narrowing is
 * applicable, or null when the precondition fails or narrowing would
 * not reduce scope.
 *
 * Accepts optional pre-computed evidence to avoid redundant recomputation.
 */
export function computeNarrowedTarget(
  input: EvaluationInput,
  precomputedEvidence?: GuardrailEvidence,
): ValidationTarget | null {
  const { targetNodes, graph, trustState, currentHashes } = input;

  const evidence = precomputedEvidence ?? assembleEvidence(input);
  const changedNodes = evidence.changedNodes;

  // Precondition: target must be large enough and changes must be narrow
  if (targetNodes.size <= NARROW_MIN_TARGET_NODES) return null;
  if (changedNodes.length === 0) return null;
  const changedRatio = changedNodes.length / targetNodes.size;
  if (changedRatio >= NARROW_MAX_CHANGED_RATIO) return null;

  const changedSet = new Set<NodeIdentity>(changedNodes);
  const result = new Set<NodeIdentity>(changedNodes);

  // BFS forward from seed through graph.forward
  const forwardQueue: NodeIdentity[] = [...changedNodes];
  const forwardVisited = new Set<NodeIdentity>(changedNodes);

  while (forwardQueue.length > 0) {
    const current = forwardQueue.shift() as NodeIdentity;
    const downstream = graph.forward.get(current) ?? [];
    for (const edge of downstream) {
      const neighbor = edge.to as NodeIdentity;
      if (forwardVisited.has(neighbor)) continue;
      forwardVisited.add(neighbor);

      // Stop at nodes outside target
      if (!targetNodes.has(neighbor)) continue;

      // Stop at trusted-unchanged nodes (they form the boundary)
      const hash = currentHashes.get(neighbor);
      if (hash && isTrusted(trustState, neighbor, hash) && !changedSet.has(neighbor)) continue;

      result.add(neighbor);
      forwardQueue.push(neighbor);
    }
  }

  // BFS backward from seed through graph.backward
  const backwardQueue: NodeIdentity[] = [...changedNodes];
  const backwardVisited = new Set<NodeIdentity>(changedNodes);

  while (backwardQueue.length > 0) {
    const current = backwardQueue.shift() as NodeIdentity;
    const upstream = graph.backward.get(current) ?? [];
    for (const edge of upstream) {
      const neighbor = edge.from as NodeIdentity;
      if (backwardVisited.has(neighbor)) continue;
      backwardVisited.add(neighbor);

      // Stop at nodes outside target
      if (!targetNodes.has(neighbor)) continue;

      // Stop at trigger nodes (no incoming edges)
      const incoming = graph.backward.get(neighbor) ?? [];
      if (incoming.length === 0) {
        result.add(neighbor);
        continue; // don't propagate further from triggers
      }

      // Stop at trusted-unchanged nodes
      const hash = currentHashes.get(neighbor);
      if (hash && isTrusted(trustState, neighbor, hash) && !changedSet.has(neighbor)) continue;

      result.add(neighbor);
      backwardQueue.push(neighbor);
    }
  }

  // No reduction — return null
  if (result.size >= targetNodes.size) return null;

  // Build entry/exit points for the slice
  const entryPoints: NodeIdentity[] = [];
  const exitPoints: NodeIdentity[] = [];

  for (const nodeId of result) {
    const incoming = graph.backward.get(nodeId) ?? [];
    const hasExternalIncoming =
      incoming.length === 0 || incoming.some((e) => !result.has(e.from as NodeIdentity));
    if (hasExternalIncoming) entryPoints.push(nodeId);

    const outgoing = graph.forward.get(nodeId) ?? [];
    const hasExternalOutgoing =
      outgoing.length === 0 || outgoing.some((e) => !result.has(e.to as NodeIdentity));
    if (hasExternalOutgoing) exitPoints.push(nodeId);
  }

  return {
    kind: 'slice',
    slice: {
      nodes: result,
      seedNodes: changedSet,
      entryPoints,
      exitPoints,
    },
  };
}
