import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
  id: 'single-trigger-001',
  name: 'Single Trigger',
  active: false,
  settings: { executionOrder: 'v1' },
})
export class SingleTriggerWorkflow {
  @node({
    id: 'node-trigger-001',
    name: 'Webhook Trigger',
    type: 'n8n-nodes-base.webhook',
    version: 2,
    position: [100, 200],
  })
  webhookTrigger = {
    path: 'test-hook',
    httpMethod: 'POST',
  };

  @links()
  defineRouting() {
    // No connections — single node workflow
  }
}
