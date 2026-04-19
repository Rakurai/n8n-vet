# n8n-vet

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg?logo=typescript&logoColor=white)](tsconfig.json)

Stop re-running the whole workflow. Vet what changed.

## Prerequisites

- **Node >= 20**
- **n8n instance** — required for execution-layer validation (static analysis works without one)
- **n8nac** — for workflow authoring and push to n8n ([n8n-as-code](https://github.com/EtienneLescot/n8n-as-code))

## Setup

```sh
npm install n8n-vet
```

n8n-vet needs two MCP servers available at runtime — **n8n-mcp** (n8n's built-in
MCP server for workflow execution) and **n8nac** (for workflow authoring):

```sh
# Claude Code
claude mcp add n8n-mcp --transport http --url http://localhost:5678/mcp-server/http
claude mcp add n8nac -- npx --yes n8nac mcp
```

For VS Code, add the servers to your `mcp.servers` in settings.json.

## Quick start

**MCP server** (for agents via Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "n8n-vet": {
      "command": "node",
      "args": ["./dist/mcp/serve.js"]
    }
  }
}
```

**CLI** (for local debugging):

```sh
npx n8n-vet validate workflow.ts
```

## The problem

Agents building n8n workflows waste enormous time on validation. They re-run entire workflows after single-node changes. They invent ad hoc tests that check nothing new. They chase failures in regions they didn't touch. The validation loop itself becomes the bottleneck — not the code.

n8n-vet fixes this by making validation targeted, trust-aware, and cheap by default.

## What it does

n8n-vet is a validation control tool for agent-built n8n workflows. It exposes an MCP server that agents call during development. Given a workflow file and a change, it:

- **Targets the change, not the workflow.** Computes the smallest useful slice around what changed, selects a path through it, and validates that — not the whole graph.
- **Tracks trust across edits.** Nodes validated in prior runs stay trusted until they change. Previously validated, unchanged regions become trusted boundaries instead of repeated work.
- **Runs static analysis before touching n8n.** Expression tracing, data-loss detection, and schema checks run locally first. Execution against the n8n instance is reserved for cases where runtime evidence is actually needed.
- **Returns structured diagnostics, not transcripts.** Compact JSON with classified errors, node annotations, and guardrail explanations. Optimized for agent token budgets, not human scrolling.
- **Prevents low-value work.** Guardrails warn, narrow, redirect, or refuse requests that would waste time — identical reruns, overly broad targets, execution when static suffices.

## How it works

```
workflow file
     │
     ▼
┌─ parse ─── graph ─── trust ─── target ─── guardrails ─┐
│                                                        │
│  static analysis (always)    execution (when needed)   │
│                                                        │
└────────────────── diagnostic summary ──────────────────┘
                          │
                     update trust
```

1. Parse the workflow (TypeScript via n8n-as-code)
2. Build a traversable graph with node classification and expression references
3. Load trust state — what was validated before, what changed since
4. Compute the validation target — changed nodes + forward propagation
5. Consult guardrails — should this proceed, narrow, redirect, or refuse?
6. Run static analysis (always) and execution (only when warranted)
7. Synthesize a diagnostic summary
8. Update trust for next time

For the engineering details: [Strategy](docs/STRATEGY.md) covers the target-selection, prioritization, and rerun-suppression approaches (including RTS/TIA-style targeting and DeFlaker-style rerun suppression) and their evidence basis. [Design specs](docs/reference/INDEX.md) cover the type contracts and subsystem behavior.

## MCP tools

n8n-vet exposes three MCP tools:

| Tool | Purpose |
|------|---------|
| **`validate`** | Validate a workflow — resolves scope, applies guardrails, runs analysis, returns diagnostics |
| **`trust_status`** | Inspect what's trusted, what changed, what needs validation |
| **`explain`** | Dry-run guardrail evaluation — preview what `validate` would do |

Default behavior when the agent calls `validate` with no target: validate whatever changed since the last successful run, using static analysis. The cheapest useful default.

## CLI

A secondary CLI exists for local debugging and development:

```
n8n-vet validate workflow.ts              # static analysis on changes
n8n-vet validate workflow.ts --layer both # static + execution
n8n-vet trust workflow.ts                 # inspect trust state
n8n-vet explain workflow.ts               # preview guardrail decision
n8n-vet validate workflow.ts --json       # raw JSON (same as MCP output)
```

## Built on

- [n8n-as-code](https://github.com/EtienneLescot/n8n-as-code) (n8nac) — sibling tool for workflow authoring and push; n8n-vet and n8nac are independent tools that an agent coordinates, not layered dependencies
- TypeScript, strict mode, ESM
- MCP server via `@modelcontextprotocol/sdk`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, integration testing,
and coding conventions.

## License

[MIT](LICENSE)
