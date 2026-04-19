/**
 * Scenario 01: Static-only validation
 *
 * Validates broken-wiring.ts and data-loss-passthrough.ts with layer 'static'.
 * Asserts disconnected-node finding and data-loss-risk finding respectively.
 * Asserts execution engine was not invoked (executedPath is null).
 */

import { resolve, join } from 'node:path';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildTestDeps } from '../lib/deps.js';
import { assertStatus, assertFindingPresent } from '../lib/assertions.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);

  // Test 1: broken-wiring should produce a 'wiring' finding (disconnected node)
  const brokenWiringPath = resolve(join(ctx.fixturesDir, 'broken-wiring.ts'));
  const result1 = await interpret(
    {
      workflowPath: brokenWiringPath,
      target: { kind: 'workflow' },
      layer: 'static',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    },
    deps,
  );

  assertStatus(result1, 'fail');
  assertFindingPresent(result1, 'wiring');

  if (result1.executedPath !== null) {
    throw new Error('Expected executedPath to be null for static-only validation');
  }

  // Test 2: data-loss-passthrough should produce a 'wiring' finding (data-loss kind maps to wiring classification)
  const dataLossPath = resolve(join(ctx.fixturesDir, 'data-loss-passthrough.ts'));
  const result2 = await interpret(
    {
      workflowPath: dataLossPath,
      target: { kind: 'workflow' },
      layer: 'static',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    },
    deps,
  );

  assertStatus(result2, 'fail');
  assertFindingPresent(result2, 'wiring');

  if (result2.executedPath !== null) {
    throw new Error('Expected executedPath to be null for static-only validation');
  }
}

export const scenario: Scenario = { name: '01-static-only', run };
