/**
 * Scenario 08: Full pipeline — multi-step validation lifecycle
 *
 * Steps:
 * 1. Validate expression-bug.ts static → find unresolvable reference
 * 2. Validate execution → confirm failure (null output / expression error)
 * 3. Fix expression in temp copy
 * 4. Validate both on fixed copy → pass
 * 5. Validate again unchanged → guardrail fires (no-change rerun)
 */

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildTestDeps } from '../lib/deps.js';
import { assertStatus, assertFindingPresent, assertNoFindings, assertGuardrailAction } from '../lib/assertions.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);
  const expressionBugPath = resolve(join(ctx.fixturesDir, 'expression-bug.ts'));

  // Step 1: Static validation — should find unresolvable expression
  const staticResult = await interpret(
    {
      workflowPath: expressionBugPath,
      target: { kind: 'workflow' },
      layer: 'static',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    },
    deps,
  );

  assertStatus(staticResult, 'fail');
  assertFindingPresent(staticResult, 'expression');

  // Step 2: Execution validation — should confirm the expression fails at runtime
  const execResult = await interpret(
    {
      workflowPath: expressionBugPath,
      target: { kind: 'workflow' },
      layer: 'execution',
      force: true,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    },
    deps,
  );

  assertStatus(execResult, 'fail');

  // Step 3: Fix expression in a temp copy
  const tempCopy = join(tmpdir(), `n8n-vet-integ-fix-${Date.now()}.ts`);
  copyFileSync(expressionBugPath, tempCopy);

  const content = readFileSync(tempCopy, 'utf-8');
  const fixed = content.replace(
    '$json.nonexistent.deep.path',
    '$json.greeting',
  );
  if (fixed === content) {
    throw new Error('Failed to fix expression in temp copy — string replacement did not match');
  }
  writeFileSync(tempCopy, fixed, 'utf-8');

  // Step 4: Validate both on fixed copy — should pass
  // Use fresh deps to avoid stale trust from the bug version
  const freshDeps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);

  const fixedResult = await interpret(
    {
      workflowPath: tempCopy,
      target: { kind: 'workflow' },
      layer: 'both',
      force: true,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    },
    freshDeps,
  );

  assertStatus(fixedResult, 'pass');
  assertNoFindings(fixedResult);

  // Step 5: Validate again unchanged — guardrail should fire
  const rerunResult = await interpret(
    {
      workflowPath: tempCopy,
      target: { kind: 'workflow' },
      layer: 'both',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    },
    freshDeps,
  );

  // Guardrail should refuse or redirect the unchanged rerun
  const hasGuardrail = rerunResult.guardrailActions.some(
    d => d.action === 'refuse' || d.action === 'redirect' || d.action === 'narrow' || d.action === 'warn',
  );
  if (!hasGuardrail) {
    throw new Error(
      `Expected guardrail action on unchanged rerun, got actions: [${rerunResult.guardrailActions.map(d => d.action).join(', ')}]`,
    );
  }
}

export const scenario: Scenario = { name: '08-full-pipeline', run };
