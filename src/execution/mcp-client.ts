/**
 * MCP client for n8n execution operations.
 *
 * Provides three MCP tool invocations:
 *   - test_workflow: Whole-workflow smoke test (synchronous, blocks up to 5 min)
 *   - get_execution: Status polling and filtered data retrieval
 *   - prepare_test_pin_data: Schema coverage for tier 3 pin data sourcing
 *
 * Zod schemas validate all MCP response boundaries per constitution
 * principle II (Contract-Driven Boundaries).
 */

import { z } from 'zod';
import type { NodeIdentity } from '../types/identity.js';
import type { ExecutionData, ExecutionResult, ExecutionStatus, PinData } from './types.js';
import { isTerminalStatus } from './types.js';
import { ExecutionInfrastructureError } from './errors.js';
import { withExecutionLock } from './lock.js';
import { extractExecutionData } from './results.js';
import type { RawResultData } from './results.js';
import type { PollingStrategy, PollStatusResult } from './poll.js';

// ---------------------------------------------------------------------------
// MCP tool caller interface
// ---------------------------------------------------------------------------

/**
 * Abstraction for invoking an MCP tool.
 * The actual implementation depends on the MCP SDK client instance.
 */
export type McpToolCaller = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Zod schemas — MCP response boundaries (T018)
// ---------------------------------------------------------------------------

/** Schema for test_workflow MCP tool response. */
export const TestWorkflowResponseSchema = z.object({
  executionId: z.string().nullable(),
  status: z.string(),
  error: z.string().optional(),
});

/** Schema for get_execution MCP tool response. */
export const GetExecutionResponseSchema = z.object({
  execution: z.object({
    id: z.string(),
    workflowId: z.string(),
    mode: z.string(),
    status: z.string(),
    startedAt: z.string(),
    stoppedAt: z.string().nullable(),
    data: z.object({
      resultData: z.object({
        runData: z.record(z.array(z.object({
          startTime: z.number(),
          executionTime: z.number(),
          executionStatus: z.string().optional(),
          error: z.record(z.unknown()).optional().nullable(),
          source: z.array(z.record(z.unknown()).nullable()).optional().nullable(),
          hints: z.array(z.object({
            message: z.string(),
            level: z.string().optional(),
          })).optional(),
        }))),
        error: z.record(z.unknown()).optional().nullable(),
        lastNodeExecuted: z.string().optional().nullable(),
      }),
    }).optional(),
  }).nullable(),
  error: z.string().optional(),
});

/** Schema for prepare_test_pin_data MCP tool response. */
export const PreparePinDataResponseSchema = z.object({
  nodeSchemasToGenerate: z.record(z.record(z.unknown())),
  nodesWithoutSchema: z.array(z.string()),
  nodesSkipped: z.array(z.string()),
  coverage: z.object({
    withSchemaFromExecution: z.number(),
    withSchemaFromDefinition: z.number(),
    withoutSchema: z.number(),
    skipped: z.number(),
    total: z.number(),
  }),
});

// ---------------------------------------------------------------------------
// Smoke test execution (T017)
// ---------------------------------------------------------------------------

/**
 * Execute whole workflow via MCP test_workflow tool.
 *
 * Synchronous — blocks until execution completes or 5-minute timeout.
 * Returns ExecutionResult with partial: false.
 */
