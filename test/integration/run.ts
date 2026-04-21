/**
 * Integration test runner — scenario registry, CLI flags, sequential execution
 * with setup/pushAll/run/cleanup lifecycle, and pass/fail reporting.
 *
 * Usage:
 *   npx tsx test/integration/run.ts              # Run all scenarios
 *   npx tsx test/integration/run.ts --check      # Check prerequisites only
 *   npx tsx test/integration/run.ts --scenario 04  # Run single scenario
 *   npx tsx test/integration/run.ts --verbose    # Verbose output
 */

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setup, createScenarioContext, type IntegrationContext } from './lib/setup.js';

// ── Types ────────────────────────────────────────────────────────

export interface Scenario {
  name: string;
  run: (ctx: IntegrationContext) => Promise<void>;
}

interface RunResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

// ── Scenario Registry ────────────────────────────────────────────

async function loadScenarios(filter?: string): Promise<Scenario[]> {
  const scenariosDir = resolve('test/integration/scenarios');
  const files = readdirSync(scenariosDir)
    .filter(f => f.endsWith('.ts'))
    .sort();

  const scenarios: Scenario[] = [];
  for (const file of files) {
    if (filter && !file.startsWith(filter)) continue;

    const mod = await import(join(scenariosDir, file));
    if (typeof mod.scenario !== 'object' || typeof mod.scenario.run !== 'function') {
      console.error(`  WARNING: ${file} does not export a valid scenario object`);
      continue;
    }
    scenarios.push(mod.scenario as Scenario);
  }

  return scenarios;
}

// ── CLI Argument Parsing ─────────────────────────────────────────

interface CliArgs {
  check: boolean;
  scenario: string | null;
  verbose: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { check: false, scenario: null, verbose: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') result.check = true;
    else if (args[i] === '--verbose') result.verbose = true;
    else if (args[i] === '--scenario' && args[i + 1]) {
      result.scenario = args[++i];
    }
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('n8n-proctor integration tests\n');

  // Setup — verify prerequisites, load manifest, create temp dirs
  let ctx: IntegrationContext;
  try {
    ctx = await setup();
    console.log('Prerequisites: OK');
  } catch (err) {
    console.error(`Prerequisites: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (args.check) {
    console.log('\n--check mode: prerequisites verified, exiting.');
    ctx.cleanup();
    return;
  }

  // Push all fixtures to n8n
  // NOTE: Skipped — seed.ts already creates/updates workflows via REST API.
  // If fixtures are modified locally, re-run `npx tsx test/integration/seed.ts`.
  // n8nac push requires files to be inside the active sync scope, which doesn't
  // match the flattened fixture layout. Fixing this properly requires rethinking
  // the fixture directory structure.
  console.log('Fixtures: using seeded workflows (run seed.ts to refresh)\n');

  // Load scenarios
  const scenarios = await loadScenarios(args.scenario ?? undefined);
  if (scenarios.length === 0) {
    console.error(args.scenario ? `No scenario matching '${args.scenario}' found.` : 'No scenarios found.');
    ctx.cleanup();
    process.exit(1);
  }

  console.log(`Running ${scenarios.length} scenario(s)...\n`);

  // Execute scenarios sequentially — each gets isolated trust/snapshot dirs
  const results: RunResult[] = [];
  for (const scenario of scenarios) {
    const scenarioCtx = createScenarioContext(ctx);
    const start = Date.now();
    try {
      await scenario.run(scenarioCtx);
      const durationMs = Date.now() - start;
      results.push({ name: scenario.name, passed: true, durationMs } as RunResult);
      console.log(`  PASS  ${scenario.name} (${durationMs}ms)`);
    } catch (err) {
      const durationMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      results.push({ name: scenario.name, passed: false, error: errorMsg, durationMs });
      console.log(`  FAIL  ${scenario.name} (${durationMs}ms)`);
      console.log(`        ${errorMsg}`);
      if (args.verbose && stack) {
        console.log(`        ${stack.split('\n').slice(1, 4).join('\n        ')}`);
      }
    } finally {
      scenarioCtx.cleanup();
    }
  }

  // Cleanup
  ctx.cleanup();

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log(`\n${passed} passed, ${failed} failed (${totalMs}ms)\n`);

  if (failed > 0) {
    console.log('Failures:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ${r.name}: ${r.error}`);
    }
    process.exit(1);
  }
}

main();
