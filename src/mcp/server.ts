/**
 * MCP server — registers three tools (validate, trust_status, explain) and
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
import { interpret } from '../orchestrator/interpret.js';
import type { OrchestratorDeps } from '../orchestrator/types.js';
import type { ValidationRequest } from '../orchestrator/types.js';
import { buildGuardrailExplanation, buildTrustStatusReport } from '../surface.js';
import type { NodeIdentity } from '../types/identity.js';
import type { AgentTarget, ValidationLayer } from '../types/target.js';

// ── Input schemas ────────────────────────────────────────────────

const ValidateInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('changed'),
    workflowPath: z.string().min(1),
    layer: z.enum(['static', 'execution', 'both']).optional(),
    force: z.boolean().optional(),
    pinData: z.record(z.array(z.object({ json: z.record(z.unknown()) }).passthrough())).optional(),
    destinationNode: z.string().min(1).optional(),
    destinationMode: z.enum(['inclusive', 'exclusive']).optional(),
  }),
  z.object({
    kind: z.literal('nodes'),
    workflowPath: z.string().min(1),
    nodes: z.array(z.string()).min(1),
    layer: z.enum(['static', 'execution', 'both']).optional(),
    force: z.boolean().optional(),
    pinData: z.record(z.array(z.object({ json: z.record(z.unknown()) }).passthrough())).optional(),
    destinationNode: z.string().min(1).optional(),
    destinationMode: z.enum(['inclusive', 'exclusive']).optional(),
  }),
  z.object({
    kind: z.literal('workflow'),
    workflowPath: z.string().min(1),
    layer: z.enum(['static', 'execution', 'both']).optional(),
    force: z.boolean().optional(),
    pinData: z.record(z.array(z.object({ json: z.record(z.unknown()) }).passthrough())).optional(),
    destinationNode: z.string().min(1).optional(),
    destinationMode: z.enum(['inclusive', 'exclusive']).optional(),
  }),
]);

const TrustStatusInputSchema = {
  workflowPath: z.string().min(1),
};

const ExplainInputSchema = {
  workflowPath: z.string().min(1),
  kind: z.enum(['nodes', 'changed', 'workflow']).optional(),
  nodes: z.array(z.string()).optional(),
  layer: z.enum(['static', 'execution', 'both']).optional(),
};

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

function resolveLayer(raw?: string): ValidationLayer {
  if (raw === 'execution' || raw === 'both') return raw;
  return 'static';
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

/** Create an MCP server with all three n8n-vet tools registered. */
export function createServer(deps: OrchestratorDeps): McpServer {
  const server = new McpServer({ name: 'n8n-vet', version: '0.1.0' });

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
          layer: resolveLayer(args.layer),
          force: args.force ?? false,
          pinData: args.pinData ?? null,
          destinationNode: args.destinationNode ?? null,
          destinationMode: args.destinationMode ?? 'inclusive',
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
          resolveLayer(args.layer),
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
