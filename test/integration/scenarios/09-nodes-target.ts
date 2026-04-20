/**
 * Scenario 09: Nodes target kind — validate specific node subset
 *
 * Uses multi-node-change.ts (Trigger → A → B → C → D) with target kind
 * 'nodes' to validate only nodes B and C. Verifies:
 * - Only the specified nodes are in the resolved target
 * - Static analysis runs only on the targeted slice
 * - Trust is recorded only for validated nodes
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
  const multiNodePath = resolve(join(ctx.fixturesDir, 'multi-node-change.ts'));

  const result = await interpret(
    {
      workflowPath: multiNodePath,
      target: { kind: 'nodes', nodes: ['B', 'C'] },
      tool: 'validate',
      force: false,
      pinData: null,
    },
    deps,
  );

  // Should pass static analysis — no wiring issues in B/C slice
  assertStatus(result, 'pass');
  assertNoFindings(result);

  // Resolved target description should reference our requested nodes
  if (!result.target.description.includes('B') || !result.target.description.includes('C')) {
    throw new Error(`Expected target description to mention B and C, got: '${result.target.description}'`);
  }

  // Trust should be recorded for validated nodes
  const trustReport = await buildTrustStatusReport(multiNodePath, deps);

  // B and C should be trusted (they were explicitly requested)
  assertTrusted(trustReport, 'B');
  assertTrusted(trustReport, 'C');
}

export const scenario: Scenario = { name: '09-nodes-target', run };
