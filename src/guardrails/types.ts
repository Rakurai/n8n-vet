/**
 * Internal types and threshold constants for the guardrail evaluation subsystem.
 *
 * Shared output types (GuardrailDecision, GuardrailEvidence) live in src/types/guardrail.ts.
 * This file defines types used only within the guardrails subsystem implementation.
 */

import type { ExpressionReference } from '../static-analysis/types.js';
import type { DiagnosticSummary, ErrorClassification } from '../types/diagnostic.js';
import type { WorkflowGraph } from '../types/graph.js';
import type { NodeIdentity } from '../types/identity.js';
import type { ValidationTarget } from '../types/target.js';
import type { NodeChangeSet, TrustState } from '../types/trust.js';

// ── Threshold constants ────────────────────────────────────────────

/** Minimum target size for narrowing to apply (target must have MORE than this). */
export const NARROW_MIN_TARGET_NODES = 5;

/** Maximum ratio of changed nodes to target nodes for narrowing (must be LESS than this). */
export const NARROW_MAX_CHANGED_RATIO = 0.2;

/** Target-to-workflow node ratio that triggers a broad-target warning (must be MORE than this). */
export const BROAD_TARGET_WARN_RATIO = 0.7;

/** Change kinds that are statically analyzable — redirect to static is safe when all changes are these kinds. */
export const STRUCTURALLY_ANALYZABLE_KINDS = new Set([
  'parameter',
  'expression',
  'connection',
  'type-version',
  'credential',
] as const);

// ── Input type ─────────────────────────────────────────────────────

/** Bundled input to the guardrail evaluation pipeline. */
export interface EvaluationInput {
  /** The resolved validation target. */
  target: ValidationTarget;
  /** Concrete node set derived from the resolved target. */
  targetNodes: Set<NodeIdentity>;
  /** Which tool is being invoked: 'validate' (static) or 'test' (execution). */
  tool: 'validate' | 'test';
  /** When true, bypass all guardrails. */
  force: boolean;
  /** Current per-workflow trust state. */
  trustState: TrustState;
  /** Diff between previous and current workflow snapshots. */
  changeSet: NodeChangeSet;
  /** Current workflow graph. */
  graph: WorkflowGraph;
  /** Content hashes for all target nodes (keyed by NodeIdentity). */
  currentHashes: Map<NodeIdentity, string>;
  /** Most recent cached diagnostic summary, or null if unavailable. */
  priorSummary: DiagnosticSummary | null;
  /** Expression references for nodes in the graph. */
  expressionRefs: ExpressionReference[];
  /** Whether the agent explicitly requested LLM/agent output validation. */
  llmValidationRequested: boolean;
  /** Current fixture/pin-data hash, or null if no fixtures are in use. */
  fixtureHash: string | null;
}

// ── Internal types ─────────────────────────────────────────────────

/** Prior run context derived from a cached DiagnosticSummary. */
export interface PriorRunContext {
  /** Whether the prior run's status was 'fail'. */
  failed: boolean;
  /** Node identities from the prior run's executed path, or null if not reconstructable. */
  failingPath: NodeIdentity[] | null;
  /** Classification of the first error, or null if no errors. */
  failureClassification: ErrorClassification | null;
}

/** Result of evaluating redirect escalation triggers. */
export interface EscalationAssessment {
  /** Whether any escalation trigger holds. */
  triggered: boolean;
  /** Human-readable descriptions of which triggers fired. */
  reasons: string[];
}
