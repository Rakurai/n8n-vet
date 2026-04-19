/**
 * The 10-step orchestration pipeline — receives a ValidationRequest and
 * coordinates all five internal subsystems to produce a DiagnosticSummary.
 *
 * Never throws for foreseeable failures; returns status:'error' diagnostics.
 * Only programming bugs (assertion failures) propagate as thrown errors.
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import stringify from 'json-stable-stringify';
import type { DiagnosticSummary, AvailableCapabilities, ValidationMeta } from '../types/diagnostic.js';
import type { WorkflowGraph } from '../types/graph.js';
import type { NodeIdentity } from '../types/identity.js';
import type { ValidationLayer } from '../types/target.js';
import type { NodeChangeSet } from '../types/trust.js';
import type { GuardrailDecision } from '../types/guardrail.js';
import type { EvaluationInput } from '../guardrails/types.js';
import type { StaticFinding } from '../static-analysis/types.js';
import type { ExecutionData } from '../diagnostics/types.js';
import type { PinData, PinDataItem, ResolvedCredentials } from '../execution/types.js';
import { computeContentHash } from '../trust/hash.js';
import {
  ValidationRequestSchema,
  deriveWorkflowId,
  type ValidationRequest,
  type OrchestratorDeps,
} from './types.js';
import { resolveTarget } from './resolve.js';
import { selectPaths } from './path.js';

/**
 * Interpret a validation request — the single public entry point for the orchestrator.
 *
 * Always returns a DiagnosticSummary. Never throws for user-facing errors.
 */
