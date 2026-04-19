/**
 * Integration test setup — prerequisite checks, temp directory creation,
 * manifest loading, and cleanup.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// ── Types ────────────────────────────────────────────────────────

/** Maps fixture names to n8n workflow IDs. */
export type Manifest = Record<string, string>;

/** Shared context object passed to every scenario. */
export interface IntegrationContext {
  n8nBaseUrl: string;
  apiKey: string | null;
  trustDir: string;
  snapshotDir: string;
  fixturesDir: string;
  manifest: Manifest;
  cleanup: () => void;
}

// ── Setup ────────────────────────────────────────────────────────

const FIXTURES_DIR = resolve('test/integration/fixtures');
const N8N_BASE_URL = process.env.N8N_BASE_URL ?? 'http://localhost:5678';

/**
 * Verify all 7 prerequisites and create an IntegrationContext.
 * Throws on any prerequisite failure.
 */
export async function setup(): Promise<IntegrationContext> {
  // 1. n8n reachable via GET /api/v1/workflows
  await checkN8nReachable();

  // 2. n8nac available via `n8nac --version`
  checkCommand('n8nac', ['--version'], 'n8nac CLI not available');

  // 3. API key configured
  const apiKey = checkApiKey();

  // 4. n8nac pointed at correct host via `n8nac config`
  checkN8nacConfig();

  // 5. Node.js 20+ via `node --version`
  checkNodeVersion();

  // 6. Project built via dist/ existence
  checkProjectBuilt();

  // 7. Manifest exists
  const manifest = loadManifest();

  // Create temp dirs for trust/snapshot isolation
  const base = join(tmpdir(), `n8n-vet-integ-${Date.now()}`);
  const trustDir = join(base, 'trust');
  const snapshotDir = join(base, 'snapshots');
  mkdirSync(trustDir, { recursive: true });
  mkdirSync(snapshotDir, { recursive: true });

  return {
    n8nBaseUrl: N8N_BASE_URL,
    apiKey,
    trustDir,
    snapshotDir,
    fixturesDir: FIXTURES_DIR,
    manifest,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/**
 * Create a fresh IntegrationContext for a single scenario with isolated
 * trust/snapshot directories. Inherits shared fields from the base context.
 */
export function createScenarioContext(base: IntegrationContext): IntegrationContext {
  const dir = join(tmpdir(), `n8n-vet-scenario-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const trustDir = join(dir, 'trust');
  const snapshotDir = join(dir, 'snapshots');
  mkdirSync(trustDir, { recursive: true });
  mkdirSync(snapshotDir, { recursive: true });

  return {
    ...base,
    trustDir,
    snapshotDir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ── Prerequisite checks ──────────────────────────────────────────

async function checkN8nReachable(): Promise<void> {
  const apiKey = process.env.N8N_API_KEY ?? '';
  const headers: Record<string, string> = {};
  if (apiKey) headers['X-N8N-API-KEY'] = apiKey;

  const url = `${N8N_BASE_URL}/api/v1/workflows`;
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (err) {
    throw new Error(`n8n not reachable at ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    throw new Error(`n8n returned HTTP ${response.status} from ${url}`);
  }
}

function checkCommand(cmd: string, args: string[], errorMsg: string): void {
  try {
    execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf-8' });
  } catch {
    throw new Error(errorMsg);
  }
}

function checkApiKey(): string | null {
  const key = process.env.N8N_API_KEY;
  if (key) return key;

  // Check if n8nac has a configured API key
  try {
    const output = execFileSync('n8nac', ['config'], { stdio: 'pipe', encoding: 'utf-8' });
    if (/api.?key/i.test(output)) return null; // key is managed by n8nac, not directly available
  } catch {
    // fall through
  }

  throw new Error('N8N_API_KEY env var not set and n8nac config does not show a configured key');
}

function checkN8nacConfig(): void {
  try {
    const output = execFileSync('n8nac', ['config'], { stdio: 'pipe', encoding: 'utf-8' });
    if (!output.includes('host') && !output.includes('url')) {
      throw new Error('n8nac config does not show a configured host');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('n8nac config')) throw err;
    throw new Error(`n8nac config check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function checkNodeVersion(): void {
  const output = execFileSync('node', ['--version'], { stdio: 'pipe', encoding: 'utf-8' });
  const match = output.trim().match(/^v(\d+)/);
  if (!match || parseInt(match[1], 10) < 20) {
    throw new Error(`Node.js 20+ required, got: ${output.trim()}`);
  }
}

function checkProjectBuilt(): void {
  if (!existsSync(resolve('dist'))) {
    throw new Error('Project not built — run `npm run build` first (dist/ not found)');
  }
}

function loadManifest(): Manifest {
  const manifestPath = join(FIXTURES_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath} — run seed script first`);
  }

  const raw = readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw) as Manifest;
}
