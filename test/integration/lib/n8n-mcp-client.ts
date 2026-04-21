/**
 * n8n native MCP client — connects to n8n's built-in MCP server via
 * Streamable HTTP transport and returns a McpToolCaller compatible with
 * n8n-proctor's execution subsystem.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpToolCaller } from '../../../src/execution/mcp-client.js';

/**
 * Create a McpToolCaller connected to n8n's Streamable HTTP MCP server.
 *
 * @param url - MCP server URL (e.g. http://localhost:5678/mcp-server/http)
 * @param token - Bearer token for authentication
 * @returns Object with callTool function and close cleanup function
 */
export async function createN8nMcpCaller(
  url: string,
  token: string,
): Promise<{ callTool: McpToolCaller; close: () => Promise<void> }> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const client = new Client({ name: 'n8n-proctor-integration', version: '0.1.0' });
  await client.connect(transport as Parameters<typeof client.connect>[0]);

  const callTool: McpToolCaller = async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    // Intercept tools/list — map to protocol-level listTools() for capability detection
    if (toolName === 'tools/list') {
      const listed = await client.listTools();
      return listed.tools.map(t => ({ name: t.name }));
    }

    const result = await client.callTool({ name: toolName, arguments: args });

    // MCP SDK returns { content: [{ type: 'text', text: '...' }], isError?: boolean }
    const content = result.content as Array<{ type: string; text: string }>;
    if (!content || content.length === 0) {
      throw new Error(`MCP tool '${toolName}' returned no content`);
    }

    const text = content[0].text;

    if (result.isError) {
      throw new Error(`MCP tool '${toolName}' error: ${text}`);
    }

    // Parse JSON response — n8n MCP tools return structured JSON
    return JSON.parse(text);
  };

  return {
    callTool,
    close: async () => {
      await client.close();
    },
  };
}
