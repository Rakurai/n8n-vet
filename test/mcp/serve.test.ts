/**
 * Tests for MCP bootstrap behavior — verifies the three deterministic states:
 * successful connection, failed connection (logged + degraded), no config.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { bootstrap } from '../../src/mcp/serve.js';
import type { BootstrapConfig } from '../../src/mcp/serve.js';
import { ExecutionInfrastructureError } from '../../src/execution/errors.js';
import type { McpToolCaller } from '../../src/execution/mcp-client.js';

describe('bootstrap', () => {
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

  afterEach(() => {
    stderrSpy.mockClear();
  });

  it('returns callTool on successful connection', async () => {
    const mockCallTool: McpToolCaller = vi.fn().mockResolvedValue({});
    const connect = vi.fn().mockResolvedValue(mockCallTool);
    const config: BootstrapConfig = {
      n8nHost: 'http://localhost:5678',
      n8nMcpToken: 'test-token',
      n8nApiKey: 'api-key',
    };

    const result = await bootstrap(config, connect);

    expect(result.callTool).toBe(mockCallTool);
    expect(result.n8nHost).toBe('http://localhost:5678');
    expect(result.n8nApiKey).toBe('api-key');
    expect(connect).toHaveBeenCalledWith('http://localhost:5678/mcp-server/http', 'test-token');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('returns callTool: undefined and logs stderr on failed connection', async () => {
    const connect = vi.fn().mockRejectedValue(
      new ExecutionInfrastructureError('unreachable', 'ECONNREFUSED'),
    );
    const config: BootstrapConfig = {
      n8nHost: 'http://localhost:5678',
      n8nMcpToken: 'test-token',
    };

    const result = await bootstrap(config, connect);

    expect(result.callTool).toBeUndefined();
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('[n8n-proctor] MCP connection failed:');
    expect(output).toContain('ECONNREFUSED');
    expect(output).toContain('Starting in static-only mode.');
  });

  it('returns callTool: undefined with no stderr when not configured', async () => {
    const connect = vi.fn();
    const config: BootstrapConfig = {};

    const result = await bootstrap(config, connect);

    expect(result.callTool).toBeUndefined();
    expect(connect).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('strips trailing slash from n8nHost', async () => {
    const mockCallTool: McpToolCaller = vi.fn().mockResolvedValue({});
    const connect = vi.fn().mockResolvedValue(mockCallTool);
    const config: BootstrapConfig = {
      n8nHost: 'http://localhost:5678/',
      n8nMcpToken: 'test-token',
    };

    await bootstrap(config, connect);

    expect(connect).toHaveBeenCalledWith('http://localhost:5678/mcp-server/http', 'test-token');
  });
});
