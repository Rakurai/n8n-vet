/**
 * Seed script — creates 7 test workflows on a live n8n instance and pulls
 * them as committed n8nac artifacts to test/integration/fixtures/.
 *
 * Usage:
 *   npx tsx test/integration/seed.ts              # Seed all fixtures
 *   npx tsx test/integration/seed.ts --fixture happy-path  # Single fixture
 *   npx tsx test/integration/seed.ts --dry-run    # Preview only
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Types ────────────────────────────────────────────────────────

interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

interface WorkflowConnection {
  node: string;
  type: string;
  index: number;
}

interface WorkflowCreatePayload {
  name: string;
  nodes: WorkflowNode[];
  connections: Record<string, { main: WorkflowConnection[][] }>;
  settings: { executionOrder: string };
  active: boolean;
}

// ── Fixture Definitions ──────────────────────────────────────────

const PREFIX = 'n8n-vet-test--';

function trigger(id: string, name: string, pos: [number, number]): WorkflowNode {
  return {
    id,
    name,
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: pos,
    parameters: {},
  };
}

function setNode(id: string, name: string, pos: [number, number], assignments: Array<{ name: string; value: string; type: string }>): WorkflowNode {
  return {
    id,
    name,
    type: 'n8n-nodes-base.set',
    typeVersion: 3,
    position: pos,
    parameters: { assignments: { assignments } },
  };
}

function httpRequest(id: string, name: string, pos: [number, number], url: string, creds?: Record<string, unknown>): WorkflowNode {
  const node: WorkflowNode = {
    id,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4,
    position: pos,
    parameters: { url, method: 'GET' },
  };
  if (creds) node.credentials = creds;
  return node;
}

function conn(node: string, index = 0): WorkflowConnection {
  return { node, type: 'main', index };
}

const FIXTURES: Record<string, WorkflowCreatePayload> = {
  'happy-path': {
    name: `${PREFIX}happy-path`,
    nodes: [
      trigger('t1', 'Trigger', [100, 200]),
      setNode('s1', 'Set', [300, 200], [{ name: 'greeting', value: 'hello', type: 'string' }]),
      { id: 'n1', name: 'NoOp', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [500, 200] as [number, number], parameters: {} },
    ],
    connections: {
      Trigger: { main: [[conn('Set')]] },
      Set: { main: [[conn('NoOp')]] },
    },
    settings: { executionOrder: 'v1' },
    active: false,
  },

  'broken-wiring': {
    name: `${PREFIX}broken-wiring`,
    nodes: [
      trigger('t1', 'Trigger', [100, 200]),
      setNode('s1', 'Set', [300, 200], [{ name: 'data', value: 'test', type: 'string' }]),
      httpRequest('h1', 'Orphaned HTTP', [300, 400], 'https://example.com/api'),
    ],
    connections: {
      Trigger: { main: [[conn('Set')]] },
      // Orphaned HTTP is NOT connected
    },
    settings: { executionOrder: 'v1' },
    active: false,
  },

  'data-loss-passthrough': {
    name: `${PREFIX}data-loss-passthrough`,
    nodes: [
      trigger('t1', 'Trigger', [100, 200]),
      httpRequest('h1', 'HTTP Request', [300, 200], 'https://example.com/data'),
      setNode('s1', 'Transform', [500, 200], [{ name: 'processed', value: '={{ $json.result }}', type: 'string' }]),
      setNode('s2', 'Use Original', [700, 200], [{ name: 'original', value: '={{ $json.rawData }}', type: 'string' }]),
    ],
    connections: {
      Trigger: { main: [[conn('HTTP Request')]] },
      'HTTP Request': { main: [[conn('Transform')]] },
      Transform: { main: [[conn('Use Original')]] },
    },
    settings: { executionOrder: 'v1' },
    active: false,
  },

  'expression-bug': {
    name: `${PREFIX}expression-bug`,
    nodes: [
      trigger('t1', 'Trigger', [100, 200]),
      setNode('s1', 'Bad Expression', [300, 200], [{ name: 'value', value: '={{ $json.nonexistent.deep.path }}', type: 'string' }]),
    ],
    connections: {
      Trigger: { main: [[conn('Bad Expression')]] },
    },
    settings: { executionOrder: 'v1' },
    active: false,
  },

  'credential-failure': {
    name: `${PREFIX}credential-failure`,
    nodes: [
      trigger('t1', 'Trigger', [100, 200]),
      httpRequest('h1', 'HTTP No Creds', [300, 200], 'https://api.example.com/protected'),
      setNode('s1', 'Process', [500, 200], [{ name: 'result', value: '={{ $json.data }}', type: 'string' }]),
    ],
    connections: {
      Trigger: { main: [[conn('HTTP No Creds')]] },
      'HTTP No Creds': { main: [[conn('Process')]] },
    },
    settings: { executionOrder: 'v1' },
    active: false,
  },

  'branching-coverage': {
    name: `${PREFIX}branching-coverage`,
    nodes: [
      trigger('t1', 'Trigger', [100, 200]),
      {
        id: 'if1', name: 'If', type: 'n8n-nodes-base.if', typeVersion: 2,
        position: [300, 200] as [number, number],
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '' },
            conditions: [{ leftValue: '={{ $json.value }}', rightValue: 'true', operator: { type: 'string', operation: 'equals' } }],
            combinator: 'and',
          },
        },
      },
      setNode('s1', 'True Path', [500, 100], [{ name: 'branch', value: 'true', type: 'string' }]),
      setNode('s2', 'False Path', [500, 300], [{ name: 'branch', value: 'false', type: 'string' }]),
    ],
    connections: {
      Trigger: { main: [[conn('If')]] },
      If: { main: [[conn('True Path')], [conn('False Path')]] },
    },
    settings: { executionOrder: 'v1' },
    active: false,
  },

  'multi-node-change': {
    name: `${PREFIX}multi-node-change`,
    nodes: [
      trigger('t1', 'Trigger', [100, 200]),
      setNode('a1', 'A', [300, 200], [{ name: 'step', value: 'A', type: 'string' }]),
      setNode('b1', 'B', [500, 200], [{ name: 'step', value: 'B', type: 'string' }]),
      setNode('c1', 'C', [700, 200], [{ name: 'step', value: 'C', type: 'string' }]),
      setNode('d1', 'D', [900, 200], [{ name: 'step', value: 'D', type: 'string' }]),
    ],
    connections: {
      Trigger: { main: [[conn('A')]] },
      A: { main: [[conn('B')]] },
      B: { main: [[conn('C')]] },
      C: { main: [[conn('D')]] },
    },
    settings: { executionOrder: 'v1' },
    active: false,
  },
};

// ── CLI ──────────────────────────────────────────────────────────

interface SeedArgs {
  fixture: string | null;
  dryRun: boolean;
}

function parseArgs(): SeedArgs {
  const args = process.argv.slice(2);
  const result: SeedArgs = { fixture: null, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') result.dryRun = true;
    else if (args[i] === '--fixture' && args[i + 1]) {
      result.fixture = args[++i];
    }
  }

  return result;
}

// ── REST API Helpers ─────────────────────────────────────────────

const N8N_BASE_URL = process.env.N8N_BASE_URL ?? 'http://localhost:5678';

function getApiHeaders(): Record<string, string> {
  const apiKey = process.env.N8N_API_KEY ?? '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-N8N-API-KEY'] = apiKey;
  return headers;
}

async function findExistingWorkflow(name: string): Promise<string | null> {
  const headers = getApiHeaders();
  let cursor: string | undefined;

  // Paginate through all workflows to find by name
  do {
    const url = new URL(`${N8N_BASE_URL}/api/v1/workflows`);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) throw new Error(`Failed to list workflows: HTTP ${response.status}`);

    const body = await response.json() as { data: Array<{ id: string; name: string }>; nextCursor?: string };
    const match = body.data.find(w => w.name === name);
    if (match) return match.id;

    cursor = body.nextCursor;
  } while (cursor);

  return null;
}

async function createWorkflow(payload: WorkflowCreatePayload): Promise<string> {
  const headers = getApiHeaders();
  const response = await fetch(`${N8N_BASE_URL}/api/v1/workflows`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create workflow '${payload.name}': HTTP ${response.status} — ${text}`);
  }

  const body = await response.json() as { id: string };
  return body.id;
}

async function updateWorkflow(id: string, payload: WorkflowCreatePayload): Promise<void> {
  const headers = getApiHeaders();
  const response = await fetch(`${N8N_BASE_URL}/api/v1/workflows/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update workflow '${payload.name}' (${id}): HTTP ${response.status} — ${text}`);
  }
}

// ── n8nac Pull ───────────────────────────────────────────────────

function pullWorkflow(workflowId: string): string {
  // n8nac pull writes a .ts file to the current n8nac project
  execFileSync('n8nac', ['pull', workflowId], { stdio: 'pipe', encoding: 'utf-8' });

  // Find the pulled file — n8nac puts it relative to project root
  // Look in typical n8nac output locations
  const candidates = [
    `workflows/${workflowId}.ts`,
    `${workflowId}.ts`,
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate);
  }

  // If we can't find by ID, search for the file by name pattern
  throw new Error(`Could not find pulled workflow file for ${workflowId}`);
}

// ── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const fixturesDir = resolve('test/integration/fixtures');
  mkdirSync(fixturesDir, { recursive: true });

  const fixtureNames = args.fixture ? [args.fixture] : Object.keys(FIXTURES);
  const manifest: Record<string, string> = {};

  // Load existing manifest if refreshing a single fixture
  const manifestPath = join(fixturesDir, 'manifest.json');
  if (args.fixture && existsSync(manifestPath)) {
    Object.assign(manifest, JSON.parse(readFileSync(manifestPath, 'utf-8')));
  }

  console.log(`Seeding ${fixtureNames.length} fixture(s)...\n`);

  for (const name of fixtureNames) {
    const payload = FIXTURES[name];
    if (!payload) {
      console.error(`Unknown fixture: ${name}`);
      process.exit(1);
    }

    if (args.dryRun) {
      console.log(`  [dry-run] Would create/update: ${payload.name} (${payload.nodes.length} nodes)`);
      continue;
    }

    // Create or update workflow on n8n
    const existingId = await findExistingWorkflow(payload.name);
    let workflowId: string;

    if (existingId) {
      console.log(`  Updating: ${payload.name} (${existingId})`);
      await updateWorkflow(existingId, payload);
      workflowId = existingId;
    } else {
      console.log(`  Creating: ${payload.name}`);
      workflowId = await createWorkflow(payload);
      console.log(`    → ID: ${workflowId}`);
    }

    manifest[name] = workflowId;

    // Pull via n8nac and copy to fixtures dir
    const pulledPath = pullWorkflow(workflowId);
    const destPath = join(fixturesDir, `${name}.ts`);
    copyFileSync(pulledPath, destPath);
    console.log(`    → Pulled to: ${destPath}`);
  }

  if (!args.dryRun) {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\nManifest written: ${manifestPath}`);
  }

  console.log('\nDone.');
}

main();
