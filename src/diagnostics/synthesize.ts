/**
 * Top-level diagnostic synthesis — the single public entry point for the
 * diagnostics subsystem.
 *
 * Assembles status, errors, annotations, hints, and path into a canonical
 * DiagnosticSummary.
 */

import type { DiagnosticSummary } from '../types/diagnostic.js';
import type { ValidationLayer } from '../types/target.js';
import type { SynthesisInput } from './types.js';
import { z } from 'zod';
import { determineStatus } from './status.js';
import { classifyStaticFindings, classifyExecutionErrors, orderErrors } from './errors.js';
import { assignAnnotations } from './annotations.js';
import { collectHints } from './hints.js';
import { reconstructPath } from './path.js';

/** Typed error for synthesis-level validation failures. */
export class SynthesisError extends Error {
  override readonly name = 'SynthesisError' as const;
}

/**
 * Synthesize a DiagnosticSummary from all evidence layers.
 *
 * This is the only public export from the diagnostics subsystem.
 */
export function synthesize(input: SynthesisInput): DiagnosticSummary {
  validateInput(input);

  const {
    staticFindings,
    executionData,
    trustState,
    guardrailDecisions,
    resolvedTarget,
    capabilities,
    meta,
  } = input;

  const status = determineStatus(staticFindings, executionData, guardrailDecisions);

  const staticErrors = classifyStaticFindings(staticFindings);
  const executionErrors = executionData !== null
    ? classifyExecutionErrors(executionData)
    : [];
  const errors = orderErrors([...staticErrors, ...executionErrors]);

  const nodeAnnotations = assignAnnotations(
    resolvedTarget,
    trustState,
    executionData,
    staticFindings,
  );

  const hints = collectHints(staticFindings, executionData);

  const executedPath = reconstructPath(executionData);

  const evidenceBasis = determineEvidenceBasis(staticFindings, executionData);

  return {
    schemaVersion: 1,
    status,
    target: resolvedTarget,
    evidenceBasis,
    executedPath,
    errors,
    nodeAnnotations,
    guardrailActions: guardrailDecisions,
    hints,
    capabilities,
    meta,
  };
}

const SynthesisInputSchema = z.object({
  staticFindings: z.array(z.object({
    node: z.string().min(1),
    kind: z.string(),
    severity: z.enum(['error', 'warning']),
    message: z.string(),
    context: z.record(z.unknown()),
  })),
  executionData: z.union([
    z.object({
      status: z.enum(['success', 'error', 'cancelled']),
      lastNodeExecuted: z.string().nullable(),
      error: z.unknown().nullable(),
      nodeResults: z.instanceof(Map),
    }),
    z.null(),
  ]),
  trustState: z.object({
    nodes: z.instanceof(Map),
  }),
  guardrailDecisions: z.array(z.object({
    action: z.string(),
    explanation: z.string(),
  }).passthrough()),
  resolvedTarget: z.object({
    description: z.string(),
    nodes: z.array(z.string().min(1)).min(1, 'resolvedTarget.nodes must not be empty — a validation run with no nodes in scope is a caller bug.'),
    automatic: z.boolean(),
  }),
  capabilities: z.object({
    staticAnalysis: z.literal(true),
    restApi: z.boolean(),
    mcpTools: z.boolean(),
  }),
  meta: z.object({
    runId: z.string().min(1),
    executionId: z.string().nullable(),
    partialExecution: z.boolean(),
    timestamp: z.string().min(1),
    durationMs: z.number().nonnegative(),
  }),
});

function validateInput(input: SynthesisInput): void {
  const result = SynthesisInputSchema.safeParse(input);
  if (!result.success) {
    throw new SynthesisError(result.error.issues[0].message);
  }
}

function determineEvidenceBasis(
  staticFindings: SynthesisInput['staticFindings'],
  executionData: SynthesisInput['executionData'],
): ValidationLayer {
  if (executionData === null) return 'static';
  if (staticFindings.length === 0) return 'execution';
  return 'both';
}
