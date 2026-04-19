import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
  id: 'data-loss-bug-001',
  name: 'Data Loss Bug',
  active: false,
  settings: { executionOrder: 'v1' },
})
export class DataLossBugWorkflow {
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
    name: 'Fetch Data',
    type: 'n8n-nodes-base.httpRequest',
    version: 4,
    position: [300, 200],
  })
  fetchData = {
    url: 'https://api.example.com/data',
    method: 'GET',
  };

  @node({
    id: 'node-set-001',
    name: 'Add Fields',
    type: 'n8n-nodes-base.set',
    version: 3,
    position: [500, 200],
  })
  addFields = {
    assignments: {
      assignments: [
        { name: 'enriched', value: '={{ $json.apiResponse }}', type: 'string' },
      ],
    },
  };

  @node({
    id: 'node-set-002',
    name: 'Use Trigger Data',
    type: 'n8n-nodes-base.set',
    version: 3,
    position: [700, 200],
  })
  useTriggerData = {
    assignments: {
      assignments: [
        { name: 'original', value: '={{ $json.triggerField }}', type: 'string' },
      ],
    },
  };

  @links()
  defineRouting() {
    this.scheduleTrigger.out(0).to(this.fetchData.in(0));
    this.fetchData.out(0).to(this.addFields.in(0));
    this.addFields.out(0).to(this.useTriggerData.in(0));
  }
}
