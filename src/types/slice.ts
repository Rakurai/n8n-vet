/**
 * Bounded regions and execution routes within a workflow graph — the structural
 * units for scoped validation.
 */

import type { NodeIdentity } from './identity.js';

/** A bounded region of the workflow graph relevant to a change. */
export interface SliceDefinition {
  /** All nodes contained within this slice. */
  nodes: Set<NodeIdentity>;
  /** Nodes whose changes triggered the construction of this slice. */
  seedNodes: Set<NodeIdentity>;
  /** Nodes at which execution enters the slice from outside. */
  entryPoints: NodeIdentity[];
  /** Nodes at which execution leaves the slice into outside regions. */
  exitPoints: NodeIdentity[];
}

/** A concrete execution route through a slice, from entry to exit. */
export interface PathDefinition {
  /** Ordered sequence of nodes traversed along this path. */
  nodes: NodeIdentity[];
  /** Connecting edges between each consecutive pair of nodes. */
  edges: PathEdge[];
  /** Whether any edge on this path uses an error output. */
  usesErrorOutput: boolean;
  /** Why this path was selected, surfaced in diagnostic output. */
  selectionReason: string;
}

/** A directed connection between two nodes in a path. */
export interface PathEdge {
  /** Source node of this edge. */
  from: NodeIdentity;
  /** Output index on the source node. */
  fromOutput: number;
  /** Destination node of this edge. */
  to: NodeIdentity;
  /** Input index on the destination node. */
  toInput: number;
  /** Whether this edge originates from an error output. */
  isError: boolean;
}
