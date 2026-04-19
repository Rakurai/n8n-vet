/**
 * Path selection — enumerate candidate execution paths through a slice and
 * rank them using 4-tier lexicographic preference for deterministic selection.
 *
 * DFS from entry points to exit points with visited-set cycle detection.
 * 20-candidate cap applied early via quick heuristic before full ranking.
 */

import type { WorkflowGraph } from '../types/graph.js';
import type { NodeIdentity } from '../types/identity.js';
import type { PathDefinition, PathEdge, SliceDefinition } from '../types/slice.js';
import type { NodeChangeSet, TrustState } from '../types/trust.js';

const CANDIDATE_CAP = 20;

/**
 * Select execution paths through a slice for validation.
 *
 * 1. Enumerate all paths from entry to exit via DFS (with cycle detection)
 * 2. If >20 candidates, pre-filter with quick heuristic
 * 3. Apply 4-tier lexicographic ranking
 * 4. Return highest-ranked path (single-path mode; multi-path in T017)
 */
export function selectPaths(
  slice: SliceDefinition,
  graph: WorkflowGraph,
  changeSet: NodeChangeSet | null,
  trustState: TrustState,
): PathDefinition[] {
  if (slice.entryPoints.length === 0 || slice.nodes.size === 0) {
    return [];
  }

  // Enumerate all candidate paths
  let candidates = enumeratePaths(slice, graph);

  if (candidates.length === 0) {
    return [];
  }

  // Cap at 20 using quick heuristic
  if (candidates.length > CANDIDATE_CAP) {
    candidates = quickFilter(candidates);
  }

  // Rank with 4-tier lexicographic comparison
  const changedNodes = resolveChangedNodes(changeSet);
  const untrustedBoundaries = resolveUntrustedBoundaries(slice, trustState);

  const ranked = candidates
    .map((path) => ({
      path,
      score: computeScore(path, changedNodes, untrustedBoundaries, graph),
    }))
    .sort((a, b) => compareScores(a.score, b.score));

  // Additional-greedy multi-path selection
  const selected: PathDefinition[] = [];
  const coveredChanged = new Set<string>();
  const coveredBoundaries = new Set<string>();

  for (const { path, score } of ranked) {
    // Count changed/untrusted for this path (for formatReason)
    let pathChanged = 0;
    let pathUntrusted = 0;
    for (const n of path.nodes) {
      if (changedNodes.has(n as string)) pathChanged++;
      if (untrustedBoundaries.has(n as string)) pathUntrusted++;
    }

    if (selected.length === 0) {
      // Always select the first (highest-ranked) path
      path.selectionReason = formatReason(score, pathChanged, pathUntrusted);
      selected.push(path);
      for (const n of path.nodes) {
        if (changedNodes.has(n as string)) coveredChanged.add(n as string);
        if (untrustedBoundaries.has(n as string)) coveredBoundaries.add(n as string);
      }
      continue;
    }

    // Check if this path covers at least 1 new changed node or 1 new untrusted boundary
    let newCoverage = 0;
    for (const n of path.nodes) {
      if (changedNodes.has(n as string) && !coveredChanged.has(n as string)) newCoverage++;
      if (untrustedBoundaries.has(n as string) && !coveredBoundaries.has(n as string))
        newCoverage++;
    }

    if (newCoverage === 0) continue;

    path.selectionReason = `additional: ${formatReason(score, pathChanged, pathUntrusted)}`;
    selected.push(path);

    for (const n of path.nodes) {
      if (changedNodes.has(n as string)) coveredChanged.add(n as string);
      if (untrustedBoundaries.has(n as string)) coveredBoundaries.add(n as string);
    }
  }

  return selected;
}

// ── Path enumeration (DFS) ────────────────────────────────────────

interface PartialPath {
  nodes: NodeIdentity[];
  edges: PathEdge[];
}

function enumeratePaths(slice: SliceDefinition, graph: WorkflowGraph): PathDefinition[] {
  const exitSet = new Set(slice.exitPoints);
  const sliceSet = slice.nodes;
  const results: PathDefinition[] = [];

  for (const entry of slice.entryPoints) {
    dfs(entry, { nodes: [entry], edges: [] }, new Set([entry]), exitSet, sliceSet, graph, results);
  }

  return results;
}

