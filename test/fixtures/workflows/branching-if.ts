import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
  id: 'branching-if-001',
  name: 'Branching If',
  active: false,
  settings: { executionOrder: 'v1' },
})
export class BranchingIfWorkflow {
  @node({
    id: 'node-trigger-001',
    name: 'Manual Trigger',
    type: 'n8n-nodes-base.manualTrigger',
    version: 1,
    position: [100, 200],
  })
  manualTrigger = {};

  @node({
    id: 'node-if-001',
    name: 'Check Value',
    type: 'n8n-nodes-base.if',
    version: 2,
    position: [300, 200],
  })
  checkValue = {
    conditions: {
      options: { caseSensitive: true },
      conditions: [
        {
          leftValue: '={{ $json.status }}',
          rightValue: 'active',
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
  };

  @node({
    id: 'node-set-001',
    name: 'True Path',
    type: 'n8n-nodes-base.set',
    version: 3,
    position: [500, 100],
  })
  truePath = {
    assignments: {
      assignments: [
        { name: 'result', value: 'active', type: 'string' },
      ],
    },
  };

  @node({
    id: 'node-noop-001',
    name: 'False Path',
    type: 'n8n-nodes-base.noOp',
    version: 1,
    position: [500, 300],
  })
  falsePath = {};

  @links()
  defineRouting() {
    this.manualTrigger.out(0).to(this.checkValue.in(0));
    this.checkValue.out(0).to(this.truePath.in(0));
    this.checkValue.out(1).to(this.falsePath.in(0));
  }
}
