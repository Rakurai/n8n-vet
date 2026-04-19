/**
 * REST API client for n8n execution.
 *
 * Handles credential resolution from a 4-level config cascade,
 * bounded execution via POST /workflows/:id/run, and execution
 * status/data retrieval via GET /executions/:id.
 *
 * Zod schemas validate all REST API response boundaries per
 * constitution principle II (Contract-Driven Boundaries).
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

import type {
  ExplicitCredentials,
  ExecutionResult,
  ExecutionStatus,
  PinData,
  ResolvedCredentials,
} from './types.js';
import {
  ExecutionConfigError,
  ExecutionInfrastructureError,
  ExecutionPreconditionError,
} from './errors.js';
import { withExecutionLock } from './lock.js';
import { extractExecutionData } from './results.js';
import type { RawResultData } from './results.js';
import type { PollingStrategy, PollStatusResult } from './poll.js';
import type { NodeIdentity } from '../types/identity.js';
import type { ExecutionData } from './types.js';

// ---------------------------------------------------------------------------
// Zod schemas — REST API response boundaries (T005)
// ---------------------------------------------------------------------------

/** Schema for POST /workflows/:id/run response. */
export const TriggerExecutionResponseSchema = z.object({
  data: z.object({
    executionId: z.string(),
  }),
});

/** Schema for GET /executions/:id response (status-only fields). */
export const ExecutionStatusResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    finished: z.boolean(),
    mode: z.string(),
    status: z.string(),
    startedAt: z.string(),
    stoppedAt: z.string().nullable(),
  }),
});

/** Schema for GET /executions/:id?includeData=true response. */
export const ExecutionDataResponseSchema = ExecutionStatusResponseSchema.extend({
  data: ExecutionStatusResponseSchema.shape.data.extend({
    data: z.object({
      resultData: z.object({
        runData: z.record(z.array(z.object({
          startTime: z.number(),
          executionTime: z.number(),
          executionStatus: z.string().optional(),
          error: z.object({
            message: z.string(),
            description: z.string().nullable().optional(),
            name: z.string().optional(),
            node: z.object({ name: z.string() }).optional(),
            httpCode: z.string().optional(),
            context: z.record(z.unknown()).optional(),
          }).optional().nullable(),
          source: z.array(z.object({
            previousNode: z.string(),
            previousNodeOutput: z.number().optional(),
            previousNodeRun: z.number().optional(),
          }).nullable()).optional().nullable(),
          hints: z.array(z.object({
            message: z.string(),
            level: z.string().optional(),
          })).optional(),
          data: z.record(z.unknown()).optional(),
        }))),
        error: z.object({
          message: z.string(),
          description: z.string().nullable().optional(),
          name: z.string().optional(),
          node: z.object({ name: z.string() }).optional(),
          httpCode: z.string().optional(),
          context: z.record(z.unknown()).optional(),
        }).optional().nullable(),
        lastNodeExecuted: z.string().optional().nullable(),
      }),
    }),
  }),
});

/** Schema for GET /workflows/:id response (existence check). */
export const WorkflowResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  updatedAt: z.string().optional(),
  hash: z.string().optional(),
});

// ---------------------------------------------------------------------------
// n8nac config file schemas
// ---------------------------------------------------------------------------

/** Schema for n8nac-config.json project config. */
const N8nacProjectConfigSchema = z.object({
  activeInstance: z.string().optional(),
  instances: z.record(z.object({
    host: z.string().optional(),
    apiKey: z.string().optional(),
  })).optional(),
});

/** Schema for ~/.config/n8nac/credentials.json global credential store. */
const N8nacGlobalCredentialsSchema = z.record(z.object({
  host: z.string().optional(),
  apiKey: z.string().optional(),
}));

// ---------------------------------------------------------------------------
// Credential Resolution (T004)
// ---------------------------------------------------------------------------

/**
 * Resolves n8n host and API key from the 4-level config cascade.
 *
 * Cascade priority (high to low):
 *   1. Explicit credentials passed in the request
 *   2. Environment variables: N8N_HOST, N8N_API_KEY
 *   3. n8nac project config: n8nac-config.json (active instance)
 *   4. Global credential store: ~/.config/n8nac/credentials.json
 *
 * Throws ExecutionConfigError identifying the specific missing credential
 * and which sources were checked.
 */
