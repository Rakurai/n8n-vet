import { describe, it, expect } from 'vitest';
import { classifyNode } from '../../src/static-analysis/classify.js';
import type { NodeAST } from '@n8n-as-code/transformer';

function makeNode(overrides: Partial<NodeAST> & { type: string }): NodeAST {
  return {
    propertyName: 'testNode',
    displayName: 'Test Node',
    version: 1,
    position: [0, 0],
    parameters: {},
    ...overrides,
  };
}

describe('classifyNode', () => {
  it('classifies If as shape-preserving', () => {
    expect(classifyNode(makeNode({ type: 'n8n-nodes-base.if' }))).toBe('shape-preserving');
  });

  it('classifies Switch as shape-preserving', () => {
    expect(classifyNode(makeNode({ type: 'n8n-nodes-base.switch' }))).toBe('shape-preserving');
  });

  it('classifies Filter as shape-preserving', () => {
    expect(classifyNode(makeNode({ type: 'n8n-nodes-base.filter' }))).toBe('shape-preserving');
  });

  it('classifies Set node with no options.include as shape-augmenting', () => {
    expect(classifyNode(makeNode({ type: 'n8n-nodes-base.set' }))).toBe('shape-augmenting');
  });

  it('classifies Set node with options.include = "all" as shape-augmenting', () => {
    const node = makeNode({
      type: 'n8n-nodes-base.set',
      parameters: { options: { include: 'all' } },
    });
    expect(classifyNode(node)).toBe('shape-augmenting');
  });

  it('classifies Set node with options.include = "selected" as shape-replacing', () => {
    const node = makeNode({
      type: 'n8n-nodes-base.set',
      parameters: { options: { include: 'selected' } },
    });
    expect(classifyNode(node)).toBe('shape-replacing');
  });

  it('classifies Set node with options.include = "none" as shape-replacing', () => {
    const node = makeNode({
      type: 'n8n-nodes-base.set',
      parameters: { options: { include: 'none' } },
    });
    expect(classifyNode(node)).toBe('shape-replacing');
  });

  it('classifies Code node as shape-opaque', () => {
    expect(classifyNode(makeNode({ type: 'n8n-nodes-base.code' }))).toBe('shape-opaque');
  });

  it('classifies trigger node as shape-replacing', () => {
    expect(classifyNode(makeNode({ type: 'n8n-nodes-base.scheduleTrigger' }))).toBe('shape-replacing');
  });

  it('classifies HTTP Request as shape-replacing', () => {
    expect(classifyNode(makeNode({ type: 'n8n-nodes-base.httpRequest' }))).toBe('shape-replacing');
  });

  it('classifies credential-based node as shape-replacing', () => {
    const node = makeNode({
      type: 'n8n-nodes-base.somethingUnknown',
      credentials: { slackApi: { id: '1', name: 'Slack' } },
    });
    expect(classifyNode(node)).toBe('shape-replacing');
  });

  it('classifies unknown type with no credentials as shape-opaque', () => {
    expect(classifyNode(makeNode({ type: 'n8n-nodes-base.somethingUnknown' }))).toBe('shape-opaque');
  });
});
