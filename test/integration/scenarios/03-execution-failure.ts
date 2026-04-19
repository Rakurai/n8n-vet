/**
 * Scenario 03: Execution failure classification
 *
 * Validates credential-failure.ts with layer 'execution'.
 * Asserts execution error, error classification 'credentials',
 * error node identified, diagnostic status 'fail'.
 */

import { resolve, join } from 'node:path';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildTestDeps } from '../lib/deps.js';
import { assertStatus, assertFindingPresent } from '../lib/assertions.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);
  const credFailurePath = resolve(join(ctx.fixturesDir, 'credential-failure.ts'));

  const result = await interpret(
    {
      workflowPath: credFailurePath,
      target: { kind: 'workflow' },
      layer: 'execution',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    },
    deps,
  );

  // Should fail due to credential issues
  assertStatus(result, 'fail');
  assertFindingPresent(result, 'credentials');

  // Verify the error node is identified
  const credError = result.errors.find(e => e.classification === 'credentials');
  if (!credError) throw new Error('Expected a credentials error');
  if (!credError.node) throw new Error('Expected error node to be identified');
}

export const scenario: Scenario = { name: '03-execution-failure', run };
