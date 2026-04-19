/**
 * Execution environment capability detection.
 *
 * Probes n8n reachability, REST auth, MCP tool discovery, and optionally
 * workflow existence/staleness. Returns DetectedCapabilities describing
 * what execution operations are available.
 *
 * Also exports toAvailableCapabilities() for mapping to the shared
 * AvailableCapabilities type used in DiagnosticSummary.
 */

import type { AvailableCapabilities } from '../types/diagnostic.js';
import type {
  DetectedCapabilities,
  ExplicitCredentials,
  ResolvedCredentials,
} from './types.js';
import {
  ExecutionInfrastructureError,
  ExecutionPreconditionError,
} from './errors.js';
import { resolveCredentials } from './rest-client.js';
import type { McpToolCaller } from './mcp-client.js';

// ---------------------------------------------------------------------------
// Capability detection (T021)
// ---------------------------------------------------------------------------

/** Known MCP tool names used by the execution subsystem. */
const EXECUTION_MCP_TOOLS = [
  'test_workflow',
  'get_execution',
  'prepare_test_pin_data',
] as const;

/**
 * Probe the execution environment and report available capabilities.
 *
 * Steps:
 *   1. Resolve credentials (throws ExecutionConfigError on failure)
 *   2. Probe n8n health/auth via REST
 *   3. Discover MCP tools if callTool provided
 *   4. Optionally check workflow existence
 */
export async function detectCapabilities(
  options?: {
    explicit?: ExplicitCredentials;
    workflowId?: string;
    callTool?: McpToolCaller;
  },
): Promise<DetectedCapabilities> {
  // Step 1: Resolve credentials
  const credentials = await resolveCredentials(options?.explicit);

  // Step 2: Probe REST availability
  const restAvailable = await probeRest(credentials);

  // Step 3: Discover MCP tools
  let mcpAvailable = false;
  let mcpTools: string[] = [];

  if (options?.callTool) {
    const discovered = await discoverMcpTools(options.callTool);
    mcpTools = discovered;
    mcpAvailable = discovered.length > 0;
  }

  // Step 4: Check workflow if requested
  if (options?.workflowId && restAvailable) {
    await checkWorkflow(options.workflowId, credentials);
  }

  // Determine capability level
  let level: DetectedCapabilities['level'];
  if (restAvailable && mcpAvailable) {
    level = 'full';
  } else if (restAvailable) {
    level = 'rest-only';
  } else {
    level = 'static-only';
  }

  return { level, restAvailable, mcpAvailable, mcpTools };
}

// ---------------------------------------------------------------------------
// toAvailableCapabilities mapper
// ---------------------------------------------------------------------------

/**
 * Map DetectedCapabilities (execution-internal) to AvailableCapabilities
 * (shared diagnostic type) for use in DiagnosticSummary.
 */
export function toAvailableCapabilities(
  detected: DetectedCapabilities,
): AvailableCapabilities {
  return {
    staticAnalysis: true,
    restApi: detected.restAvailable,
    mcpTools: detected.mcpAvailable,
  };
}

// ---------------------------------------------------------------------------
// Probing helpers
// ---------------------------------------------------------------------------

/** Probe n8n REST API availability and authentication. */
async function probeRest(credentials: ResolvedCredentials): Promise<boolean> {
  const host = credentials.host.replace(/\/+$/, '');

  let response: Response;
  try {
    response = await fetch(`${host}/api/v1/workflows?limit=1`, {
      method: 'GET',
      headers: {
        'X-N8N-API-KEY': credentials.apiKey,
      },
    });
  } catch {
    throw new ExecutionInfrastructureError(
      'unreachable',
      `n8n unreachable at ${credentials.host}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ExecutionInfrastructureError(
      'auth-failure',
      `Authentication failed for ${credentials.host} (HTTP ${response.status})`,
    );
  }

  return response.ok;
}

/**
 * Discover which execution-related MCP tools are available by probing each.
 *
 * Calls each tool with minimal/empty args. If the tool exists, the MCP server
 * will return a result (possibly an error result for invalid args, but that
 * still proves the tool is registered). A thrown error means the tool is
 * not available.
 */
async function discoverMcpTools(callTool: McpToolCaller): Promise<string[]> {
  const discovered: string[] = [];

  for (const toolName of EXECUTION_MCP_TOOLS) {
    try {
      await callTool(toolName, {});
      discovered.push(toolName);
    } catch {
      // Tool not available — skip
    }
  }

  return discovered;
}

/** Check workflow existence via REST. */
async function checkWorkflow(
  workflowId: string,
  credentials: ResolvedCredentials,
): Promise<void> {
  const host = credentials.host.replace(/\/+$/, '');

  let response: Response;
  try {
    response = await fetch(`${host}/api/v1/workflows/${workflowId}`, {
      method: 'GET',
      headers: {
        'X-N8N-API-KEY': credentials.apiKey,
      },
    });
  } catch (err) {
    throw new ExecutionInfrastructureError(
      'unreachable',
      `n8n unreachable during workflow check: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (response.status === 404) {
    throw new ExecutionPreconditionError(
      'workflow-not-found',
      `Workflow ${workflowId} not found in n8n. Push it first via n8nac.`,
    );
  }

  // Staleness check depends on Phase 3 trust hashing.
  // When trust hashing is available, compare local content hash to remote.
  // For now, existence check only.
}
