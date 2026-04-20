/**
 * MCP test client — spawns n8n-vet's MCP server as a child process,
 * connects via stdio transport, and provides typed methods for all 4 tools.
 */

import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface McpTestClient {
  validate(input: {
    workflowPath: string;
    kind?: string;
    nodes?: string[];
    force?: boolean;
  }): Promise<McpToolResponse>;

  test(input: {
    workflowPath: string;
    kind?: string;
    nodes?: string[];
    force?: boolean;
    pinData?: Record<string, Array<{ json: Record<string, unknown> }>>;
  }): Promise<McpToolResponse>;

  trustStatus(input: {
    workflowPath: string;
  }): Promise<McpToolResponse>;

  explain(input: {
    workflowPath: string;
    kind?: string;
    nodes?: string[];
    tool?: string;
  }): Promise<McpToolResponse>;

  close(): Promise<void>;
}

export interface McpToolResponse {
  success: boolean;
  data?: unknown;
  error?: { type: string; message: string };
}

/**
 * Spawn the MCP server and connect a client to it.
 * Returns a typed client with validate/test/trustStatus/explain methods.
 */
export async function createMcpTestClient(): Promise<McpTestClient> {
  const serverPath = resolve('dist/mcp/serve.js');

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
  });

  const client = new Client({ name: 'n8n-vet-test', version: '0.1.0' });
  await client.connect(transport);

  async function callTool(name: string, args: Record<string, unknown>): Promise<McpToolResponse> {
    const result = await client.callTool({ name, arguments: args });

    // MCP SDK returns { content: [{ type: 'text', text: '...' }], isError?: boolean }
    const content = result.content as Array<{ type: string; text: string }>;
    if (!content || content.length === 0) {
      throw new Error(`MCP tool '${name}' returned no content`);
    }

    const text = content[0].text;

    // Handle MCP SDK error responses (plain text, not JSON)
    if (result.isError) {
      return { success: false, error: { type: 'mcp_error', message: text } };
    }

    try {
      return JSON.parse(text) as McpToolResponse;
    } catch {
      // Server returned non-JSON text — wrap as error
      return { success: false, error: { type: 'parse_error', message: text } };
    }
  }

  return {
    validate: (input) => callTool('validate', input as unknown as Record<string, unknown>),
    test: (input) => callTool('test', input as unknown as Record<string, unknown>),
    trustStatus: (input) => callTool('trust_status', input as unknown as Record<string, unknown>),
    explain: (input) => callTool('explain', input as unknown as Record<string, unknown>),
    close: async () => {
      await client.close();
    },
  };
}
