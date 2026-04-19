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
import type { WorkflowAST } from '@n8n-as-code/transformer';
import type { Edge, GraphNode, WorkflowGraph } from '../types/graph.js';
import type { NodeIdentity } from '../types/identity.js';
import { nodeIdentity } from '../types/identity.js';
import type { SerializedEdge, SerializedGraphNode, WorkflowSnapshot } from './types.js';

const SNAPSHOTS_SUBDIR = 'snapshots';
const DEFAULT_SNAPSHOTS_DIR = '.n8n-vet/snapshots';

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
  const base = dataDir ?? resolveSnapshotsDir();
  const safeId = encodeURIComponent(workflowId);
  return join(base, `${safeId}.json`);
}

function resolveSnapshotsDir(): string {
  const envDir = process.env.N8N_VET_DATA_DIR;
  if (envDir) {
    return join(envDir, SNAPSHOTS_SUBDIR);
  }
  return DEFAULT_SNAPSHOTS_DIR;
}

function serializeGraph(workflowId: string, graph: WorkflowGraph): WorkflowSnapshot {
  const nodes: SerializedGraphNode[] = [];
  for (const node of graph.nodes.values()) {
    const nodeAst = graph.ast.nodes.find((n) => n.propertyName === node.name);
    nodes.push({
      name: node.name,
      displayName: node.displayName,
      type: node.type,
      typeVersion: node.typeVersion,
      parameters: node.parameters,
      credentials: node.credentials,
      disabled: node.disabled,
      classification: node.classification,
      retryOnFail: nodeAst?.retryOnFail ?? false,
      executeOnce: nodeAst?.executeOnce ?? false,
      onError: nodeAst?.onError ?? null,
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
  const nodes = new Map<NodeIdentity, GraphNode>();
  const displayNameIndex = new Map<string, NodeIdentity>();

  for (const sn of snapshot.nodes) {
    const name = nodeIdentity(sn.name);
    nodes.set(name, {
      name,
      displayName: sn.displayName,
      type: sn.type,
      typeVersion: sn.typeVersion,
      parameters: sn.parameters,
      credentials: sn.credentials,
      disabled: sn.disabled,
      classification: sn.classification,
    });
    displayNameIndex.set(sn.displayName, name);
  }

  const forward = new Map<NodeIdentity, Edge[]>();
  for (const [key, edges] of Object.entries(snapshot.forward)) {
    forward.set(nodeIdentity(key), edges.map(deserializeEdge));
  }

  const backward = new Map<NodeIdentity, Edge[]>();
  for (const [key, edges] of Object.entries(snapshot.backward)) {
    backward.set(nodeIdentity(key), edges.map(deserializeEdge));
  }

  // Snapshot graphs have no full AST — reconstruct stub AST nodes carrying
  // execution settings so computeContentHash and executionSettingsChanged work.
  const astNodes = snapshot.nodes.map((sn) => ({
    propertyName: sn.name,
    position: [0, 0] as [number, number],
    retryOnFail: sn.retryOnFail ?? false,
    executeOnce: sn.executeOnce ?? false,
    onError: sn.onError ?? null,
  }));
  const ast = { nodes: astNodes, connections: [] } as unknown as WorkflowAST;

  return { nodes, forward, backward, displayNameIndex, ast };
}

function deserializeEdge(se: SerializedEdge): Edge {
  return {
    from: nodeIdentity(se.from),
    fromOutput: se.fromOutput,
    isError: se.isError,
    to: nodeIdentity(se.to),
    toInput: se.toInput,
  };
}
