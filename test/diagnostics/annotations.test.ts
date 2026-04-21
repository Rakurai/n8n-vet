/**
 * Tests for assignAnnotations — node annotation assignment logic.
 *
 * Verifies priority ordering (validated > trusted > skipped), one-per-node
 * guarantee, and correct classification under mixed conditions.
 */

import { describe, it, expect } from 'vitest';
import { assignAnnotations } from '../../src/diagnostics/annotations.js';
import { nodeIdentity } from '../../src/types/identity.js';
import { threeNodeTarget, singleNodeTarget } from '../fixtures/diagnostics/targets.js';
import {
  emptyTrustState,
  partialTrustState,
} from '../fixtures/diagnostics/trust-state.js';
import {
  dataLossError,
} from '../fixtures/diagnostics/static-findings.js';
import {
  successExecution,
} from '../fixtures/diagnostics/execution-data.js';

describe('assignAnnotations', () => {
  it('marks all nodes validated when each has static findings', () => {
    const findingsForAll = [
      { node: nodeIdentity('httpRequest') },
      { node: nodeIdentity('setFields') },
      { node: nodeIdentity('codeNode') },
    ];

    const annotations = assignAnnotations(threeNodeTarget, emptyTrustState, null, findingsForAll);

    expect(annotations).toHaveLength(3);
    for (const ann of annotations) {
      expect(ann.status).toBe('validated');
    }
  });

  it('marks a node trusted when it is in TrustState but has no findings or execution', () => {
    // setFields is trusted in partialTrustState; use singleNodeTarget for httpRequest
    // but we want setFields — build a single-node target for it
    const setFieldsTarget = {
      description: 'Requested node: setFields',
      nodes: [nodeIdentity('setFields')],
      automatic: false,
    };

    const annotations = assignAnnotations(setFieldsTarget, partialTrustState, null, []);

    expect(annotations).toHaveLength(1);
    expect(annotations[0].status).toBe('trusted');
    expect(annotations[0].node).toBe(nodeIdentity('setFields'));
  });

  it('marks a node skipped when not in TrustState and no findings or execution', () => {
    const annotations = assignAnnotations(singleNodeTarget, emptyTrustState, null, []);

    expect(annotations).toHaveLength(1);
    expect(annotations[0].status).toBe('skipped');
    expect(annotations[0].node).toBe(nodeIdentity('httpRequest'));
  });

  it('validated wins over trusted when a node has both trust record and findings', () => {
    // setFields is in partialTrustState AND dataLossError targets setFields
    const setFieldsTarget = {
      description: 'Requested node: setFields',
      nodes: [nodeIdentity('setFields')],
      automatic: false,
    };

    const annotations = assignAnnotations(setFieldsTarget, partialTrustState, null, [dataLossError]);

    expect(annotations).toHaveLength(1);
    expect(annotations[0].status).toBe('validated');
  });

  it('returns exactly one annotation per node', () => {
    // Duplicate findings for the same node should not produce duplicate annotations
    const duplicateFindings = [
      { node: nodeIdentity('httpRequest') },
      { node: nodeIdentity('httpRequest') },
    ];

    const annotations = assignAnnotations(threeNodeTarget, partialTrustState, null, duplicateFindings);

    expect(annotations).toHaveLength(3);
    const nodeNames = annotations.map((a) => a.node);
    expect(new Set(nodeNames).size).toBe(3);
  });

  it('marks executed nodes as validated with execution data', () => {
    // successExecution has trigger, httpRequest, setFields executed
    // threeNodeTarget has httpRequest, setFields, codeNode
    // httpRequest and setFields are executed → validated; codeNode is not → skipped
    const annotations = assignAnnotations(threeNodeTarget, emptyTrustState, successExecution, []);

    const byNode = new Map(annotations.map((a) => [a.node, a]));
    expect(byNode.get(nodeIdentity('httpRequest'))!.status).toBe('validated');
    expect(byNode.get(nodeIdentity('setFields'))!.status).toBe('validated');
    expect(byNode.get(nodeIdentity('codeNode'))!.status).toBe('skipped');
  });

  it('classifies a mixed scenario: some validated, some trusted, some skipped', () => {
    // threeNodeTarget: httpRequest, setFields, codeNode
    // partialTrustState trusts: trigger, setFields
    // dataLossError finding targets: setFields
    // No execution data
    //
    // Expected:
    //   httpRequest → skipped (not trusted, no findings)
    //   setFields   → validated (has finding — wins over trusted)
    //   codeNode    → skipped (not trusted, no findings)
    const annotations = assignAnnotations(threeNodeTarget, partialTrustState, null, [dataLossError]);

    expect(annotations).toHaveLength(3);
    const byNode = new Map(annotations.map((a) => [a.node, a]));

    expect(byNode.get(nodeIdentity('httpRequest'))!.status).toBe('skipped');
    expect(byNode.get(nodeIdentity('setFields'))!.status).toBe('validated');
    expect(byNode.get(nodeIdentity('codeNode'))!.status).toBe('skipped');
  });
});

