/**
 * Scenario 01: Static-only validation
 *
 * Validates data-loss-passthrough.ts with tool 'validate' and asserts a
 * data-loss wiring finding. Also validates broken-wiring.ts (passes static
 * because disconnected-node detection is not yet implemented).
 * Asserts execution engine was not invoked (executedPath is null).
 */

import { resolve, join } from 'node:path';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildTestDeps } from '../lib/deps.js';
import { assertStatus, assertFindingPresent, assertEvidenceBasis, assertNodeAnnotation, assertAnnotationCount, assertHintPresent } from '../lib/assertions.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);

  // Test 1: data-loss-passthrough should produce a 'wiring' finding (data-loss through shape-replacing node)
  const dataLossPath = resolve(join(ctx.fixturesDir, 'data-loss-passthrough.ts'));
  const result1 = await interpret(
    {
      workflowPath: dataLossPath,
      target: { kind: 'workflow' },
      tool: 'validate',
      force: false,
      pinData: null,
    },
    deps,
  );

  assertStatus(result1, 'fail');
  assertFindingPresent(result1, 'wiring');
  assertEvidenceBasis(result1, 'static');

  // The wiring error should be attributed to the node with the broken reference
  const wiringError = result1.errors.find(e => e.classification === 'wiring');
  if (!wiringError?.node) {
    throw new Error('Expected wiring error to have a node attribution');
  }

  // Capabilities should report no MCP tools for static-only
  if (result1.capabilities.mcpTools !== false) {
    throw new Error('Expected capabilities.mcpTools to be false for static-only validation');
  }

  if (result1.executedPath !== null) {
    throw new Error('Expected executedPath to be null for static-only validation');
  }

  // B3: nodeAnnotations — one per target node, nodes with findings are 'validated'
  assertAnnotationCount(result1, result1.target.nodes.length);
  // The node that produced the wiring error should be 'validated'
  assertNodeAnnotation(result1, wiringError.node, 'validated');

  // B4: hints — static-only run should include the info hint about execution
  assertHintPresent(result1, 'info', 'static analysis only');

  // Test 2: broken-wiring passes static (orphaned node detection not yet implemented)
  const brokenWiringPath = resolve(join(ctx.fixturesDir, 'broken-wiring.ts'));
  const result2 = await interpret(
    {
      workflowPath: brokenWiringPath,
      target: { kind: 'workflow' },
      tool: 'validate',
      force: false,
      pinData: null,
    },
    deps,
  );

  assertStatus(result2, 'pass');
  assertEvidenceBasis(result2, 'static');

  if (result2.executedPath !== null) {
    throw new Error('Expected executedPath to be null for static-only validation');
  }
}

export const scenario: Scenario = { name: '01-static-only', run };
