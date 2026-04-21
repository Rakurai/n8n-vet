/**
 * Workaround: enable MCP access on n8n workflows via REST API.
 *
 * Older versions of n8nac strip the `availableInMCP` workflow setting on push.
 * The committed fixture .ts files have `availableInMCP: true`, so newer n8nac
 * versions that preserve the flag will not need this workaround.
 *
 * On first run, samples one workflow to detect whether the flag was preserved.
 * The result is cached in a local state file so subsequent runs skip the check.
 *
 * TEMPORARY — remove when the minimum supported n8nac version preserves the flag.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface WorkflowResponse {
  id: string;
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

interface LocalState {
  mcpAccessVerified?: boolean;
}

const STATE_FILE = '.local-state.json';

function readState(fixturesDir: string): LocalState {
  const path = join(fixturesDir, STATE_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as LocalState;
  } catch {
    return {};
  }
}

function writeState(fixturesDir: string, state: LocalState): void {
  writeFileSync(join(fixturesDir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

/**
 * Force `availableInMCP: true` on a single workflow via PUT.
 */
async function forceEnableMcpAccess(
  host: string,
  apiKey: string,
  workflowId: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': apiKey,
  };

  const getResp = await fetch(`${host}/api/v1/workflows/${workflowId}`, { headers });
  if (!getResp.ok) {
    throw new Error(`Failed to GET workflow ${workflowId}: HTTP ${getResp.status}`);
  }
  const data = (await getResp.json()) as WorkflowResponse;

  if (data.settings?.availableInMCP === true) return;

  const putResp = await fetch(`${host}/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      name: data.name,
      nodes: data.nodes,
      connections: data.connections,
      settings: { ...data.settings, availableInMCP: true },
    }),
  });

  if (!putResp.ok) {
    const text = await putResp.text();
    throw new Error(`Failed to enable MCP on workflow ${workflowId}: HTTP ${putResp.status} — ${text}`);
  }
}

/**
 * Ensure MCP access on all workflows in a manifest.
 *
 * Checks a local state file first — if already verified, skips entirely (0 API
 * calls). Otherwise samples one workflow, fixes all if needed, and persists the
 * result so future runs are free.
 */
export async function ensureMcpAccess(
  host: string,
  apiKey: string,
  manifest: Record<string, string>,
  fixturesDir: string,
): Promise<void> {
  const ids = Object.values(manifest);
  if (ids.length === 0) return;

  // Fast path: already verified in a previous run
  const state = readState(fixturesDir);
  if (state.mcpAccessVerified) return;

  // Check every workflow — a reseed can leave individual workflows with the
  // flag stripped even when others still have it. Sampling one is not enough.
  for (const id of ids) {
    await forceEnableMcpAccess(host, apiKey, id);
  }

  // Persist so subsequent runs skip the check
  writeState(fixturesDir, { ...state, mcpAccessVerified: true });
}
