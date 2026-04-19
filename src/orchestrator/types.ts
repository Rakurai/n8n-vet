/**
 * Orchestrator types — request, interpreted state, dependency injection, and
 * snapshot serialization for the 10-step validation pipeline.
 */

import { resolve } from 'node:path';
import { z } from 'zod';
import type { WorkflowAST } from '@n8n-as-code/transformer';
import type { SynthesisInput } from '../diagnostics/types.js';
import type {
  PinData,
  PinDataItem,
  PinDataResult,
  ExecutionResult,
  DetectedCapabilities,
  ResolvedCredentials,
} from '../execution/types.js';
import type { McpToolCaller } from '../execution/mcp-client.js';
import type { EvaluationInput } from '../guardrails/types.js';
import type { ExpressionReference, StaticFinding } from '../static-analysis/types.js';
import type { NodeSchemaProvider } from '../static-analysis/schemas.js';
import type { DiagnosticSummary, ResolvedTarget } from '../types/diagnostic.js';
import type { WorkflowGraph } from '../types/graph.js';
import type { GuardrailDecision } from '../types/guardrail.js';
import type { NodeIdentity } from '../types/identity.js';
import type { AgentTarget, ValidationLayer } from '../types/target.js';
import type { NodeChangeSet, TrustState } from '../types/trust.js';

// ── Zod schema for edge validation ────────────────────────────────

const AgentTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('nodes'), nodes: z.array(z.string().min(1)) }),
  z.object({ kind: z.literal('changed') }),
  z.object({ kind: z.literal('workflow') }),
]);

const ValidationLayerSchema = z.enum(['static', 'execution', 'both']);

export const ValidationRequestSchema = z.object({
  workflowPath: z.string().min(1),
  target: AgentTargetSchema,
  layer: ValidationLayerSchema,
  force: z.boolean(),
  pinData: z.record(z.array(z.object({ json: z.record(z.unknown()) }).passthrough())).nullable(),
  destinationNode: z.string().min(1).nullable(),
  destinationMode: z.enum(['inclusive', 'exclusive']),
});

// ── ValidationRequest ─────────────────────────────────────────────

/** The agent's validation request — validated at the orchestrator boundary via Zod. */
export interface ValidationRequest {
  workflowPath: string;
  target: AgentTarget;
  layer: ValidationLayer;
  force: boolean;
  pinData: PinData | null;
  destinationNode: string | null;
  destinationMode: 'inclusive' | 'exclusive';
}

// ── InterpretedRequest ────────────────────────────────────────────

/** Internal orchestrator state after resolution and guardrail consultation. */
export interface InterpretedRequest {
  resolvedTarget: ResolvedTarget;
  guardrailDecision: GuardrailDecision;
  effectiveLayer: ValidationLayer;
  graph: WorkflowGraph;
  changeSet: NodeChangeSet | null;
  trustState: TrustState;
}

// ── OrchestratorDeps ──────────────────────────────────────────────

/** Dependency injection object — all subsystem calls are injected for testability. */
export interface OrchestratorDeps {
  // Workflow parsing
  parseWorkflowFile: (path: string) => Promise<WorkflowAST>;
  buildGraph: (ast: WorkflowAST) => WorkflowGraph;

  // Trust
  loadTrustState: (workflowId: string) => TrustState;
  persistTrustState: (state: TrustState, workflowHash: string) => void;
  computeChangeSet: (previous: WorkflowGraph, current: WorkflowGraph) => NodeChangeSet;
  invalidateTrust: (state: TrustState, changeSet: NodeChangeSet, graph: WorkflowGraph) => TrustState;
  recordValidation: (
    state: TrustState,
    nodes: NodeIdentity[],
    graph: WorkflowGraph,
    layer: ValidationLayer,
    runId: string,
    fixtureHash: string | null,
  ) => TrustState;

  // Guardrails
  evaluate: (input: EvaluationInput) => GuardrailDecision;

  // Static analysis
  traceExpressions: (graph: WorkflowGraph, nodes: NodeIdentity[]) => ExpressionReference[];
  detectDataLoss: (
    graph: WorkflowGraph,
    refs: ExpressionReference[],
    nodes: NodeIdentity[],
    provider?: NodeSchemaProvider,
  ) => StaticFinding[];
  checkSchemas: (
    graph: WorkflowGraph,
    refs: ExpressionReference[],
    provider?: NodeSchemaProvider,
  ) => StaticFinding[];
  validateNodeParams: (
    graph: WorkflowGraph,
    nodes: NodeIdentity[],
    provider?: NodeSchemaProvider,
  ) => StaticFinding[];

  // Execution
  executeBounded: (
    workflowId: string,
    destinationNodeName: string,
    pinData: PinData,
    credentials: ResolvedCredentials,
    mode?: 'inclusive' | 'exclusive',
  ) => Promise<ExecutionResult>;
  executeSmoke: (
    workflowId: string,
    pinData: PinData,
    callTool: McpToolCaller,
    triggerNodeName?: string,
  ) => Promise<ExecutionResult>;
  getExecutionData: (
    executionId: string,
    credentials: ResolvedCredentials,
  ) => Promise<unknown>;
  constructPinData: (
    graph: WorkflowGraph,
    trustedBoundaries: NodeIdentity[],
    fixtures?: Record<string, PinDataItem[]>,
    priorArtifacts?: Record<string, PinDataItem[]>,
  ) => PinDataResult;

  // Diagnostics
  synthesize: (input: SynthesisInput) => DiagnosticSummary;

  // Snapshots
  loadSnapshot: (workflowId: string) => WorkflowGraph | null;
  saveSnapshot: (workflowId: string, graph: WorkflowGraph) => void;

  // Capability detection
  detectCapabilities: (options?: {
    explicit?: { host?: string; apiKey?: string };
    workflowId?: string;
    callTool?: McpToolCaller;
  }) => Promise<DetectedCapabilities>;
}

// ── WorkflowSnapshot ──────────────────────────────────────────────

/** Serialized graph node for snapshot storage. */
export interface SerializedGraphNode {
  name: string;
  displayName: string;
  type: string;
  typeVersion: number;
  parameters: Record<string, unknown>;
  credentials: Record<string, unknown> | null;
  disabled: boolean;
  classification: string;
}

/** Serialized edge for snapshot storage. */
export interface SerializedEdge {
  from: string;
  fromOutput: number;
  isError: boolean;
  to: string;
  toInput: number;
}

/** Lightweight serialized form stored in `.n8n-vet/snapshots/{workflowId}.json`. */
export interface WorkflowSnapshot {
  workflowId: string;
  savedAt: string;
  nodes: SerializedGraphNode[];
  forward: Record<string, SerializedEdge[]>;
  backward: Record<string, SerializedEdge[]>;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Derive a stable workflow ID from a file path (absolute, normalized). */
export function deriveWorkflowId(workflowPath: string): string {
  return resolve(workflowPath);
}
