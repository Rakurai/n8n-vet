/**
 * Scenario 07: MCP tools round-trip
 *
 * Spawns the MCP server, tests all 3 tools (validate, trust_status, explain)
 * with valid and invalid input.
 */

import { resolve, join } from 'node:path';
import { createMcpTestClient, type McpTestClient } from '../lib/mcp-client.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  let client: McpTestClient | null = null;

  try {
    client = await createMcpTestClient();

    const happyPath = resolve(join(ctx.fixturesDir, 'happy-path.ts'));

    // Test 1: validate with valid input
    const validateResult = await client.validate({
      workflowPath: happyPath,
      kind: 'workflow',
    });

    if (!validateResult.success) {
      throw new Error(`validate tool failed: ${JSON.stringify(validateResult.error)}`);
    }
    if (!validateResult.data) {
      throw new Error('validate tool returned no data');
    }

    // Test 2: trust_status with valid input
    const trustResult = await client.trustStatus({
      workflowPath: happyPath,
    });

    if (!trustResult.success) {
      throw new Error(`trust_status tool failed: ${JSON.stringify(trustResult.error)}`);
    }
    if (!trustResult.data) {
      throw new Error('trust_status tool returned no data');
    }

    // Test 3: explain with valid input
    const explainResult = await client.explain({
      workflowPath: happyPath,
      tool: 'validate',
    });

    if (!explainResult.success) {
      throw new Error(`explain tool failed: ${JSON.stringify(explainResult.error)}`);
    }
    if (!explainResult.data) {
      throw new Error('explain tool returned no data');
    }

    // Test 4: validate with nonexistent file — returns success with status 'error' in data
    // (interpret catches parse errors internally and returns an error diagnostic)
    const invalidResult = await client.validate({
      workflowPath: 'nonexistent/workflow.ts',
      kind: 'workflow',
    });

    if (!invalidResult.success) {
      throw new Error(`validate tool returned failure for nonexistent file — expected success with error diagnostic`);
    }
    const diagnosticData = invalidResult.data as { status?: string };
    if (diagnosticData?.status !== 'error') {
      throw new Error(`Expected diagnostic status 'error' for nonexistent file, got '${diagnosticData?.status}'`);
    }

    // Test 5: trust_status with nonexistent file — throws (no internal catch)
    const invalidTrustResult = await client.trustStatus({
      workflowPath: 'nonexistent/workflow.ts',
    });

    if (invalidTrustResult.success) {
      throw new Error('trust_status tool should have failed for nonexistent file');
    }
    if (!invalidTrustResult.error) {
      throw new Error(
        `Expected trust_status error, got none`,
      );
    }

    // Test 6: explain with nonexistent file — throws (no internal catch)
    const invalidExplainResult = await client.explain({
      workflowPath: 'nonexistent/workflow.ts',
    });

    if (invalidExplainResult.success) {
      throw new Error('explain tool should have failed for nonexistent file');
    }
    if (!invalidExplainResult.error) {
      throw new Error(
        `Expected explain error, got none`,
      );
    }
  } finally {
    if (client) await client.close();
  }
}

export const scenario: Scenario = { name: '07-mcp-tools', run };
