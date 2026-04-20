/**
 * Scenario 06: Branching workflow with execution path validation
 *
 * Uses branching-coverage.ts (Trigger → If → TruePath / FalsePath).
 * Tests with tool 'test' via MCP and asserts the executed path
 * contains the correct node sequence including branch selection.
 *
 * When N8N_MCP_TOKEN is not configured, falls back to static-only.
 */

import { resolve, join } from 'node:path';
import { interpret } from '../../../src/orchestrator/interpret.js';
import { buildTestDeps } from '../lib/deps.js';
import { assertStatus, assertNoFindings } from '../lib/assertions.js';
import type { IntegrationContext } from '../lib/setup.js';
import type { Scenario } from '../run.js';

async function run(ctx: IntegrationContext): Promise<void> {
  const deps = buildTestDeps(ctx.trustDir, ctx.snapshotDir);
  const branchingPath = resolve(join(ctx.fixturesDir, 'branching-coverage.ts'));

  const result = await interpret(
    {
      workflowPath: branchingPath,
      target: { kind: 'workflow' },
      tool: 'test',
      force: true,
      pinData: null,
      callTool: ctx.callTool ?? undefined,
    },
    deps,
  );

  // Static analysis: no wiring errors expected in this fixture
  assertStatus(result, 'pass');
  assertNoFindings(result);

  if (ctx.callTool) {
    // Execution should produce a path
    if (!result.executedPath || result.executedPath.length === 0) {
      throw new Error('Expected non-empty executedPath from branching workflow execution');
    }

    // Path should start with Trigger and include If
    const pathNames = result.executedPath.map(n => n.name);
    if (pathNames[0] !== 'Trigger') {
      throw new Error(`Expected path to start with 'Trigger', got '${pathNames[0]}'`);
    }
    if (!pathNames.includes('If')) {
      throw new Error(`Expected path to include 'If' node, got: [${pathNames.join(', ')}]`);
    }

    // Path should include one branch (True Path or False Path, depending on pin data)
    const hasBranch = pathNames.includes('True Path') || pathNames.includes('False Path');
    if (!hasBranch) {
      throw new Error(`Expected path to include 'True Path' or 'False Path', got: [${pathNames.join(', ')}]`);
    }

    // Execution metadata should be populated
    if (!result.meta.executionId) {
      throw new Error('Expected executionId to be populated after execution');
    }
  }
}

export const scenario: Scenario = { name: '06-branching-execution', run };
