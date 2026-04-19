# Data Model: Integration Testing Suite

**Feature**: 010-integration-testing
**Date**: 2026-04-19

## Entities

### IntegrationContext

Shared context object created at test run start, passed to every scenario.

| Field | Type | Description |
|-------|------|-------------|
| n8nBaseUrl | string | n8n instance URL (e.g., `http://localhost:5678`) |
| apiKey | string | n8n API key for REST calls |
| trustDir | string | Temporary directory for trust state isolation |
| snapshotDir | string | Temporary directory for snapshot isolation |
| fixturesDir | string | Path to `test/integration/fixtures/` |
| manifest | Manifest | Parsed fixture manifest |
| cleanup | () => Promise<void> | Removes temp dirs on teardown |

### Manifest

Maps fixture names to their n8n-assigned workflow IDs.

| Field | Type | Description |
|-------|------|-------------|
| [fixtureName] | string | n8n workflow ID (e.g., `"wf-abc123"`) |

**Example**:
```json
{
  "happy-path": "wf-abc123",
  "broken-wiring": "wf-def456",
  "data-loss-passthrough": "wf-ghi789",
  "expression-bug": "wf-jkl012",
  "credential-failure": "wf-mno345",
  "branching-coverage": "wf-pqr678",
  "multi-node-change": "wf-stu901"
}
```

### Scenario

A self-contained integration test function.

| Field | Type | Description |
|-------|------|-------------|
| name | string | Display name (e.g., `"01-static-only"`) |
| run | (ctx: IntegrationContext) => Promise<void> | Test function, throws on failure |

### WorkflowCreatePayload

Fixture definition used by the seed script to create workflows on n8n.

| Field | Type | Description |
|-------|------|-------------|
| name | string | Workflow name (prefixed `n8n-vet-test--`) |
| nodes | Array | Node definitions with type, version, parameters |
| connections | Record | Connection map between nodes |
| settings | object | Workflow settings (executionOrder, etc.) |
| active | boolean | Always `false` for test workflows |

## Fixture Catalog

Each fixture targets one primary validation signal.

| Fixture | Nodes | Primary Signal | Validation Layer |
|---------|-------|----------------|-----------------|
| happy-path | Trigger → Set → NoOp | No issues | Both |
| broken-wiring | Trigger → Set, orphaned HTTP | Disconnected node | Static |
| data-loss-passthrough | Trigger → HTTP → Set → Set | Data-loss-risk | Static |
| expression-bug | Trigger → Set (bad ref) | Unresolvable expression | Both |
| credential-failure | Trigger → HTTP (no creds) → Set | Credential error | Execution |
| branching-coverage | Trigger → If → True/False paths | Path selection | Execution |
| multi-node-change | Trigger → A → B → C → D | Scope narrowing | Static |

## State Lifecycle

```
Test Run Start
  ├── setup() → create IntegrationContext with fresh temp dirs
  ├── pushAllFixtures() → push committed .ts files to n8n
  ├── for each scenario:
  │     ├── scenario starts with empty trust (isolated dir)
  │     ├── scenario calls library APIs (interpret, trustStatus, explain)
  │     ├── trust/snapshot state written to temp dir
  │     └── scenario asserts on results, throws on failure
  └── cleanup() → remove temp dirs
```

Trust state is never shared between scenarios. Each scenario builds its own trust from scratch within the isolated temp directory.
