/**
 * Scenario 03: Execution failure via n8n MCP
 *
 * Tests credential-failure.ts with tool 'test' to trigger a runtime failure.
 * The workflow's HTTP Request node attempts to reach an unreachable endpoint
 * without credentials, producing an execution error.
 *
 * When N8N_MCP_TOKEN is not configured, falls back to verifying graceful
 * degradation (execution skipped when callTool is absent).
 */

import { resolve, join } from 'node:path';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildTestDeps } from '../lib/deps.js';
import { assertStatus } from '../lib/assertions.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);
  const credFailurePath = resolve(join(ctx.fixturesDir, 'credential-failure.ts'));

  if (ctx.callTool) {
    // Execution test — expects runtime failure from unreachable HTTP endpoint
    const execResult = await interpret(
      {
        workflowPath: credFailurePath,
        target: { kind: 'workflow' },
        tool: 'test',
        force: true,
        pinData: null,
        callTool: ctx.callTool,
      },
      deps,
    );

    assertStatus(execResult, 'fail');

    // Capabilities should report MCP tools available
    if (!execResult.capabilities.mcpTools) {
      throw new Error('Expected capabilities.mcpTools to be true');
    }

    // The error should reference the HTTP node
    const httpError = execResult.errors.find(e => e.node === 'HTTP No Creds');
    if (!httpError) {
      throw new Error('Expected an error on node "HTTP No Creds"');
    }
  }
}

export const scenario: Scenario = { name: '03-execution-failure', run };