export async function resolveCredentials(
  explicit?: ExplicitCredentials,
): Promise<ResolvedCredentials> {
  // Layer 1: Explicit
  let host = explicit?.host;
  let apiKey = explicit?.apiKey;

  // Layer 2: Environment variables
  host ??= process.env['N8N_HOST'];
  apiKey ??= process.env['N8N_API_KEY'];

  // Layer 3: n8nac project config
  if (!host || !apiKey) {
    const projectCreds = await readProjectConfig();
    host ??= projectCreds?.host;
    apiKey ??= projectCreds?.apiKey;
  }

  // Layer 4: Global credential store
  if (!host || !apiKey) {
    const globalCreds = await readGlobalCredentials();
    host ??= globalCreds?.host;
    apiKey ??= globalCreds?.apiKey;
  }

  // Validate completeness
  const missing: string[] = [];
  if (!host) missing.push('host');
  if (!apiKey) missing.push('apiKey');

  if (missing.length > 0) {
    throw new ExecutionConfigError(
      `Missing ${missing.join(' and ')}: checked explicit config, env vars (N8N_HOST/N8N_API_KEY), n8nac-config.json, ~/.config/n8nac/credentials.json`,
    );
  }

  return { host: host!, apiKey: apiKey! };
}

// ---------------------------------------------------------------------------
// Config file readers
// ---------------------------------------------------------------------------

/** Partial credential result from a config source. */
interface PartialCredentials {
  host: string | undefined;
  apiKey: string | undefined;
}

/** Read n8nac project config from cwd. Returns active instance creds or undefined. */
async function readProjectConfig(): Promise<PartialCredentials | undefined> {
  try {
    const raw = await readFile(resolve('n8nac-config.json'), 'utf-8');
    const parsed = N8nacProjectConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return undefined;

    const config = parsed.data;
    const instanceName = config.activeInstance;
    if (!instanceName || !config.instances) return undefined;

    const instance = config.instances[instanceName];
    if (!instance) return undefined;
    return { host: instance.host, apiKey: instance.apiKey };
  } catch {
    return undefined;
  }
}

/** Read global n8nac credentials. Returns first entry or undefined. */
async function readGlobalCredentials(): Promise<PartialCredentials | undefined> {
  try {
    const credPath = join(homedir(), '.config', 'n8nac', 'credentials.json');
    const raw = await readFile(credPath, 'utf-8');
    const parsed = N8nacGlobalCredentialsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return undefined;

    const entries = Object.values(parsed.data);
    const first = entries[0];
    if (!first) return undefined;
    return { host: first.host, apiKey: first.apiKey };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// REST API helpers
// ---------------------------------------------------------------------------

/** Build headers for authenticated n8n REST API requests. */
function authHeaders(creds: ResolvedCredentials): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-N8N-API-KEY': creds.apiKey,
  };
}

