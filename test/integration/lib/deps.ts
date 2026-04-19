/**
 * Test dependency builder — wraps buildDeps() from src/deps.ts and overrides
 * the four persistence functions to bind dataDir to the IntegrationContext's
 * isolated temp directories.
 *
 * This ensures each test scenario's trust state and snapshots are fully
 * isolated from each other and from the user's real .n8n-vet directory.
 */

import { buildDeps } from '../../../src/deps.js';
import { loadTrustState, persistTrustState } from '../../../src/trust/persistence.js';
import { loadSnapshot, saveSnapshot } from '../../../src/orchestrator/snapshots.js';
import type { OrchestratorDeps } from '../../../src/orchestrator/types.js';

/**
 * Build OrchestratorDeps with persistence functions bound to isolated directories.
 *
 * @param trustDir - Directory for trust state files (temp per test run)
 * @param snapshotDir - Directory for snapshot files (temp per test run)
 */
export function buildTestDeps(trustDir: string, snapshotDir: string): OrchestratorDeps {
  const deps = buildDeps();

  return {
    ...deps,
    loadTrustState: (workflowId: string) => loadTrustState(workflowId, trustDir),
    persistTrustState: (state, workflowHash) => persistTrustState(state, workflowHash, trustDir),
    loadSnapshot: (workflowId: string) => loadSnapshot(workflowId, snapshotDir),
    saveSnapshot: (workflowId, graph) => saveSnapshot(workflowId, graph, snapshotDir),
  };
}
