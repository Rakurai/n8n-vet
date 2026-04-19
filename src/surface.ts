/**
 * Shared surface-layer composition functions for trust_status and explain.
 *
 * Called by both the MCP server and CLI commands. These compose existing
 * subsystem functions to produce the TrustStatusReport and GuardrailExplanation
 * output shapes. No business logic — just subsystem orchestration.
 */

import type { EvaluationInput } from './guardrails/types.js';
import { deriveWorkflowId } from './orchestrator/types.js';
import type { OrchestratorDeps } from './orchestrator/types.js';
import { computeContentHash } from './trust/hash.js';
import type { NodeIdentity } from './types/identity.js';
import type {
  GuardrailExplanation,
  TrustStatusReport,
  TrustedNodeInfo,
  UntrustedNodeInfo,
} from './types/surface.js';
import type { AgentTarget, ValidationLayer } from './types/target.js';

// ── Trust status composition ─────────────────────────────────────

export async function buildTrustStatusReport(
  workflowPath: string,
  deps: OrchestratorDeps,
): Promise<TrustStatusReport> {
  const ast = await deps.parseWorkflowFile(workflowPath);
  const graph = deps.buildGraph(ast);
  const workflowId = deriveWorkflowId(workflowPath);
  const trustState = deps.loadTrustState(workflowId);
  const snapshot = deps.loadSnapshot(workflowId);
  const changeSet = snapshot ? deps.computeChangeSet(snapshot, graph) : null;

  const trustedNodes: TrustedNodeInfo[] = [];
  const untrustedNodes: UntrustedNodeInfo[] = [];

  for (const [name, node] of graph.nodes) {
    const record = trustState.nodes.get(name);

    if (!record) {
      untrustedNodes.push({ name, reason: 'no prior validation' });
      continue;
    }

    const currentHash = computeContentHash(node, graph.ast);
    const contentUnchanged = currentHash === record.contentHash;

    if (contentUnchanged) {
      trustedNodes.push({
        name,
        validatedAt: record.validatedAt,
        validationLayer: record.validationLayer,
        contentUnchanged: true,
      });
    } else {
      untrustedNodes.push({ name, reason: 'content changed since last validation' });
    }
  }

  const changedSinceLastValidation = changeSet
    ? [...changeSet.added, ...changeSet.modified.map((m) => m.node), ...changeSet.removed]
    : [];

  return {
    workflowId,
    totalNodes: graph.nodes.size,
    trustedNodes,
    untrustedNodes,
    changedSinceLastValidation,
  };
}

// ── Explain composition ──────────────────────────────────────────

export async function buildGuardrailExplanation(
  workflowPath: string,
  target: AgentTarget,
  layer: ValidationLayer,
  deps: OrchestratorDeps,
): Promise<GuardrailExplanation> {
  const ast = await deps.parseWorkflowFile(workflowPath);
  const graph = deps.buildGraph(ast);
  const workflowId = deriveWorkflowId(workflowPath);
  const trustState = deps.loadTrustState(workflowId);
  const snapshot = deps.loadSnapshot(workflowId);
  const changeSet = snapshot
    ? deps.computeChangeSet(snapshot, graph)
    : {
        added: [...graph.nodes.keys()] as NodeIdentity[],
        removed: [],
        modified: [],
        unchanged: [],
      };

  let targetNodes: Set<NodeIdentity>;
  let resolvedNodeNames: NodeIdentity[];
  let automatic: boolean;

  if (target.kind === 'nodes') {
    targetNodes = new Set(target.nodes);
    resolvedNodeNames = [...target.nodes];
    automatic = false;
  } else if (target.kind === 'workflow') {
    const allNodes = [...graph.nodes.keys()];
    targetNodes = new Set(allNodes);
    resolvedNodeNames = allNodes;
    automatic = false;
  } else {
    const changedNodes = [...changeSet.added, ...changeSet.modified.map((m) => m.node)];
    targetNodes = new Set(changedNodes);
    resolvedNodeNames = changedNodes;
    automatic = true;
  }

  const currentHashes = new Map<NodeIdentity, string>();
  for (const nodeId of targetNodes) {
    const node = graph.nodes.get(nodeId);
    if (node) {
      currentHashes.set(nodeId, computeContentHash(node, graph.ast));
    }
  }

  const evaluationInput: EvaluationInput = {
    target,
    targetNodes,
    layer,
    force: false,
    trustState,
    changeSet,
    graph,
    currentHashes,
    priorSummary: null,
    expressionRefs: [],
    llmValidationRequested: false,
    fixtureHash: null,
  };

  const guardrailDecision = deps.evaluate(evaluationInput);
  const capabilities = await deps.detectCapabilities();

  return {
    guardrailDecision,
    targetResolution: {
      resolvedNodes: resolvedNodeNames,
      selectedPath: [],
      automatic,
    },
    capabilities: {
      staticAnalysis: true,
      mcpTools: capabilities.mcpAvailable,
    },
  };
}
