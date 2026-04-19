/**
 * Expression reference extraction — parses n8n expression patterns from node
 * parameters and resolves display name references to graph node identities.
 *
 * Supports 4 reference patterns:
 * 1. `$json.field` / `$json['field']` — implicit current input
 * 2. `$('DisplayName').first().json.field` — explicit named reference
 * 3. `$input.first().json.field` — explicit current input
 * 4. `$node["DisplayName"].json.field` — legacy named reference
 */

import type { NodeIdentity } from '../types/identity.js';
import { nodeIdentity } from '../types/identity.js';
import type { WorkflowGraph } from '../types/graph.js';
import type { ExpressionReference } from './types.js';

/**
 * Extract all expression references from the parameters of the specified nodes.
 *
 * Recursively walks parameter values, finds n8n expression strings (`={{ }}`),
 * and parses the 4 supported reference patterns. Display names are resolved to
 * property names via the graph's displayNameIndex.
 *
 * Unresolvable references (dynamic keys, `$fromAI()`, unknown display names)
 * are recorded with `resolved: false` — never thrown.
 */
export function traceExpressions(
  graph: WorkflowGraph,
  nodes: NodeIdentity[],
): ExpressionReference[] {
  const results: ExpressionReference[] = [];

  for (const nodeId of nodes) {
    const graphNode = graph.nodes.get(nodeId);
    if (!graphNode) continue;

    walkParameters(
      graphNode.parameters,
      '',
      nodeId,
      graph,
      results,
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Expression patterns (ported from n8n's node-reference-parser-utils.ts)
// ---------------------------------------------------------------------------

// Pattern 1: $json.field or $json['field'] or $json["field"]
const JSON_DOT_PATTERN = /\$json\.(\w+(?:\.\w+)*)/g;
const JSON_BRACKET_PATTERN = /\$json\[['"](\w+)['"]\]/g;

// Pattern 2: $('DisplayName').first().json.field (and .last(), .item, .all(), .itemMatching())
const EXPLICIT_REF_PATTERN = /\$\(['"]([^'"]+)['"]\)(?:\.(?:first|last|all|itemMatching)\(\)|\.\s*item)?\.json(?:\.(\w+(?:\.\w+)*)|\[['"](\w+)['"]\])?/g;

// Pattern 3: $input.first().json.field (and variants)
const INPUT_PATTERN = /\$input(?:\.(?:first|last|all|itemMatching)\(\)|\.\s*item)?\.json(?:\.(\w+(?:\.\w+)*)|\[['"](\w+)['"]\])?/g;

// Pattern 4: $node["DisplayName"].json.field (legacy)
const NODE_REF_PATTERN = /\$node\[['"]([^'"]+)['"]\]\.json(?:\.(\w+(?:\.\w+)*)|\[['"](\w+)['"]\])?/g;

// Unresolvable patterns: $fromAI(), dynamic bracket access ($json[variable])
const FROM_AI_PATTERN = /\$fromAI\(/g;
const DYNAMIC_BRACKET_PATTERN = /\$json\[(?!['"])/g;

// ---------------------------------------------------------------------------
// Parameter walking
// ---------------------------------------------------------------------------

function walkParameters(
  value: unknown,
  path: string,
  nodeId: NodeIdentity,
  graph: WorkflowGraph,
  results: ExpressionReference[],
): void {
  if (typeof value === 'string') {
    if (value.startsWith('=')) {
      extractFromExpression(value, path, nodeId, graph, results);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walkParameters(value[i], path ? `${path}[${i}]` : `[${i}]`, nodeId, graph, results);
    }
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walkParameters(child, path ? `${path}.${key}` : key, nodeId, graph, results);
    }
  }
}

// ---------------------------------------------------------------------------
// Expression parsing
// ---------------------------------------------------------------------------

function extractFromExpression(
  expression: string,
  parameter: string,
  nodeId: NodeIdentity,
  graph: WorkflowGraph,
  results: ExpressionReference[],
): void {
  // Pattern 1: $json.field
  extractJsonDotRefs(expression, parameter, nodeId, results);
  // Pattern 1b: $json['field']
  extractJsonBracketRefs(expression, parameter, nodeId, results);
  // Pattern 2: $('DisplayName')...
  extractExplicitRefs(expression, parameter, nodeId, graph, results);
  // Pattern 3: $input...
  extractInputRefs(expression, parameter, nodeId, results);
  // Pattern 4: $node["DisplayName"]...
  extractNodeRefs(expression, parameter, nodeId, graph, results);
  // Unresolvable: $fromAI(), dynamic bracket access
  extractUnresolvableRefs(expression, parameter, nodeId, results);
}

function extractJsonDotRefs(
  expression: string,
  parameter: string,
  nodeId: NodeIdentity,
  results: ExpressionReference[],
): void {
  // Reset lastIndex for global regex
  JSON_DOT_PATTERN.lastIndex = 0;

  // Filter out matches that are actually part of explicit patterns
  let match: RegExpExecArray | null;
  while ((match = JSON_DOT_PATTERN.exec(expression)) !== null) {
    // Check this isn't inside a $('...).json or $input.json or $node[...].json context
    const beforeMatch = expression.slice(0, match.index);
    if (isInsideExplicitContext(beforeMatch)) continue;

    results.push({
      node: nodeId,
      parameter,
      raw: match[0],
      referencedNode: null, // $json refers to current input, no named node
      fieldPath: match[1],
      resolved: true,
    });
  }
}

function extractJsonBracketRefs(
  expression: string,
  parameter: string,
  nodeId: NodeIdentity,
  results: ExpressionReference[],
): void {
  JSON_BRACKET_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = JSON_BRACKET_PATTERN.exec(expression)) !== null) {
    const beforeMatch = expression.slice(0, match.index);
    if (isInsideExplicitContext(beforeMatch)) continue;

    results.push({
      node: nodeId,
      parameter,
      raw: match[0],
      referencedNode: null,
      fieldPath: match[1],
      resolved: true,
    });
  }
}

function extractExplicitRefs(
  expression: string,
  parameter: string,
  nodeId: NodeIdentity,
  graph: WorkflowGraph,
  results: ExpressionReference[],
): void {
  EXPLICIT_REF_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = EXPLICIT_REF_PATTERN.exec(expression)) !== null) {
    const displayName = match[1];
    const fieldPath = match[2] ?? match[3] ?? null;
    const propertyName = graph.displayNameIndex.get(displayName);

    results.push({
      node: nodeId,
      parameter,
      raw: match[0],
      referencedNode: propertyName ? nodeIdentity(propertyName) : null,
      fieldPath,
      resolved: propertyName !== undefined,
    });
  }
}

function extractInputRefs(
  expression: string,
  parameter: string,
  nodeId: NodeIdentity,
  results: ExpressionReference[],
): void {
  INPUT_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INPUT_PATTERN.exec(expression)) !== null) {
    const fieldPath = match[1] ?? match[2] ?? null;

    results.push({
      node: nodeId,
      parameter,
      raw: match[0],
      referencedNode: null, // $input refers to current input, no named node
      fieldPath,
      resolved: true,
    });
  }
}

function extractNodeRefs(
  expression: string,
  parameter: string,
  nodeId: NodeIdentity,
  graph: WorkflowGraph,
  results: ExpressionReference[],
): void {
  NODE_REF_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = NODE_REF_PATTERN.exec(expression)) !== null) {
    const displayName = match[1];
    const fieldPath = match[2] ?? match[3] ?? null;
    const propertyName = graph.displayNameIndex.get(displayName);

    results.push({
      node: nodeId,
      parameter,
      raw: match[0],
      referencedNode: propertyName ? nodeIdentity(propertyName) : null,
      fieldPath,
      resolved: propertyName !== undefined,
    });
  }
}

function extractUnresolvableRefs(
  expression: string,
  parameter: string,
  nodeId: NodeIdentity,
  results: ExpressionReference[],
): void {
  // $fromAI() — AI-generated parameter, cannot be statically resolved
  FROM_AI_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FROM_AI_PATTERN.exec(expression)) !== null) {
    results.push({
      node: nodeId,
      parameter,
      raw: match[0],
      referencedNode: null,
      fieldPath: null,
      resolved: false,
    });
  }

  // $json[variable] — dynamic bracket access (not a string literal)
  DYNAMIC_BRACKET_PATTERN.lastIndex = 0;
  while ((match = DYNAMIC_BRACKET_PATTERN.exec(expression)) !== null) {
    results.push({
      node: nodeId,
      parameter,
      raw: match[0],
      referencedNode: null,
      fieldPath: null,
      resolved: false,
    });
  }
}

/**
 * Check if the position in expression is inside an explicit reference context
 * (e.g., after `$('...').first().json` or `$input.first().json` or `$node[...].json`).
 * This prevents double-matching `$json.field` that's actually part of a longer pattern.
 */
function isInsideExplicitContext(textBefore: string): boolean {
  // Check if the $json is preceded by .json context from an explicit ref
  return /\)\s*\.json$/.test(textBefore) ||
    /\.item\s*\.json$/.test(textBefore) ||
    /\]\s*\.json$/.test(textBefore);
}
