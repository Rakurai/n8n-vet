/**
 * Scenario 08: Full pipeline — multi-step validation lifecycle
 *
 * Steps:
 * 1. Validate data-loss-passthrough.ts static → find data-loss wiring issue
 * 2. Copy fixture, fix the data-loss reference
 * 3. Validate fixed copy static → pass
 * 4. Validate again unchanged → guardrail fires (no-change rerun)
 */

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildTestDeps } from '../lib/deps.js';
import { assertStatus, assertFindingPresent, assertNoFindings } from '../lib/assertions.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);
  const dataLossPath = resolve(join(ctx.fixturesDir, 'data-loss-passthrough.ts'));

  // Step 1: Static validation — should find data-loss wiring issue
  const staticResult = await interpret(
    {
      workflowPath: dataLossPath,
      target: { kind: 'workflow' },
      tool: 'validate',
      force: false,
      pinData: null,
    },
    deps,
  );

  assertStatus(staticResult, 'fail');
  assertFindingPresent(staticResult, 'wiring');

  // Step 2: Fix the data-loss reference in a temp copy.
  // The UseOriginal node references $json.rawData which doesn't exist after
  // the Transform node replaces the item shape. Fix by referencing $json.processed
  // which IS set by Transform.
  const tempCopy = join(tmpdir(), `n8n-vet-integ-fix-${Date.now()}.ts`);
  copyFileSync(dataLossPath, tempCopy);

  let content = readFileSync(tempCopy, 'utf-8');
  // Remove the UseOriginal node's problematic reference entirely — replace with
  // a value that doesn't reference upstream data through a shape-replacing node.
  // Also fix Transform's $json.result reference (from HttpRequest through shape-replacer).
  content = content.replace(
    "'={{ $json.result }}'",
    "'fixed-value'",
  );
  content = content.replace(
    "'={{ $json.rawData }}'",
    "'fixed-value'",
  );
  if (content === readFileSync(dataLossPath, 'utf-8')) {
    throw new Error('Failed to fix data-loss references in temp copy');
  }
  writeFileSync(tempCopy, content, 'utf-8');

  // Step 3: Validate fixed copy — should pass
  const freshDeps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);

  const fixedResult = await interpret(
    {
      workflowPath: tempCopy,
      target: { kind: 'workflow' },
      tool: 'validate',
      force: true,
      pinData: null,
    },
    freshDeps,
  );

  assertStatus(fixedResult, 'pass');
  assertNoFindings(fixedResult);

  // Step 4: Validate again unchanged — guardrail should fire
  const rerunResult = await interpret(
    {
      workflowPath: tempCopy,
      target: { kind: 'workflow' },
      tool: 'validate',
      force: false,
      pinData: null,
    },
    freshDeps,
  );

  // Guardrail should refuse or redirect the unchanged rerun
  const hasGuardrail = rerunResult.guardrailActions.some(
    d => d.action === 'refuse' || d.action === 'narrow' || d.action === 'warn',
  );
  if (!hasGuardrail) {
    throw new Error(
      `Expected guardrail action on unchanged rerun, got actions: [${rerunResult.guardrailActions.map(d => d.action).join(', ')}]`,
    );
  }
}

export const scenario: Scenario = { name: '08-full-pipeline', run };
