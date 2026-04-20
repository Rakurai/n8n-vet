/**
 * CLI entry point — parses arguments, dispatches to command functions,
 * formats output, and sets exit code.
 *
 * Usage: n8n-vet <command> <workflow-path> [options]
 * Commands: validate, trust, explain
 */

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildDeps } from '../deps.js';
import type { PinData } from '../execution/types.js';
import type { NodeIdentity } from '../types/identity.js';
import type { AgentTarget } from '../types/target.js';
import { runExplain, runTest, runTrust, runValidate } from './commands.js';
import type { ExplainOptions, TestOptions, ValidateOptions } from './commands.js';
import {
  formatDiagnosticSummary,
  formatGuardrailExplanation,
  formatMcpError,
  formatTrustStatus,
} from './format.js';

// ── Usage ───────────────────────────────────────────────────────

const USAGE = `Usage: n8n-vet <command> <workflow-path> [options]

Commands:
  validate   Validate an n8n workflow (static analysis)
  test       Test an n8n workflow via execution
  trust      Show trust status for a workflow
  explain    Preview guardrail behavior

Options:
  --target <kind>     nodes, changed, or workflow (default: changed)
  --nodes <name,...>  Comma-separated node names (requires --target nodes)
  --tool <tool>       validate or test (default: validate, for explain command)
  --force             Bypass guardrails
  --json              Output raw JSON envelope`;

// ── Argument parsing ────────────────────────────────────────────

function resolveTarget(
  targetKind: string | undefined,
  nodesArg: string | undefined,
): AgentTarget | string {
  const kind = targetKind ?? 'changed';

  if (kind !== 'nodes' && kind !== 'changed' && kind !== 'workflow') {
    return `Invalid --target value: "${kind}". Must be nodes, changed, or workflow.`;
  }

  if (kind === 'nodes' && !nodesArg) {
    return '--target nodes requires --nodes <name,...>';
  }

  if (nodesArg && kind !== 'nodes') {
    return '--nodes requires --target nodes';
  }

  if (kind === 'nodes') {
    const names =
      nodesArg
        ?.split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0) ?? [];
    if (names.length === 0) {
      return '--nodes must contain at least one non-empty node name';
    }
    return { kind: 'nodes', nodes: names as NodeIdentity[] };
  }
  if (kind === 'workflow') return { kind: 'workflow' };
  return { kind: 'changed' };
}

function resolveTool(raw: string | undefined): 'validate' | 'test' | string {
  const tool = raw ?? 'validate';
  if (tool !== 'validate' && tool !== 'test') {
    return `Invalid --tool value: "${tool}". Must be validate or test.`;
  }
  return tool;
}

// ── Main ────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  // biome-ignore lint/suspicious/noImplicitAnyLet: parseArgs return type is complex and inferred at assignment
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        target: { type: 'string' },
        nodes: { type: 'string' },
        tool: { type: 'string' },
        layer: { type: 'string' },
        force: { type: 'boolean', default: false },
        'pin-data': { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    });
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : 'Invalid arguments'}\n\n${USAGE}\n`,
    );
    return 2;
  }

  const { values, positionals } = parsed;
  const command = positionals[0];
  const workflowPath = positionals[1];
  const jsonMode = values.json ?? false;

  // Reject --layer on all commands
  if (values.layer !== undefined) {
    process.stderr.write(
      'Error: --layer is no longer supported. Use separate validate/test commands.\n',
    );
    return 2;
  }

  if (!command || !workflowPath) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  // Path traversal validation
  const resolvedPath = resolve(workflowPath);
  const root = process.cwd();
  if (!resolvedPath.startsWith(`${root}/`) && resolvedPath !== root) {
    process.stderr.write(
      `Error: path traversal rejected — '${workflowPath}' resolves outside project root\n`,
    );
    return 2;
  }

  const deps = buildDeps();

  if (command === 'validate') {
    const target = resolveTarget(values.target, values.nodes);
    if (typeof target === 'string') {
      process.stderr.write(`${target}\n`);
      return 2;
    }

    const options: ValidateOptions = {
      target,
      force: values.force ?? false,
    };

    const result = await runValidate(workflowPath, options, deps);

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result.success ? 0 : 1;
    }

    if (result.success) {
      process.stdout.write(`${formatDiagnosticSummary(result.data)}\n`);
      return 0;
    }
    process.stderr.write(`${formatMcpError(result.error)}\n`);
    return 1;
  }

  if (command === 'test') {
    const target = resolveTarget(values.target, values.nodes);
    if (typeof target === 'string') {
      process.stderr.write(`${target}\n`);
      return 2;
    }

    let pinData: PinData | null = null;
    const pinDataArg = values['pin-data'];
    if (pinDataArg) {
      try {
        pinData = JSON.parse(pinDataArg);
      } catch {
        process.stderr.write('Error: --pin-data must be valid JSON\n');
        return 2;
      }
    }

    const options: TestOptions = {
      target,
      force: values.force ?? false,
      pinData,
    };

    const result = await runTest(workflowPath, options, deps);

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result.success ? 0 : 1;
    }

    if (result.success) {
      process.stdout.write(`${formatDiagnosticSummary(result.data)}\n`);
      return 0;
    }
    process.stderr.write(`${formatMcpError(result.error)}\n`);
    return 1;
  }

  if (command === 'trust') {
    const result = await runTrust(workflowPath, deps);

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result.success ? 0 : 1;
    }

    if (result.success) {
      process.stdout.write(`${formatTrustStatus(result.data)}\n`);
      return 0;
    }
    process.stderr.write(`${formatMcpError(result.error)}\n`);
    return 1;
  }

  if (command === 'explain') {
    const target = resolveTarget(values.target, values.nodes);
    if (typeof target === 'string') {
      process.stderr.write(`${target}\n`);
      return 2;
    }

    const tool = resolveTool(values.tool);
    if (tool !== 'validate' && tool !== 'test') {
      process.stderr.write(`${tool}\n`);
      return 2;
    }

    const options: ExplainOptions = { target, tool };
    const result = await runExplain(workflowPath, options, deps);

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result.success ? 0 : 1;
    }

    if (result.success) {
      process.stdout.write(`${formatGuardrailExplanation(result.data)}\n`);
      return 0;
    }
    process.stderr.write(`${formatMcpError(result.error)}\n`);
    return 1;
  }

  process.stderr.write(`Unknown command: "${command}"\n\n${USAGE}\n`);
  return 2;
}

// Run when invoked directly
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] === thisFile) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
