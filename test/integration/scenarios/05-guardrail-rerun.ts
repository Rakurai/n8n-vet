/**
 * Scenario 05: Guardrail rerun refusal
 *
 * Steps:
 * 1. Validate happy-path.ts static to build trust
 * 2. Validate again with no changes → assert guardrail refuse or redirect
 * 3. Call buildGuardrailExplanation → assert it reports what guardrail would do
 */

import { resolve, join } from 'node:path';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildGuardrailExplanation } from '../../../src/surface.js';
import { buildTestDeps } from '../lib/deps.js';
import { assertStatus } from '../lib/assertions.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);
  const happyPath = resolve(join(ctx.fixturesDir, 'happy-path.ts'));

  // Step 1: Validate static to build trust
  const result1 = await interpret(
    {
      workflowPath: happyPath,
      target: { kind: 'workflow' },
      tool: 'validate',
      force: false,
      pinData: null,
    },
    deps,
  );

  assertStatus(result1, 'pass');

  // Step 2: Validate again unchanged — guardrail should fire
  const result2 = await interpret(
    {
      workflowPath: happyPath,
      target: { kind: 'workflow' },
      tool: 'validate',
      force: false,
      pinData: null,
    },
    deps,
  );

  const guardrailAction = result2.guardrailActions.find(
    d => d.action === 'refuse' || d.action === 'narrow' || d.action === 'warn',
  );

  if (!guardrailAction) {
    throw new Error(
      `Expected guardrail to fire on unchanged rerun, got actions: [${result2.guardrailActions.map(d => d.action).join(', ')}]`,
    );
  }

  // Step 3: buildGuardrailExplanation should report what guardrail would do
  const explanation = await buildGuardrailExplanation(
    happyPath,
    { kind: 'workflow' },
    'validate',
    deps,
  );

  // The explanation should contain the guardrail decision
  if (!explanation.guardrailDecision) {
    throw new Error('Expected guardrailExplanation to contain a guardrailDecision');
  }

  // The decision should not be 'proceed' since nothing changed
  if (explanation.guardrailDecision.action === 'proceed') {
    throw new Error(
      `Expected guardrail explanation to show non-proceed action, got: ${explanation.guardrailDecision.action}`,
    );
  }
}

export const scenario: Scenario = { name: '05-guardrail-rerun', run };
