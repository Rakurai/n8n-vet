import { describe, it, expect } from 'vitest';
import { checkSchemas } from '../../src/static-analysis/schemas.js';
import { nodeIdentity } from '../../src/types/identity.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { WorkflowGraph } from '../../src/types/graph.js';
import type { WorkflowAST } from '@n8n-as-code/transformer';
import type { ExpressionReference } from '../../src/static-analysis/types.js';
import type { NodeSchemaProvider } from '../../src/static-analysis/schemas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(nodes: Array<{name: string; displayName: string; type: string}>): WorkflowGraph {
  const nodeMap = new Map();
  const displayNameIndex = new Map();
  for (const n of nodes) {
    nodeMap.set(n.name, {
      name: n.name, displayName: n.displayName, type: n.type,
      typeVersion: 1, parameters: {}, credentials: null,
      disabled: false, classification: 'shape-replacing' as const,
    });
    displayNameIndex.set(n.displayName, n.name);
  }
  return {
    nodes: nodeMap, forward: new Map(), backward: new Map(),
    displayNameIndex,
    ast: { metadata: { id: 'test', name: 'Test', active: false }, nodes: [], connections: [] } as unknown as WorkflowAST,
  };
}

function makeRef(node: string, referencedNode: string | null, fieldPath: string | null): ExpressionReference {
  return {
    node: nodeIdentity(node),
    parameter: 'value',
    raw: '$json.field',
    referencedNode: referencedNode ? nodeIdentity(referencedNode) : null,
    fieldPath,
    resolved: referencedNode !== null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkSchemas', () => {
  const graph = makeGraph([
    { name: 'httpRequest', displayName: 'HTTP Request', type: 'n8n-nodes-base.httpRequest' },
  ]);

  it('returns empty when no schemaProvider', () => {
    const refs = [makeRef('httpRequest', 'httpRequest', 'name')];
    const findings = checkSchemas(graph, refs);
    expect(findings).toEqual([]);
  });

  it('returns empty when schemaProvider undefined', () => {
    const refs = [makeRef('httpRequest', 'httpRequest', 'name')];
    const findings = checkSchemas(graph, refs, undefined);
    expect(findings).toEqual([]);
  });

  it('no finding when schema has matching field', () => {
    const refs = [makeRef('httpRequest', 'httpRequest', 'name')];
    const provider: NodeSchemaProvider = {
      getNodeSchema: () => ({ properties: { name: { type: 'string' } } }),
    };
    const findings = checkSchemas(graph, refs, provider);
    expect(findings).toEqual([]);
  });

  it('schema-mismatch when field not in schema', () => {
    const refs = [makeRef('httpRequest', 'httpRequest', 'nonExistent')];
    const provider: NodeSchemaProvider = {
      getNodeSchema: () => ({ properties: { name: { type: 'string' } } }),
    };
    const findings = checkSchemas(graph, refs, provider);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('schema-mismatch');
    expect(findings[0].severity).toBe('warning');
  });

  it('skips when schema unavailable', () => {
    const refs = [makeRef('httpRequest', 'httpRequest', 'name')];
    const provider: NodeSchemaProvider = {
      getNodeSchema: () => undefined,
    };
    const findings = checkSchemas(graph, refs, provider);
    expect(findings).toEqual([]);
  });

  it('skips unresolved references', () => {
    const refs = [makeRef('httpRequest', null, null)];
    const provider: NodeSchemaProvider = {
      getNodeSchema: () => ({ properties: { name: { type: 'string' } } }),
    };
    const findings = checkSchemas(graph, refs, provider);
    expect(findings).toEqual([]);
  });
});
