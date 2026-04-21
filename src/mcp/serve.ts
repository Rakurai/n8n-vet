/**
 * MCP server entry point — creates the server, connects stdio transport, starts.
 *
 * This file is the entry point referenced by `.mcp.json` (dist/mcp/serve.js).
 * It is invoked by the Claude Code plugin system.
 *
 * When N8N_HOST and N8N_MCP_TOKEN are set (via plugin userConfig),
 * a client connection to n8n's MCP server is established so the execution
 * layer can run workflows and retrieve results.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { buildDeps } from '../deps.js';
import { ExecutionInfrastructureError } from '../execution/errors.js';
import type { McpToolCaller } from '../execution/mcp-client.js';
import { VERSION } from '../version.js';
import { createServer } from './server.js';

/**
 * Connect to n8n's Streamable HTTP MCP server and return a McpToolCaller.
 * Throws ExecutionInfrastructureError on failure (fail-fast).
 */
async function connectToN8n(url: string, token: string): Promise<McpToolCaller> {
  try {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });

    const client = new Client({ name: 'n8n-proctor', version: VERSION });
    await client.connect(transport as Transport);

    const callTool: McpToolCaller = async (toolName, args) => {
      if (toolName === 'tools/list') {
        const listed = await client.listTools();
        return listed.tools.map((t) => ({ name: t.name }));
      }

      const result = await client.callTool({ name: toolName, arguments: args });
      const content = result.content as Array<{ type: string; text: string }>;
      if (!content || content.length === 0) {
        throw new Error(`MCP tool '${toolName}' returned no content`);
      }
      const text = content[0].text;
      if (result.isError) {
        const truncated = text.length > 200 ? `${text.slice(0, 200)} [truncated]` : text;
        throw new Error(`MCP tool '${toolName}' error: ${truncated}`);
      }
      return JSON.parse(text);
    };

    return callTool;
  } catch (err) {
    throw new ExecutionInfrastructureError(
      'unreachable',
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ── Bootstrap ────────────────────────────────────────────────────

export interface BootstrapConfig {
  n8nHost?: string | undefined;
  n8nMcpToken?: string | undefined;
  n8nApiKey?: string | undefined;
}

export interface BootstrapResult {
  callTool: McpToolCaller | undefined;
  n8nHost: string | undefined;
  n8nApiKey: string | undefined;
}

/**
 * Bootstrap the MCP connection. Determines capability state at startup.
 *
 * When MCP is configured but unreachable, logs a single diagnostic line
 * to stderr and proceeds in static-only mode. The server always starts.
 */
export async function bootstrap(
  config: BootstrapConfig,
  connect: (url: string, token: string) => Promise<McpToolCaller>,
): Promise<BootstrapResult> {
  let callTool: McpToolCaller | undefined;

  if (config.n8nHost && config.n8nMcpToken) {
    const mcpUrl = `${config.n8nHost.replace(/\/$/, '')}/mcp-server/http`;
    try {
      callTool = await connect(mcpUrl, config.n8nMcpToken);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[n8n-proctor] MCP connection failed: ${reason}. Starting in static-only mode.\n`,
      );
    }
  }

  return {
    callTool,
    n8nHost: config.n8nHost,
    n8nApiKey: config.n8nApiKey,
  };
}

// ── Module top-level startup ─────────────────────────────────────

const result = await bootstrap(
  {
    n8nHost: process.env.N8N_HOST,
    n8nMcpToken: process.env.N8N_MCP_TOKEN,
    n8nApiKey: process.env.N8N_API_KEY,
  },
  connectToN8n,
);

const deps = buildDeps();
const server = createServer(deps, result.callTool);
const transport = new StdioServerTransport();
await server.connect(transport);