// ---------------------------------------------------------------------------
// Executed node annotations (replaces US3 mocked annotations)
// ---------------------------------------------------------------------------

describe('assignAnnotations — executed node annotations', () => {
  it('marks a node with execution results as validated', () => {
    const exec: import('../../src/diagnostics/types.js').ExecutionData = {
      status: 'success',
      lastNodeExecuted: 'httpRequest',
      error: null,
      nodeResults: new Map([
        [
          nodeIdentity('httpRequest'),
          [
            {
              executionIndex: 0,
              status: 'success',
              executionTimeMs: 5,
              error: null,
              source: null,
              hints: [],
            },
          ],
        ],
      ]),
    };

    const annotations = assignAnnotations(singleNodeTarget, emptyTrustState, exec, []);

    expect(annotations).toHaveLength(1);
    expect(annotations[0].status).toBe('validated');
  });

  it('validated from execution wins over trusted', () => {
    const exec: import('../../src/diagnostics/types.js').ExecutionData = {
      status: 'success',
      lastNodeExecuted: 'httpRequest',
      error: null,
      nodeResults: new Map([
        [
          nodeIdentity('httpRequest'),
          [
            {
              executionIndex: 0,
              status: 'success',
              executionTimeMs: 5,
              error: null,
              source: null,
              hints: [],
            },
          ],
        ],
      ]),
    };
    // httpRequest has both execution results AND findings
    const findings = [{ node: nodeIdentity('httpRequest') }];

    const annotations = assignAnnotations(singleNodeTarget, emptyTrustState, exec, findings);

    expect(annotations).toHaveLength(1);
    expect(annotations[0].status).toBe('validated');
  });

  it('every node in resolvedTarget gets exactly one annotation (no duplicates, no omissions)', () => {
    // threeNodeTarget: httpRequest, setFields, codeNode
    // httpRequest is executed, setFields is executed, codeNode is not in execution
    const exec: import('../../src/diagnostics/types.js').ExecutionData = {
      status: 'success',
      lastNodeExecuted: 'setFields',
      error: null,
      nodeResults: new Map([
        [
          nodeIdentity('httpRequest'),
          [
            {
              executionIndex: 0,
              status: 'success',
              executionTimeMs: 5,
              error: null,
              source: null,
              hints: [],
            },
          ],
        ],
        [
          nodeIdentity('setFields'),
          [
            {
              executionIndex: 1,
              status: 'success',
              executionTimeMs: 8,
              error: null,
              source: { previousNode: 'httpRequest', previousNodeOutput: 0, previousNodeRun: 0 },
              hints: [],
            },
          ],
        ],
      ]),
    };

    const annotations = assignAnnotations(threeNodeTarget, emptyTrustState, exec, []);

    expect(annotations).toHaveLength(3);
    const nodeSet = new Set(annotations.map((a) => a.node));
    expect(nodeSet.size).toBe(3);

    const byNode = new Map(annotations.map((a) => [a.node, a]));
    expect(byNode.get(nodeIdentity('httpRequest'))!.status).toBe('validated');
    expect(byNode.get(nodeIdentity('setFields'))!.status).toBe('validated');
    expect(byNode.get(nodeIdentity('codeNode'))!.status).toBe('skipped');
  });
});
