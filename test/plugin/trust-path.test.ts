import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadTrustState, persistTrustState } from '../../src/trust/persistence.js';
import type { TrustState, NodeTrustRecord } from '../../src/types/trust.js';
import type { NodeIdentity } from '../../src/types/identity.js';

const SCRATCH = join(resolve('.'), '.scratch/test-trust-path');
const DEFAULT_DIR = join(resolve('.'), '.n8n-vet');
const ENV_KEY = 'N8N_VET_DATA_DIR';

function makeTrustState(workflowId: string): TrustState {
  const record: NodeTrustRecord = {
    contentHash: 'abc123',
    validatedBy: 'test-run-1',
    validatedAt: new Date().toISOString(),
    validatedWith: 'static',
    fixtureHash: null,
  };
  const nodes = new Map<NodeIdentity, NodeTrustRecord>([
    ['NodeA' as NodeIdentity, record],
  ]);
  return { workflowId, nodes, connectionsHash: 'conn-hash' };
}

describe('trust state path resolution (N8N_VET_DATA_DIR)', () => {
  let originalEnv: string | undefined;

  function cleanup() {
    if (existsSync(SCRATCH)) rmSync(SCRATCH, { recursive: true, force: true });
    // Clean default dir trust file only (don't nuke the whole .n8n-vet)
    const defaultFile = join(DEFAULT_DIR, 'trust-state.json');
    if (existsSync(defaultFile)) rmSync(defaultFile);
  }

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    cleanup();
  });

  it('writes trust state under N8N_VET_DATA_DIR when env var is set', () => {
    originalEnv = process.env[ENV_KEY];
    process.env[ENV_KEY] = SCRATCH;

    const state = makeTrustState('trust-env-test');
    persistTrustState(state, 'wf-hash-1');

    const filePath = join(SCRATCH, 'trust-state.json');
    expect(existsSync(filePath)).toBe(true);

    const loaded = loadTrustState('trust-env-test');
    expect(loaded.nodes.size).toBe(1);
  });

  it('writes trust state under .n8n-vet/ when N8N_VET_DATA_DIR is absent', () => {
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];

    const state = makeTrustState('trust-default-test');
    persistTrustState(state, 'wf-hash-2');

    const filePath = join(DEFAULT_DIR, 'trust-state.json');
    expect(existsSync(filePath)).toBe(true);

    const loaded = loadTrustState('trust-default-test');
    expect(loaded.nodes.size).toBe(1);
  });
});
