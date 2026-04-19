import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve('.');

interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface McpJson {
  mcpServers: Record<string, McpServerConfig>;
}

describe('.mcp.json configuration', () => {
  const mcpJson: McpJson = JSON.parse(
    readFileSync(resolve(ROOT, '.mcp.json'), 'utf-8'),
  );

  it('declares an n8n-vet server', () => {
    expect(mcpJson.mcpServers['n8n-vet']).toBeDefined();
  });

  const server = mcpJson.mcpServers['n8n-vet']!;

  it('uses node as command (stdio transport)', () => {
    expect(server.command).toBe('node');
  });

  it('args point to dist/mcp/serve.js entry point', () => {
    expect(server.args).toHaveLength(1);
    expect(server.args[0]).toContain('dist/mcp/serve.js');
  });

  it('passes all required env vars (N8N_VET_DATA_DIR, NODE_PATH)', () => {
    for (const key of ['N8N_VET_DATA_DIR', 'NODE_PATH']) {
      expect(server.env, `missing env var: ${key}`).toHaveProperty(key);
    }
  });
});
