import { workflow, node, links } from '@n8n-as-code/transformer';

@workflow({
  id: 'explicit-refs-001',
  name: 'Explicit References',
  active: false,
  settings: { executionOrder: 'v1' },
})
export class ExplicitReferencesWorkflow {
  @node({
    id: 'node-trigger-001',
    name: 'Manual Trigger',
    type: 'n8n-nodes-base.manualTrigger',
    version: 1,
    position: [100, 200],
  })
  manualTrigger = {};

  @node({
    id: 'node-http-001',
    name: 'Fetch API',
    type: 'n8n-nodes-base.httpRequest',
    version: 4,
    position: [300, 200],
  })
  fetchApi = {
    url: 'https://api.example.com/users',
    method: 'GET',
  };

  @node({
    id: 'node-set-001',
    name: 'Add Metadata',
    type: 'n8n-nodes-base.set',
    version: 3,
    position: [500, 200],
  })
  addMetadata = {
    assignments: {
      assignments: [
        { name: 'source', value: 'api', type: 'string' },
      ],
    },
  };

  @node({
    id: 'node-set-002',
    name: 'Combine Data',
    type: 'n8n-nodes-base.set',
    version: 3,
    position: [700, 200],
  })
  combineData = {
    assignments: {
      assignments: [
        { name: 'apiName', value: "={{ $('Fetch API').first().json.name }}", type: 'string' },
        { name: 'currentData', value: '={{ $json.source }}', type: 'string' },
        { name: 'inputData', value: '={{ $input.first().json.source }}', type: 'string' },
        { name: 'legacyRef', value: '={{ $node["Fetch API"].json.name }}', type: 'string' },
      ],
    },
  };

  @links()
  defineRouting() {
    this.manualTrigger.out(0).to(this.fetchApi.in(0));
    this.fetchApi.out(0).to(this.addMetadata.in(0));
    this.addMetadata.out(0).to(this.combineData.in(0));
  }
}
