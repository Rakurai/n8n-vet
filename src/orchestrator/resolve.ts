/**
 * Target resolution — converts an AgentTarget into a ResolvedTarget with a
 * concrete SliceDefinition for scoped validation.
 *
 * Three resolution strategies:
 * - `nodes`: verify existence, forward/backward propagate to build slice
 * - `changed`: RTS/TIA heuristic from change set or approximate detection
 * - `workflow`: all nodes in the graph
 */

import type { ResolvedTarget } from '../types/diagnostic.js';
import type { WorkflowGraph } from '../types/graph.js';
import type { NodeIdentity } from '../types/identity.js';
import type { SliceDefinition } from '../types/slice.js';
import type { AgentTarget } from '../types/target.js';
import type { NodeChangeSet, TrustState } from '../types/trust.js';

/** Result of target resolution — either success with target+slice, or error data. */
export type ResolveResult =
  | { ok: true; target: ResolvedTarget; slice: SliceDefinition }
  | { ok: false; errorMessage: string };

/**
 * Resolve an agent target to concrete nodes and a slice definition.
 *
 * Returns error data (not throws) for missing nodes, empty lists, and
 * empty change sets — the caller wraps these into status:'error' diagnostics.
 */
export function resolveTarget(
  target: AgentTarget,
  graph: WorkflowGraph,
  changeSet: NodeChangeSet | null,
  trustState: TrustState,
): ResolveResult {
  switch (target.kind) {
    case 'nodes':
      return resolveNodes(target.nodes, graph);
    case 'changed':
      return resolveChanged(graph, changeSet, trustState);
    case 'workflow':
      return resolveWorkflow(graph);
  }
}

// ── nodes ─────────────────────────────────────────────────────────

function resolveNodes(
  names: NodeIdentity[],
  graph: WorkflowGraph,
): ResolveResult {
  if (names.length === 0) {
    return { ok: false, errorMessage: 'Empty nodes list in validation target' };
  }

  const missing: string[] = [];
  for (const name of names) {
    if (!graph.nodes.has(name as string)) {
      missing.push(name as string);
    }
  }

  if (missing.length > 0) {
    return { ok: false, errorMessage: `Nodes not found in workflow: ${missing.join(', ')}` };
  }

  const seedNodes = new Set(names);
  const sliceNodes = new Set(names);

  // Forward-propagate to exits
  const exitPoints: NodeIdentity[] = [];
  for (const name of names) {
    propagateForward(name as string, graph, sliceNodes, exitPoints);
  }

  // Backward-walk to entry points (triggers or graph roots)
  const entryPoints: NodeIdentity[] = [];
  for (const name of names) {
    propagateBackward(name as string, graph, sliceNodes, entryPoints);
  }

  // Deduplicate entry/exit
  const uniqueEntries = [...new Set(entryPoints)];
  const uniqueExits = [...new Set(exitPoints)];

  return {
    ok: true,
    target: {
      description: `Named nodes: ${names.map(String).join(', ')}`,
      nodes: [...sliceNodes],
      automatic: false,
    },
    slice: {
      nodes: sliceNodes,
      seedNodes,
      entryPoints: uniqueEntries,
      exitPoints: uniqueExits,
    },
  };
}

// ── changed ───────────────────────────────────────────────────────

function resolveChanged(
  graph: WorkflowGraph,
  changeSet: NodeChangeSet | null,
  trustState: TrustState,
): ResolveResult {
  let seedNames: NodeIdentity[];

  if (changeSet !== null) {
    // Precise detection from snapshot diff
    seedNames = [
      ...changeSet.added,
      ...changeSet.modified.map((m) => m.node),
    ];
  } else {
    // Approximate detection from trust state content hashes
    seedNames = approximateChanges(graph, trustState);
  }

  if (seedNames.length === 0) {
    // No changes detected — pass to guardrails which will refuse
    return {
      ok: true,
      target: {
        description: 'No changes detected',
        nodes: [],
        automatic: true,
      },
      slice: {
        nodes: new Set(),
        seedNodes: new Set(),
        entryPoints: [],
        exitPoints: [],
      },
    };
  }

  const seedNodes = new Set(seedNames);
  const sliceNodes = new Set(seedNames);

  const exitPoints: NodeIdentity[] = [];
  for (const name of seedNames) {
    propagateForward(name as string, graph, sliceNodes, exitPoints, trustState);
  }

  const entryPoints: NodeIdentity[] = [];
  for (const name of seedNames) {
    propagateBackward(name as string, graph, sliceNodes, entryPoints, trustState);
  }

  const uniqueEntries = [...new Set(entryPoints)];
  const uniqueExits = [...new Set(exitPoints)];

  return {
    ok: true,
    target: {
      description: `Changed nodes: ${seedNames.map(String).join(', ')}`,
      nodes: [...sliceNodes],
      automatic: true,
    },
    slice: {
      nodes: sliceNodes,
      seedNodes,
      entryPoints: uniqueEntries,
      exitPoints: uniqueExits,
    },
  };
}

