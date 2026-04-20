import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTrustState, persistTrustState } from '../../src/trust/persistence.js';
import { TrustPersistenceError } from '../../src/trust/errors.js';
import type { TrustState, NodeTrustRecord } from '../../src/types/trust.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import type { PersistedTrustStore } from '../../src/trust/types.js';

function ni(name: string): NodeIdentity {
  return name as NodeIdentity;
}

function makeRecord(hash = 'abc123'): NodeTrustRecord {
  return {
    contentHash: hash,
    validatedBy: 'run-001',
    validatedAt: '2026-04-18T00:00:00.000Z',
    validatedWith: 'static',
    fixtureHash: null,
  };
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'trust-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('loadTrustState', () => {
  it('returns empty trust state for missing file', () => {
    const state = loadTrustState('wf-001', tempDir);

    expect(state.workflowId).toBe('wf-001');
    expect(state.nodes.size).toBe(0);
    expect(state.connectionsHash).toBe('');
  });

  it('returns empty trust state for schema version mismatch', () => {
    const store: PersistedTrustStore = {
      schemaVersion: 999,
      workflows: {
        'wf-001': {
          workflowId: 'wf-001',
          workflowHash: 'hash',
          connectionsHash: 'conn-hash',
          nodes: { nodeA: makeRecord() },
        },
      },
    };
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'trust-state.json'), JSON.stringify(store));

    const state = loadTrustState('wf-001', tempDir);

    expect(state.nodes.size).toBe(0);
  });

  it('returns empty trust state when workflow not in file', () => {
    const store: PersistedTrustStore = {
      schemaVersion: 1,
      workflows: {
        'other-wf': {
          workflowId: 'other-wf',
          workflowHash: 'hash',
          connectionsHash: 'conn-hash',
          nodes: {},
        },
      },
    };
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'trust-state.json'), JSON.stringify(store));

    const state = loadTrustState('wf-001', tempDir);

    expect(state.workflowId).toBe('wf-001');
    expect(state.nodes.size).toBe(0);
  });

  it('throws TrustPersistenceError for corrupt JSON', () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'trust-state.json'), '{bad json!!!');

    expect(() => loadTrustState('wf-001', tempDir)).toThrow(TrustPersistenceError);
  });

  it('throws TrustPersistenceError for invalid schema', () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'trust-state.json'), JSON.stringify({ wrong: 'shape' }));

    expect(() => loadTrustState('wf-001', tempDir)).toThrow(TrustPersistenceError);
  });
});

describe('persistTrustState', () => {
  it('round-trip write+read produces equivalent state', () => {
    const nodes = new Map<NodeIdentity, NodeTrustRecord>();
    nodes.set(ni('nodeA'), makeRecord('hash-a'));
    nodes.set(ni('nodeB'), makeRecord('hash-b'));

    const state: TrustState = {
      workflowId: 'wf-001',
      nodes,
      connectionsHash: 'conn-hash-001',
    };

    persistTrustState(state, 'wf-hash-001', tempDir);
    const loaded = loadTrustState('wf-001', tempDir);

    expect(loaded.workflowId).toBe('wf-001');
    expect(loaded.connectionsHash).toBe('conn-hash-001');
    expect(loaded.nodes.size).toBe(2);
    expect(loaded.nodes.get(ni('nodeA'))?.contentHash).toBe('hash-a');
    expect(loaded.nodes.get(ni('nodeB'))?.contentHash).toBe('hash-b');
  });

  it('preserves other workflows in the file', () => {
    // Write workflow A
    const stateA: TrustState = {
      workflowId: 'wf-A',
      nodes: new Map([[ni('n1'), makeRecord('ha')]]),
      connectionsHash: 'ca',
    };
    persistTrustState(stateA, 'wha', tempDir);

    // Write workflow B
    const stateB: TrustState = {
      workflowId: 'wf-B',
      nodes: new Map([[ni('n2'), makeRecord('hb')]]),
      connectionsHash: 'cb',
    };
    persistTrustState(stateB, 'whb', tempDir);

    // Both should be loadable
    const loadedA = loadTrustState('wf-A', tempDir);
    const loadedB = loadTrustState('wf-B', tempDir);

    expect(loadedA.nodes.size).toBe(1);
    expect(loadedB.nodes.size).toBe(1);
  });

  it('Map to Record conversion correctness', () => {
    const nodes = new Map<NodeIdentity, NodeTrustRecord>();
    nodes.set(ni('myNode'), makeRecord('test-hash'));

    const state: TrustState = {
      workflowId: 'wf-001',
      nodes,
      connectionsHash: 'ch',
    };

    persistTrustState(state, 'wh', tempDir);

    // Read raw JSON to verify Record structure
    const raw = JSON.parse(readFileSync(join(tempDir, 'trust-state.json'), 'utf-8'));
    expect(raw.workflows['wf-001'].nodes.myNode).toBeDefined();
    expect(raw.workflows['wf-001'].nodes.myNode.contentHash).toBe('test-hash');

    // Load back and verify Map conversion
    const loaded = loadTrustState('wf-001', tempDir);
    expect(loaded.nodes.get(ni('myNode'))?.contentHash).toBe('test-hash');
  });

  it('creates directory if it does not exist', () => {
    const nestedDir = join(tempDir, 'nested', 'deep');

    const state: TrustState = {
      workflowId: 'wf-001',
      nodes: new Map(),
      connectionsHash: '',
    };

    persistTrustState(state, 'wh', nestedDir);
    const loaded = loadTrustState('wf-001', nestedDir);

    expect(loaded.workflowId).toBe('wf-001');
  });
});

