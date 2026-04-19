/**
 * Tests for mapToMcpError — domain error → McpError mapping at the surface boundary.
 */

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { mapToMcpError } from '../src/errors.js';
import { MalformedWorkflowError, ConfigurationError } from '../src/static-analysis/errors.js';

describe('mapToMcpError', () => {
  it('maps MalformedWorkflowError to parse_error', () => {
    const err = new MalformedWorkflowError('missing nodes array');
    const result = mapToMcpError(err);
    expect(result.type).toBe('parse_error');
    expect(result.message).toContain('missing nodes array');
  });

  it('maps ConfigurationError to configuration_error', () => {
    const err = new ConfigurationError('@n8n-as-code/transformer');
    const result = mapToMcpError(err);
    expect(result.type).toBe('configuration_error');
    expect(result.message).toContain('@n8n-as-code/transformer');
  });

  it('maps ENOENT error to workflow_not_found', () => {
    const err = Object.assign(
      new Error("ENOENT: no such file or directory, open '/tmp/missing.ts'"),
      { code: 'ENOENT' },
    );
    const result = mapToMcpError(err);
    expect(result.type).toBe('workflow_not_found');
    expect(result.message).toContain('ENOENT');
  });

  it('maps ZodError to parse_error', () => {
    const err = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        path: ['workflowPath'],
        message: 'Required',
      },
    ]);
    const result = mapToMcpError(err);
    expect(result.type).toBe('parse_error');
  });

  it('maps generic Error to internal_error', () => {
    const err = new Error('something unexpected');
    const result = mapToMcpError(err);
    expect(result.type).toBe('internal_error');
    expect(result.message).toBe('something unexpected');
  });

  it('maps non-Error throw to internal_error', () => {
    const result = mapToMcpError('string thrown');
    expect(result.type).toBe('internal_error');
    expect(result.message).toBe('string thrown');
  });
});
