/**
 * Per-node result extraction from raw n8n execution data.
 *
 * Transforms the raw IRunExecutionData shape into ExecutionData —
 * per-node status, timing, typed errors, source lineage, and hints.
 * Raw output data (INodeExecutionData[]) is intentionally excluded.
 */

import { nodeIdentity } from '../types/identity.js';
import type {
  ExecutionData,
  ExecutionErrorData,
  ExecutionHint,
  ExecutionStatus,
  NodeExecutionResult,
  SourceInfo,
} from './types.js';

// ---------------------------------------------------------------------------
// Raw data shape (from Zod-validated REST/MCP responses)
// ---------------------------------------------------------------------------

/** Shape of a single node execution run from n8n's runData. */
interface RawNodeRun {
  startTime: number;
  executionTime: number;
  executionStatus?: string;
  error?: {
    message: string;
    description?: string | null;
    name?: string;
    node?: { name: string };
    httpCode?: string;
    context?: Record<string, unknown>;
  } | null;
  source?: Array<{
    previousNode: string;
    previousNodeOutput?: number;
    previousNodeRun?: number;
  } | null> | null;
  hints?: Array<{
    message: string;
    level?: string;
  }>;
  data?: Record<string, unknown>;
}

/** Shape of the resultData from a completed execution. */
export interface RawResultData {
  runData: Record<string, RawNodeRun[]>;
  error?: {
    message: string;
    description?: string | null;
    name?: string;
    node?: { name: string };
    httpCode?: string;
    context?: Record<string, unknown>;
  } | null;
  lastNodeExecuted?: string | null;
}

// ---------------------------------------------------------------------------
// Extraction (T010)
// ---------------------------------------------------------------------------

/**
 * Extract per-node execution results from raw result data.
 *
 * Filters to only the requested nodeNames if provided.
 * Does NOT extract raw output data — only status, timing, errors, lineage, hints.
 */
export function extractExecutionData(
  resultData: RawResultData,
  status: ExecutionStatus,
  nodeNames?: string[],
): ExecutionData {
  const nodeResults = new Map<ReturnType<typeof nodeIdentity>, NodeExecutionResult[]>();
  const nameFilter = nodeNames ? new Set(nodeNames) : null;

  for (const [nodeName, runs] of Object.entries(resultData.runData)) {
    if (nameFilter && !nameFilter.has(nodeName)) continue;

    const results: NodeExecutionResult[] = runs.map((run, index) =>
      extractNodeRun(run, index),
    );

    nodeResults.set(nodeIdentity(nodeName), results);
  }

  return {
    nodeResults,
    lastNodeExecuted: resultData.lastNodeExecuted ?? null,
    error: resultData.error ? classifyError(resultData.error) : null,
    status,
  };
}

// ---------------------------------------------------------------------------
// Per-run extraction
// ---------------------------------------------------------------------------

function extractNodeRun(run: RawNodeRun, index: number): NodeExecutionResult {
  return {
    executionIndex: index,
    status: run.executionStatus === 'error' || run.error ? 'error' : 'success',
    executionTimeMs: run.executionTime,
    error: run.error ? classifyError(run.error) : null,
    source: extractSource(run.source),
    hints: extractHints(run.hints),
  };
}

function extractSource(
  source: RawNodeRun['source'],
): SourceInfo | null {
  if (!source || source.length === 0) return null;

  // Take the first non-null source entry
  const entry = source.find((s) => s !== null);
  if (!entry) return null;

  return {
    previousNode: entry.previousNode,
    previousNodeOutput: entry.previousNodeOutput ?? 0,
    previousNodeRun: entry.previousNodeRun ?? 0,
  };
}

function extractHints(
  hints: RawNodeRun['hints'],
): ExecutionHint[] {
  if (!hints) return [];
  return hints.map((h) => ({
    message: h.message,
    severity: h.level ?? 'info',
  }));
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Classify a raw n8n error into a typed ExecutionErrorData.
 *
 * Discriminates on available context fields:
 * - httpCode present → contextKind: 'api'
 * - name contains 'Cancel' or context has cancellation reason → contextKind: 'cancellation'
 * - name contains 'Expression' → contextKind: 'expression'
 * - otherwise → contextKind: 'other'
 */
export function classifyError(raw: NonNullable<RawNodeRun['error']>): ExecutionErrorData {
  const base = {
    type: raw.name ?? 'UnknownError',
    message: raw.message,
    description: raw.description ?? null,
    node: raw.node?.name ?? null,
  };

  // API error — has httpCode
  if (raw.httpCode) {
    const context: { httpCode: string; errorCode?: string } = { httpCode: raw.httpCode };
    const errorCode = raw.context?.['errorCode'];
    if (typeof errorCode === 'string') {
      context.errorCode = errorCode;
    }
    return { ...base, contextKind: 'api', context };
  }

  // Cancellation error
  if (raw.name?.includes('Cancel') || raw.context?.['reason'] === 'manual' || raw.context?.['reason'] === 'timeout' || raw.context?.['reason'] === 'shutdown') {
    const reason = (raw.context?.['reason'] as 'manual' | 'timeout' | 'shutdown') ?? 'manual';
    return {
      ...base,
      contextKind: 'cancellation',
      context: { reason },
    };
  }

  // Expression error
  if (raw.name?.includes('Expression')) {
    const context: { expressionType?: string; parameter?: string } = {};
    const exprType = raw.context?.['expressionType'];
    if (typeof exprType === 'string') {
      context.expressionType = exprType;
    }
    const param = raw.context?.['parameter'];
    if (typeof param === 'string') {
      context.parameter = param;
    }
    return { ...base, contextKind: 'expression', context };
  }

  // Generic/other error
  const context: { runIndex?: number; itemIndex?: number } = {};
  const runIndex = raw.context?.['runIndex'];
  if (typeof runIndex === 'number') {
    context.runIndex = runIndex;
  }
  const itemIndex = raw.context?.['itemIndex'];
  if (typeof itemIndex === 'number') {
    context.itemIndex = itemIndex;
  }
  return { ...base, contextKind: 'other', context };
}
