/**
 * Path selection — enumerate candidate execution paths through a slice and
 * rank them using 4-tier lexicographic preference for deterministic selection.
 *
 * DFS from entry points to exit points with visited-set cycle detection.
 * 20-candidate cap applied early via quick heuristic before full ranking.
 */

import type { NodeIdentity } from '../types/identity.js';
import type { WorkflowGraph } from '../types/graph.js';
import type { SliceDefinition, PathDefinition, PathEdge } from '../types/slice.js';
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
      score: computeScore(path, changedNodes, untrustedBoundaries),
    }))
    .sort((a, b) => compareScores(a.score, b.score));

  // Additional-greedy multi-path selection
  const selected: PathDefinition[] = [];
  const coveredChanged = new Set<string>();
  const coveredBoundaries = new Set<string>();

  for (const { path, score } of ranked) {
    if (selected.length === 0) {
      // Always select the first (highest-ranked) path
      path.selectionReason = formatReason(score);
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
      if (untrustedBoundaries.has(n as string) && !coveredBoundaries.has(n as string)) newCoverage++;
    }

    if (newCoverage === 0) continue;

    path.selectionReason = `additional: ${formatReason(score)}`;
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
  nodes: string[];
  edges: PathEdge[];
}

function enumeratePaths(
  slice: SliceDefinition,
  graph: WorkflowGraph,
): PathDefinition[] {
  const exitSet = new Set(slice.exitPoints.map(String));
  const sliceSet = new Set([...slice.nodes].map(String));
  const results: PathDefinition[] = [];

  for (const entry of slice.entryPoints) {
    const entryStr = entry as string;
    dfs(
      entryStr,
      { nodes: [entryStr], edges: [] },
      new Set([entryStr]),
      exitSet,
      sliceSet,
      graph,
      results,
    );
  }

  return results;
}

function dfs(
  current: string,
  partial: PartialPath,
  visited: Set<string>,
  exitSet: Set<string>,
  sliceSet: Set<string>,
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
      from: current as NodeIdentity,
      fromOutput: edge.fromOutput,
      to: edge.to as NodeIdentity,
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
    nodes: [...partial.nodes] as NodeIdentity[],
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

// ── 4-tier scoring ────────────────────────────────────────────────

interface PathScore {
  /** Tier 1: true if all edges are non-error (lower index = better) */
  allNonError: boolean;
  /** Tier 2: true if all branching nodes use output 0 */
  allOutputZero: boolean;
  /** Tier 3: count of changed nodes covered (more = better) */
  changedNodesCovered: number;
  /** Tier 4: count of untrusted boundaries crossed (more = better) */
  untrustedBoundariesCrossed: number;
}

function computeScore(
  path: PathDefinition,
  changedNodes: Set<string>,
  untrustedBoundaries: Set<string>,
): PathScore {
  const allNonError = !path.usesErrorOutput;
  const allOutputZero = path.edges.every((e) => e.fromOutput === 0);

  let changedNodesCovered = 0;
  for (const node of path.nodes) {
    if (changedNodes.has(node as string)) changedNodesCovered++;
  }

  let untrustedBoundariesCrossed = 0;
  for (const node of path.nodes) {
    if (untrustedBoundaries.has(node as string)) untrustedBoundariesCrossed++;
  }

  return { allNonError, allOutputZero, changedNodesCovered, untrustedBoundariesCrossed };
}

/** Compare two scores — negative means `a` is better (higher rank). */
function compareScores(a: PathScore, b: PathScore): number {
  // Tier 1: prefer all non-error
  if (a.allNonError !== b.allNonError) return a.allNonError ? -1 : 1;
  // Tier 2: prefer all output 0
  if (a.allOutputZero !== b.allOutputZero) return a.allOutputZero ? -1 : 1;
  // Tier 3: prefer more changed nodes (descending)
  if (a.changedNodesCovered !== b.changedNodesCovered) {
    return b.changedNodesCovered - a.changedNodesCovered;
  }
  // Tier 4: prefer more untrusted boundaries (descending)
  return b.untrustedBoundariesCrossed - a.untrustedBoundariesCrossed;
}

function formatReason(score: PathScore): string {
  const parts: string[] = [];
  if (score.allNonError) parts.push('non-error path');
  else parts.push('uses error output');
  if (score.changedNodesCovered > 0) parts.push(`covers ${score.changedNodesCovered} changed node(s)`);
  if (score.untrustedBoundariesCrossed > 0) parts.push(`crosses ${score.untrustedBoundariesCrossed} untrusted boundary(ies)`);
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

function resolveUntrustedBoundaries(
  slice: SliceDefinition,
  trustState: TrustState,
): Set<string> {
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
