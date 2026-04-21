/**
 * Scenario 10: Test-refusal guardrail
 *
 * The test-refusal guardrail is core product identity: when all changes are
 * structurally analyzable, calling `test` should refuse and recommend
 * `validate` instead. This prevents unnecessary execution cost.
 *
 * Steps:
 * 1. Call `test` on happy-path.ts without force → assert refusal
 * 2. Assert specific guardrail action, status, and explanation content
 * 3. Call `test` with force → assert it does NOT refuse
 */

import { resolve, join } from 'node:path';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildTestDeps } from '../lib/deps.js';
import {
  assertStatus,
  assertGuardrailAction,
  assertGuardrailExplanationContains,
} from '../lib/assertions.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);
  const happyPath = resolve(join(ctx.fixturesDir, 'happy-path.ts'));

  // Step 1: Call test without force on a structurally-analyzable workflow
  const result1 = await interpret(
    {
      workflowPath: happyPath,
      target: { kind: 'changed' },
      tool: 'test',
      force: false,
      pinData: null,
    },
    deps,
  );

  // Guardrail should refuse — all nodes are structurally analyzable
  assertStatus(result1, 'skipped');
  assertGuardrailAction(result1, 'refuse');
  assertGuardrailExplanationContains(result1, 'refuse', 'structurally analyzable');

  // Step 2: Call test with force → should NOT refuse (proceeds or errors on missing MCP)
  const result2 = await interpret(
    {
      workflowPath: happyPath,
      target: { kind: 'changed' },
      tool: 'test',
      force: true,
      pinData: null,
      ...(ctx.callTool ? { callTool: ctx.callTool } : {}),
    },
    deps,
  );

  // With force, the guardrail should not refuse
  const hasRefusal = result2.guardrailActions.some(d => d.action === 'refuse');
  if (hasRefusal) {
    throw new Error('Expected force=true to bypass test-refusal guardrail, but got refuse action');
  }

  // Status should be pass (with MCP) or pass/error (without MCP) — but not skipped
  if (result2.status === 'skipped') {
    throw new Error('Expected force=true to bypass guardrail, but status is still skipped');
  }
}

export const scenario: Scenario = { name: '10-test-refusal', run };
