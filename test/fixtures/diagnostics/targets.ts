/**
 * Test fixtures for resolved validation targets, available capabilities, and validation metadata.
 *
 * Provides realistic ResolvedTarget, AvailableCapabilities, and ValidationMeta instances
 * for diagnostic summary construction and compactness testing.
 */

import type { ResolvedTarget, AvailableCapabilities, ValidationMeta } from '../../../src/types/diagnostic.js';
import { nodeIdentity } from '../../../src/types/identity.js';

export const threeNodeTarget: ResolvedTarget = {
  description: 'Changed nodes: httpRequest, setFields, codeNode',
  nodes: [nodeIdentity('httpRequest'), nodeIdentity('setFields'), nodeIdentity('codeNode')],
  automatic: true,
};

export const singleNodeTarget: ResolvedTarget = {
  description: 'Requested node: httpRequest',
  nodes: [nodeIdentity('httpRequest')],
  automatic: false,
};

export const fiveNodeTarget: ResolvedTarget = {
  description: 'Changed nodes: httpRequest, setFields, codeNode, ifNode, respondToWebhook',
  nodes: [
    nodeIdentity('httpRequest'),
    nodeIdentity('setFields'),
    nodeIdentity('codeNode'),
    nodeIdentity('ifNode'),
    nodeIdentity('respondToWebhook'),
  ],
  automatic: true,
};

export const fullCapabilities: AvailableCapabilities = {
  staticAnalysis: true,
  mcpTools: true,
};

export const staticOnlyCapabilities: AvailableCapabilities = {
  staticAnalysis: true,
  mcpTools: false,
};

export const testMeta: ValidationMeta = {
  runId: 'run-001',
  executionId: null,
  timestamp: '2026-04-18T12:00:00Z',
  durationMs: 150,
};

export const executionMeta: ValidationMeta = {
  runId: 'run-002',
  executionId: 'exec-001',
  timestamp: '2026-04-18T12:01:00Z',
  durationMs: 3200,
};
