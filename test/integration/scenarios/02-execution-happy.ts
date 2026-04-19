/**
 * Scenario 02: Execution happy path
 *
 * Validates happy-path.ts with layer 'both'.
 * Asserts no static findings, execution success, diagnostic status 'pass',
 * and trust state updated for all nodes.
 */

import { resolve, join } from 'node:path';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildTrustStatusReport } from '../../../src/surface.js';
import { buildTestDeps } from '../lib/deps.js';
import { assertStatus, assertNoFindings, assertTrusted } from '../lib/assertions.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);
  const happyPath = resolve(join(ctx.fixturesDir, 'happy-path.ts'));

  const result = await interpret(
    {
      workflowPath: happyPath,
      target: { kind: 'workflow' },
      layer: 'both',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    },
    deps,
  );

  assertStatus(result, 'pass');
  assertNoFindings(result);

  if (result.executedPath === null) {
    throw new Error('Expected executedPath to be non-null for layer "both"');
  }

  // Verify trust state was updated for all nodes
  const trustReport = await buildTrustStatusReport(happyPath, deps);

  assertTrusted(trustReport, 'Trigger');
  assertTrusted(trustReport, 'Set');
  assertTrusted(trustReport, 'NoOp');
}

export const scenario: Scenario = { name: '02-execution-happy', run };
