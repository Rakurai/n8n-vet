/**
 * Fixture helper: creates a WorkflowAST with a connection referencing
 * a non-existent node. Used to test MalformedWorkflowError for broken refs.
 */
import type { WorkflowAST } from '@n8n-as-code/transformer';

export function createBrokenRefAST(): WorkflowAST {
  return {
    metadata: {
      id: 'malformed-broken-ref-001',
      name: 'Malformed Broken Ref',
      active: false,
    },
    nodes: [
      {
        propertyName: 'trigger',
        displayName: 'Trigger',
        type: 'n8n-nodes-base.manualTrigger',
        version: 1,
        position: [100, 200],
        parameters: {},
      },
    ],
    connections: [
      {
        from: { node: 'trigger', output: 0 },
        to: { node: 'nonExistentNode', input: 0 },
      },
    ],
  };
}
