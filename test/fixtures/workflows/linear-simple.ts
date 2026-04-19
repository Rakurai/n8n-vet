import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
  id: 'linear-simple-001',
  name: 'Linear Simple',
  active: false,
  settings: { executionOrder: 'v1' },
})
export class LinearSimpleWorkflow {
  @node({
    id: 'node-trigger-001',
    name: 'Schedule Trigger',
    type: 'n8n-nodes-base.scheduleTrigger',
    version: 1.2,
    position: [100, 200],
  })
  scheduleTrigger = {
    rule: {
      interval: [{ field: 'cronExpression', expression: '0 9 * * *' }],
    },
  };

  @node({
    id: 'node-http-001',
    name: 'HTTP Request',
    type: 'n8n-nodes-base.httpRequest',
    version: 4,
    position: [300, 200],
  })
  httpRequest = {
    url: 'https://api.example.com/data',
    method: 'GET',
  };

  @node({
    id: 'node-set-001',
    name: 'Set Fields',
    type: 'n8n-nodes-base.set',
    version: 3,
    position: [500, 200],
    // NOTE: no options.include → defaults to shape-augmenting
  })
  setFields = {
    assignments: {
      assignments: [
        { name: 'processed', value: '={{ $json.data }}', type: 'string' },
      ],
    },
  };

  @links()
  defineRouting() {
    this.scheduleTrigger.out(0).to(this.httpRequest.in(0));
    this.httpRequest.out(0).to(this.setFields.in(0));
  }
}
