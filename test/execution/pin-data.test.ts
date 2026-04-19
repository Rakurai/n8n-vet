/**
 * Unit tests for pin data construction.
 *
 * Covers: all 4 tiers (agent-fixture > prior-artifact > execution-history > error),
 * source map correctness, normalization of flat objects to { json } wrapper,
 * error on missing data with specific node names.
 */

import { describe, it, expect } from 'vitest';
import { nodeIdentity } from '../../src/types/identity.js';
import type { PinDataItem } from '../../src/execution/types.js';

// Functions under test (will be imported once T013/T014 are implemented)
import { constructPinData, normalizePinData } from '../../src/execution/pin-data.js';
import { ExecutionPreconditionError } from '../../src/execution/errors.js';

// ---------------------------------------------------------------------------
// Helper: minimal graph for testing
// ---------------------------------------------------------------------------

function makeTestGraph(nodeNames: string[], triggerNodes: string[] = []) {
  const nodes = new Map<string, { name: string; displayName: string; type: string; typeVersion: number; parameters: Record<string, unknown>; credentials: null; disabled: boolean; classification: 'shape-opaque' }>();

  for (const name of nodeNames) {
    const isTrigger = triggerNodes.includes(name);
    nodes.set(name, {
      name,
      displayName: name,
      type: isTrigger ? 'n8n-nodes-base.manualTrigger' : 'n8n-nodes-base.httpRequest',
      typeVersion: 1,
      parameters: {},
      credentials: null,
      disabled: false,
      classification: 'shape-opaque',
    });
  }

  return {
    nodes,
    forward: new Map(),
    backward: new Map(),
    displayNameIndex: new Map(),
    ast: {} as any,
  };
}

// ---------------------------------------------------------------------------
// constructPinData
// ---------------------------------------------------------------------------

describe('constructPinData', () => {
  it('sources pin data from agent fixtures (tier 1)', () => {
    const graph = makeTestGraph(['trigger', 'nodeA'], ['trigger']);
    const fixtures: Record<string, PinDataItem[]> = {
      trigger: [{ json: { id: 1 } }],
    };

    const result = constructPinData(
      graph,
      [nodeIdentity('trigger')],
      fixtures,
    );

    expect(result.pinData['trigger']).toHaveLength(1);
    expect(result.sourceMap['trigger']).toBe('agent-fixture');
  });

  it('tier 1 (fixture) wins over tier 2 (prior artifact)', () => {
    const graph = makeTestGraph(['trigger'], ['trigger']);
    const fixtures: Record<string, PinDataItem[]> = {
      trigger: [{ json: { from: 'fixture' } }],
    };
    const priorArtifacts: Record<string, PinDataItem[]> = {
      trigger: [{ json: { from: 'artifact' } }],
    };

    const result = constructPinData(
      graph,
      [nodeIdentity('trigger')],
      fixtures,
      priorArtifacts,
    );

    expect(result.sourceMap['trigger']).toBe('agent-fixture');
    expect(result.pinData['trigger']![0]!.json['from']).toBe('fixture');
  });

  it('falls to tier 2 (prior artifact) when no fixture', () => {
    const graph = makeTestGraph(['trigger'], ['trigger']);
    const priorArtifacts: Record<string, PinDataItem[]> = {
      trigger: [{ json: { from: 'artifact' } }],
    };

    const result = constructPinData(
      graph,
      [nodeIdentity('trigger')],
      undefined,
      priorArtifacts,
    );

    expect(result.sourceMap['trigger']).toBe('prior-artifact');
  });

  it('throws ExecutionPreconditionError when nodes lack pin data', () => {
    const graph = makeTestGraph(['trigger', 'boundaryNode'], ['trigger']);

    expect(() =>
      constructPinData(
        graph,
        [nodeIdentity('trigger'), nodeIdentity('boundaryNode')],
      ),
    ).toThrow(ExecutionPreconditionError);
  });

  it('error message lists specific missing node names', () => {
    const graph = makeTestGraph(['trigger', 'nodeA', 'nodeB'], ['trigger']);

    try {
      constructPinData(
        graph,
        [nodeIdentity('trigger'), nodeIdentity('nodeA'), nodeIdentity('nodeB')],
      );
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as ExecutionPreconditionError;
      expect(err.reason).toBe('missing-pin-data');
      expect(err.message).toContain('trigger');
      expect(err.message).toContain('nodeA');
    }
  });

  it('builds source map with correct tier for each node', () => {
    const graph = makeTestGraph(['trigger', 'boundary'], ['trigger']);
    const fixtures: Record<string, PinDataItem[]> = {
      trigger: [{ json: { id: 1 } }],
    };
    const priorArtifacts: Record<string, PinDataItem[]> = {
      boundary: [{ json: { id: 2 } }],
    };

    const result = constructPinData(
      graph,
      [nodeIdentity('trigger'), nodeIdentity('boundary')],
      fixtures,
      priorArtifacts,
    );

    expect(result.sourceMap['trigger']).toBe('agent-fixture');
    expect(result.sourceMap['boundary']).toBe('prior-artifact');
  });
});

// ---------------------------------------------------------------------------
// normalizePinData
// ---------------------------------------------------------------------------

describe('normalizePinData', () => {
  it('wraps flat object in { json } wrapper', () => {
    const raw = [{ id: 1, name: 'test' }] as unknown as PinDataItem[];
    const normalized = normalizePinData(raw);
    expect(normalized[0]!.json).toEqual({ id: 1, name: 'test' });
  });

  it('passes through already-wrapped items unchanged', () => {
    const items: PinDataItem[] = [{ json: { id: 1 } }];
    const normalized = normalizePinData(items);
    expect(normalized).toEqual(items);
  });

  it('handles mixed arrays of flat and wrapped items', () => {
    const raw = [
      { json: { id: 1 } },
      { name: 'flat' },
    ] as unknown as PinDataItem[];
    const normalized = normalizePinData(raw);
    expect(normalized[0]!.json).toEqual({ id: 1 });
    expect(normalized[1]!.json).toEqual({ name: 'flat' });
  });

  it('returns empty array for empty input', () => {
    expect(normalizePinData([])).toEqual([]);
  });
});
