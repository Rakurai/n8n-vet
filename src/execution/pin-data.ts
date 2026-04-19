/**
 * Pin data construction with 4-tier sourcing and source traceability.
 *
 * Tier priority (high to low):
 *   1. Agent-provided fixtures (explicit test data from the calling agent)
 *   2. Prior validation artifacts (cached from successful prior runs)
 *   3. Execution history via MCP prepare_test_pin_data (requires MCP client)
 *   4. Error — throw with specific missing node names
 *
 * Also handles normalization of flat objects to { json } wrapper format
 * and artifact caching for tier 2 sourcing.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkflowGraph } from '../types/graph.js';
import type { NodeIdentity } from '../types/identity.js';
import { ExecutionPreconditionError } from './errors.js';
import type { PinData, PinDataItem, PinDataResult, PinDataSourceMap } from './types.js';

// ---------------------------------------------------------------------------
// Pin Data Construction (T013)
// ---------------------------------------------------------------------------

/**
 * Construct pin data for a validation run using 4-tier sourcing priority.
 *
 * Determines which nodes need pin data (trusted boundary nodes at the edge
 * of the execution scope), then sources data for each from the highest
 * available tier.
 *
 * Tier 3 (execution history via MCP) is skipped when no MCP client is
 * available — unresolved nodes proceed directly to tier 4 (error).
 */
export function constructPinData(
  _graph: WorkflowGraph,
  trustedBoundaries: NodeIdentity[],
  fixtures?: Record<string, PinDataItem[]>,
  priorArtifacts?: Record<string, PinDataItem[]>,
): PinDataResult {
  const pinData: PinData = {};
  const sourceMap: PinDataSourceMap = {};
  const missingNodes: string[] = [];

  for (const boundary of trustedBoundaries) {
    const nodeName = boundary as string;

    // Tier 1: Agent-provided fixtures
    if (fixtures && nodeName in fixtures) {
      pinData[nodeName] = normalizePinData(fixtures[nodeName] ?? []);
      sourceMap[nodeName] = 'agent-fixture';
      continue;
    }

    // Tier 2: Prior validation artifacts
    if (priorArtifacts && nodeName in priorArtifacts) {
      pinData[nodeName] = normalizePinData(priorArtifacts[nodeName] ?? []);
      sourceMap[nodeName] = 'prior-artifact';
      continue;
    }

    // Tier 3: Execution history (MCP) — skipped when MCP unavailable
    // MCP client integration added after US3 (T019).

    // Tier 4: Error — collect missing
    missingNodes.push(nodeName);
  }

  if (missingNodes.length > 0) {
    throw new ExecutionPreconditionError(
      'missing-pin-data',
      `Pin data unavailable for nodes: ${missingNodes.join(', ')}. Provide fixtures or ensure prior validation artifacts exist.`,
    );
  }

  return { pinData, sourceMap };
}

// ---------------------------------------------------------------------------
// Pin Data Normalization (T014)
// ---------------------------------------------------------------------------

/**
 * Normalize pin data items to n8n's expected { json } wrapper format.
 *
 * Detects flat objects missing the `json` wrapper and wraps them.
 * Items that already have a `json` property are passed through.
 */
export function normalizePinData(items: PinDataItem[]): PinDataItem[] {
  return items.map((item) => {
    // Already wrapped — has a `json` property that is an object
    if (isWrappedItem(item)) {
      return item;
    }

    // Flat object — wrap it
    return { json: item as unknown as Record<string, unknown> };
  });
}

/** Check if an item already has the { json: ... } wrapper. */
function isWrappedItem(item: unknown): item is PinDataItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'json' in item &&
    (item as Record<string, unknown>).json !== null &&
    typeof (item as Record<string, unknown>).json === 'object'
  );
}

// ---------------------------------------------------------------------------
// Pin Data Artifact Caching (T015)
// ---------------------------------------------------------------------------

const PIN_DATA_DIR = '.n8n-vet/pin-data';

/**
 * Read cached pin data artifact for a node.
 *
 * Cached at .n8n-vet/pin-data/<workflowId>/<nodeContentHash>.json.
 * Content-hash keying ensures automatic invalidation when node content changes.
 */
export async function readCachedPinData(
  workflowId: string,
  nodeContentHash: string,
): Promise<PinDataItem[] | undefined> {
  const path = join(PIN_DATA_DIR, workflowId, `${nodeContentHash}.json`);

  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined; // File not found — expected for cache miss
    }
    throw err; // Unexpected error — re-throw
  }

  // JSON parse errors indicate corrupt cache — fail-fast, don't mask
  return JSON.parse(raw) as PinDataItem[];
}

/**
 * Write pin data artifact to cache after successful validation.
 *
 * Called by the orchestrator (Phase 7) after a successful execution run,
 * so that future validations can use this data as tier 2 source.
 */
export async function writeCachedPinData(
  workflowId: string,
  nodeContentHash: string,
  items: PinDataItem[],
): Promise<void> {
  const dir = join(PIN_DATA_DIR, workflowId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${nodeContentHash}.json`);
  await writeFile(path, JSON.stringify(items, null, 2), 'utf-8');
}
