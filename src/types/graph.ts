/**
 * Traversable graph representation built from parsed workflow files — the
 * central data structure for static analysis, slice computation, and trust
 * reasoning.
 *
 * Graph construction consumes a `WorkflowAST` from the n8nac transformer and
 * produces bidirectional adjacency maps keyed by node name (property name),
 * enabling efficient traversal in either direction during slice computation.
 */

import type { WorkflowAST } from '@n8n-as-code/transformer';

/**
 * Complete traversable representation of a parsed n8n workflow.
 *
 * Both adjacency maps are derived from the same edge set; they are maintained
 * in parallel so that forward (downstream) and backward (upstream) traversal
 * are both O(1) lookups without re-scanning on each pass.
 */
export interface WorkflowGraph {
  /** All nodes in the workflow, keyed by property name (the stable graph key). */
  nodes: Map<string, GraphNode>;

  /** Forward adjacency: maps each source node name to its outgoing edges. */
  forward: Map<string, Edge[]>;

  /** Backward adjacency: maps each destination node name to its incoming edges. */
  backward: Map<string, Edge[]>;

  /** Original AST produced by the n8nac transformer; preserved for provenance. */
  ast: WorkflowAST;
}

/**
 * A single node in the workflow graph, carrying the properties needed for
 * static analysis and expression resolution.
 *
 * `name` is the canonical graph key (property name). `displayName` is kept
 * separately because n8n expressions reference nodes by display name (e.g.
 * `$('Schedule Trigger')`), not by property name.
 */
export interface GraphNode {
  /** Property name — the stable identifier used as the graph key. */
  name: string;

  /** n8n display name, used in expression resolution (e.g. `$('Schedule Trigger')`). */
  displayName: string;

  /** n8n node type identifier (e.g. `n8n-nodes-base.httpRequest`). */
  type: string;

  /** Node type schema version. */
  typeVersion: number;

  /** Full node parameters as declared in the workflow file. */
  parameters: Record<string, unknown>;

  /** Credential bindings, or null when no credentials are attached. */
  credentials: Record<string, unknown> | null;

  /** Whether this node is disabled and will be skipped during execution. */
  disabled: boolean;

  /** Static analysis classification describing how this node affects item shape. */
  classification: NodeClassification;
}

/**
 * Describes how a node affects the shape of the items flowing through it.
 *
 * Used by static analysis to bound what needs re-validation when a node
 * changes, and to reason about which downstream nodes may be affected by a
 * shape change.
 *
 * - `shape-preserving` — passes items through without structural change
 * - `shape-augmenting` — adds fields to items without removing existing ones
 * - `shape-replacing` — produces items with a structure unrelated to the input
 * - `shape-opaque` — output shape cannot be statically determined
 */
export type NodeClassification =
  | 'shape-preserving'
  | 'shape-augmenting'
  | 'shape-replacing'
  | 'shape-opaque';

/**
 * A directed connection between two nodes in the workflow graph.
 *
 * Output and input indices follow n8n's zero-based convention. Error outputs
 * are flagged separately so that slice computation can distinguish normal data
 * flow from error-handling branches.
 */
export interface Edge {
  /** Source node name. */
  from: string;

  /** Source output index (zero-based). */
  fromOutput: number;

  /** Whether this edge originates from an error output. */
  isError: boolean;

  /** Destination node name. */
  to: string;

  /** Destination input index (zero-based). */
  toInput: number;
}
