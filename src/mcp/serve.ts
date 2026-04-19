/**
 * MCP server entry point — creates the server, connects stdio transport, starts.
 *
 * This file is the entry point referenced by `.mcp.json` (dist/mcp/serve.js).
 * It is invoked by the Claude Code plugin system.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildDeps } from '../deps.js';
import { createServer } from './server.js';

const deps = buildDeps();
const server = createServer(deps);
const transport = new StdioServerTransport();
await server.connect(transport);
