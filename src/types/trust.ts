/**
 * Trust state and change detection types — per-node validation records and
 * workflow snapshot differencing.
 */

import type { NodeIdentity } from './identity.js';
import type { ValidationLayer } from './target.js';

/** Per-workflow trust state, keyed by node identity. */
export interface TrustState {
  workflowId: string;
  /** Per-node trust records, keyed by node identity. */
  nodes: Map<NodeIdentity, NodeTrustRecord>;
  /** Hash of full connection topology at last trust computation. */
  connectionsHash: string;
}

/** Trust record for a single node, established by a completed validation run. */
export interface NodeTrustRecord {
  /** Hash of trust-relevant node properties at validation time. */
  contentHash: string;
  /** Identifier of the validation run that established trust. */
  validatedBy: string;
  /** ISO 8601 timestamp of the validation run. */
  validatedAt: string;
  /** Which evidence layer produced this trust record. */
  validationLayer: ValidationLayer;
  /** Hash of fixture/pin-data used during validation; null for static-only trust. */
  fixtureHash: string | null;
}

/**
 * Result of comparing two workflow snapshots — classifies every node as added,
 * removed, modified, or unchanged.
 */
export interface NodeChangeSet {
  added: NodeIdentity[];
  removed: NodeIdentity[];
  modified: NodeModification[];
  unchanged: NodeIdentity[];
}

/** A node whose content changed between snapshots, along with the specific change kinds. */
export interface NodeModification {
  node: NodeIdentity;
  changes: ChangeKind[];
}

/**
 * The kind of change detected on a node.
 *
 * `position-only` and `metadata-only` are trust-preserving — they do not
 * invalidate a prior `NodeTrustRecord`. All other kinds are trust-breaking.
 */
export type ChangeKind =
  | 'parameter'
  | 'expression'
  | 'connection'
  | 'type-version'
  | 'credential'
  | 'execution-setting'
  | 'rename'
  | 'position-only'
  | 'metadata-only';