function dfs(
  current: NodeIdentity,
  partial: PartialPath,
  visited: Set<NodeIdentity>,
  exitSet: Set<NodeIdentity>,
  sliceSet: Set<NodeIdentity>,
  graph: WorkflowGraph,
  results: PathDefinition[],
): void {
  // If current is an exit point and path has at least the entry, record it
  if (exitSet.has(current) && partial.nodes.length >= 1) {
    results.push(toPathDefinition(partial));
    // Don't return — exit nodes might also have outgoing edges within the slice
  }

  const edges = graph.forward.get(current);
  if (!edges || edges.length === 0) {
    // Terminal node — if not already recorded as exit, record now
    if (!exitSet.has(current) && partial.nodes.length > 1) {
      results.push(toPathDefinition(partial));
    }
    return;
  }

  // Sort edges for determinism: by output index, then by destination name
  const sortedEdges = [...edges].sort(
    (a, b) => a.fromOutput - b.fromOutput || a.to.localeCompare(b.to),
  );

  for (const edge of sortedEdges) {
    if (!sliceSet.has(edge.to)) continue;
    if (visited.has(edge.to)) continue;

    const pathEdge: PathEdge = {
      from: current,
      fromOutput: edge.fromOutput,
      to: edge.to,
      toInput: edge.toInput,
      isError: edge.isError,
    };

    partial.nodes.push(edge.to);
    partial.edges.push(pathEdge);
    visited.add(edge.to);

    dfs(edge.to, partial, visited, exitSet, sliceSet, graph, results);

    partial.nodes.pop();
    partial.edges.pop();
    visited.delete(edge.to);
  }
}

function toPathDefinition(partial: PartialPath): PathDefinition {
  return {
    nodes: [...partial.nodes],
    edges: [...partial.edges],
    usesErrorOutput: partial.edges.some((e) => e.isError),
    selectionReason: '',
  };
}

// ── Quick heuristic pre-filter ────────────────────────────────────

function quickFilter(candidates: PathDefinition[]): PathDefinition[] {
  return candidates
    .sort((a, b) => {
      // Fewest error outputs first
      const aErrors = a.edges.filter((e) => e.isError).length;
      const bErrors = b.edges.filter((e) => e.isError).length;
      if (aErrors !== bErrors) return aErrors - bErrors;
      // Fewest total nodes
      return a.nodes.length - b.nodes.length;
    })
    .slice(0, CANDIDATE_CAP);
}

// ── STRATEGY.md-aligned scoring ──────────────────────────────────

/** Calibratable scoring weights per STRATEGY.md path ranking factors. */
const WEIGHT_HIGH = 3;
const WEIGHT_MEDIUM = 2;
const WEIGHT_NEGATIVE = -1;

function computeScore(
  path: PathDefinition,
  changedNodes: Set<string>,
  untrustedBoundaries: Set<string>,
  graph: WorkflowGraph,
): number {
  let score = 0;

  for (const node of path.nodes) {
    const id = node as string;
    const graphNode = graph.nodes.get(node);

    // High weight: changed opaque/shape-replacing nodes
    if (
      changedNodes.has(id) &&
      graphNode &&
      (graphNode.classification === 'shape-opaque' ||
        graphNode.classification === 'shape-replacing')
    ) {
      score += WEIGHT_HIGH;
    }

    // High weight: untrusted boundaries
    if (untrustedBoundaries.has(id)) {
      score += WEIGHT_HIGH;
    }

    // Medium weight: changed branching logic (nodes with multiple outgoing edges)
    if (changedNodes.has(id)) {
      const edges = graph.forward.get(node);
      if (edges && edges.length > 1) {
        score += WEIGHT_MEDIUM;
      }
    }

    // Baseline: any changed node covered
    if (changedNodes.has(id)) {
      score += 1;
    }
  }

  // Negative weight: estimated execution cost (path length proxy)
  score += path.nodes.length * WEIGHT_NEGATIVE;

  return score;
}

/** Compare two scores — negative means `a` is better (higher rank). */
function compareScores(a: number, b: number): number {
  return b - a;
}

function formatReason(score: number, changedCount: number, untrustedCount: number): string {
  const parts: string[] = [];
  parts.push(`score ${score}`);
  if (changedCount > 0) parts.push(`covers ${changedCount} changed node(s)`);
  if (untrustedCount > 0) parts.push(`crosses ${untrustedCount} untrusted boundary(ies)`);
  return parts.join(', ');
}

// ── helpers ───────────────────────────────────────────────────────

function resolveChangedNodes(changeSet: NodeChangeSet | null): Set<string> {
  if (!changeSet) return new Set();
  const nodes = new Set<string>();
  for (const id of changeSet.added) nodes.add(id as string);
  for (const mod of changeSet.modified) nodes.add(mod.node as string);
  return nodes;
}

function resolveUntrustedBoundaries(slice: SliceDefinition, trustState: TrustState): Set<string> {
  const untrusted = new Set<string>();
  // Entry and exit points that are not trusted are untrusted boundaries
  for (const entry of slice.entryPoints) {
    if (!trustState.nodes.has(entry)) untrusted.add(entry as string);
  }
  for (const exit of slice.exitPoints) {
    if (!trustState.nodes.has(exit)) untrusted.add(exit as string);
  }
  return untrusted;
}