describe('trust migration — old validationLayer field', () => {
  it('reads old validationLayer field and maps to validatedWith', () => {
    const oldStore = {
      schemaVersion: 1,
      workflows: {
        'wf-001': {
          workflowId: 'wf-001',
          workflowHash: 'hash',
          connectionsHash: 'conn-hash',
          nodes: {
            nodeA: {
              contentHash: 'hash-a',
              validatedBy: 'run-001',
              validatedAt: '2026-04-18T00:00:00.000Z',
              validationLayer: 'static',
              fixtureHash: null,
            },
          },
        },
      },
    };
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'trust-state.json'), JSON.stringify(oldStore));

    const state = loadTrustState('wf-001', tempDir);

    expect(state.nodes.get(ni('nodeA'))?.validatedWith).toBe('static');
  });

  it('maps old "both" value to "execution"', () => {
    const oldStore = {
      schemaVersion: 1,
      workflows: {
        'wf-001': {
          workflowId: 'wf-001',
          workflowHash: 'hash',
          connectionsHash: 'conn-hash',
          nodes: {
            nodeA: {
              contentHash: 'hash-a',
              validatedBy: 'run-001',
              validatedAt: '2026-04-18T00:00:00.000Z',
              validationLayer: 'both',
              fixtureHash: 'fix-123',
            },
          },
        },
      },
    };
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'trust-state.json'), JSON.stringify(oldStore));

    const state = loadTrustState('wf-001', tempDir);

    expect(state.nodes.get(ni('nodeA'))?.validatedWith).toBe('execution');
  });

  it('writes new validatedWith field (not validationLayer)', () => {
    const nodes = new Map<NodeIdentity, NodeTrustRecord>();
    nodes.set(ni('nodeA'), makeRecord('hash-a'));

    const state: TrustState = {
      workflowId: 'wf-001',
      nodes,
      connectionsHash: 'conn-hash',
    };

    persistTrustState(state, 'wh', tempDir);

    const raw = JSON.parse(readFileSync(join(tempDir, 'trust-state.json'), 'utf-8'));
    const node = raw.workflows['wf-001'].nodes.nodeA;
    expect(node.validatedWith).toBe('static');
    expect(node.validationLayer).toBeUndefined();
  });

  it('round-trips old format through write+read', () => {
    const oldStore = {
      schemaVersion: 1,
      workflows: {
        'wf-001': {
          workflowId: 'wf-001',
          workflowHash: 'hash',
          connectionsHash: 'conn-hash',
          nodes: {
            nodeA: {
              contentHash: 'hash-a',
              validatedBy: 'run-001',
              validatedAt: '2026-04-18T00:00:00.000Z',
              validationLayer: 'both',
              fixtureHash: 'fix-123',
            },
            nodeB: {
              contentHash: 'hash-b',
              validatedBy: 'run-001',
              validatedAt: '2026-04-18T00:00:00.000Z',
              validationLayer: 'execution',
              fixtureHash: null,
            },
          },
        },
      },
    };
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'trust-state.json'), JSON.stringify(oldStore));

    // Read old format
    const state = loadTrustState('wf-001', tempDir);
    expect(state.nodes.get(ni('nodeA'))?.validatedWith).toBe('execution');
    expect(state.nodes.get(ni('nodeB'))?.validatedWith).toBe('execution');

    // Write back in new format
    persistTrustState(state, 'new-hash', tempDir);

    // Read again — should use new field name
    const reloaded = loadTrustState('wf-001', tempDir);
    expect(reloaded.nodes.get(ni('nodeA'))?.validatedWith).toBe('execution');
    expect(reloaded.nodes.get(ni('nodeB'))?.validatedWith).toBe('execution');

    // Verify raw JSON uses validatedWith, not validationLayer
    const raw = JSON.parse(readFileSync(join(tempDir, 'trust-state.json'), 'utf-8'));
    expect(raw.workflows['wf-001'].nodes.nodeA.validatedWith).toBe('execution');
    expect(raw.workflows['wf-001'].nodes.nodeA.validationLayer).toBeUndefined();
  });
});
