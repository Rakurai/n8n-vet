/**
 * Shared test fixtures for the guardrail evaluation subsystem.
 *
 * Provides factory functions that build WorkflowGraph, TrustState,
 * NodeChangeSet, currentHashes, DiagnosticSummary, and EvaluationInput
 * instances for use in guardrail tests.
 */

import type { EvaluationInput } from '../../src/guardrails/types.js';
import type { ExpressionReference } from '../../src/static-analysis/types.js';
import type {
  DiagnosticError,
  DiagnosticSummary,
  ErrorClassification,
  PathNode,
} from '../../src/types/diagnostic.js';
import type { Edge, GraphNode, NodeClassification, WorkflowGraph } from '../../src/types/graph.js';
import type { NodeIdentity } from '../../src/types/identity.js';
import { nodeIdentity } from '../../src/types/identity.js';
import type { ValidationTarget } from '../../src/types/target.js';
import type {
  ChangeKind,
  NodeChangeSet,
  NodeTrustRecord,
  TrustState,
} from '../../src/types/trust.js';

// ── Node definition helpers ──────────────────────────────────────────

interface NodeDef {
  name: string;
  displayName: string;
  type: string;
  typeVersion?: number;
  classification?: NodeClassification;
  disabled?: boolean;
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown> | null;
}

function makeGraphNode(def: NodeDef): GraphNode {
  return {
    name: def.name as NodeIdentity,
    displayName: def.displayName,
    type: def.type,
    typeVersion: def.typeVersion ?? 1,
    parameters: def.parameters ?? {},
    credentials: def.credentials ?? null,
    disabled: def.disabled ?? false,
    classification: def.classification ?? 'shape-preserving',
  };
}

// ── Graph builders ───────────────────────────────────────────────────

interface GraphSpec {
  nodes: NodeDef[];
  edges: Array<{
    from: string;
    to: string;
    fromOutput?: number;
    toInput?: number;
    isError?: boolean;
  }>;
}

function buildGraph(spec: GraphSpec): WorkflowGraph {
  const nodes = new Map<NodeIdentity, GraphNode>();
  const forward = new Map<NodeIdentity, Edge[]>();
  const backward = new Map<NodeIdentity, Edge[]>();
  const displayNameIndex = new Map<string, NodeIdentity>();

  for (const def of spec.nodes) {
    const id = def.name as NodeIdentity;
    nodes.set(id, makeGraphNode(def));
    forward.set(id, []);
    backward.set(id, []);
    displayNameIndex.set(def.displayName, id);
  }

  for (const e of spec.edges) {
    const edge: Edge = {
      from: e.from as NodeIdentity,
      fromOutput: e.fromOutput ?? 0,
      isError: e.isError ?? false,
      to: e.to as NodeIdentity,
      toInput: e.toInput ?? 0,
    };
    (forward.get(e.from as NodeIdentity) as Edge[]).push(edge);
    (backward.get(e.to as NodeIdentity) as Edge[]).push(edge);
  }

  // Provide a minimal AST stub — tests don't need full AST
  const ast = { workflows: [] } as unknown as WorkflowGraph['ast'];

  return { nodes, forward, backward, displayNameIndex, ast };
}

/**
 * Linear 5-node graph: trigger → http → set → code → output
 * All shape-preserving except set (shape-augmenting).
 */
export function linearGraph(): WorkflowGraph {
  return buildGraph({
    nodes: [
      {
        name: 'trigger',
        displayName: 'Schedule Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        classification: 'shape-preserving',
      },
      {
        name: 'http',
        displayName: 'HTTP Request',
        type: 'n8n-nodes-base.httpRequest',
        classification: 'shape-replacing',
      },
      {
        name: 'set',
        displayName: 'Set Fields',
        type: 'n8n-nodes-base.set',
        classification: 'shape-augmenting',
      },
      {
        name: 'code',
        displayName: 'Code',
        type: 'n8n-nodes-base.code',
        classification: 'shape-opaque',
      },
      {
        name: 'output',
        displayName: 'Output',
        type: 'n8n-nodes-base.set',
        classification: 'shape-preserving',
      },
    ],
    edges: [
      { from: 'trigger', to: 'http' },
      { from: 'http', to: 'set' },
      { from: 'set', to: 'code' },
      { from: 'code', to: 'output' },
    ],
  });
}