export async function interpret(
  request: ValidationRequest,
  deps: OrchestratorDeps,
): Promise<DiagnosticSummary> {
  const startTime = Date.now();
  const runId = randomUUID();

  // ── Step 1: Validate and parse ──────────────────────────────────
  const parseResult = ValidationRequestSchema.safeParse(request);
  if (!parseResult.success) {
    return errorDiagnostic(
      `Invalid request: ${parseResult.error.message}`,
      runId,
      startTime,
    );
  }

  let graph: WorkflowGraph;
  try {
    const ast = await deps.parseWorkflowFile(request.workflowPath);
    graph = deps.buildGraph(ast);
  } catch (err) {
    return errorDiagnostic(
      `Failed to parse workflow: ${err instanceof Error ? err.message : String(err)}`,
      runId,
      startTime,
    );
  }

  // ── Step 2: Load trust state ────────────────────────────────────
  const workflowId = deriveWorkflowId(request.workflowPath);
  const trustState = deps.loadTrustState(workflowId);

  // ── Step 3: Compute change set ──────────────────────────────────
  let changeSet: NodeChangeSet | null = null;
  const previousGraph = deps.loadSnapshot(workflowId);
  let activeTrust = trustState;
  if (previousGraph) {
    changeSet = deps.computeChangeSet(previousGraph, graph);
    activeTrust = deps.invalidateTrust(trustState, changeSet, graph);
  }

  // ── Step 4: Resolve target ──────────────────────────────────────
  const resolveResult = resolveTarget(request.target, graph, changeSet, activeTrust);
  if (!resolveResult.ok) {
    return errorDiagnostic(resolveResult.errorMessage, runId, startTime);
  }

  let { target: resolvedTarget, slice } = resolveResult;
  let paths = selectPaths(slice, graph, changeSet, activeTrust);

  // ── Step 5: Consult guardrails ──────────────────────────────────
  const expressionRefs = deps.traceExpressions(
    graph,
    resolvedTarget.nodes,
  );

  const currentHashes = computeCurrentHashes(graph, resolvedTarget.nodes);
  const fixtureHash = request.pinData ? hashPinData(request.pinData) : null;

  const evaluationInput: EvaluationInput = {
    target: { kind: 'slice', slice },
    targetNodes: new Set(resolvedTarget.nodes),
    layer: request.layer,
    force: request.force,
    trustState: activeTrust,
    changeSet: changeSet ?? { added: [], removed: [], modified: [], unchanged: [] },
    graph,
    currentHashes,
    priorSummary: null,
    expressionRefs,
    llmValidationRequested: false,
    fixtureHash,
  };

  const guardrailDecision = deps.evaluate(evaluationInput);
  let effectiveLayer: ValidationLayer = request.layer;
  const guardrailDecisions: GuardrailDecision[] = [guardrailDecision];

  // Route on guardrail action
  if (guardrailDecision.action === 'refuse' && !request.force) {
    return skippedDiagnostic(
      resolvedTarget,
      guardrailDecisions,
      runId,
      startTime,
    );
  }

  if (guardrailDecision.action === 'narrow' && !request.force) {
    const narrowedTarget = guardrailDecision.narrowedTarget;
    if (narrowedTarget.kind === 'slice') {
      slice = narrowedTarget.slice;
      resolvedTarget = {
        description: `Narrowed: ${resolvedTarget.description}`,
        nodes: [...narrowedTarget.slice.nodes],
        automatic: true,
      };
      paths = selectPaths(slice, graph, changeSet, activeTrust);
    }
  }

  if (guardrailDecision.action === 'redirect' && !request.force) {
    effectiveLayer = guardrailDecision.redirectedLayer;
  }

  // ── Step 6: Run validation ──────────────────────────────────────
  const staticFindings: StaticFinding[] = [];
  let executionData: ExecutionData | null = null;
  const capabilities: AvailableCapabilities = {
    staticAnalysis: true,
    restApi: false,
    mcpTools: false,
  };
  let executionId: string | null = null;

  // Step 6a: Static analysis (reuse expressionRefs from step 5 for single-path)
  if (effectiveLayer === 'static' || effectiveLayer === 'both') {
    if (paths.length <= 1) {
      const dataLossFindings = deps.detectDataLoss(graph, expressionRefs, resolvedTarget.nodes);
      const schemaFindings = deps.checkSchemas(graph, expressionRefs);
      const paramFindings = deps.validateNodeParams(graph, resolvedTarget.nodes);
      staticFindings.push(...dataLossFindings, ...schemaFindings, ...paramFindings);
    } else {
      for (const path of paths) {
        const pathNodes = path.nodes;
        const refs = deps.traceExpressions(graph, pathNodes);
        const dataLossFindings = deps.detectDataLoss(graph, refs, pathNodes);
        const schemaFindings = deps.checkSchemas(graph, refs);
        const paramFindings = deps.validateNodeParams(graph, pathNodes);
        staticFindings.push(...dataLossFindings, ...schemaFindings, ...paramFindings);
      }
    }
  }

  // Step 6b: Execution
  if (effectiveLayer === 'execution' || effectiveLayer === 'both') {
    try {
      const detected = await deps.detectCapabilities();
      capabilities.restApi = detected.restAvailable;
      capabilities.mcpTools = detected.mcpAvailable;

      if (detected.restAvailable || detected.mcpAvailable) {
        const trustedBoundaries = resolvedTarget.nodes.filter(
          (n) => activeTrust.nodes.has(n),
        );
        const pinDataResult = deps.constructPinData(
          graph,
          trustedBoundaries,
          request.pinData as Record<string, PinDataItem[]> | undefined,
        );

        let execResult;
        if (request.destinationNode !== null && detected.restAvailable) {
          const creds = resolveExecCredentials();
          execResult = await deps.executeBounded(
            workflowId,
            request.destinationNode,
            pinDataResult.pinData,
            creds,
            request.destinationMode,
          );
        } else if (request.target.kind === 'workflow' && detected.mcpAvailable) {
          // MCP smoke test requires a callTool injected via deps.
          // Without MCP capability wired through deps, fall through to REST.
          if (detected.restAvailable) {
            const destination = findFurthestDownstream(slice);
            if (destination) {
              const creds = resolveExecCredentials();
              execResult = await deps.executeBounded(
                workflowId,
                destination as string,
                pinDataResult.pinData,
                creds,
                'inclusive',
              );
            }
          }
        } else if (detected.restAvailable) {
          const destination = findFurthestDownstream(slice);
          if (destination) {
            const creds = resolveExecCredentials();
            execResult = await deps.executeBounded(
              workflowId,
              destination as string,
              pinDataResult.pinData,
              creds,
              'inclusive',
            );
          }
        }

        if (execResult) {
          executionId = execResult.executionId;
          if (detected.restAvailable && execResult.executionId) {
            const creds = resolveExecCredentials();
            const rawData = await deps.getExecutionData(execResult.executionId, creds);
            executionData = rawData as ExecutionData | null;
          }
        }
      }
    } catch (err) {
      return errorDiagnostic(
        `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
        runId,
        startTime,
      );
    }
  }

  // ── Step 7: Synthesize ──────────────────────────────────────────

  const meta: ValidationMeta = {
    runId,
    executionId,
    partialExecution: request.destinationNode !== null,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };

  const summary = deps.synthesize({
    staticFindings,
    executionData,
    trustState: activeTrust,
    guardrailDecisions,
    resolvedTarget,
    capabilities,
    meta,
  });

  // ── Step 8: Update trust (pass only) ────────────────────────────
  if (summary.status === 'pass') {
    // Only record trust for nodes that were actually validated (present in paths)
    const validatedNodes = collectValidatedNodes(paths, resolvedTarget.nodes);
    const updatedTrust = deps.recordValidation(
      activeTrust,
      validatedNodes,
      graph,
      effectiveLayer,
      runId,
      fixtureHash,
    );
    deps.persistTrustState(updatedTrust, workflowId);
  }

  // ── Step 9: Save snapshot (pass only) ───────────────────────────
  if (summary.status === 'pass') {
    deps.saveSnapshot(workflowId, graph);
  }

  // ── Step 10: Return ─────────────────────────────────────────────
  return summary;
}

// ── helpers ───────────────────────────────────────────────────────

function computeCurrentHashes(
  graph: WorkflowGraph,
  nodes: NodeIdentity[],
): Map<NodeIdentity, string> {
  const hashes = new Map<NodeIdentity, string>();
  for (const nodeId of nodes) {
    const node = graph.nodes.get(nodeId as string);
    if (node) {
      hashes.set(nodeId, computeContentHash(node, graph.ast));
    }
  }
  return hashes;
}

function hashPinData(pinData: PinData): string {
  const serialized = stringify(pinData);
  if (serialized === undefined) return '';
  return createHash('sha256').update(serialized).digest('hex');
}

function resolveExecCredentials(): ResolvedCredentials {
  const host = process.env['N8N_HOST'];
  const apiKey = process.env['N8N_API_KEY'];
  if (!host) throw new Error('N8N_HOST environment variable is required for execution');
  if (!apiKey) throw new Error('N8N_API_KEY environment variable is required for execution');
  return { host, apiKey };
}

/** Find the furthest downstream node in a slice for bounded execution. */
function findFurthestDownstream(
  slice: import('../types/slice.js').SliceDefinition,
): NodeIdentity | null {
  if (slice.exitPoints.length > 0) {
    return slice.exitPoints[0]!;
  }
  return null;
}

/** Collect nodes that were actually covered by selected paths. */
function collectValidatedNodes(
  paths: import('../types/slice.js').PathDefinition[],
  targetNodes: NodeIdentity[],
): NodeIdentity[] {
  if (paths.length === 0) return targetNodes;
  const covered = new Set<string>();
  for (const path of paths) {
    for (const node of path.nodes) {
      covered.add(node as string);
    }
  }
  return targetNodes.filter((n) => covered.has(n as string));
}

function errorDiagnostic(
  message: string,
  runId: string,
  startTime: number,
): DiagnosticSummary {
  return {
    schemaVersion: 1,
    status: 'error',
    target: { description: 'N/A', nodes: [], automatic: false },
    evidenceBasis: 'static',
    executedPath: null,
    errors: [
      {
        type: 'OrchestratorError',
        message,
        description: null,
        node: null,
        classification: 'platform',
        context: {},
      },
    ],
    nodeAnnotations: [],
    guardrailActions: [],
    hints: [],
    capabilities: { staticAnalysis: true, restApi: false, mcpTools: false },
    meta: {
      runId,
      executionId: null,
      partialExecution: false,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
  };
}

function skippedDiagnostic(
  target: { description: string; nodes: NodeIdentity[]; automatic: boolean },
  guardrailDecisions: GuardrailDecision[],
  runId: string,
  startTime: number,
): DiagnosticSummary {
  return {
    schemaVersion: 1,
    status: 'skipped',
    target,
    evidenceBasis: 'static',
    executedPath: null,
    errors: [],
    nodeAnnotations: [],
    guardrailActions: guardrailDecisions,
    hints: [],
    capabilities: { staticAnalysis: true, restApi: false, mcpTools: false },
    meta: {
      runId,
      executionId: null,
      partialExecution: false,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
  };
}
