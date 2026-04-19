/**
 * Snapshot persistence — save and load serialized WorkflowGraph snapshots
 * for change detection between validation runs.
 *
 * Snapshots are stored in `.n8n-vet/snapshots/{workflowId}.json` and contain
 * enough information to reconstruct a WorkflowGraph for `computeChangeSet`.
 * The raw AST is excluded to keep snapshots lightweight.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WorkflowGraph, GraphNode, Edge, NodeClassification } from '../types/graph.js';
import type { WorkflowSnapshot, SerializedGraphNode, SerializedEdge } from './types.js';

const SNAPSHOTS_DIR = '.n8n-vet/snapshots';

/** Load a previously saved workflow snapshot and reconstruct a WorkflowGraph. */
export function loadSnapshot(workflowId: string, dataDir?: string): WorkflowGraph | null {
  const filePath = snapshotPath(workflowId, dataDir);

  if (!existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, 'utf-8');
  const snapshot = JSON.parse(raw) as WorkflowSnapshot;
  return deserializeGraph(snapshot);
}

/** Save a workflow graph as a snapshot, excluding the raw AST. */
export function saveSnapshot(workflowId: string, graph: WorkflowGraph, dataDir?: string): void {
  const filePath = snapshotPath(workflowId, dataDir);
  const dir = dirname(filePath);

  mkdirSync(dir, { recursive: true });

  const snapshot = serializeGraph(workflowId, graph);
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
}

function snapshotPath(workflowId: string, dataDir?: string): string {
  const base = dataDir ?? SNAPSHOTS_DIR;
  const safeId = encodeURIComponent(workflowId);
  return join(base, `${safeId}.json`);
}

function serializeGraph(workflowId: string, graph: WorkflowGraph): WorkflowSnapshot {
  const nodes: SerializedGraphNode[] = [];
  for (const node of graph.nodes.values()) {
    nodes.push({
      name: node.name,
      displayName: node.displayName,
      type: node.type,
      typeVersion: node.typeVersion,
      parameters: node.parameters,
      credentials: node.credentials,
      disabled: node.disabled,
      classification: node.classification,
    });
  }

  const forward: Record<string, SerializedEdge[]> = {};
  for (const [key, edges] of graph.forward) {
    forward[key] = edges.map(serializeEdge);
  }

  const backward: Record<string, SerializedEdge[]> = {};
  for (const [key, edges] of graph.backward) {
    backward[key] = edges.map(serializeEdge);
  }

  return {
    workflowId,
    savedAt: new Date().toISOString(),
    nodes,
    forward,
    backward,
  };
}

function serializeEdge(edge: Edge): SerializedEdge {
  return {
    from: edge.from,
    fromOutput: edge.fromOutput,
    isError: edge.isError,
    to: edge.to,
    toInput: edge.toInput,
  };
}

function deserializeGraph(snapshot: WorkflowSnapshot): WorkflowGraph {
  const nodes = new Map<string, GraphNode>();
  const displayNameIndex = new Map<string, string>();

  for (const sn of snapshot.nodes) {
    nodes.set(sn.name, {
      name: sn.name,
      displayName: sn.displayName,
      type: sn.type,
      typeVersion: sn.typeVersion,
      parameters: sn.parameters,
      credentials: sn.credentials,
      disabled: sn.disabled,
      classification: sn.classification as NodeClassification,
    });
    displayNameIndex.set(sn.displayName, sn.name);
  }

  const forward = new Map<string, Edge[]>();
  for (const [key, edges] of Object.entries(snapshot.forward)) {
    forward.set(key, edges.map(deserializeEdge));
  }

  const backward = new Map<string, Edge[]>();
  for (const [key, edges] of Object.entries(snapshot.backward)) {
    backward.set(key, edges.map(deserializeEdge));
  }

  // Snapshot graphs have no AST — provide a minimal placeholder.
  // This is sufficient for computeChangeSet which only inspects nodes and adjacency.
  const ast = { nodes: [], connections: [] } as unknown as import('@n8n-as-code/transformer').WorkflowAST;

  return { nodes, forward, backward, displayNameIndex, ast };
}

function deserializeEdge(se: SerializedEdge): Edge {
  return {
    from: se.from,
    fromOutput: se.fromOutput,
    isError: se.isError,
    to: se.to,
    toInput: se.toInput,
  };
}
