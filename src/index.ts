/**
 * n8n-check: guardrailed validation control for agent-built n8n workflows.
 *
 * Package entry point. Re-exports the public API surface.
 * This is the only barrel file in the project (per CODING.md).
 */

// Runtime exports
export { nodeIdentity, NodeIdentityError } from './types/identity.js';

// Static analysis — public functions (FR-024 cross-subsystem contract)
export { buildGraph, parseWorkflowFile } from './static-analysis/graph.js';
export { traceExpressions } from './static-analysis/expressions.js';
export { detectDataLoss } from './static-analysis/data-loss.js';
export { checkSchemas } from './static-analysis/schemas.js';
export { validateNodeParams } from './static-analysis/params.js';
export { MalformedWorkflowError, ConfigurationError } from './static-analysis/errors.js';
export { classifyNode } from './static-analysis/classify.js';

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

// Static analysis types
export type {
  StaticFinding,
  ExpressionReference,
  StaticAnalysisResult,
} from './static-analysis/types.js';

export type {
  NodeSchemaProvider,
  NodeSchema,
  SchemaProperty,
} from './static-analysis/schemas.js';
