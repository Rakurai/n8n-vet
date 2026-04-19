/**
 * Unit tests for REST client request shaping.
 *
 * Covers: payload shape per research R1 (destinationNode with nodeName),
 * auth header inclusion, error mapping for 404/401/unreachable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nodeIdentity } from '../../src/types/identity.js';
import { ExecutionInfrastructureError, ExecutionPreconditionError } from '../../src/execution/errors.js';
import type { PinData } from '../../src/execution/types.js';

import {
  resolveCredentials,
  executeBounded,
  TriggerExecutionResponseSchema,
  ExecutionStatusResponseSchema,
  ExecutionDataResponseSchema,
  WorkflowResponseSchema,
} from '../../src/execution/rest-client.js';
import { ExecutionConfigError } from '../../src/execution/errors.js';
import { releaseExecutionLock } from '../../src/execution/lock.js';

// ---------------------------------------------------------------------------
// resolveCredentials
// ---------------------------------------------------------------------------

describe('resolveCredentials', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['N8N_HOST'];
    delete process.env['N8N_API_KEY'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('resolves from explicit credentials', async () => {
    const creds = await resolveCredentials({
      host: 'https://n8n.example.com',
      apiKey: 'test-key-123',
    });
    expect(creds).toEqual({
      host: 'https://n8n.example.com',
      apiKey: 'test-key-123',
    });
  });

  it('resolves from environment variables', async () => {
    process.env['N8N_HOST'] = 'https://env-host.example.com';
    process.env['N8N_API_KEY'] = 'env-key-456';

    const creds = await resolveCredentials();
    expect(creds).toEqual({
      host: 'https://env-host.example.com',
      apiKey: 'env-key-456',
    });
  });

  it('explicit overrides env vars', async () => {
    process.env['N8N_HOST'] = 'https://env-host.example.com';
    process.env['N8N_API_KEY'] = 'env-key-456';

    const creds = await resolveCredentials({
      host: 'https://explicit.example.com',
    });
    expect(creds.host).toBe('https://explicit.example.com');
    expect(creds.apiKey).toBe('env-key-456');
  });

  it('throws ExecutionConfigError when no credentials found', async () => {
    await expect(resolveCredentials()).rejects.toThrow(ExecutionConfigError);
    await expect(resolveCredentials()).rejects.toThrow(/Missing host and apiKey/);
  });

  it('throws ExecutionConfigError identifying specific missing credential', async () => {
    process.env['N8N_HOST'] = 'https://partial.example.com';
    await expect(resolveCredentials()).rejects.toThrow(/Missing apiKey/);
  });

  it('error message lists all checked sources', async () => {
    try {
      await resolveCredentials();
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as ExecutionConfigError;
      expect(err.message).toContain('explicit config');
      expect(err.message).toContain('N8N_HOST');
      expect(err.message).toContain('n8nac-config.json');
      expect(err.message).toContain('credentials.json');
    }
  });
});

// ---------------------------------------------------------------------------
// Zod schema validation
// ---------------------------------------------------------------------------

describe('TriggerExecutionResponseSchema', () => {
  it('parses valid trigger response', () => {
    const result = TriggerExecutionResponseSchema.parse({
      executionId: 'exec-123',
    });
    expect(result.executionId).toBe('exec-123');
  });

  it('rejects missing executionId', () => {
    expect(() => TriggerExecutionResponseSchema.parse({})).toThrow();
  });
});

describe('ExecutionStatusResponseSchema', () => {
  it('parses valid status response', () => {
    const result = ExecutionStatusResponseSchema.parse({
      id: 'exec-123',
      finished: true,
      mode: 'manual',
      status: 'success',
      startedAt: '2026-01-01T00:00:00.000Z',
      stoppedAt: '2026-01-01T00:00:05.000Z',
    });
    expect(result.status).toBe('success');
    expect(result.finished).toBe(true);
  });

  it('accepts null stoppedAt for running executions', () => {
    const result = ExecutionStatusResponseSchema.parse({
      id: 'exec-123',
      finished: false,
      mode: 'manual',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      stoppedAt: null,
    });
    expect(result.stoppedAt).toBeNull();
  });
});

describe('WorkflowResponseSchema', () => {
  it('parses valid workflow response', () => {
    const result = WorkflowResponseSchema.parse({
      id: 'wf-123',
      name: 'Test Workflow',
      active: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.id).toBe('wf-123');
  });

  it('accepts missing optional fields', () => {
    const result = WorkflowResponseSchema.parse({
      id: 'wf-123',
      name: 'Test',
      active: false,
    });
    expect(result.hash).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// executeBounded
// ---------------------------------------------------------------------------

describe('executeBounded', () => {
  const credentials = { host: 'https://n8n.test', apiKey: 'key-123' };
  const workflowId = 'wf-abc';
  const destinationNodeName = 'TargetNode';
  const pinData: PinData = { TriggerNode: [{ json: { x: 1 } }] };

  afterEach(() => {
    vi.restoreAllMocks();
    releaseExecutionLock();
  });

  it('returns ExecutionResult with executionId, status running, partial true on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ executionId: 'exec-123' }), { status: 200 }),
    );

    const result = await executeBounded(workflowId, destinationNodeName, pinData, credentials);

    expect(result.executionId).toBe('exec-123');
    expect(result.status).toBe('running');
    expect(result.partial).toBe(true);
  });

  it('sends correct URL, method, auth header, and body shape', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ executionId: 'exec-456' }), { status: 200 }),
    );

    await executeBounded(workflowId, destinationNodeName, pinData, credentials, 'exclusive');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://n8n.test/api/v1/workflows/wf-abc/run');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-N8N-API-KEY']).toBe('key-123');
    const body = JSON.parse(init.body as string) as unknown;
    expect(body).toMatchObject({
      destinationNode: { nodeName: destinationNodeName, mode: 'exclusive' },
      pinData,
    });
  });

  it('throws ExecutionPreconditionError workflow-not-found on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    );

    const err = await executeBounded(workflowId, destinationNodeName, pinData, credentials)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExecutionPreconditionError);
    expect(err).toMatchObject({ reason: 'workflow-not-found' });
  });

  it('throws ExecutionInfrastructureError auth-failure on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );

    const err = await executeBounded(workflowId, destinationNodeName, pinData, credentials)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExecutionInfrastructureError);
    expect(err).toMatchObject({ reason: 'auth-failure' });
  });

  it('throws ExecutionInfrastructureError unreachable on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await executeBounded(workflowId, destinationNodeName, pinData, credentials)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExecutionInfrastructureError);
    expect(err).toMatchObject({ reason: 'unreachable' });
  });

  it('throws ExecutionPreconditionError execution-in-flight when another is in progress', async () => {
    // First call hangs so the lock is held when the second call is made.
    let resolveFirst!: (value: Response) => void;
    const firstFetch = new Promise<Response>((res) => { resolveFirst = res; });
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(firstFetch);

    const firstCall = executeBounded(workflowId, destinationNodeName, pinData, credentials);

    await expect(
      executeBounded(workflowId, destinationNodeName, pinData, credentials),
    ).rejects.toMatchObject({ reason: 'execution-in-flight' });

    // Resolve the first call so the lock is released cleanly.
    resolveFirst(
      new Response(JSON.stringify({ executionId: 'exec-789' }), { status: 200 }),
    );
    await firstCall;
  });

  it('allows a second call after the first completes', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ executionId: 'exec-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ executionId: 'exec-2' }), { status: 200 }),
      );

    const first = await executeBounded(workflowId, destinationNodeName, pinData, credentials);
    const second = await executeBounded(workflowId, destinationNodeName, pinData, credentials);

    expect(first.executionId).toBe('exec-1');
    expect(second.executionId).toBe('exec-2');
  });
});
