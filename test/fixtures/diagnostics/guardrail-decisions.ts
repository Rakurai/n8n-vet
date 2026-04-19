/**
 * Test fixtures for guardrail decision variants.
 *
 * Each export covers one discriminant of the GuardrailDecision union,
 * providing realistic evidence payloads for diagnostic and formatting tests.
 */

import type { GuardrailDecision } from '../../../src/types/guardrail.js';
import { nodeIdentity } from '../../../src/types/identity.js';
import type { ValidationTarget, ValidationLayer } from '../../../src/types/target.js';

const sharedEvidence = {
  changedNodes: [nodeIdentity('httpRequest')],
  trustedNodes: [nodeIdentity('setFields'), nodeIdentity('codeNode')],
  lastValidatedAt: '2026-04-18T11:50:00Z',
  fixtureChanged: false,
};

export const proceedDecision: GuardrailDecision = {
  action: 'proceed',
  explanation: 'Target is minimal and contains recent changes — validation is worthwhile.',
  evidence: sharedEvidence,
  overridable: false,
};

export const warnDecision: GuardrailDecision = {
  action: 'warn',
  explanation: 'Target spans the entire workflow — consider narrowing to changed nodes only.',
  evidence: {
    changedNodes: [nodeIdentity('httpRequest')],
    trustedNodes: [
      nodeIdentity('setFields'),
      nodeIdentity('codeNode'),
      nodeIdentity('ifNode'),
      nodeIdentity('respondToWebhook'),
    ],
    lastValidatedAt: '2026-04-18T11:45:00Z',
    fixtureChanged: false,
  },
  overridable: true,
};

const narrowedTarget: ValidationTarget = {
  kind: 'nodes',
  nodes: [nodeIdentity('httpRequest'), nodeIdentity('setFields')],
};

export const narrowDecision: GuardrailDecision = {
  action: 'narrow',
  explanation: 'Only 2 of 5 targeted nodes changed — narrowing to the changed subset.',
  evidence: {
    changedNodes: [nodeIdentity('httpRequest'), nodeIdentity('setFields')],
    trustedNodes: [nodeIdentity('codeNode'), nodeIdentity('ifNode'), nodeIdentity('respondToWebhook')],
    lastValidatedAt: '2026-04-18T11:48:00Z',
    fixtureChanged: false,
  },
  overridable: true,
  narrowedTarget,
};

const redirectedLayer: ValidationLayer = 'static';

export const redirectDecision: GuardrailDecision = {
  action: 'redirect',
  explanation: 'No execution backend available — redirecting to static analysis only.',
  evidence: {
    changedNodes: [nodeIdentity('httpRequest')],
    trustedNodes: [],
    lastValidatedAt: null,
    fixtureChanged: false,
  },
  overridable: true,
  redirectedLayer,
};

export const refuseDecision: GuardrailDecision = {
  action: 'refuse',
  explanation: 'All targeted nodes are trusted and unchanged — validation would be redundant.',
  evidence: {
    changedNodes: [],
    trustedNodes: [nodeIdentity('httpRequest'), nodeIdentity('setFields')],
    lastValidatedAt: '2026-04-18T11:55:00Z',
    fixtureChanged: false,
  },
  overridable: true,
};

export const mixedDecisions: GuardrailDecision[] = [proceedDecision, warnDecision];
