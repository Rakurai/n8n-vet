/**
 * Schema compatibility checking — validates referenced field paths against
 * upstream node schemas when available via an optional NodeSchemaProvider.
 *
 * Intentionally limited in v1: true output schema checking requires
 * execution history inference. This function checks what it can from
 * input parameter schemas and degrades gracefully when schemas are unavailable.
 */

import type { WorkflowGraph } from '../types/graph.js';
import type { ExpressionReference, StaticFinding } from './types.js';

// ---------------------------------------------------------------------------
// Schema provider interfaces
// ---------------------------------------------------------------------------

/**
 * Minimal schema provider interface — compatible with @n8n-as-code/skills
 * NodeSchemaProvider. Defined locally to avoid hard dependency on skills package.
 */
export interface NodeSchemaProvider {
  getNodeSchema(nodeType: string): NodeSchema | undefined;
}

export interface NodeSchema {
  properties?: Record<string, SchemaProperty>;
}

export interface SchemaProperty {
  type?: string;
  required?: boolean;
  description?: string;
}

// ---------------------------------------------------------------------------
// Schema checking
// ---------------------------------------------------------------------------

export function checkSchemas(
  graph: WorkflowGraph,
  references: ExpressionReference[],
  schemaProvider?: NodeSchemaProvider,
): StaticFinding[] {
  if (!schemaProvider) {
    return [];
  }

  const findings: StaticFinding[] = [];

  for (const ref of references) {
    if (ref.referencedNode === null || ref.fieldPath === null) {
      continue;
    }

    const graphNode = graph.nodes.get(ref.referencedNode);
    if (!graphNode) {
      continue;
    }

    const schema = schemaProvider.getNodeSchema(graphNode.type);
    if (!schema?.properties) {
      continue;
    }

    const topLevelField = ref.fieldPath.split('.')[0];
    if (!(topLevelField in schema.properties)) {
      findings.push({
        node: ref.node,
        severity: 'warning',
        kind: 'schema-mismatch',
        message: `Field "${ref.fieldPath}" not found in schema for node "${graphNode.displayName}" (${graphNode.type})`,
        context: {
          upstreamNode: ref.referencedNode,
          fieldPath: ref.fieldPath,
          parameter: ref.parameter,
        },
      });
    }
  }

  return findings;
}
