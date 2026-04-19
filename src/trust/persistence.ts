/**
 * Trust state persistence — read/write trust state to local JSON file with
 * schema versioning, Zod validation, and typed error handling.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NodeIdentity } from '../types/identity.js';
import type { NodeTrustRecord, TrustState } from '../types/trust.js';
import { TrustPersistenceError } from './errors.js';
import { type PersistedTrustStore, persistedTrustStoreSchema } from './types.js';

const TRUST_FILE = 'trust-state.json';
const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_DATA_DIR = '.n8n-vet';

/**
 * Load trust state from the local JSON file.
 *
 * - Missing file → empty trust state (no error)
 * - Schema version mismatch → empty trust state (no error)
 * - Corrupt file → throws TrustPersistenceError
 * - Workflow not in file → empty trust state (no error)
 */
export function loadTrustState(workflowId: string, dataDir?: string): TrustState {
  const filePath = resolveFilePath(dataDir);

  if (!existsSync(filePath)) {
    return emptyState(workflowId);
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new TrustPersistenceError(filePath, err instanceof Error ? err : new Error(String(err)));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TrustPersistenceError(filePath, err instanceof Error ? err : new Error(String(err)));
  }

  const result = persistedTrustStoreSchema.safeParse(parsed);
  if (!result.success) {
    throw new TrustPersistenceError(filePath, new Error(result.error.message));
  }

  const store = result.data;

  // Schema version mismatch → discard
  if (store.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return emptyState(workflowId);
  }

  // Workflow not in file → empty
  const workflow = store.workflows[workflowId];
  if (!workflow) {
    return emptyState(workflowId);
  }

  // Convert Record to Map
  const nodes = new Map<NodeIdentity, NodeTrustRecord>();
  for (const [key, record] of Object.entries(workflow.nodes)) {
    nodes.set(key as NodeIdentity, record);
  }

  return {
    workflowId,
    nodes,
    connectionsHash: workflow.connectionsHash,
  };
}

/**
 * Write trust state to the local JSON file.
 *
 * Creates directory if needed. Reads existing file to preserve other
 * workflows' trust state. Merges the specified workflow's state.
 */
export function persistTrustState(state: TrustState, workflowHash: string, dataDir?: string): void {
  const filePath = resolveFilePath(dataDir);
  const dir = resolveDir(dataDir);

  mkdirSync(dir, { recursive: true });

  // Read existing file to preserve other workflows
  let store: PersistedTrustStore = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    workflows: {},
  };

  if (existsSync(filePath)) {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new TrustPersistenceError(
        filePath,
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    try {
      const parsed = JSON.parse(raw);
      const result = persistedTrustStoreSchema.safeParse(parsed);
      if (result.success && result.data.schemaVersion === CURRENT_SCHEMA_VERSION) {
        store = result.data;
      }
    } catch {
      // JSON parse failure — start fresh
    }
  }

  // Convert Map to Record
  const nodesRecord: Record<string, NodeTrustRecord> = {};
  for (const [key, record] of state.nodes) {
    nodesRecord[key] = record;
  }

  store.workflows[state.workflowId] = {
    workflowId: state.workflowId,
    workflowHash,
    connectionsHash: state.connectionsHash,
    nodes: nodesRecord,
  };

  writeFileSync(filePath, JSON.stringify(store, null, 2));
}

function resolveFilePath(dataDir?: string): string {
  return join(dataDir ?? process.env.N8N_VET_DATA_DIR ?? DEFAULT_DATA_DIR, TRUST_FILE);
}

function resolveDir(dataDir?: string): string {
  return dataDir ?? process.env.N8N_VET_DATA_DIR ?? DEFAULT_DATA_DIR;
}

function emptyState(workflowId: string): TrustState {
  return {
    workflowId,
    nodes: new Map(),
    connectionsHash: '',
  };
}
