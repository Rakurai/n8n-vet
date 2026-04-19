/**
 * Node type classification sets — static lookup tables for determining how
 * an n8n node type affects item shape during data flow.
 */

/** Nodes that pass items through without structural change. */
export const SHAPE_PRESERVING_TYPES: ReadonlySet<string> = new Set([
  'n8n-nodes-base.if',
  'n8n-nodes-base.switch',
  'n8n-nodes-base.noOp',
  'n8n-nodes-base.wait',
  'n8n-nodes-base.filter',
  'n8n-nodes-base.sort',
  'n8n-nodes-base.limit',
  'n8n-nodes-base.splitInBatches',
  'n8n-nodes-base.removeDuplicates',
] as const);

/** Nodes whose output shape cannot be statically determined. */
export const SHAPE_OPAQUE_TYPES: ReadonlySet<string> = new Set([
  'n8n-nodes-base.code',
  'n8n-nodes-base.function',
  'n8n-nodes-base.functionItem',
  '@n8n/n8n-nodes-langchain.aiTransform',
] as const);

/** The Set node type — requires special handling based on options.include. */
export const SET_NODE_TYPE = 'n8n-nodes-base.set' as const;

/** The Merge node type — requires mode-aware classification. */
export const MERGE_NODE_TYPE = 'n8n-nodes-base.merge' as const;

/** The HTTP Request node type. */
export const HTTP_REQUEST_TYPE = 'n8n-nodes-base.httpRequest' as const;
