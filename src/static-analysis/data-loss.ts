/**
 * Data-loss-through-replacement detection — identifies references to `$json`
 * fields that pass through shape-replacing nodes, meaning the original data
 * is no longer available at the point of reference.
 *
 * Also emits opaque-boundary warnings when upstream nodes have indeterminate
 * output shapes (Code nodes, unknown community nodes).
 */

import type { WorkflowGraph } from '../types/graph.js';
import type { NodeIdentity } from '../types/identity.js';
import type { NodeSchemaProvider } from './schemas.js';
import type { ExpressionReference } from './types.js';
import type { StaticFinding } from './types.js';

/**
 * Detect data-loss risks and broken references for expressions within target nodes.
 *
 * Never throws — all problems become `StaticFinding` entries.
 */
export function detectDataLoss(
  graph: WorkflowGraph,
  references: ExpressionReference[],
  targetNodes: NodeIdentity[],
  schemaProvider?: NodeSchemaProvider,
): StaticFinding[] {
  const targetSet = new Set<NodeIdentity>(targetNodes);
  const findings: StaticFinding[] = [];

  for (const ref of references) {
    if (!targetSet.has(ref.node)) continue;
    // Skip references in disabled nodes
    const node = graph.nodes.get(ref.node);
    if (node?.disabled) continue;

    if (ref.referencedNode !== null) {
      handleExplicitReference(ref, graph, findings);
    } else {
      handleImplicitReference(ref, graph, findings, schemaProvider);
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Case 1: Explicit named reference ($('NodeName') or $node["NodeName"])
// ---------------------------------------------------------------------------

function handleExplicitReference(
  ref: ExpressionReference,
  graph: WorkflowGraph,
  findings: StaticFinding[],
): void {
  if (!ref.resolved) return;

  // referencedNode is guaranteed non-null by the caller guard
  const referencedName = ref.referencedNode as NodeIdentity;

  if (!graph.nodes.has(referencedName)) {
    findings.push({
      node: ref.node,
      severity: 'error',
      kind: 'broken-reference',
      message: `Expression references node "${referencedName}" which does not exist in the workflow`,
      context: {
        referencedNode: referencedName,
        parameter: ref.parameter,
        expression: ref.raw,
      },
    });
  }
  // If it exists, explicit references use paired-item tracking — no data-loss check needed.
}

// ---------------------------------------------------------------------------
// Case 2: Implicit reference ($json.field or $input.json.field)
// ---------------------------------------------------------------------------

function handleImplicitReference(
  ref: ExpressionReference,
  graph: WorkflowGraph,
  findings: StaticFinding[],
  schemaProvider?: NodeSchemaProvider,
): void {
  walkBackward(ref.node, ref, graph, findings, new Set<NodeIdentity>(), schemaProvider);
}

function walkBackward(
  currentNode: NodeIdentity,
  ref: ExpressionReference,
  graph: WorkflowGraph,
  findings: StaticFinding[],
  visited: Set<NodeIdentity>,
  schemaProvider?: NodeSchemaProvider,
): void {
  if (visited.has(currentNode)) return;
  visited.add(currentNode);

  const incoming = graph.backward.get(currentNode);
  if (!incoming || incoming.length === 0) return;

  for (const edge of incoming) {
    const pred = graph.nodes.get(edge.from);
    if (!pred) continue;

    switch (pred.classification) {
      case 'shape-preserving':
      case 'shape-augmenting':
        walkBackward(edge.from, ref, graph, findings, visited, schemaProvider);
        break;

      case 'shape-opaque':
        findings.push({
          node: ref.node,
          severity: 'warning',
          kind: 'opaque-boundary',
          message: `Upstream node "${pred.displayName}" has indeterminate output shape — cannot verify data availability`,
          context: {
            opaqueNode: pred.name,
          },
        });
        break;

      case 'shape-replacing':
        if (isFirstDataSource(edge.from, graph)) {
          // Origin of data, not replacing someone else's output — no finding.
        } else {
          const severity = shouldDowngrade(pred.type, ref.fieldPath, schemaProvider)
            ? ('warning' as const)
            : ('error' as const);
          findings.push({
            node: ref.node,
            severity,
            kind: 'data-loss',
            message: `$json reference may lose data — upstream node "${pred.displayName}" replaces item shape`,
            context: {
              upstreamNode: pred.name,
              fieldPath: ref.fieldPath ?? '',
              parameter: ref.parameter,
            },
          });
        }
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Schema downgrade (FR-023)
// ---------------------------------------------------------------------------

/**
 * Check if a data-loss finding should be downgraded from error to warning.
 * Returns true when the upstream node has a known schema containing the field.
 */
function shouldDowngrade(
  nodeType: string,
  fieldPath: string | null,
  schemaProvider?: NodeSchemaProvider,
): boolean {
  if (!schemaProvider || !fieldPath) return false;

  const schema = schemaProvider.getNodeSchema(nodeType);
  if (!schema?.properties) return false;

  const topLevelField = fieldPath.split('.')[0];
  return topLevelField in schema.properties;
}

// ---------------------------------------------------------------------------
// First data source detection
// ---------------------------------------------------------------------------

/**
 * A node is a first data source if ALL backward paths from it lead to entry
 * points (nodes with no incoming edges) without encountering any other
 * shape-replacing or shape-augmenting nodes.
 */
function isFirstDataSource(nodeName: NodeIdentity, graph: WorkflowGraph): boolean {
  return allPathsReachEntry(nodeName, graph, new Set<NodeIdentity>());
}

function allPathsReachEntry(
  nodeName: NodeIdentity,
  graph: WorkflowGraph,
  visited: Set<NodeIdentity>,
): boolean {
  if (visited.has(nodeName)) return true; // cycle → treat as reachable
  visited.add(nodeName);

  const incoming = graph.backward.get(nodeName);
  if (!incoming || incoming.length === 0) return true; // entry node

  for (const edge of incoming) {
    const pred = graph.nodes.get(edge.from);
    if (!pred) return true; // missing node → treat as entry

    if (pred.classification === 'shape-replacing' || pred.classification === 'shape-augmenting') {
      return false;
    }

    if (!allPathsReachEntry(edge.from, graph, visited)) {
      return false;
    }
  }

  return true;
}
