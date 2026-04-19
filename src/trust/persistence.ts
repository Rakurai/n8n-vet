/**
 * Trust state persistence — read/write trust state to local JSON file with
 * schema versioning, Zod validation, and typed error handling.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
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
    } catch (err) {
      if (err instanceof SyntaxError) {
        // JSON parse failure — start fresh
      } else {
        throw err;
      }
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

  const content = JSON.stringify(store, null, 2);

  // Atomic write: write to temp file then rename
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const lockPath = `${filePath}.lock`;

  // Advisory lock via sentinel file
  acquireAdvisoryLock(lockPath);
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, filePath);
  } finally {
    releaseAdvisoryLock(lockPath);
  }
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

const LOCK_STALE_MS = 10_000;

function acquireAdvisoryLock(lockPath: string): void {
  // If lock exists and is stale, remove it
  if (existsSync(lockPath)) {
    try {
      const raw = readFileSync(lockPath, 'utf-8');
      const timestamp = Number.parseInt(raw, 10);
      if (Date.now() - timestamp > LOCK_STALE_MS) {
        unlinkSync(lockPath);
      }
    } catch {
      // Lock file unreadable — remove
      try {
        unlinkSync(lockPath);
      } catch {
        /* already gone */
      }
    }
  }

  mkdirSync(dirname(lockPath), { recursive: true });
  // Best-effort advisory lock via exclusive file creation
  writeFileSync(lockPath, String(Date.now()), { flag: 'wx' });
}

function releaseAdvisoryLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    /* already gone */
  }
}