/**
 * Branching 10-node graph with IF node, merge, and sub-workflow:
 *
 *   trigger → validate → if
 *                         ├─(true)→ transform → enrich → merge
 *                         └─(false)→ fallback → subWorkflow → merge
 *   merge → output
 *
 * Provides diverse classifications for redirect/narrowing tests.
 */
export function branchingGraph(): WorkflowGraph {
  return buildGraph({
    nodes: [
      {
        name: 'trigger',
        displayName: 'Trigger',
        type: 'n8n-nodes-base.manualTrigger',
        classification: 'shape-preserving',
      },
      {
        name: 'validate',
        displayName: 'Validate',
        type: 'n8n-nodes-base.set',
        classification: 'shape-augmenting',
      },
      {
        name: 'if',
        displayName: 'Check',
        type: 'n8n-nodes-base.if',
        classification: 'shape-preserving',
      },
      {
        name: 'transform',
        displayName: 'Transform',
        type: 'n8n-nodes-base.set',
        classification: 'shape-augmenting',
      },
      {
        name: 'enrich',
        displayName: 'Enrich',
        type: 'n8n-nodes-base.httpRequest',
        classification: 'shape-replacing',
      },
      {
        name: 'fallback',
        displayName: 'Fallback',
        type: 'n8n-nodes-base.set',
        classification: 'shape-preserving',
      },
      {
        name: 'subWorkflow',
        displayName: 'Sub Workflow',
        type: 'n8n-nodes-base.executeWorkflow',
        classification: 'shape-opaque',
      },
      {
        name: 'merge',
        displayName: 'Merge',
        type: 'n8n-nodes-base.merge',
        classification: 'shape-preserving',
      },
      {
        name: 'format',
        displayName: 'Format',
        type: 'n8n-nodes-base.set',
        classification: 'shape-augmenting',
      },
      {
        name: 'output',
        displayName: 'Output',
        type: 'n8n-nodes-base.set',
        classification: 'shape-preserving',
      },
    ],
    edges: [
      { from: 'trigger', to: 'validate' },
      { from: 'validate', to: 'if' },
      { from: 'if', to: 'transform', fromOutput: 0 },
      { from: 'if', to: 'fallback', fromOutput: 1 },
      { from: 'transform', to: 'enrich' },
      { from: 'enrich', to: 'merge' },
      { from: 'fallback', to: 'subWorkflow' },
      { from: 'subWorkflow', to: 'merge' },
      { from: 'merge', to: 'format' },
      { from: 'format', to: 'output' },
    ],
  });
}

/**
 * Large 15-node graph for narrowing threshold tests.
 * Linear chain of 15 nodes with mixed classifications.
 */
export function largeGraph(): WorkflowGraph {
  const names = [
    'trigger',
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
    'g',
    'h',
    'i',
    'j',
    'k',
    'l',
    'm',
    'output',
  ];
  const nodes: NodeDef[] = names.map((name, idx) => ({
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    type: idx === 0 ? 'n8n-nodes-base.scheduleTrigger' : 'n8n-nodes-base.set',
    classification: 'shape-preserving' as NodeClassification,
  }));
  const edges: GraphSpec['edges'] = [];
  for (let i = 0; i < names.length - 1; i++) {
    edges.push({ from: names[i], to: names[i + 1] });
  }
  return buildGraph({ nodes, edges });
}

// ── Identity helpers ─────────────────────────────────────────────────

/** Create a Set<NodeIdentity> from string names. */
export function nodeSet(...names: string[]): Set<NodeIdentity> {
  return new Set(names.map(nodeIdentity));
}

/** Create a NodeIdentity from a string. */
export function nid(name: string): NodeIdentity {
  return nodeIdentity(name);
}

// ── TrustState builders ──────────────────────────────────────────────

const DEFAULT_HASH = 'hash-000';
const DEFAULT_TIMESTAMP = '2026-04-17T12:00:00.000Z';
const DEFAULT_RUN_ID = 'run-001';

/** Empty trust state — no nodes trusted. */
export function emptyTrustState(workflowId = 'wf-001'): TrustState {
  return {
    workflowId,
    nodes: new Map(),
    connectionsHash: 'conn-hash-001',
  };
}

