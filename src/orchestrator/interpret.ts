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
import type { ExecutionData } from '../diagnostics/types.js';
import { getExecution } from '../execution/mcp-client.js';
import { readCachedPinData, writeCachedPinData } from '../execution/pin-data.js';
import type { PinData, PinDataItem } from '../execution/types.js';
import type { EvaluationInput } from '../guardrails/types.js';
import type { StaticFinding } from '../static-analysis/types.js';
import { computeContentHash, computeWorkflowHash } from '../trust/hash.js';
import type {
  AvailableCapabilities,
  DiagnosticSummary,
  ValidationMeta,
} from '../types/diagnostic.js';
import type { WorkflowGraph } from '../types/graph.js';
import type { GuardrailDecision } from '../types/guardrail.js';
import type { NodeIdentity } from '../types/identity.js';
import type { NodeChangeSet } from '../types/trust.js';
import { selectPaths } from './path.js';
import { resolveTarget } from './resolve.js';
import {
  type OrchestratorDeps,
  type ValidationRequest,
  ValidationRequestSchema,
  deriveWorkflowId,
} from './types.js';

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
    return errorDiagnostic(`Invalid request: ${parseResult.error.message}`, runId, startTime);
  }

  let graph: WorkflowGraph;
  let n8nWorkflowId: string;
  try {
    const ast = await deps.parseWorkflowFile(request.workflowPath);
    graph = deps.buildGraph(ast);
    n8nWorkflowId = graph.ast.metadata.id.trim();
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
  const expressionRefs = deps.traceExpressions(graph, resolvedTarget.nodes);

  const currentHashes = computeCurrentHashes(graph, resolvedTarget.nodes);
  const fixtureHash = request.pinData ? hashPinData(request.pinData) : null;

  const evaluationInput: EvaluationInput = {
    target: { kind: 'slice', slice },
    targetNodes: new Set(resolvedTarget.nodes),
    tool: request.tool,
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
  const guardrailDecisions: GuardrailDecision[] = [guardrailDecision];

  // Route on guardrail action
  if (guardrailDecision.action === 'refuse' && !request.force) {
    return skippedDiagnostic(resolvedTarget, guardrailDecisions, runId, startTime);
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

  // ── Step 6: Run validation ──────────────────────────────────────
  const staticFindings: StaticFinding[] = [];
  let executionData: ExecutionData | null = null;
  let usedPinData: PinData | null = null;
  const capabilities: AvailableCapabilities = {
    staticAnalysis: true,
    mcpTools: false,
  };
  let executionId: string | null = null;

  // Step 6a: Static analysis — validate tool only
  if (request.tool === 'validate') {
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

  // Step 6b: Execution — test tool only (MCP is the sole execution backend)
  const executionErrors: {
    type: string;
    message: string;
    description: null;
    node: null;
    classification: 'platform';
    context: Record<string, never>;
  }[] = [];
  if (request.tool === 'test') {
    if (!n8nWorkflowId) {
      executionErrors.push({
        type: 'OrchestratorError',
        message:
          'Cannot run execution validation: missing metadata.id in workflow file. Run n8nac push first to populate the workflow ID.',
        description: null,
        node: null,
        classification: 'platform',
        context: {},
      });
    } else {
      try {
        const detected = await deps.detectCapabilities(
          request.callTool ? { callTool: request.callTool } : undefined,
        );
        capabilities.mcpTools = detected.mcpAvailable;

        if (detected.mcpAvailable && request.callTool) {
          const trustedBoundaries = resolvedTarget.nodes.filter((n) => activeTrust.nodes.has(n));
          // Load cached pin data as prior artifacts (tier 2)
          const priorArtifacts: Record<string, PinDataItem[]> = {};
          const nodeHashes = computeCurrentHashes(graph, trustedBoundaries);
          for (const boundary of trustedBoundaries) {
            const hash = nodeHashes.get(boundary);
            if (hash) {
              const cached = await readCachedPinData(workflowId, hash);
              if (cached) priorArtifacts[boundary as string] = cached;
            }
          }

          const pinDataResult = deps.constructPinData(
            graph,
            trustedBoundaries,
            request.pinData as Record<string, PinDataItem[]> | undefined,
            Object.keys(priorArtifacts).length > 0 ? priorArtifacts : undefined,
          );
          usedPinData = pinDataResult.pinData;

          const execResult = await deps.executeSmoke(
            n8nWorkflowId,
            pinDataResult.pinData,
            request.callTool,
          );

          executionId = execResult.executionId;

          // Retrieve execution data via MCP
          if (execResult.executionId) {
            const mcpResult = await getExecution(
              n8nWorkflowId,
              execResult.executionId,
              request.callTool,
              { includeData: true },
            );
            if (mcpResult.data) {
              executionData = mcpResult.data;
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
  }

  // ── Step 7: Deduplicate and Synthesize ──────────────────────────

  // Deduplicate static findings by (node, kind, message)
  const seen = new Set<string>();
  const deduplicatedFindings = staticFindings.filter((f) => {
    const key = `${f.node}|${f.kind}|${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const meta: ValidationMeta = {
    runId,
    executionId,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };

  const summary = deps.synthesize({
    staticFindings: deduplicatedFindings,
    executionData,
    trustState: activeTrust,
    guardrailDecisions,
    resolvedTarget,
    capabilities,
    meta,
  });

  // Append execution errors (e.g., missing metadata.id) to the summary
  if (executionErrors.length > 0) {
    summary.errors.push(...executionErrors);
    if (summary.status === 'pass') {
      summary.status = 'error';
    }
  }

  // ── Step 8: Update trust (pass only) ────────────────────────────
  if (summary.status === 'pass') {
    // Only record trust for nodes that were actually validated (present in paths)
    const validatedNodes = collectValidatedNodes(paths, resolvedTarget.nodes);
    const updatedTrust = deps.recordValidation(
      activeTrust,
      validatedNodes,
      graph,
      request.tool === 'test' ? 'execution' : 'static',
      runId,
      fixtureHash,
    );
    deps.persistTrustState(updatedTrust, computeWorkflowHash(graph));
  }

  // ── Step 9: Save snapshot (pass only) ───────────────────────────
  if (summary.status === 'pass') {
    deps.saveSnapshot(workflowId, graph);

    // Cache used pin data for future tier 2 sourcing
    if (usedPinData) {
      const hashes = computeCurrentHashes(graph, [...Object.keys(usedPinData)] as NodeIdentity[]);
      for (const [nodeId, hash] of hashes) {
        const items = usedPinData[nodeId as string];
        if (items) {
          await writeCachedPinData(workflowId, hash, items);
        }
      }
    }
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
    const node = graph.nodes.get(nodeId);
    if (node) {
      hashes.set(nodeId, computeContentHash(node, graph.ast));
    }
  }
  return hashes;
}

function hashPinData(pinData: PinData): string {
  const serialized = stringify(pinData);
  if (serialized === undefined) {
    throw new Error('Pin data contains non-serializable values');
  }
  return createHash('sha256').update(serialized).digest('hex');
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

function errorDiagnostic(message: string, runId: string, startTime: number): DiagnosticSummary {
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
    capabilities: { staticAnalysis: true, mcpTools: false },
    meta: {
      runId,
      executionId: null,
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
    capabilities: { staticAnalysis: true, mcpTools: false },
    meta: {
      runId,
      executionId: null,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
  };
}
