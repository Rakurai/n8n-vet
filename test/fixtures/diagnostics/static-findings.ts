/**
 * Test fixtures for static analysis findings used by the diagnostics subsystem.
 *
 * Each export is a realistic `StaticFinding` instance covering one variant of
 * the discriminated union. Composite arrays (`noErrorFindings`, `mixedFindings`)
 * provide pre-built collections for aggregate diagnostic tests.
 */

import type { StaticFinding } from '../../../src/static-analysis/types.js';
import { nodeIdentity } from '../../../src/types/identity.js';

export const passFinding: StaticFinding = {
  node: nodeIdentity('setFields'),
  severity: 'warning',
  message: 'Potential data loss: upstream field "email" is not mapped',
  kind: 'data-loss',
  context: {
    upstreamNode: nodeIdentity('httpRequest'),
    fieldPath: 'email',
    parameter: 'assignments',
  },
};

export const dataLossError: StaticFinding = {
  node: nodeIdentity('setFields'),
  severity: 'error',
  message: 'Data loss: field "userId" dropped between httpRequest and setFields',
  kind: 'data-loss',
  context: {
    upstreamNode: nodeIdentity('httpRequest'),
    fieldPath: 'userId',
    parameter: 'assignments',
  },
};

export const brokenRefError: StaticFinding = {
  node: nodeIdentity('ifCondition'),
  severity: 'error',
  message: 'Reference to non-existent node "deletedNode"',
  kind: 'broken-reference',
  context: {
    referencedNode: 'deletedNode',
    parameter: 'conditions.string[0].value1',
    expression: '={{ $node["deletedNode"].json.status }}',
  },
};

export const invalidParamError: StaticFinding = {
  node: nodeIdentity('httpRequest'),
  severity: 'error',
  message: 'Invalid parameter: "method" is not a recognized HTTP method',
  kind: 'invalid-parameter',
  context: {
    parameter: 'method',
  },
};

export const schemaMismatchError: StaticFinding = {
  node: nodeIdentity('spreadsheetAppend'),
  severity: 'error',
  message: 'Schema mismatch: expected number for "amount", upstream provides string',
  kind: 'schema-mismatch',
  context: {
    upstreamNode: nodeIdentity('codeNode'),
    fieldPath: 'amount',
    parameter: 'columns.value',
  },
};

export const missingCredsError: StaticFinding = {
  node: nodeIdentity('slackSendMessage'),
  severity: 'error',
  message: 'Missing credentials for Slack OAuth2 API',
  kind: 'missing-credentials',
  context: {
    credentialType: 'slackOAuth2Api',
  },
};

export const unresolvableExprError: StaticFinding = {
  node: nodeIdentity('setFields'),
  severity: 'error',
  message: 'Cannot resolve expression referencing ambiguous context',
  kind: 'unresolvable-expression',
  context: {
    parameter: 'assignments.value',
    expression: '={{ $json.items[*].nested?.deep }}',
  },
};

export const opaqueBoundaryWarning: StaticFinding = {
  node: nodeIdentity('functionNode'),
  severity: 'warning',
  message: 'Node "codeNode" has opaque logic; output schema unknown',
  kind: 'opaque-boundary',
  context: {
    opaqueNode: nodeIdentity('codeNode'),
  },
};

/** Findings array containing only warnings — no errors present. */
export const noErrorFindings: StaticFinding[] = [
  passFinding,
  opaqueBoundaryWarning,
];

/** Findings array mixing errors and warnings for aggregate diagnostic tests. */
export const mixedFindings: StaticFinding[] = [
  passFinding,
  dataLossError,
  brokenRefError,
  opaqueBoundaryWarning,
  missingCredsError,
];