/** Partial trust — only the specified nodes are trusted. */
export function partialTrustState(
  trustedNodes: string[],
  options?: {
    workflowId?: string;
    hash?: string;
    fixtureHash?: string | null;
    validatedAt?: string;
  },
): TrustState {
  const nodes = new Map<NodeIdentity, NodeTrustRecord>();
  for (const name of trustedNodes) {
    nodes.set(nodeIdentity(name), {
      contentHash: options?.hash ?? DEFAULT_HASH,
      validatedBy: DEFAULT_RUN_ID,
      validatedAt: options?.validatedAt ?? DEFAULT_TIMESTAMP,
      validatedWith: 'static',
      fixtureHash: options?.fixtureHash ?? null,
    });
  }
  return {
    workflowId: options?.workflowId ?? 'wf-001',
    nodes,
    connectionsHash: 'conn-hash-001',
  };
}

/** Full trust — all nodes in the given set are trusted. */
export function fullTrustState(
  allNodes: string[],
  options?: {
    workflowId?: string;
    hash?: string;
    fixtureHash?: string | null;
    validatedAt?: string;
  },
): TrustState {
  return partialTrustState(allNodes, options);
}

// ── NodeChangeSet builders ───────────────────────────────────────────

/** No changes detected. */
export function noChanges(unchangedNodes: string[]): NodeChangeSet {
  return {
    added: [],
    removed: [],
    modified: [],
    unchanged: unchangedNodes.map(nodeIdentity),
  };
}

/** Narrow changes — a small number of modified nodes with specified change kinds. */
export function narrowChanges(
  modifications: Array<{ node: string; changes: ChangeKind[] }>,
  unchangedNodes: string[] = [],
): NodeChangeSet {
  return {
    added: [],
    removed: [],
    modified: modifications.map((m) => ({
      node: nodeIdentity(m.node),
      changes: m.changes,
    })),
    unchanged: unchangedNodes.map(nodeIdentity),
  };
}

/** Broad changes — many nodes changed. */
export function broadChanges(
  modifiedNames: string[],
  changeKind: ChangeKind = 'parameter',
  unchangedNodes: string[] = [],
): NodeChangeSet {
  return {
    added: [],
    removed: [],
    modified: modifiedNames.map((name) => ({
      node: nodeIdentity(name),
      changes: [changeKind],
    })),
    unchanged: unchangedNodes.map(nodeIdentity),
  };
}

/** Change set with added nodes. */
export function addedChanges(addedNames: string[], unchangedNodes: string[] = []): NodeChangeSet {
  return {
    added: addedNames.map(nodeIdentity),
    removed: [],
    modified: [],
    unchanged: unchangedNodes.map(nodeIdentity),
  };
}

// ── Content hash builders ────────────────────────────────────────────

/** Build a currentHashes map where all nodes have the same hash. */
export function uniformHashes(nodeNames: string[], hash = DEFAULT_HASH): Map<NodeIdentity, string> {
  const map = new Map<NodeIdentity, string>();
  for (const name of nodeNames) {
    map.set(nodeIdentity(name), hash);
  }
  return map;
}

/** Build a currentHashes map with per-node hash overrides. */
export function customHashes(
  entries: Array<{ node: string; hash: string }>,
): Map<NodeIdentity, string> {
  const map = new Map<NodeIdentity, string>();
  for (const { node, hash } of entries) {
    map.set(nodeIdentity(node), hash);
  }
  return map;
}

// ── DiagnosticSummary builders ───────────────────────────────────────

/** Null prior summary — no prior run available. */
export function nullSummary(): null {
  return null;
}

/** Passed diagnostic summary. */
export function passedSummary(targetNodes: string[]): DiagnosticSummary {
  return {
    schemaVersion: 1,
    status: 'pass',
    target: {
      description: 'test target',
      nodes: targetNodes.map(nodeIdentity),
      automatic: true,
    },
    evidenceBasis: 'static',
    executedPath: targetNodes.map((name, idx) => ({
      name: nodeIdentity(name),
      executionIndex: idx,
      sourceOutput: idx === 0 ? null : 0,
    })),
    errors: [],
    nodeAnnotations: [],
    guardrailActions: [],
    hints: [],
    capabilities: { staticAnalysis: true, mcpTools: false },
    meta: {
      runId: 'run-prior-001',
      executionId: 'exec-001',
      timestamp: DEFAULT_TIMESTAMP,
      durationMs: 100,
    },
  };
}

