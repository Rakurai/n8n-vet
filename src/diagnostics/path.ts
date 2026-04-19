/**
 * Path reconstruction — collects execution node results and emits
 * an ordered PathNode[] representing the concrete execution route.
 */

import type { PathNode } from '../types/diagnostic.js';
import type { ExecutionData } from './types.js';

/** Typed error for path reconstruction failures. */
export class PathReconstructionError extends Error {
  override readonly name = 'PathReconstructionError' as const;
}

/**
 * Reconstruct the executed path from execution data.
 *
 * Sorts node results by executionIndex ascending and emits PathNode[]
 * with sourceOutput extracted from each node's source data.
 *
 * Returns null when executionData is null.
 * Raises on missing structural data (executionIndex or source).
 */
export function reconstructPath(executionData: ExecutionData | null): PathNode[] | null {
  if (executionData === null) return null;

  const entries = Array.from(executionData.nodeResults.entries());

  for (const [node, result] of entries) {
    if (result.source === undefined || result.source === null) {
      throw new PathReconstructionError(
        `Missing structural data for node "${node}": source is ${String(result.source)}`,
      );
    }
    if (result.executionIndex === undefined || result.executionIndex === null) {
      throw new PathReconstructionError(
        `Missing structural data for node "${node}": executionIndex is ${String(result.executionIndex)}`,
      );
    }
  }

  const sorted = entries.sort(
    ([, a], [, b]) => a.executionIndex - b.executionIndex,
  );

  return sorted.map(([node, result]) => ({
    name: node,
    executionIndex: result.executionIndex,
    sourceOutput: result.source.previousNodeOutput,
  }));
}