export async function executeSmoke(
  workflowId: string,
  pinData: PinData,
  callTool: McpToolCaller,
  triggerNodeName?: string,
): Promise<ExecutionResult> {
  return withExecutionLock(async () => {
    const args: Record<string, unknown> = { workflowId, pinData };
    if (triggerNodeName !== undefined) {
      args['triggerNodeName'] = triggerNodeName;
    }

    let raw: unknown;
    try {
      raw = await callTool('test_workflow', args);
    } catch (err) {
      throw new ExecutionInfrastructureError(
        'mcp-unavailable',
        `MCP test_workflow unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = TestWorkflowResponseSchema.parse(raw);

    return {
      executionId: parsed.executionId ?? '',
      status: parsed.status as ExecutionStatus,
      error: parsed.error
        ? {
            type: 'McpTestError',
            message: parsed.error,
            description: null,
            node: null,
            contextKind: 'other' as const,
            context: {},
          }
        : null,
      partial: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Execution retrieval (T018)
// ---------------------------------------------------------------------------

/**
 * Get execution via MCP get_execution tool.
 *
 * Supports status-only mode (includeData: false) and full data mode
 * (includeData: true with optional nodeNames filter and truncation).
 */
export async function getExecution(
  workflowId: string,
  executionId: string,
  callTool: McpToolCaller,
  options?: {
    includeData?: boolean;
    nodeNames?: string[];
    truncateData?: number;
  },
): Promise<{ status: ExecutionStatus; data?: ExecutionData }> {
  const args: Record<string, unknown> = { workflowId, executionId };
  if (options?.includeData) {
    args['includeData'] = true;
  }
  if (options?.nodeNames) {
    args['nodeNames'] = options.nodeNames;
  }
  if (options?.truncateData !== undefined) {
    args['truncateData'] = options.truncateData;
  }

  let raw: unknown;
  try {
    raw = await callTool('get_execution', args);
  } catch (err) {
    throw new ExecutionInfrastructureError(
      'mcp-unavailable',
      `MCP get_execution unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsed = GetExecutionResponseSchema.parse(raw);

  if (!parsed.execution) {
    throw new ExecutionInfrastructureError(
      'execution-not-found',
      `Execution ${executionId} not found via MCP`,
    );
  }

  const status = parsed.execution.status as ExecutionStatus;

  if (!options?.includeData || !parsed.execution.data) {
    return { status };
  }

  const executionData = extractExecutionData(
    parsed.execution.data.resultData as RawResultData,
    status,
    options.nodeNames,
  );

  return { status, data: executionData };
}

// ---------------------------------------------------------------------------
// MCP polling strategy
// ---------------------------------------------------------------------------

/**
 * Create a PollingStrategy backed by MCP get_execution.
 */
export function createMcpPollingStrategy(
  workflowId: string,
  callTool: McpToolCaller,
): PollingStrategy {
  return {
    async checkStatus(executionId: string): Promise<PollStatusResult> {
      const result = await getExecution(workflowId, executionId, callTool);
      return {
        status: result.status,
        finished: isTerminalStatus(result.status),
      };
    },

    async retrieveData(
      executionId: string,
      nodeNames: NodeIdentity[],
      truncateData: number,
    ): Promise<ExecutionData> {
      const result = await getExecution(workflowId, executionId, callTool, {
        includeData: true,
        nodeNames: nodeNames as string[],
        truncateData,
      });

      if (!result.data) {
        return {
          nodeResults: new Map(),
          lastNodeExecuted: null,
          error: null,
          status: result.status,
        };
      }

      return result.data;
    },
  };
}

// ---------------------------------------------------------------------------
// Prepare test pin data (T019)
// ---------------------------------------------------------------------------

/** Result from prepare_test_pin_data MCP tool. */
export interface PreparePinDataResult {
  nodeSchemasToGenerate: Record<string, Record<string, unknown>>;
  nodesWithoutSchema: string[];
  nodesSkipped: string[];
  coverage: {
    withSchemaFromExecution: number;
    withSchemaFromDefinition: number;
    withoutSchema: number;
    skipped: number;
    total: number;
  };
}

/**
 * Invoke MCP prepare_test_pin_data to get schema coverage for tier 3 sourcing.
 *
 * Returns schemas (not actual pin data) — the agent uses these to understand
 * expected data shapes. Nodes in nodesWithoutSchema fall through to tier 4 (error).
 */
export async function preparePinData(
  workflowId: string,
  callTool: McpToolCaller,
): Promise<PreparePinDataResult> {
  let raw: unknown;
  try {
    raw = await callTool('prepare_test_pin_data', { workflowId });
  } catch (err) {
    throw new ExecutionInfrastructureError(
      'mcp-unavailable',
      `MCP prepare_test_pin_data unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return PreparePinDataResponseSchema.parse(raw);
}