/**
 * Approximate change detection when no prior snapshot is available.
 * Compare graph nodes against trust state content hashes.
 * Nodes not in trust state, or with different hashes, are considered changed.
 */
function approximateChanges(
  graph: WorkflowGraph,
  trustState: TrustState,
): NodeIdentity[] {
  if (trustState.nodes.size === 0) {
    // No trust at all — everything is "changed"
    return [...graph.nodes.keys()] as NodeIdentity[];
  }

  const changed: NodeIdentity[] = [];
  for (const [name] of graph.nodes) {
    const nodeId = name as NodeIdentity;
    const trustRecord = trustState.nodes.get(nodeId);
    if (!trustRecord) {
      // New or unknown node
      changed.push(nodeId);
    }
    // Note: without a snapshot we can't recompute content hashes,
    // so we trust the trust state records. Only truly new nodes are flagged.
  }

  return changed;
}

// ── workflow ──────────────────────────────────────────────────────

function resolveWorkflow(graph: WorkflowGraph): ResolveResult {
  const allNodes: NodeIdentity[] = [...graph.nodes.keys()] as NodeIdentity[];

  // Entry points: nodes with no incoming edges (triggers/roots)
  const entryPoints: NodeIdentity[] = [];
  // Exit points: nodes with no outgoing edges (terminals)
  const exitPoints: NodeIdentity[] = [];

  for (const name of allNodes) {
    const incoming = graph.backward.get(name as string);
    if (!incoming || incoming.length === 0) {
      entryPoints.push(name);
    }
    const outgoing = graph.forward.get(name as string);
    if (!outgoing || outgoing.length === 0) {
      exitPoints.push(name);
    }
  }

  return {
    ok: true,
    target: {
      description: 'Entire workflow',
      nodes: allNodes,
      automatic: false,
    },
    slice: {
      nodes: new Set(allNodes),
      seedNodes: new Set(allNodes),
      entryPoints,
      exitPoints,
    },
  };
}

// ── graph traversal helpers ───────────────────────────────────────

/** Forward-propagate from a node through graph.forward until exit or trusted boundary. */
function propagateForward(
  startName: string,
  graph: WorkflowGraph,
  sliceNodes: Set<NodeIdentity>,
  exitPoints: NodeIdentity[],
  trustState?: TrustState,
): void {
  const visited = new Set<string>();
  const stack = [startName];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const edges = graph.forward.get(current);
    if (!edges || edges.length === 0) {
      exitPoints.push(current as NodeIdentity);
      continue;
    }

    for (const edge of edges) {
      const downstream = edge.to;
      // Stop at trusted boundaries (for change-driven slicing)
      if (trustState && isTrusted(downstream as NodeIdentity, trustState)) {
        exitPoints.push(downstream as NodeIdentity);
        sliceNodes.add(downstream as NodeIdentity);
        continue;
      }
      sliceNodes.add(downstream as NodeIdentity);
      stack.push(downstream);
    }
  }
}

/** Backward-walk from a node through graph.backward to triggers or trusted boundaries. */
function propagateBackward(
  startName: string,
  graph: WorkflowGraph,
  sliceNodes: Set<NodeIdentity>,
  entryPoints: NodeIdentity[],
  trustState?: TrustState,
): void {
  const visited = new Set<string>();
  const stack = [startName];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const edges = graph.backward.get(current);
    if (!edges || edges.length === 0) {
      entryPoints.push(current as NodeIdentity);
      continue;
    }

    for (const edge of edges) {
      const upstream = edge.from;
      // Stop at trusted boundaries
      if (trustState && isTrusted(upstream as NodeIdentity, trustState)) {
        entryPoints.push(upstream as NodeIdentity);
        sliceNodes.add(upstream as NodeIdentity);
        continue;
      }
      sliceNodes.add(upstream as NodeIdentity);
      stack.push(upstream);
    }
  }
}

function isTrusted(nodeId: NodeIdentity, trustState: TrustState): boolean {
  return trustState.nodes.has(nodeId);
}
