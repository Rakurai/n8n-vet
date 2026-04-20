---
name: validate-workflow
description: Use to validate n8n-as-code workflow files, debug n8n execution failures, check data flow between nodes, or decide whether a workflow change needs runtime validation. Requires the n8n-vet MCP server.
license: MIT
compatibility: ">=0.1.0"
---

# n8n Workflow Validation

You have access to n8n-vet tools for validating n8n workflows. n8n-vet keeps validation **bounded, local, and diagnostic** rather than broad and wasteful.

n8n-vet is a **sibling tool** to n8nac. n8n-vet validates; n8nac authors and pushes. You coordinate both tools independently.

## Tools

### validate

Run static analysis on a workflow. Returns a diagnostic summary. Does not require a running n8n instance.

**Parameters:**

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `kind` | `'changed' \| 'nodes' \| 'workflow'` | yes | — | `changed`: auto-detect what changed. `nodes`: target specific nodes. `workflow`: whole workflow. |
| `workflowPath` | string | yes | — | Relative path to the `.ts` workflow file. |
| `nodes` | string[] | only when `kind: 'nodes'` | — | Node names to validate. |
| `force` | boolean | no | `false` | Override guardrail decisions (narrowing, refusal). |

### test

Run execution-backed validation against a live n8n instance. Requires the workflow to be pushed (`metadata.id` must exist) and an n8n MCP connection.

**Parameters:**

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `kind` | `'changed' \| 'nodes' \| 'workflow'` | yes | — | `changed`: auto-detect what changed. `nodes`: target specific nodes. `workflow`: whole workflow. |
| `workflowPath` | string | yes | — | Relative path to the `.ts` workflow file. |
| `nodes` | string[] | only when `kind: 'nodes'` | — | Node names to validate. |
| `force` | boolean | no | `false` | Override guardrail decisions (narrowing, test-refusal). |
| `pinData` | `Record<string, {json: object}[]>` | no | — | Mock data keyed by node name. Used to pin upstream outputs during execution. |

### trust_status

Check which nodes are trusted (previously validated, unchanged) vs which need validation.

| Param | Type | Required |
|-------|------|----------|
| `workflowPath` | string | yes |

### explain

Dry-run guardrail evaluation. Shows what `validate` or `test` would decide without running validation.

| Param | Type | Required | Default |
|-------|------|----------|---------|
| `workflowPath` | string | yes | — |
| `kind` | `'changed' \| 'nodes' \| 'workflow'` | no | `'changed'` |
| `nodes` | string[] | no | — |
| `tool` | `'validate' \| 'test'` | no | `'validate'` |

## Response envelope

All tools return `{ success: true, data: <result> }` or `{ success: false, error: { type, message } }`.

Error types: `workflow_not_found`, `parse_error`, `configuration_error`, `infrastructure_error`, `trust_error`, `precondition_error`, `internal_error`.

## Development Workflow: Validate → Push → Test

Validation and testing are separate operations with separate tools, connected by an `n8nac push` step.

### Step 1: Validate (before push)

No n8n instance required. Call `validate` with `kind: 'changed'` (or `'nodes'`). Catches data-loss between nodes, broken expression references, schema/parameter errors, wiring issues, and node classification problems. Cheap, local, fast.

### Step 2: Push the workflow

After static validation passes, push with `n8nac push`. n8n-vet does not push. The first push assigns `metadata.id` in the workflow file, which is required for execution testing.

### Step 3: Test (after push)

Requires a deployed workflow. Call `test` with the desired target. Runs a smoke test via MCP, observes the actual execution path, and catches runtime issues (credential failures, external service errors, expression evaluation bugs).

If `metadata.id` is missing when you call `test`, n8n-vet returns a precondition error.

## Trust persistence

Trust carries forward across calls. Nodes that pass static validation (Step 1) remain trusted through execution testing (Step 3) as long as their content hasn't changed. This means execution focuses only on runtime-specific concerns.

Call `trust_status` to see current trust state before deciding what to validate or test.

## When to validate

| Situation | Call |
|-----------|------|
| Edited a `.ts` workflow file | `validate({ kind: 'changed', workflowPath })` |
| Want to check data flow before push | `validate({ kind: 'changed', workflowPath })` |
| Target specific nodes for static analysis | `validate({ kind: 'nodes', workflowPath, nodes: ['HTTP Request', 'Set Fields'] })` |
| System refused validation | Call `explain` to understand why, then decide whether to `force` |
| Not sure what needs validation | Call `trust_status` first |

## When to test

| Situation | Call |
|-----------|------|
| After `n8nac push` succeeds | `test({ kind: 'changed', workflowPath })` |
| Smoke test whole workflow | `test({ kind: 'workflow', workflowPath })` |
| Debugging execution failure | `test({ kind: 'nodes', workflowPath, nodes: ['Failing Node'] })` |
| Mock upstream data for execution | `test({ kind: 'nodes', workflowPath, nodes: [...], pinData: { 'Source Node': [{ json: { field: 'value' } }] } })` |

## Reading results

The `DiagnosticSummary` has a `status` field: `pass`, `fail`, `error`, `skipped`.

- **pass** — No issues. Trust updated.
- **fail** — Errors found. Check `errors[]` for classified issues.
- **error** — Tool/infrastructure failure (not a workflow bug). Common: missing `metadata.id`.
- **skipped** — Guardrails refused. Read `guardrailActions[]` for explanation.

### Error classifications

Branch on `errors[].classification`:

| Classification | Meaning | Agent action |
|---------------|---------|-------------|
| `wiring` | Broken references, missing connections | Fix workflow structure |
| `expression` | Invalid expressions, reference errors | Fix the expression |
| `credentials` | Missing or invalid credentials | Ask user to configure |
| `external-service` | Third-party API failure | Retry or ask user |
| `platform` | n8n infrastructure issue | Not fixable by editing workflow |
| `cancelled` | Execution was cancelled | Investigate cause |
| `unknown` | Unclassified | Inspect error message |

### Hints

Check `hints[]` for additional signals. Each hint has `severity: 'info' | 'warning' | 'danger'` and a `message`. These supplement errors with context about opaque nodes, trust boundaries, or reduced confidence areas.

## Guardrails

If the system narrows your target or refuses, read `guardrailActions[]` in the response. Each action has an `explanation` and is `overridable: true/false`. Only use `force: true` if you have a specific reason to override.

When calling `test` and the guardrails determine all changes are structurally analyzable (no opaque nodes, no runtime-dependent behavior), the tool will refuse and recommend using `validate` instead. This is the **test-refusal** guardrail — it prevents unnecessary execution cost when static analysis is sufficient.

Guardrail actions: `proceed`, `warn`, `narrow`, `refuse`.
