/**
 * n8n-check: guardrailed validation control for agent-built n8n workflows.
 *
 * Package entry point. Re-exports the public API surface.
 * This is the only barrel file in the project (per CODING.md).
 */

// Runtime exports
export { nodeIdentity, NodeIdentityError } from './types/identity.js';

// Type re-exports — grouped by domain
export type { NodeIdentity } from './types/identity.js';

export type { WorkflowGraph, GraphNode, Edge, NodeClassification } from './types/graph.js';

export type { SliceDefinition, PathDefinition, PathEdge } from './types/slice.js';

export type { AgentTarget, ValidationTarget, ValidationLayer } from './types/target.js';

export type {
  TrustState,
  NodeTrustRecord,
  NodeChangeSet,
  NodeModification,
  ChangeKind,
} from './types/trust.js';

export type {
  GuardrailDecisionBase,
  GuardrailDecision,
  GuardrailAction,
  GuardrailEvidence,
} from './types/guardrail.js';

export type {
  DiagnosticSummary,
  ResolvedTarget,
  PathNode,
  DiagnosticErrorBase,
  DiagnosticError,
  ErrorClassification,
  NodeAnnotationStatus,
  NodeAnnotation,
  DiagnosticHint,
  AvailableCapabilities,
  ValidationMeta,
} from './types/diagnostic.js';
