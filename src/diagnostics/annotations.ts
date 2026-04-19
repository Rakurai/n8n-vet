/**
 * Node annotation assignment for the diagnostics subsystem.
 *
 * Assigns each node in the resolved target exactly one annotation status
 * based on priority order: mocked → validated → trusted → skipped.
 */

import type { NodeAnnotation } from '../types/diagnostic.js';
import type { ResolvedTarget } from '../types/diagnostic.js';
import type { NodeIdentity } from '../types/identity.js';
import type { TrustState } from '../types/trust.js';
import type { ExecutionData } from './types.js';

/**
 * Assign annotations to every node in the resolved target.
 *
 * Priority order (first match wins):
 * 1. Node was actively analyzed/executed in this run → 'validated'
 * 2. Node is in TrustState.nodes and unchanged → 'trusted'
 * 3. Otherwise → 'skipped'
 *
 * Returns exactly one annotation per node in resolvedTarget.nodes.
 */
export function assignAnnotations(
  resolvedTarget: ResolvedTarget,
  trustState: TrustState,
  executionData: ExecutionData | null,
  staticFindings: { node: NodeIdentity }[],
): NodeAnnotation[] {
  const executedNodes = collectExecutedNodes(executionData);
  const analyzedNodes = collectAnalyzedNodes(staticFindings);

  return resolvedTarget.nodes.map((node) =>
    annotateNode(node, executedNodes, analyzedNodes, trustState),
  );
}

function annotateNode(
  node: NodeIdentity,
  executedNodes: Set<NodeIdentity>,
  analyzedNodes: Set<NodeIdentity>,
  trustState: TrustState,
): NodeAnnotation {
  if (executedNodes.has(node) || analyzedNodes.has(node)) {
    return {
      node,
      status: 'validated',
      reason: 'Changed since last validation',
    };
  }

  const record = trustState.nodes.get(node);
  if (record) {
    return {
      node,
      status: 'trusted',
      reason: `Unchanged since validation at ${record.validatedAt}`,
    };
  }

  return {
    node,
    status: 'skipped',
    reason: 'Outside validation scope',
  };
}

function collectExecutedNodes(executionData: ExecutionData | null): Set<NodeIdentity> {
  const nodes = new Set<NodeIdentity>();
  if (executionData === null) return nodes;

  for (const [node] of executionData.nodeResults) {
    nodes.add(node);
  }
  return nodes;
}

function collectAnalyzedNodes(staticFindings: { node: NodeIdentity }[]): Set<NodeIdentity> {
  const nodes = new Set<NodeIdentity>();
  for (const finding of staticFindings) {
    nodes.add(finding.node);
  }
  return nodes;
}