/** Normalize host URL — strip trailing slash. */
function normalizeHost(host: string): string {
  return host.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Bounded Execution (T009)
// ---------------------------------------------------------------------------

/**
 * Execute a bounded subgraph via n8n REST API.
 *
 * POST /workflows/:id/run with payload:
 *   { destinationNode: { nodeName, mode }, pinData }
 *
 * Maps HTTP errors to typed execution errors:
 *   404 → ExecutionPreconditionError (workflow-not-found)
 *   401 → ExecutionInfrastructureError (auth-failure)
 *   network → ExecutionInfrastructureError (unreachable)
 */
export async function executeBounded(
  workflowId: string,
  destinationNodeName: string,
  pinData: PinData,
  credentials: ResolvedCredentials,
  mode: 'inclusive' | 'exclusive' = 'inclusive',
): Promise<ExecutionResult> {
  return withExecutionLock(async () => {
    const url = `${normalizeHost(credentials.host)}/api/v1/workflows/${workflowId}/run`;

    const body = JSON.stringify({
      destinationNode: { nodeName: destinationNodeName, mode },
      pinData,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: authHeaders(credentials),
        body,
      });
    } catch (err) {
      throw new ExecutionInfrastructureError(
        'unreachable',
        `n8n unreachable at ${credentials.host}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw new ExecutionPreconditionError(
          'workflow-not-found',
          `Workflow ${workflowId} not found in n8n. Push it first via n8nac.`,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new ExecutionInfrastructureError(
          'auth-failure',
          `Authentication failed for ${credentials.host} (HTTP ${response.status})`,
        );
      }
      throw new ExecutionInfrastructureError(
        'unreachable',
        `n8n returned HTTP ${response.status}: ${await response.text().catch(() => 'unknown error')}`,
      );
    }

    const json: unknown = await response.json();
    const parsed = TriggerExecutionResponseSchema.parse(json);

    return {
      executionId: parsed.data.executionId,
      status: 'running' as ExecutionStatus,
      error: null,
      partial: true,
    };
  });
}

// ---------------------------------------------------------------------------
// Execution Status & Data Retrieval (T022 — REST-only polling path)
// ---------------------------------------------------------------------------

/**
 * Get execution status (metadata only) via REST API.
 * Used as the REST-only polling strategy.
 */
export async function getExecutionStatus(
  executionId: string,
  credentials: ResolvedCredentials,
): Promise<{ status: ExecutionStatus; finished: boolean }> {
  const url = `${normalizeHost(credentials.host)}/api/v1/executions/${executionId}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: authHeaders(credentials),
    });
  } catch (err) {
    throw new ExecutionInfrastructureError(
      'unreachable',
      `n8n unreachable during polling: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new ExecutionInfrastructureError(
        'execution-not-found',
        `Execution ${executionId} not found`,
      );
    }
    throw new ExecutionInfrastructureError(
      'unreachable',
      `n8n returned HTTP ${response.status} during status poll`,
    );
  }

  const json: unknown = await response.json();
  const parsed = ExecutionStatusResponseSchema.parse(json);

  return {
    status: parsed.data.status as ExecutionStatus,
    finished: parsed.data.finished,
  };
}

/**
 * Get full execution data via REST API.
 * Used for the data retrieval phase after terminal status detected.
 */
export async function getExecutionData(
  executionId: string,
  credentials: ResolvedCredentials,
): Promise<z.infer<typeof ExecutionDataResponseSchema>> {
  const url = `${normalizeHost(credentials.host)}/api/v1/executions/${executionId}?includeData=true`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: authHeaders(credentials),
    });
  } catch (err) {
    throw new ExecutionInfrastructureError(
      'unreachable',
      `n8n unreachable during data retrieval: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    throw new ExecutionInfrastructureError(
      'execution-not-found',
      `Failed to retrieve execution data for ${executionId} (HTTP ${response.status})`,
    );
  }

  const json: unknown = await response.json();
  return ExecutionDataResponseSchema.parse(json);
}

// ---------------------------------------------------------------------------
// REST Polling Strategy (T022)
// ---------------------------------------------------------------------------

/**
 * Create a PollingStrategy backed by REST API calls.
 *
 * Used when MCP is unavailable. Status polling uses GET /executions/:id
 * (metadata only). Data retrieval uses GET /executions/:id?includeData=true
 * and extracts per-node results.
 *
 * Note: REST does not support nodeNames filtering or truncateData —
 * all node data is returned and filtered client-side by extractExecutionData.
 */
export function createRestPollingStrategy(
  credentials: ResolvedCredentials,
): PollingStrategy {
  return {
    async checkStatus(executionId: string): Promise<PollStatusResult> {
      return getExecutionStatus(executionId, credentials);
    },

    async retrieveData(
      executionId: string,
      nodeNames: NodeIdentity[],
      _truncateData: number,
    ): Promise<ExecutionData> {
      const response = await getExecutionData(executionId, credentials);
      const resultData = response.data.data.resultData;
      const status = response.data.status as ExecutionStatus;

      return extractExecutionData(
        resultData as RawResultData,
        status,
        nodeNames as string[],
      );
    },
  };
}
