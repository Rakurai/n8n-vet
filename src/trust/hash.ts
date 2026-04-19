/**
 * Content hashing — deterministic SHA-256 hashes for node content, connection
 * topology, and composite workflow identity.
 *
 * Uses json-stable-stringify + SHA-256 to match n8nac's HashUtils.computeHash()
 * behavior (research R1).
 */

import { createHash } from 'node:crypto';
import type { WorkflowAST } from '@n8n-as-code/transformer';
import stringify from 'json-stable-stringify';
import type { GraphNode, WorkflowGraph } from '../types/graph.js';
import { ContentHashError } from './errors.js';

/**
 * Compute SHA-256 hash of a node's trust-relevant properties.
 *
 * Includes: type, typeVersion, parameters, credentials, disabled,
 * retryOnFail, executeOnce, onError (execution settings from AST).
 * Excludes: position, name, displayName, notes, id, classification.
 *
 * @throws {ContentHashError} if canonical serialization fails.
 */
export function computeContentHash(node: GraphNode, ast: WorkflowAST): string {
  try {
    // Find matching NodeAST to extract execution settings (research R3)
    const nodeAst = ast.nodes.find((n) => n.propertyName === node.name);

    const hashInput = {
      type: node.type,
      typeVersion: node.typeVersion,
      parameters: node.parameters,
      credentials: node.credentials,
      disabled: node.disabled,
      retryOnFail: nodeAst?.retryOnFail ?? false,
      executeOnce: nodeAst?.executeOnce ?? false,
      onError: nodeAst?.onError ?? null,
    };

    const serialized = stringify(hashInput);
    if (serialized === undefined) {
      throw new ContentHashError(node.name, new Error('json-stable-stringify returned undefined'));
    }
    return sha256(serialized);
  } catch (err) {
    if (err instanceof ContentHashError) throw err;
    throw new ContentHashError(node.name, err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Compute SHA-256 hash of the full connection topology.
 *
 * Sorts by node name and edge output index for determinism regardless of
 * Map iteration order.
 */
export function computeConnectionsHash(graph: WorkflowGraph): string {
  const sortedNames = [...graph.forward.keys()].sort();
  const entries: Array<
    [string, Array<{ to: string; fromOutput: number; toInput: number; isError: boolean }>]
  > = [];

  for (const name of sortedNames) {
    const edges = graph.forward.get(name) ?? [];
    const sortedEdges = [...edges]
      .sort((a, b) => a.fromOutput - b.fromOutput || a.to.localeCompare(b.to))
      .map((e) => ({ to: e.to, fromOutput: e.fromOutput, toInput: e.toInput, isError: e.isError }));
    entries.push([name, sortedEdges]);
  }

  const serialized = stringify(entries);
  if (serialized === undefined) {
    throw new Error('Failed to serialize connection topology');
  }
  return sha256(serialized);
}

/**
 * Compute a composite workflow hash for quick-check short-circuiting.
 *
 * Composed from sorted node content hashes + connections hash. If this hash
 * matches between two snapshots, no node-level diffing is needed (research R6).
 *
 * Caches individual node hashes to avoid redundant recomputation.
 */
export function computeWorkflowHash(graph: WorkflowGraph): string {
  const sortedNames = [...graph.nodes.keys()].sort();
  const nodeHashes: string[] = [];
  const hashCache = new Map<string, string>();

  for (const name of sortedNames) {
    const node = graph.nodes.get(name);
    if (node) {
      let hash = hashCache.get(name);
      if (hash === undefined) {
        hash = computeContentHash(node, graph.ast);
        hashCache.set(name, hash);
      }
      nodeHashes.push(hash);
    }
  }

  const connectionsHash = computeConnectionsHash(graph);
  const serialized = stringify({ nodeHashes, connectionsHash });
  if (serialized === undefined) {
    throw new Error('Failed to serialize workflow hash input');
  }
  return sha256(serialized);
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
