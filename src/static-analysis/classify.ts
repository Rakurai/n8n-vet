/**
 * Node classification — determines how an n8n node type affects the shape
 * of items flowing through it, using priority-ordered matching rules.
 *
 * Classification order (first match wins):
 * 1. Explicit opaque set (Code, Function, FunctionItem, AI Transform)
 * 2. Set node special handling (check options.include)
 * 3. Explicit shape-preserving set
 * 4. Trigger detection (type name contains "Trigger")
 * 5. HTTP Request detection
 * 6. Credential-based detection (non-empty credentials → shape-replacing)
 * 7. Default: shape-opaque (unknown node type)
 */

import type { NodeAST } from '@n8n-as-code/transformer';
import type { NodeClassification } from '../types/graph.js';
import {
  HTTP_REQUEST_TYPE,
  MERGE_NODE_TYPE,
  SET_NODE_TYPE,
  SHAPE_OPAQUE_TYPES,
  SHAPE_PRESERVING_TYPES,
} from './node-sets.js';

/**
 * Classify a node by how it affects item shape during data flow.
 *
 * @throws — never; always returns a valid classification.
 */
export function classifyNode(node: NodeAST): NodeClassification {
  // 1. Explicit opaque set
  if (SHAPE_OPAQUE_TYPES.has(node.type)) {
    return 'shape-opaque';
  }

  // 2. Set node special handling
  if (node.type === SET_NODE_TYPE) {
    return classifySetNode(node.parameters);
  }

  // 2b. Merge node mode-aware classification
  if (node.type === MERGE_NODE_TYPE) {
    return classifyMergeNode(node.parameters);
  }

  // 3. Explicit shape-preserving set
  if (SHAPE_PRESERVING_TYPES.has(node.type)) {
    return 'shape-preserving';
  }

  // 4. Trigger detection
  if (node.type.toLowerCase().includes('trigger')) {
    return 'shape-replacing';
  }

  // 5. HTTP Request detection
  if (node.type === HTTP_REQUEST_TYPE) {
    return 'shape-replacing';
  }

  // 6. Credential-based detection
  if (node.credentials && Object.keys(node.credentials).length > 0) {
    return 'shape-replacing';
  }

  // 7. Default: unknown node type → opaque
  return 'shape-opaque';
}

/**
 * Classify a Set node based on its `options.include` parameter value.
 */
function classifySetNode(parameters: Record<string, unknown>): NodeClassification {
  const options = parameters.options as Record<string, unknown> | undefined;
  const include = options?.include as string | undefined;

  if (include === undefined || include === 'all') {
    return 'shape-augmenting';
  }

  // 'selected', 'none', 'except' → shape-replacing
  return 'shape-replacing';
}

/**
 * Classify a Merge node based on its `mode` parameter.
 *
 * Modes:
 * - append, chooseBranch → shape-preserving (items pass through as-is)
 * - combineByPosition, combineByFields, multiplex → shape-augmenting (merges fields)
 * - combineBySql → shape-replacing (SQL query creates new shape)
 */
function classifyMergeNode(parameters: Record<string, unknown>): NodeClassification {
  const mode = parameters.mode as string | undefined;

  switch (mode) {
    case 'append':
    case 'chooseBranch':
      return 'shape-preserving';
    case 'combineByPosition':
    case 'combineByFields':
    case 'multiplex':
      return 'shape-augmenting';
    case 'combineBySql':
      return 'shape-replacing';
    default:
      // Unknown or unset mode — default to shape-augmenting (safe assumption)
      return 'shape-augmenting';
  }
}
