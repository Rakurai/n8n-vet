/**
 * Scenario 06: Bounded execution
 *
 * Push multi-node-change.ts, validate with target nodes ['B'],
 * destinationNode 'B', destinationMode 'inclusive', pin data for trigger.
 * Assert only trigger→A→B have execution results, C and D have none.
 */

import { resolve, join } from 'node:path';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildTestDeps } from '../lib/deps.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);
  const multiNodePath = resolve(join(ctx.fixturesDir, 'multi-node-change.ts'));

  const result = await interpret(
    {
      workflowPath: multiNodePath,
      target: { kind: 'nodes', nodes: ['B'] },
      layer: 'both',
      force: false,
      pinData: {
        Trigger: [{ json: { value: 'test' } }],
      },
      destinationNode: 'B',
      destinationMode: 'inclusive',
    },
    deps,
  );

  // Execution should have completed (pass or fail)
  if (result.executedPath === null) {
    throw new Error('Expected execution to run with destinationNode set');
  }

  // Only trigger→A→B should be in the executed path
  const executedNodeNames = result.executedPath.map(p => String(p.name));

  // C and D should NOT be in the executed path
  if (executedNodeNames.includes('C')) {
    throw new Error(`Node C should not be executed with destinationNode 'B', but was in path: [${executedNodeNames.join(', ')}]`);
  }
  if (executedNodeNames.includes('D')) {
    throw new Error(`Node D should not be executed with destinationNode 'B', but was in path: [${executedNodeNames.join(', ')}]`);
  }

  // B should be in the path (it's the destination)
  if (!executedNodeNames.includes('B')) {
    throw new Error(`Node B should be in executed path as destination, but path was: [${executedNodeNames.join(', ')}]`);
  }
}

export const scenario: Scenario = { name: '06-bounded-execution', run };
