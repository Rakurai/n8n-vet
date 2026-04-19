/**
 * OrchestratorDeps factory — wires all real subsystem implementations into
 * the dependency injection object required by `interpret()`.
 *
 * Used by both the MCP server and CLI entry points. This is the single
 * place where subsystem imports are assembled into a deps object.
 */

import type { OrchestratorDeps } from './orchestrator/types.js';

import { detectDataLoss } from './static-analysis/data-loss.js';
import { traceExpressions } from './static-analysis/expressions.js';
import { buildGraph, parseWorkflowFile } from './static-analysis/graph.js';
import { validateNodeParams } from './static-analysis/params.js';
import { checkSchemas } from './static-analysis/schemas.js';

import { computeChangeSet } from './trust/change.js';
import { loadTrustState, persistTrustState } from './trust/persistence.js';
import { invalidateTrust, recordValidation } from './trust/trust.js';

import { evaluate } from './guardrails/evaluate.js';

import { detectCapabilities } from './execution/capabilities.js';
import { executeSmoke } from './execution/mcp-client.js';
import { constructPinData } from './execution/pin-data.js';
import { executeBounded, getExecutionData } from './execution/rest-client.js';

import { synthesize } from './diagnostics/synthesize.js';

import { loadSnapshot, saveSnapshot } from './orchestrator/snapshots.js';

/** Build the full OrchestratorDeps from real subsystem implementations. */
export function buildDeps(): OrchestratorDeps {
  return {
    parseWorkflowFile,
    buildGraph,
    traceExpressions,
    detectDataLoss,
    checkSchemas,
    validateNodeParams,
    loadTrustState,
    persistTrustState,
    computeChangeSet,
    invalidateTrust,
    recordValidation,
    evaluate,
    executeBounded,
    executeSmoke,
    getExecutionData,
    constructPinData,
    synthesize,
    loadSnapshot,
    saveSnapshot,
    detectCapabilities,
  };
}
