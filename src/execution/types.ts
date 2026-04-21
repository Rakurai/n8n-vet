/**
 * Internal types for the execution subsystem — pin data, execution results,
 * per-node extraction, and capability detection.
 *
 * Cross-subsystem types (NodeIdentity, WorkflowGraph, AvailableCapabilities)
 * are imported from src/types/. These types are internal to execution and
 * consumed by the orchestrator (Phase 7) and diagnostics (Phase 6).
 */

import type { NodeIdentity } from '../types/identity.js';

// ---------------------------------------------------------------------------
// Pin Data
// ---------------------------------------------------------------------------

/** Record mapping node names to arrays of pin data items for mocking. */
export type PinData = Record<string, PinDataItem[]>;

/** A single output item in pin data format. */
export interface PinDataItem {
  json: Record<string, unknown>;
  binary?: Record<string, unknown>;
}

/** Which sourcing tier provided pin data for a given node. */
export type PinDataSource = 'agent-fixture' | 'prior-artifact' | 'mcp-schema' | 'execution-history';

/** Traceability map: node name → which tier provided its pin data. */
export type PinDataSourceMap = Record<string, PinDataSource>;

/** Output of pin data construction: the data plus its provenance. */
export interface PinDataResult {
  pinData: PinData;
  sourceMap: PinDataSourceMap;
}

// ---------------------------------------------------------------------------
// Execution Result (from triggering an execution)
// ---------------------------------------------------------------------------

/**
 * Known execution statuses from n8n.
 *
 * Terminal statuses trigger the data retrieval phase of polling.
 * Non-terminal statuses continue the status polling loop.
 */
export type ExecutionStatus =
  | 'success'
  | 'error'
  | 'crashed'
  | 'canceled'
  | 'waiting'
  | 'running'
  | 'new'
  | 'unknown';

/** Outcome of triggering an execution. */
export interface ExecutionResult {
  executionId: string;
  status: ExecutionStatus;
  error: ExecutionErrorData | null;
}

// ---------------------------------------------------------------------------
// Execution Error Data (discriminated on contextKind)
// ---------------------------------------------------------------------------

/** Base fields shared by all execution error variants. */
export interface ExecutionErrorDataBase {
  type: string;
  message: string;
  description: string | null;
  node: string | null;
}

/** Classified execution error with context-specific fields. */
export type ExecutionErrorData = ExecutionErrorDataBase &
  (
    | { contextKind: 'api'; context: { httpCode?: string; errorCode?: string } }
    | { contextKind: 'cancellation'; context: { reason: 'manual' | 'timeout' | 'shutdown' } }
    | { contextKind: 'expression'; context: { expressionType?: string; parameter?: string } }
    | { contextKind: 'other'; context: { runIndex?: number; itemIndex?: number } }
  );

// ---------------------------------------------------------------------------
// Execution Data (per-node results from a completed execution)
// ---------------------------------------------------------------------------

/** Per-node execution results extracted from a completed run. */
export interface ExecutionData {
  nodeResults: Map<NodeIdentity, NodeExecutionResult[]>;
  lastNodeExecuted: string | null;
  error: ExecutionErrorData | null;
  status: ExecutionStatus;
}

/** A single execution attempt for one node. */
export interface NodeExecutionResult {
  executionIndex: number;
  status: 'success' | 'error';
  executionTimeMs: number;
  error: ExecutionErrorData | null;
  source: SourceInfo | null;
  hints: ExecutionHint[];
}

/** Execution lineage — which upstream node produced the input. */
export interface SourceInfo {
  previousNode: string;
  previousNodeOutput: number;
  previousNodeRun: number;
}

/** Non-blocking informational hint from node execution. */
export interface ExecutionHint {
  message: string;
  severity: string;
}

// ---------------------------------------------------------------------------
// Capability Detection
// ---------------------------------------------------------------------------

/** Summary capability level of the execution environment. */
export type CapabilityLevel = 'mcp' | 'static-only';

/** Detected execution environment capabilities. */
export interface DetectedCapabilities {
  level: CapabilityLevel;
  mcpAvailable: boolean;
  mcpTools: string[];
}
