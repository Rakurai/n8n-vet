/**
 * MCP server — registers four tools (validate, test, trust_status, explain) and
 * exposes them to agents via the MCP protocol.
 *
 * This is a thin delegation layer. Tool handlers parse input, apply defaults,
 * delegate to library core functions, and wrap results in the response envelope.
 */

import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpResponse } from '../errors.js';
import { mapToMcpError } from '../errors.js';
import type { McpToolCaller } from '../execution/mcp-client.js';
import { interpret } from '../orchestrator/interpret.js';
import type { OrchestratorDeps } from '../orchestrator/types.js';
import type { ValidationRequest } from '../orchestrator/types.js';
import { buildGuardrailExplanation, buildTrustStatusReport } from '../surface.js';
import type { NodeIdentity } from '../types/identity.js';
import type { AgentTarget } from '../types/target.js';
import { VERSION } from '../version.js';

// ── Input schemas ────────────────────────────────────────────────

// Flat object schemas — the MCP SDK cannot serialize z.discriminatedUnion
// to JSON Schema (normalizeObjectSchema returns undefined for non-object types,
// producing an empty properties:{} schema on the wire). We use a single object
// and validate nodes-requires-array in the handler via resolveTarget().
// We also cannot use .refine() — the SDK's normalizeObjectSchema doesn't
// unwrap ZodEffects, so .refine() also produces properties:{}.

const ValidateInputSchema = z.object({
  kind: z.enum(['changed', 'nodes', 'workflow']),
  workflowPath: z.string().min(1),
  nodes: z.array(z.string()).optional(),
  force: z.boolean().optional(),
});

const TestInputSchema = z.object({
  kind: z.enum(['changed', 'nodes', 'workflow']),
  workflowPath: z.string().min(1),
  nodes: z.array(z.string()).optional(),
  force: z.boolean().optional(),
  pinData: z.record(z.array(z.object({ json: z.record(z.unknown()) }).passthrough())).optional(),
});

const TrustStatusInputSchema = {
  workflowPath: z.string().min(1),
};

const ExplainInputSchema = z
  .object({
    workflowPath: z.string().min(1),
    kind: z.enum(['nodes', 'changed', 'workflow']).optional(),
    nodes: z.array(z.string()).optional(),
    tool: z.enum(['validate', 'test']).default('validate'),
  })
  .strict();

// ── Helpers ──────────────────────────────────────────────────────

function wrapSuccess<T>(data: T): { content: Array<{ type: 'text'; text: string }> } {
  const envelope: McpResponse<T> = { success: true, data };
  return { content: [{ type: 'text', text: JSON.stringify(envelope) }] };
}

function wrapError(error: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const envelope: McpResponse<never> = { success: false, error: mapToMcpError(error) };
  return { content: [{ type: 'text', text: JSON.stringify(envelope) }] };
}

function resolveTarget(raw: {
  kind: 'nodes' | 'changed' | 'workflow';
  nodes?: string[] | undefined;
}): AgentTarget | Error {
  if (raw.kind === 'nodes') {
    if (!raw.nodes || raw.nodes.length === 0) {
      return new Error('nodes must be a non-empty array when kind is "nodes"');
    }
    return { kind: 'nodes', nodes: raw.nodes as NodeIdentity[] };
  }
  if (raw.kind === 'workflow') return { kind: 'workflow' };
  return { kind: 'changed' };
}

/** Validate that workflowPath resolves under the project root (cwd). Throws on traversal. */
function validatePathBoundary(workflowPath: string): string {
  const resolved = resolve(workflowPath);
  const root = process.cwd();
  if (!resolved.startsWith(`${root}/`) && resolved !== root) {
    throw new Error(`Path traversal rejected: '${workflowPath}' resolves outside project root`);
  }
  return resolved;
}

// ── Server factory ───────────────────────────────────────────────

/** Create an MCP server with all four n8n-proctor tools registered. */
export function createServer(deps: OrchestratorDeps, callTool?: McpToolCaller): McpServer {
  const server = new McpServer({ name: 'n8n-proctor', version: VERSION });

  // ── validate ─────────────────────────────────────────────────
  server.registerTool(
    'validate',
    {
      description: 'Validate an n8n workflow. Returns a diagnostic summary.',
      inputSchema: ValidateInputSchema,
    },
    async (args) => {
      try {
        validatePathBoundary(args.workflowPath);
        const target = resolveTarget(args);
        if (target instanceof Error) return wrapError(target);

        const request: ValidationRequest = {
          workflowPath: args.workflowPath,
          target,
          tool: 'validate',
          force: args.force ?? false,
          pinData: null,
        };
        const summary = await interpret(request, deps);
        return wrapSuccess(summary);
      } catch (error) {
        return wrapError(error);
      }
    },
  );

  // ── test ─────────────────────────────────────────────────────
  server.registerTool(
    'test',
    {
      description: 'Test an n8n workflow via execution. Requires n8n MCP connection.',
      inputSchema: TestInputSchema,
    },
    async (args) => {
      try {
        validatePathBoundary(args.workflowPath);
        const target = resolveTarget(args);
        if (target instanceof Error) return wrapError(target);

        const request: ValidationRequest = {
          workflowPath: args.workflowPath,
          target,
          tool: 'test',
          force: args.force ?? false,
          pinData: args.pinData ?? null,
          ...(callTool ? { callTool } : {}),
        };
        const summary = await interpret(request, deps);
        return wrapSuccess(summary);
      } catch (error) {
        return wrapError(error);
      }
    },
  );

  // ── trust_status ─────────────────────────────────────────────
  server.registerTool(
    'trust_status',
    {
      description: 'Inspect trust state for a workflow. Shows trusted/untrusted nodes and changes.',
      inputSchema: TrustStatusInputSchema,
    },
    async (args) => {
      try {
        validatePathBoundary(args.workflowPath);
        const report = await buildTrustStatusReport(args.workflowPath, deps);
        return wrapSuccess(report);
      } catch (error) {
        return wrapError(error);
      }
    },
  );

  // ── explain ──────────────────────────────────────────────────
  server.registerTool(
    'explain',
    {
      description:
        'Dry-run guardrail evaluation. Shows what guardrails would decide without performing validation.',
      inputSchema: ExplainInputSchema,
    },
    async (args) => {
      try {
        validatePathBoundary(args.workflowPath);
        const target = resolveTarget({ kind: args.kind ?? 'changed', nodes: args.nodes });
        if (target instanceof Error) return wrapError(target);

        const explanation = await buildGuardrailExplanation(
          args.workflowPath,
          target,
          args.tool,
          deps,
        );
        return wrapSuccess(explanation);
      } catch (error) {
        return wrapError(error);
      }
    },
  );

  return server;
}
