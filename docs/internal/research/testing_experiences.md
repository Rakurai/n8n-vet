# N8N Workflow Testing Experiences

Field notes from an AI agent testing n8n workflows using n8nac (n8n-as-code CLI), the n8n MCP server, and custom helpers. Written to inform better tooling.

## What Worked

### n8nac push/pull is the right abstraction

TypeScript workflow files with decorators are readable and diffable. The `push`/`pull` cycle is intuitive — it maps to how developers already think about deployment. Having workflows in git means I can edit with standard tools, grep for patterns, and do bulk refactors (e.g., converting 12 Postgres nodes in one script).

### n8nac execution get --include-data is invaluable

Being able to retrieve full execution data (every node's input/output) from the CLI is the single most useful debugging capability. Without it, I'd be completely blind. The `--json` flag makes it scriptable.

### n8n MCP server's search_nodes + get_node_types

Discovering node types and getting exact parameter schemas prevents hallucination. The discriminator system (resource/operation/mode) is well-designed — it narrows the type surface before you write code.

### The webhook-based E2E pattern

Submitting a job via HTTP, then inspecting executions, is a natural testing loop. The execution data contains everything needed to diagnose failures.

## Pain Points

### 1. OCC conflicts on every push after GUI interaction

Any change in the n8n GUI (even toggling MCP exposure) creates a version mismatch. Every subsequent `n8nac push` fails with a conflict. The resolution is `n8nac resolve <id> --mode keep-current`, but this becomes muscle memory for the wrong reason. In a typical debug cycle (edit file → push → check GUI → push again), I hit this on nearly every second push.

**What would help:** A `--force` flag on `n8nac push`, or automatic OCC resolution when the local file is newer than the remote change.

### 2. No way to validate data flow statically

`n8nac verify` and `validate_workflow` check node schemas — parameter names, types, required fields. They do NOT catch:
- A node referencing `$json.callback_base_url` when the upstream node's output doesn't contain that field
- Data loss when an HTTP Request or Postgres node replaces `$json` with its own response, breaking downstream references
- Expression references to nodes that exist but whose output shape doesn't match (e.g., `$('Extract Approved Vectors').first().json.vector` when that node was never executed in the current branch)

The broadened-vector data loss bug (the biggest bug this session) passed all validation. It only surfaced at runtime because an HTTP callback node sat between the data-producing Code node and the loop, silently replacing the items. This class of bug — where the workflow graph is valid but the data contracts between nodes are broken — is the #1 source of runtime failures.

**What would help:** A data flow analyzer that traces `$json`, `$('Node Name')`, and expression references through the graph and flags when a referenced field isn't present in the upstream node's schema or sample output.

### 3. Execution inspection requires custom scripting

The raw execution JSON from `n8nac execution get` is enormous (thousands of lines for a 50-node workflow). Finding the error node requires parsing. Tracing data flow requires knowing which nodes to inspect. I ended up writing three commands (`errors`, `summary`, `trace`) in `scripts/dev/n8n_exec_inspect.py` because this workflow repeated on every failure.

The n8n MCP server's `get_execution` has `nodeNames` and `truncateData` filters, which help, but you need to already know which nodes to inspect. When debugging a new failure, you don't.

**What would help:** `n8nac execution get <id> --errors-only` that returns just the failed node(s) with their input data and error message. Also `--summary` for the one-line-per-node view I built in the inspect script.

### 4. No integration test framework for workflows

There's no way to say "run this workflow with this input and assert that node X outputs Y." The closest is `test_workflow` with `pinData`, but that's for mocking external services — it doesn't test the actual data flow between nodes. And it requires you to manually construct pin data for every external node.

The actual testing loop is: submit a real job → wait for it to reach a failure or completion → inspect the execution. This means:
- Every test takes 30-120 seconds (LLM calls, HTTP round-trips)
- Failures late in the workflow require re-running the entire pipeline
- No way to test a single branch (e.g., just the broadened-vector path) without going through the full plan→approve→collect→scope→approve→collect flow

**What would help:** A way to replay a successful execution up to node N, then continue with modified nodes from there. Or: snapshot an execution's state at a checkpoint and resume from it.

### 5. availableInMCP silently dropped on push

`n8nac push` strips the `availableInMCP` workflow setting because its internal `WorkflowSettings` interface is a closed allowlist. This means every push disables MCP access, requiring manual re-enablement in the GUI. During a debug cycle with many pushes, this is a constant friction.

This is documented in `docs/n8nac-mcp-bug.md` with root cause analysis. The fix is straightforward (add index signature to `WorkflowSettings`), but until then it breaks any workflow that uses MCP exposure.

### 6. Error messages are often generic

n8n's runtime errors frequently say things like "Invalid JSON in response body" without showing what the body actually was, or "Could not get parameter" without saying which expression failed. Diagnosing these requires pulling the full execution data and manually inspecting the input to the failed node.

**What would help:** Error messages that include the first 500 chars of the actual value that failed parsing, or the expression that failed evaluation with its resolved value.

### 7. No way to test from a mid-workflow checkpoint

The main workflow is a long pipeline: webhook → plan generation → approval wait → collection loop → scope analysis → approval wait → broadened collection → dedup → packaging. When a bug exists in the packaging phase, I have to run the entire pipeline from scratch every time. A 5-minute round-trip for each iteration.

**What would help:** Execution checkpointing — save the state at a Wait node resume point, then replay from there with modified downstream nodes.

### 8. Postgres node format is fragile and underdocumented

The `columns` resource mapper format for Postgres v2.6 (`{ mappingMode, value, matchingColumns, schema }`) is not obvious from the node schema alone. We went through three wrong formats before finding the right one:
1. `columnToMatchOn` / `dataMode` / `valuesToSend` (old API, silently accepted but broken at runtime)
2. String expression format `'{{ {"mappingMode":"autoMapInputData"} }}'` (invalid)
3. Correct object format with full schema array

`get_node_types` returns the structure, but the relationship between `mappingMode`, `value`, and `schema` isn't clear from the type definition alone. We needed a working example to understand it.

**What would help:** Example-driven documentation for complex node parameters, especially resource mappers. A "show me a working update node" command.

## What I'd Build

If I were designing a testing toolkit for n8n workflows:

1. **`n8nac test <workflow-id> --input '{"key":"value"}'`** — Run a workflow with given input and wait for completion. Return pass/fail with error details. No need to construct pin data manually.

2. **`n8nac test <workflow-id> --from-execution <exec-id> --start-at "Node Name"`** — Replay an execution up to a node, then continue with the current workflow definition. This is the single highest-value feature for iterative debugging.

3. **`n8nac execution errors <exec-id>`** — First-class error inspection without piping through custom scripts.

4. **`n8nac execution trace <exec-id> "Node A" "Node B" "Node C"`** — Show input/output for specific nodes, truncated sensibly.

5. **Data flow linting** — Static analysis that traces expressions through the graph and warns when `$json.field` or `$('Node').first().json.field` references can't be satisfied by upstream output shapes.

6. **Push with `--force` or `--auto-resolve`** — Skip OCC conflicts when the intent is clearly "my local file wins."

7. **Workflow segment testing** — Define a subgraph (start node → end node) and test it in isolation with mocked inputs.

## Environment Notes

- n8n runs in Docker, backend on host. Workflows call back to `http://host.docker.internal:5472/callbacks`.
- LM Studio provides the LLM at `http://host.docker.internal:4000` (local model, ~8-30s per call).
- n8nac must run from the repo root where `n8nac-config.json` lives.
- The inspect scripts in `scripts/dev/n8n_exec_inspect.py` handle n8nac's mixed stdout (JSON prefixed with log lines) by scanning for the first `{`.
