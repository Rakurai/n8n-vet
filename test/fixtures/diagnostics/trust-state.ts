/**
 * Trust state fixtures for the diagnostics subsystem.
 *
 * Provides pre-built TrustState instances at varying levels of node coverage
 * (empty, partial, full) for testing trust-aware diagnostic logic such as
 * boundary detection, change classification, and validation planning.
 */

import type { TrustState, NodeTrustRecord } from '../../../src/types/trust.js';
import type { ValidationLayer } from '../../../src/types/target.js';
import { nodeIdentity } from '../../../src/types/identity.js';

const trigger = nodeIdentity('trigger');
const httpRequest = nodeIdentity('httpRequest');
const setFields = nodeIdentity('setFields');
const codeNode = nodeIdentity('codeNode');

function record(
  contentHash: string,
  validatedBy: string,
  validatedAt: string,
  validationLayer: ValidationLayer,
  fixtureHash: string | null,
): NodeTrustRecord {
  return { contentHash, validatedBy, validatedAt, validationLayer, fixtureHash };
}

/** Trust state with no node records — clean slate. */
export const emptyTrustState: TrustState = {
  workflowId: 'wf-test-001',
  nodes: new Map(),
  connectionsHash: 'conn-empty-abc123',
};

/** Trust state where only trigger and setFields are trusted; httpRequest and codeNode are not. */
export const partialTrustState: TrustState = {
  workflowId: 'wf-test-001',
  nodes: new Map([
    [trigger, record('hash-trigger-a1', 'run-001', '2026-04-17T10:00:00Z', 'static', null)],
    [setFields, record('hash-setFields-b2', 'run-001', '2026-04-17T10:05:00Z', 'static', null)],
  ]),
  connectionsHash: 'conn-partial-def456',
};

/** Trust state where all four nodes are trusted with mixed validation layers. */
export const fullTrustState: TrustState = {
  workflowId: 'wf-test-001',
  nodes: new Map([
    [trigger, record('hash-trigger-a1', 'run-002', '2026-04-17T14:00:00Z', 'static', null)],
    [httpRequest, record('hash-http-c3', 'run-002', '2026-04-17T14:01:00Z', 'both', 'fix-http-ee11')],
    [setFields, record('hash-setFields-b2', 'run-002', '2026-04-17T14:02:00Z', 'static', null)],
    [codeNode, record('hash-code-d4', 'run-002', '2026-04-17T14:03:00Z', 'both', 'fix-code-ff22')],
  ]),
  connectionsHash: 'conn-full-ghi789',
};
