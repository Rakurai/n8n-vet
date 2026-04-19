---
description: Validate n8n workflow changes. Use when the user edits an n8n-as-code workflow file and needs to check if the changes are correct, or when debugging workflow failures.
---

# n8n Workflow Validation

You have access to n8n-check tools for validating n8n workflows. Use them to keep validation **bounded, local, and diagnostic** rather than broad and wasteful.

## Tools available

- **validate** — Run validation on a workflow. Returns a diagnostic summary with status, errors, warnings, and node annotations.
- **trust_status** — Check which nodes are trusted (previously validated and unchanged) vs which need validation.
- **explain** — Dry-run: see what validate would do without actually running it. Useful before deciding whether to force-override guardrails.

## When to validate

- After editing a workflow `.ts` or `.json` file
- After the agent reports a workflow execution failure
- When the user asks to check or test a workflow

## How to validate

1. **Default: validate what changed.** Call `validate` with just the `workflowPath`. The system auto-detects changes and validates the minimum useful scope.

2. **Target specific nodes.** If you know which nodes changed: `{ target: { kind: 'nodes', nodes: ['HTTP Request', 'Set Fields'] } }`.

3. **Static first.** Default layer is `static` — cheap, local, no n8n instance needed. Only request `execution` or `both` when you need runtime evidence.

4. **Respect guardrails.** If the system narrows your target or redirects from execution to static, it's saving you work. Read the `guardrailActions` in the response to understand why. Only use `force: true` if you have a specific reason.

5. **Check trust before broad validation.** Call `trust_status` to see what's already trusted. Don't re-validate unchanged regions.

## Common patterns

| Situation | Action |
|-----------|--------|
| Edited one node | `validate` with default target (auto-detects change) |
| Want to check data flow | `validate` with `layer: 'static'` (catches broken refs, data loss) |
| Need runtime proof | `validate` with `layer: 'both'` |
| Debugging execution failure | `validate` with `layer: 'execution'` targeting the failing node |
| Smoke test whole workflow | `validate` with `target: { kind: 'workflow' }, layer: 'execution'` |
| System refused validation | Call `explain` to understand why, then decide whether to `force` |

## Reading results

The `DiagnosticSummary` has a `status` field you can branch on: `pass`, `fail`, `error`, `skipped`.

- **pass**: No issues found. Trust is updated.
- **fail**: Errors found. Check `errors[]` for classified issues (`wiring`, `expression`, `credentials`, `external-service`).
- **error**: Tool/infrastructure failure. Check `errors[]` for what went wrong.
- **skipped**: Guardrails refused (e.g., identical rerun). Read `guardrailActions[]` for explanation.

Focus on `errors` and `warnings`, not on the full node annotation list. The summary is designed to be compact — don't expand it unnecessarily.
