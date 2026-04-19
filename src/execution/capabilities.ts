/**
 * Execution environment capability detection.
 *
 * Probes MCP tool discovery to determine whether execution is available.
 * Returns DetectedCapabilities describing the execution surface.
 *
 * Also exports toAvailableCapabilities() for mapping to the shared
 * AvailableCapabilities type used in DiagnosticSummary.
 */

import type { AvailableCapabilities } from '../types/diagnostic.js';
import type { McpToolCaller } from './mcp-client.js';
import type { DetectedCapabilities } from './types.js';

// ---------------------------------------------------------------------------
// Capability detection (T021)
// ---------------------------------------------------------------------------

/** Known MCP tool names used by the execution subsystem. */
const EXECUTION_MCP_TOOLS = ['test_workflow', 'get_execution', 'prepare_test_pin_data'] as const;

/**
 * Probe the execution environment and report available capabilities.
 *
 * Discovers available MCP tools and determines the capability level:
 * 'mcp' when execution tools are available, 'static-only' otherwise.
 */
export async function detectCapabilities(options?: {
  callTool?: McpToolCaller;
}): Promise<DetectedCapabilities> {
  let mcpAvailable = false;
  let mcpTools: string[] = [];

  if (options?.callTool) {
    const discovered = await discoverMcpTools(options.callTool);
    mcpTools = discovered;
    mcpAvailable = discovered.length > 0;
  }

  const level: DetectedCapabilities['level'] = mcpAvailable ? 'mcp' : 'static-only';

  return { level, mcpAvailable, mcpTools };
}

// ---------------------------------------------------------------------------
// toAvailableCapabilities mapper
// ---------------------------------------------------------------------------

/**
 * Map DetectedCapabilities (execution-internal) to AvailableCapabilities
 * (shared diagnostic type) for use in DiagnosticSummary.
 */
export function toAvailableCapabilities(detected: DetectedCapabilities): AvailableCapabilities {
  return {
    staticAnalysis: true,
    mcpTools: detected.mcpAvailable,
  };
}

// ---------------------------------------------------------------------------
// Probing helpers
// ---------------------------------------------------------------------------

/**
 * Discover which execution-related MCP tools are available via tools/list.
 *
 * Calls `tools/list` to get the full tool listing, then filters for known
 * execution-related tools. Falls back to per-tool probing if `tools/list`
 * is not available.
 */
async function discoverMcpTools(callTool: McpToolCaller): Promise<string[]> {
  // Try tools/list first for efficient discovery
  try {
    const listResult = await callTool('tools/list', {});
    if (Array.isArray(listResult)) {
      const toolNames = new Set(
        listResult.map((t: unknown) =>
          typeof t === 'object' && t !== null && 'name' in t ? (t as { name: string }).name : '',
        ),
      );
      return EXECUTION_MCP_TOOLS.filter((name) => toolNames.has(name));
    }
  } catch {
    // tools/list not available — fall back to per-tool probing
  }

  // Fallback: probe each tool individually
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
