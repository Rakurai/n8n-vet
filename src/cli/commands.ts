/**
 * CLI command implementations — validate, trust, explain.
 *
 * Each command accepts parsed arguments, delegates to library core,
 * and returns an McpResponse envelope. The CLI entry point handles
 * output formatting and exit codes.
 */

import type { McpResponse } from '../errors.js';
import { mapToMcpError } from '../errors.js';
import type { PinData } from '../execution/types.js';
import { interpret } from '../orchestrator/interpret.js';
import type { OrchestratorDeps } from '../orchestrator/types.js';
import type { ValidationRequest } from '../orchestrator/types.js';
import { buildGuardrailExplanation, buildTrustStatusReport } from '../surface.js';
import type { DiagnosticSummary } from '../types/diagnostic.js';
import type { GuardrailExplanation, TrustStatusReport } from '../types/surface.js';
import type { AgentTarget } from '../types/target.js';

// ── Option types ────────────────────────────────────────────────

export interface ValidateOptions {
  target: AgentTarget;
  force: boolean;
}

export interface TestOptions {
  target: AgentTarget;
  force: boolean;
  pinData: PinData | null;
}

export interface ExplainOptions {
  target: AgentTarget;
  tool: 'validate' | 'test';
}

// ── Commands ────────────────────────────────────────────────────

export async function runValidate(
  workflowPath: string,
  options: ValidateOptions,
  deps: OrchestratorDeps,
): Promise<McpResponse<DiagnosticSummary>> {
  try {
    const request: ValidationRequest = {
      workflowPath,
      target: options.target,
      tool: 'validate',
      force: options.force,
      pinData: null,
    };
    const summary = await interpret(request, deps);
    return { success: true, data: summary };
  } catch (error) {
    return { success: false, error: mapToMcpError(error) };
  }
}

export async function runTest(
  workflowPath: string,
  options: TestOptions,
  deps: OrchestratorDeps,
): Promise<McpResponse<DiagnosticSummary>> {
  try {
    const request: ValidationRequest = {
      workflowPath,
      target: options.target,
      tool: 'test',
      force: options.force,
      pinData: options.pinData,
    };
    const summary = await interpret(request, deps);
    return { success: true, data: summary };
  } catch (error) {
    return { success: false, error: mapToMcpError(error) };
  }
}

export async function runTrust(
  workflowPath: string,
  deps: OrchestratorDeps,
): Promise<McpResponse<TrustStatusReport>> {
  try {
    const report = await buildTrustStatusReport(workflowPath, deps);
    return { success: true, data: report };
  } catch (error) {
    return { success: false, error: mapToMcpError(error) };
  }
}

export async function runExplain(
  workflowPath: string,
  options: ExplainOptions,
  deps: OrchestratorDeps,
): Promise<McpResponse<GuardrailExplanation>> {
  try {
    const explanation = await buildGuardrailExplanation(
      workflowPath,
      options.target,
      options.tool,
      deps,
    );
    return { success: true, data: explanation };
  } catch (error) {
    return { success: false, error: mapToMcpError(error) };
  }
}
