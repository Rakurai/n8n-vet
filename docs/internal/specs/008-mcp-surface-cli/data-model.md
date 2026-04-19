# Data Model: MCP Surface and CLI

**Feature**: 008-mcp-surface-cli | **Date**: 2026-04-19

## McpError

Typed error at the MCP/CLI boundary. Four discriminants covering all domain error categories.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'workflow_not_found' \| 'parse_error' \| 'configuration_error' \| 'internal_error'` | Error category discriminant |
| `message` | `string` | Human/agent-readable error description |

**Error mapping from domain errors**:

| Domain Error Class | McpError type |
|-------------------|---------------|
| `ENOENT` / file not found | `workflow_not_found` |
| `MalformedWorkflowError` | `parse_error` |
| Zod validation errors (invalid input) | `parse_error` |
| `ConfigurationError`, `ExecutionConfigError` | `configuration_error` |
| All other exceptions | `internal_error` |

## McpResponse\<T\>

Response envelope wrapping all tool/command outputs.

| Variant | Fields | Description |
|---------|--------|-------------|
| Success | `{ success: true, data: T }` | Tool operated correctly; `data` contains the result |
| Failure | `{ success: false, error: McpError }` | Tool-level failure; `error` describes what went wrong |

**Invariant**: Validation status `'fail'` in DiagnosticSummary is `success: true` at the envelope level.

## TrustStatusReport

Output of the `trust_status` tool. Assembled from trust state + change set.

| Field | Type | Description |
|-------|------|-------------|
| `workflowId` | `string` | Absolute path-based workflow identifier |
| `totalNodes` | `number` | Total nodes in the current workflow graph |
| `trustedNodes` | `TrustedNodeInfo[]` | Nodes with active trust records |
| `untrustedNodes` | `UntrustedNodeInfo[]` | Nodes without trust or with invalidated trust |
| `changedSinceLastValidation` | `string[]` | Node names that changed since last validation |

### TrustedNodeInfo

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Node identity (property name) |
| `validatedAt` | `string` | ISO 8601 timestamp of last validation |
| `validationLayer` | `string` | Layer that established trust (`'static'`, `'execution'`, `'both'`) |
| `contentUnchanged` | `boolean` | Whether node content hash still matches trust record |

### UntrustedNodeInfo

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Node identity (property name) |
| `reason` | `string` | Why the node is untrusted (e.g., "no prior validation", "content changed", "connection topology changed") |

## GuardrailExplanation

Output of the `explain` tool. Dry-run guardrail evaluation result.

| Field | Type | Description |
|-------|------|-------------|
| `guardrailDecision` | `GuardrailDecision` | What the guardrails would decide (from `src/types/guardrail.ts`) |
| `targetResolution` | `TargetResolutionInfo` | How the target would resolve |
| `capabilities` | `AvailableCapabilities` | What validation capabilities are currently available (from `src/types/diagnostic.ts`) |

### TargetResolutionInfo

| Field | Type | Description |
|-------|------|-------------|
| `resolvedNodes` | `string[]` | Node names that would be in validation scope |
| `selectedPath` | `string[]` | Ordered node names of the selected path (if path selection occurred) |
| `automatic` | `boolean` | Whether target resolution was automatic (`true` for `changed` kind) |

## ValidationRequest Defaults

Applied at the MCP/CLI boundary before delegation.

| Field | Default when omitted |
|-------|---------------------|
| `target` | `{ kind: 'changed' }` |
| `layer` | `'static'` |
| `force` | `false` |
| `pinData` | `null` |
| `destinationNode` | `null` |
| `destinationMode` | `'inclusive'` |
