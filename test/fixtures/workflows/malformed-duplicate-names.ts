/**
 * Fixture helper: creates a WorkflowAST with duplicate node property names.
 * Used to test MalformedWorkflowError for duplicate names.
 */
import type { WorkflowAST } from '@n8n-as-code/transformer';

export function createDuplicateNamesAST(): WorkflowAST {
  return {
    metadata: {
      id: 'malformed-duplicate-001',
      name: 'Malformed Duplicate Names',
      active: false,
    },
    nodes: [
      {
        propertyName: 'myNode',
        displayName: 'My Node',
        type: 'n8n-nodes-base.set',
        version: 3,
        position: [100, 200],
        parameters: {},
      },
      {
        propertyName: 'myNode',
        displayName: 'My Node Copy',
        type: 'n8n-nodes-base.set',
        version: 3,
        position: [300, 200],
        parameters: {},
      },
    ],
    connections: [],
  };
}
