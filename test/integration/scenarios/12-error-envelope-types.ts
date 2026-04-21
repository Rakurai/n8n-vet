/**
 * Scenario 12: Error envelope types
 *
 * SKILL.md documents 7 error types as a contract with agent consumers.
 * This scenario asserts the error `type` strings via the MCP server,
 * not just `success: false`.
 *
 * Tests 1-3: MCP server returns correct error envelopes for nonexistent files.
 * Tests 4-6: mapToMcpError maps domain errors to documented envelope types.
 */

import { mapToMcpError } from '../../../src/errors.js';
import { ConfigurationError } from '../../../src/static-analysis/errors.js';
import { ExecutionInfrastructureError } from '../../../src/execution/errors.js';
import { TrustPersistenceError } from '../../../src/trust/errors.js';
import { createMcpTestClient, type McpTestClient } from '../lib/mcp-client.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(_ctx: IntegrationContext): Promise<void> {
  let client: McpTestClient | null = null;

  try {
    client = await createMcpTestClient();

    // Test 1: validate on nonexistent file
    // interpret() catches parse errors internally → returns success with status 'error'
    const validateResult = await client.validate({
      workflowPath: 'nonexistent/does-not-exist.workflow.ts',
      kind: 'workflow',
    });

    // validate wraps errors in a diagnostic with status 'error' (success envelope)
    if (validateResult.success) {
      const data = validateResult.data as { status?: string };
      if (data?.status !== 'error') {
        throw new Error(`Expected validate diagnostic status 'error' for nonexistent file, got '${data?.status}'`);
      }
    } else {
      // If it returned as an MCP error instead, check the type
      const errorType = validateResult.error?.type;
      if (errorType !== 'workflow_not_found' && errorType !== 'parse_error') {
        throw new Error(`Expected error type 'workflow_not_found' or 'parse_error', got '${errorType}'`);
      }
    }

    // Test 2: trust_status on nonexistent file → MCP error with type
    const trustResult = await client.trustStatus({
      workflowPath: 'nonexistent/does-not-exist.workflow.ts',
    });

    if (trustResult.success) {
      throw new Error('Expected trust_status to fail for nonexistent file');
    }
    const trustErrorType = trustResult.error?.type;
    if (!trustErrorType) {
      throw new Error('Expected trust_status error to have a type field');
    }
    // Must be one of the documented error types
    const validTypes = [
      'workflow_not_found', 'parse_error', 'configuration_error',
      'infrastructure_error', 'trust_error', 'precondition_error', 'internal_error',
    ];
    if (!validTypes.includes(trustErrorType)) {
      throw new Error(`trust_status error type '${trustErrorType}' is not a documented McpErrorType`);
    }

    // Test 3: explain on nonexistent file → MCP error with type
    const explainResult = await client.explain({
      workflowPath: 'nonexistent/does-not-exist.workflow.ts',
    });

    if (explainResult.success) {
      throw new Error('Expected explain to fail for nonexistent file');
    }
    const explainErrorType = explainResult.error?.type;
    if (!explainErrorType) {
      throw new Error('Expected explain error to have a type field');
    }
    if (!validTypes.includes(explainErrorType)) {
      throw new Error(`explain error type '${explainErrorType}' is not a documented McpErrorType`);
    }
  } finally {
    if (client) await client.close();
  }

  // Test 4: ConfigurationError → 'configuration_error'
  const configErr = mapToMcpError(new ConfigurationError('@n8n-as-code/transformer'));
  if (configErr.type !== 'configuration_error') {
    throw new Error(`Expected 'configuration_error', got '${configErr.type}'`);
  }

  // Test 5: ExecutionInfrastructureError → 'infrastructure_error'
  const infraErr = mapToMcpError(new ExecutionInfrastructureError('mcp-unavailable', 'MCP connection failed'));
  if (infraErr.type !== 'infrastructure_error') {
    throw new Error(`Expected 'infrastructure_error', got '${infraErr.type}'`);
  }

  // Test 6: TrustPersistenceError → 'trust_error'
  const trustErr = mapToMcpError(new TrustPersistenceError('/tmp/trust.json', new Error('corrupt')));
  if (trustErr.type !== 'trust_error') {
    throw new Error(`Expected 'trust_error', got '${trustErr.type}'`);
  }
}

export const scenario: Scenario = { name: '12-error-envelope-types', run };
