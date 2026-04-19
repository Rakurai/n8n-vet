/**
 * MCP test client — spawns n8n-vet's MCP server as a child process,
 * connects via stdio transport, and provides typed methods for all 3 tools.
 */

import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface McpTestClient {
  validate(input: {
    workflowPath: string;
    target?: { kind: string; nodes?: string[] };
    layer?: string;
    force?: boolean;
    pinData?: Record<string, Array<{ json: Record<string, unknown> }>>;
    destinationNode?: string;
    destinationMode?: string;
  }): Promise<McpToolResponse>;

  trustStatus(input: {
    workflowPath: string;
  }): Promise<McpToolResponse>;

  explain(input: {
    workflowPath: string;
    target?: { kind: string; nodes?: string[] };
    layer?: string;
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
 * Returns a typed client with validate/trustStatus/explain methods.
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

    // MCP SDK returns { content: [{ type: 'text', text: '...' }] }
    const content = result.content as Array<{ type: string; text: string }>;
    if (!content || content.length === 0) {
      throw new Error(`MCP tool '${name}' returned no content`);
    }

    return JSON.parse(content[0].text) as McpToolResponse;
  }

  return {
    validate: (input) => callTool('validate', input as unknown as Record<string, unknown>),
    trustStatus: (input) => callTool('trust_status', input as unknown as Record<string, unknown>),
    explain: (input) => callTool('explain', input as unknown as Record<string, unknown>),
    close: async () => {
      await client.close();
    },
  };
}
