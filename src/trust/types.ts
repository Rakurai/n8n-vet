/**
 * Internal types for the trust subsystem — persistence schema and rerun assessment.
 *
 * Shared types (TrustState, NodeTrustRecord, NodeChangeSet, etc.) live in
 * src/types/trust.ts. This file defines types used only within the trust
 * subsystem implementation.
 */

import { z } from 'zod';
import type { NodeIdentity } from '../types/identity.js';
import type { NodeTrustRecord } from '../types/trust.js';

/** Result of evaluating whether re-validating a target is likely low-value. */
export interface RerunAssessment {
  isLowValue: boolean;
  confidence: 'high' | 'medium';
  reason: string;
  suggestedNarrowedTarget: NodeIdentity[] | null;
}

/** On-disk representation of the full trust store (all workflows). */
export interface PersistedTrustStore {
  schemaVersion: number;
  workflows: Record<string, PersistedWorkflowTrust>;
}

/** Single workflow's trust state in persisted (JSON-safe) form. */
export interface PersistedWorkflowTrust {
  workflowId: string;
  workflowHash: string;
  connectionsHash: string;
  nodes: Record<string, NodeTrustRecord>;
}

// -- Zod schemas for persistence boundary validation --

/**
 * Backwards-compatible schema for NodeTrustRecord.
 *
 * Old trust files use `validationLayer` (possibly with value `'both'`).
 * New trust files use `validatedWith` (`'static' | 'execution'` only).
 * We accept either field name on read, map `'both'` → `'execution'`,
 * and always output `validatedWith`.
 */
const nodeTrustRecordSchema = z
  .object({
    contentHash: z.string(),
    validatedBy: z.string(),
    validatedAt: z.string(),
    validatedWith: z.enum(['static', 'execution']).optional(),
    validationLayer: z.enum(['static', 'execution', 'both']).optional(),
    fixtureHash: z.string().nullable(),
  })
  .transform((rec) => {
    const raw = rec.validatedWith ?? rec.validationLayer ?? 'static';
    const validatedWith = raw === 'both' ? 'execution' : raw;
    return {
      contentHash: rec.contentHash,
      validatedBy: rec.validatedBy,
      validatedAt: rec.validatedAt,
      validatedWith: validatedWith as 'static' | 'execution',
      fixtureHash: rec.fixtureHash,
    };
  });

const persistedWorkflowTrustSchema = z.object({
  workflowId: z.string(),
  workflowHash: z.string(),
  connectionsHash: z.string(),
  nodes: z.record(z.string(), nodeTrustRecordSchema),
});

export const persistedTrustStoreSchema = z.object({
  schemaVersion: z.number(),
  workflows: z.record(z.string(), persistedWorkflowTrustSchema),
});
