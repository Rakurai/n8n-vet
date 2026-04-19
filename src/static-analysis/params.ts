/**
 * Node parameter validation — checks node parameters against type definitions
 * from an optional NodeSchemaProvider, flagging missing required parameters
 * and undefined credential types.
 */

import type { WorkflowGraph } from '../types/graph.js';
import type { NodeIdentity } from '../types/identity.js';
import type { NodeSchemaProvider } from './schemas.js';
import type { StaticFinding } from './types.js';

export function validateNodeParams(
  graph: WorkflowGraph,
  nodes: NodeIdentity[],
  schemaProvider?: NodeSchemaProvider,
): StaticFinding[] {
  if (!schemaProvider) {
    return [];
  }

  const findings: StaticFinding[] = [];

  for (const nodeId of nodes) {
    const graphNode = graph.nodes.get(nodeId);
    if (!graphNode) {
      continue;
    }
    // Skip disabled nodes
    if (graphNode.disabled) continue;

    const schema = schemaProvider.getNodeSchema(graphNode.type);
    if (!schema?.properties) {
      continue;
    }

    // Check required parameters are present
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (prop.required && !(key in graphNode.parameters)) {
        findings.push({
          node: nodeId,
          severity: 'warning',
          kind: 'invalid-parameter',
          message: `Missing required parameter "${key}" on node "${graphNode.displayName}" (${graphNode.type})`,
          context: {
            parameter: key,
            expected: 'required parameter must be present',
          },
        });
      }
    }

    // Credential type validation deferred — requires a credential type registry
    // not available from NodeSchemaProvider in v1. See audit finding PH-001.
  }

  return findings;
}
