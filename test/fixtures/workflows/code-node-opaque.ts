import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
  id: 'code-node-opaque-001',
  name: 'Code Node Opaque',
  active: false,
  settings: { executionOrder: 'v1' },
})
export class CodeNodeOpaqueWorkflow {
  @node({
    id: 'node-trigger-001',
    name: 'Manual Trigger',
    type: 'n8n-nodes-base.manualTrigger',
    version: 1,
    position: [100, 200],
  })
  manualTrigger = {};

  @node({
    id: 'node-code-001',
    name: 'Transform Data',
    type: 'n8n-nodes-base.code',
    version: 2,
    position: [300, 200],
  })
  transformData = {
    language: 'javaScript',
    jsCode: 'return items.map(item => ({ json: { transformed: true } }));',
  };

  @node({
    id: 'node-set-001',
    name: 'Use Transformed',
    type: 'n8n-nodes-base.set',
    version: 3,
    position: [500, 200],
  })
  useTransformed = {
    assignments: {
      assignments: [
        { name: 'result', value: '={{ $json.transformed }}', type: 'string' },
      ],
    },
  };

  @links()
  defineRouting() {
    this.manualTrigger.out(0).to(this.transformData.in(0));
    this.transformData.out(0).to(this.useTransformed.in(0));
  }
}