/** Failed diagnostic summary with a specific failing path and error classification. */
export function failedSummary(
  failingPath: string[],
  classification: ErrorClassification = 'expression',
): DiagnosticSummary {
  const pathNodes: PathNode[] = failingPath.map((name, idx) => ({
    name: nodeIdentity(name),
    executionIndex: idx,
    sourceOutput: idx === 0 ? null : 0,
  }));

  const lastNode =
    failingPath.length > 0 ? nodeIdentity(failingPath[failingPath.length - 1]) : null;
  const base = {
    type: 'ExpressionError',
    message: 'Test error',
    description: null,
    node: lastNode,
  };

  let error: DiagnosticError;
  switch (classification) {
    case 'expression':
      error = {
        ...base,
        classification,
        context: { expression: '={{ $json.missing }}', parameter: 'value' },
      };
      break;
    case 'external-service':
      error = { ...base, classification, context: { httpCode: '500' } };
      break;
    case 'platform':
      error = { ...base, classification, context: { runIndex: 0 } };
      break;
    case 'wiring':
      error = { ...base, classification, context: { parameter: 'value' } };
      break;
    case 'credentials':
      error = { ...base, classification, context: { credentialType: 'test' } };
      break;
    case 'cancelled':
      error = { ...base, classification, context: { reason: 'test' } };
      break;
    case 'unknown':
      error = { ...base, classification, context: {} };
      break;
  }

  return {
    schemaVersion: 1,
    status: 'fail',
    target: {
      description: 'test target',
      nodes: failingPath.map(nodeIdentity),
      automatic: true,
    },
    evidenceBasis: 'static',
    executedPath: pathNodes,
    errors: [error],
    nodeAnnotations: [],
    guardrailActions: [],
    hints: [],
    capabilities: { staticAnalysis: true, mcpTools: false },
    meta: {
      runId: 'run-prior-002',
      executionId: 'exec-002',
      timestamp: DEFAULT_TIMESTAMP,
      durationMs: 200,
    },
  };
}

// ── ExpressionReference builders ─────────────────────────────────────

/** Build expression references for test scenarios. */
export function makeExpressionRef(
  node: string,
  referencedNode: string | null,
  options?: { parameter?: string; raw?: string; fieldPath?: string | null },
): ExpressionReference {
  return {
    node: nodeIdentity(node),
    parameter: options?.parameter ?? 'value',
    raw: options?.raw ?? `={{ $('${referencedNode ?? 'unknown'}').item.json.data }}`,
    referencedNode: referencedNode ? nodeIdentity(referencedNode) : null,
    fieldPath: options?.fieldPath ?? null,
    resolved: referencedNode !== null,
  };
}

// ── EvaluationInput builder ──────────────────────────────────────────

interface EvaluationInputOverrides {
  target?: ValidationTarget;
  targetNodes?: Set<NodeIdentity>;
  tool?: 'validate' | 'test';
  force?: boolean;
  trustState?: TrustState;
  changeSet?: NodeChangeSet;
  graph?: WorkflowGraph;
  currentHashes?: Map<NodeIdentity, string>;
  priorSummary?: DiagnosticSummary | null;
  expressionRefs?: ExpressionReference[];
  llmValidationRequested?: boolean;
  fixtureHash?: string | null;
}

/**
 * Build a complete EvaluationInput with sensible defaults.
 * Override any field via the overrides parameter.
 */
export function makeEvaluationInput(overrides: EvaluationInputOverrides = {}): EvaluationInput {
  const graph = overrides.graph ?? linearGraph();
  const allNames = [...graph.nodes.keys()];
  const targetNodes = overrides.targetNodes ?? nodeSet(...allNames);

  return {
    target: overrides.target ?? { kind: 'workflow' },
    targetNodes,
    tool: overrides.tool ?? 'validate',
    force: overrides.force ?? false,
    trustState: overrides.trustState ?? emptyTrustState(),
    changeSet: overrides.changeSet ?? noChanges(allNames),
    graph,
    currentHashes: overrides.currentHashes ?? uniformHashes(allNames),
    priorSummary: overrides.priorSummary ?? null,
    expressionRefs: overrides.expressionRefs ?? [],
    llmValidationRequested: overrides.llmValidationRequested ?? false,
    fixtureHash: overrides.fixtureHash ?? null,
  };
}
