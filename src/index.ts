/**
 * n8n-vet: guardrailed validation control for agent-built n8n workflows.
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

// Trust subsystem — public functions
export {
  computeContentHash,
  computeConnectionsHash,
  computeWorkflowHash,
} from './trust/hash.js';
export { computeChangeSet } from './trust/change.js';
export {
  recordValidation,
  invalidateTrust,
  isTrusted,
  getTrustedBoundaries,
  getUntrustedNodes,
  getRerunAssessment,
} from './trust/trust.js';
export { loadTrustState, persistTrustState } from './trust/persistence.js';
export { TrustPersistenceError, ContentHashError } from './trust/errors.js';

// Type re-exports — grouped by domain
export type { NodeIdentity } from './types/identity.js';

export type { WorkflowGraph, GraphNode, Edge, NodeClassification } from './types/graph.js';

export type { SliceDefinition, PathDefinition, PathEdge } from './types/slice.js';

export type { AgentTarget, ValidationTarget, ValidationEvidence } from './types/target.js';

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

export type { RerunAssessment } from './trust/types.js';

export type {
  NodeSchemaProvider,
  NodeSchema,
  SchemaProperty,
} from './static-analysis/schemas.js';

// Diagnostics — public API
export { synthesize, SynthesisError } from './diagnostics/synthesize.js';

// Diagnostics types
export type { SynthesisInput } from './diagnostics/types.js';

// Guardrails — public API
export { evaluate } from './guardrails/evaluate.js';

// Guardrails types
export type { EvaluationInput } from './guardrails/types.js';

// Execution — public API
export { executeSmoke } from './execution/mcp-client.js';
export { constructPinData } from './execution/pin-data.js';
export { detectCapabilities } from './execution/capabilities.js';

// Execution types
export type {
  PinData,
  PinDataResult,
  ExecutionResult,
  ExecutionData,
  DetectedCapabilities,
} from './execution/types.js';

// Orchestrator — public API
export { interpret } from './orchestrator/interpret.js';

// Orchestrator types
export type {
  ValidationRequest,
  InterpretedRequest,
  OrchestratorDeps,
  WorkflowSnapshot,
} from './orchestrator/types.js';
export { ValidationRequestSchema, deriveWorkflowId } from './orchestrator/types.js';

// MCP surface — public API
export { createServer } from './mcp/server.js';
export { buildDeps } from './deps.js';
export { buildTrustStatusReport, buildGuardrailExplanation } from './surface.js';

// MCP surface types
export type { McpError, McpErrorType, McpResponse } from './errors.js';
export { mapToMcpError } from './errors.js';
export type {
  TrustStatusReport,
  TrustedNodeInfo,
  UntrustedNodeInfo,
  GuardrailExplanation,
  TestPreconditions,
  TargetResolutionInfo,
} from './types/surface.js';
