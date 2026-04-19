/**
 * Node annotation assignment for the diagnostics subsystem.
 *
 * Assigns each node in the resolved target exactly one annotation status
 * based on priority order: mocked → validated → trusted → skipped.
 */

import type { NodeAnnotation } from '../types/diagnostic.js';
import type { NodeIdentity } from '../types/identity.js';
import type { ResolvedTarget } from '../types/diagnostic.js';
import type { TrustState } from '../types/trust.js';
import type { ExecutionData, NodeExecutionResult } from './types.js';

/**
 * Assign annotations to every node in the resolved target.
 *
 * Priority order (first match wins):
 * 1. Node has execution data with pinDataSource → 'mocked'
 * 2. Node was actively analyzed/executed in this run → 'validated'
 * 3. Node is in TrustState.nodes and unchanged → 'trusted'
 * 4. Otherwise → 'skipped'
 *
 * Returns exactly one annotation per node in resolvedTarget.nodes.
 */
export function assignAnnotations(
  resolvedTarget: ResolvedTarget,
  trustState: TrustState,
  executionData: ExecutionData | null,
  staticFindings: { node: NodeIdentity }[],
): NodeAnnotation[] {
  const mockedNodes = collectMockedNodes(executionData);
  const executedNodes = collectExecutedNodes(executionData);
  const analyzedNodes = collectAnalyzedNodes(staticFindings);

  return resolvedTarget.nodes.map((node) =>
    annotateNode(node, mockedNodes, executedNodes, analyzedNodes, trustState),
  );
}

function annotateNode(
  node: NodeIdentity,
  mockedNodes: Map<NodeIdentity, NodeExecutionResult>,
  executedNodes: Set<NodeIdentity>,
  analyzedNodes: Set<NodeIdentity>,
  trustState: TrustState,
): NodeAnnotation {
  const mockedResult = mockedNodes.get(node);
  if (mockedResult !== undefined) {
    return {
      node,
      status: 'mocked',
      reason: `Pin data provided from ${mockedResult.pinDataSource!}`,
    };
  }

  if (executedNodes.has(node) || analyzedNodes.has(node)) {
    return {
      node,
      status: 'validated',
      reason: 'Changed since last validation',
    };
  }

  if (trustState.nodes.has(node)) {
    const record = trustState.nodes.get(node)!;
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

/** Collect nodes that have execution data with a pinDataSource set. */
function collectMockedNodes(executionData: ExecutionData | null): Map<NodeIdentity, NodeExecutionResult> {
  const nodes = new Map<NodeIdentity, NodeExecutionResult>();
  if (executionData === null) return nodes;

  for (const [node, result] of executionData.nodeResults) {
    if (result.pinDataSource !== undefined) {
      nodes.set(node, result);
    }
  }
  return nodes;
}

function collectExecutedNodes(executionData: ExecutionData | null): Set<NodeIdentity> {
  const nodes = new Set<NodeIdentity>();
  if (executionData === null) return nodes;

  for (const [node, result] of executionData.nodeResults) {
    if (result.pinDataSource === undefined) {
      nodes.add(node);
    }
  }
  return nodes;
}

function collectAnalyzedNodes(
  staticFindings: { node: NodeIdentity }[],
): Set<NodeIdentity> {
  const nodes = new Set<NodeIdentity>();
  for (const finding of staticFindings) {
    nodes.add(finding.node);
  }
  return nodes;
}
