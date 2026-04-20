/**
 * Scenario 04: Trust lifecycle
 *
 * Steps:
 * 1. Copy multi-node-change.ts to temp, validate static → all nodes become trusted
 * 2. Edit node B parameters in the temp copy
 * 3. Assert node B untrusted, others trusted
 * 4. Validate again with 'changed' target → assert only B and downstream validated (not A)
 */

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildTrustStatusReport } from '../../../src/surface.js';
import { buildTestDeps } from '../lib/deps.js';
import { assertStatus, assertTrusted, assertUntrusted } from '../lib/assertions.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);
  const multiNodePath = resolve(join(ctx.fixturesDir, 'multi-node-change.ts'));

  // Use a stable temp path (trust is keyed by file path, so we need the same
  // path across validate → modify → re-validate)
  const tempCopy = join(tmpdir(), `n8n-vet-integ-trust-${Date.now()}.ts`);
  copyFileSync(multiNodePath, tempCopy);

  // Step 1: Validate static on the temp copy → build trust for all nodes
  const result1 = await interpret(
    {
      workflowPath: tempCopy,
      target: { kind: 'workflow' },
      tool: 'validate',
      force: false,
      pinData: null,
    },
    deps,
  );

  assertStatus(result1, 'pass');

  // Verify all nodes are trusted
  const trust1 = await buildTrustStatusReport(tempCopy, deps);
  assertTrusted(trust1, 'Trigger');
  assertTrusted(trust1, 'A');
  assertTrusted(trust1, 'B');
  assertTrusted(trust1, 'C');
  assertTrusted(trust1, 'D');

  // Step 2: Edit node B's parameter value in the temp copy
  const content = readFileSync(tempCopy, 'utf-8');
  const modified = content.replace(
    /name:\s*['"]step['"],\s*value:\s*['"]B['"]/,
    "name: 'step', value: 'B-modified'",
  );
  if (modified === content) {
    throw new Error('Failed to modify node B in temp copy — regex did not match');
  }
  writeFileSync(tempCopy, modified, 'utf-8');

  // Step 3: Check trust on the modified copy — B should be untrusted
  const trust2 = await buildTrustStatusReport(tempCopy, deps);
  assertTrusted(trust2, 'Trigger');
  assertTrusted(trust2, 'A');
  assertUntrusted(trust2, 'B');

  // Step 4: Validate again with 'changed' target — should only validate changed nodes
  const result2 = await interpret(
    {
      workflowPath: tempCopy,
      target: { kind: 'changed' },
      tool: 'validate',
      force: false,
      pinData: null,
    },
    deps,
  );

  // The validation target should include B (changed) and downstream (C, D).
  // A is included as a trusted entry boundary but is not the seed.
  const validatedNodes = result2.target.nodes;
  const validatedNodeNames = validatedNodes.map(n => String(n));

  if (!validatedNodeNames.includes('B')) {
    throw new Error(`Node B should be in the validation target, but targets were: [${validatedNodeNames.join(', ')}]`);
  }

  // Trigger should not be in the slice — it's beyond the trusted boundary (A)
  if (validatedNodeNames.includes('Trigger')) {
    throw new Error(`Node Trigger should not be re-validated, but it was in the target: [${validatedNodeNames.join(', ')}]`);
  }
}

export const scenario: Scenario = { name: '04-trust-lifecycle', run };
