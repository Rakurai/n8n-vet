/**
 * Validation target specifications and evidence layer selection — what to validate and how.
 */

import type { NodeIdentity } from './identity.js';
import type { PathDefinition, SliceDefinition } from './slice.js';

/**
 * Agent-facing target specification — what MCP/CLI tools accept as input.
 * Discriminated union on `kind`.
 */
export type AgentTarget =
  | { kind: 'nodes'; nodes: NodeIdentity[] }
  | { kind: 'changed' }
  | { kind: 'workflow' };

/**
 * Internal target representation — extends AgentTarget with computed variants
 * resolved during validation planning.
 * Discriminated union on `kind`.
 *
 * Agent variants are repeated verbatim (not via `AgentTarget |`) so that
 * TypeScript can narrow exhaustively across the full union.
 */
export type ValidationTarget =
  | { kind: 'nodes'; nodes: NodeIdentity[] }
  | { kind: 'changed' }
  | { kind: 'workflow' }
  | { kind: 'slice'; slice: SliceDefinition }
  | { kind: 'path'; path: PathDefinition };

/**
 * Which evidence type backs a validation or test result.
 *
 * - `static`    — structural analysis only; no workflow execution
 * - `execution` — live execution against n8n
 */
export type ValidationEvidence = 'static' | 'execution';
