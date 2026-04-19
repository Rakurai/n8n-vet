/**
 * Scenario 04: Trust lifecycle
 *
 * Steps:
 * 1. Validate multi-node-change.ts static → all nodes become trusted
 * 2. Copy fixture to temp, edit node B parameters
 * 3. Assert node B untrusted, others trusted
 * 4. Validate again → assert only B and downstream validated (not A)
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

  // Step 1: Validate static → build trust for all nodes
  const result1 = await interpret(
    {
      workflowPath: multiNodePath,
      target: { kind: 'workflow' },
      layer: 'static',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    },
    deps,
  );

  assertStatus(result1, 'pass');

  // Verify all nodes are trusted
  const trust1 = await buildTrustStatusReport(multiNodePath, deps);
  assertTrusted(trust1, 'Trigger');
  assertTrusted(trust1, 'A');
  assertTrusted(trust1, 'B');
  assertTrusted(trust1, 'C');
  assertTrusted(trust1, 'D');

  // Step 2: Copy to temp, modify node B's parameters
  const tempCopy = join(tmpdir(), `n8n-vet-integ-trust-${Date.now()}.ts`);
  copyFileSync(multiNodePath, tempCopy);

  const content = readFileSync(tempCopy, 'utf-8');
  // Change node B's parameter value — match the specific step:'B' assignment
  // The fixture has assignments like { name: 'step', value: 'A' }, { name: 'step', value: 'B' }, etc.
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
      layer: 'static',
      force: false,
      pinData: null,
      destinationNode: null,
      destinationMode: 'inclusive',
    },
    deps,
  );

  // The validation should target B (and possibly downstream C, D) but not A
  const validatedNodes = result2.target.nodes;
  const validatedNodeNames = validatedNodes.map(n => String(n));

  if (validatedNodeNames.includes('A')) {
    throw new Error(`Node A should not be re-validated, but it was in the target: [${validatedNodeNames.join(', ')}]`);
  }

  if (!validatedNodeNames.includes('B')) {
    throw new Error(`Node B should be in the validation target, but targets were: [${validatedNodeNames.join(', ')}]`);
  }
}

export const scenario: Scenario = { name: '04-trust-lifecycle', run };
