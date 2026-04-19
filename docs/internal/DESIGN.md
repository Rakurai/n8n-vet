# System Design

## 1. Purpose

This document is the architectural bridge between the product definition (VISION, PRD, SCOPE, CONCEPTS) and later detailed specification work.

It describes the major subsystems, their responsibilities, the primary control flows, and the key design models that shape how the product operates. It records decisions that are implied or confirmed by the feasibility research, and it identifies design tensions that remain open.

This document should be read together with `VISION.md`, `PRD.md`, `SCOPE.md`, `CONCEPTS.md`, `STRATEGY.md`, and `TECH.md`.

### What this document does

- Establishes the internal architecture at subsystem level
- Defines the validation model, runtime integration model, diagnostic result model, guardrail model, trust model, and failure model
- Records which architectural choices are grounded in feasibility results

### What this document does not do

- Rewrite the PRD or restate product requirements
- Commit to exact API signatures, class hierarchies, or persistence schemas
- Produce an implementation plan or phased delivery roadmap
- Resolve open design tensions that require further specification work

---

## 2. Design goals

The architecture must serve these goals, derived from the vision, PRD, and engineering strategy (`STRATEGY.md`):

1. **Bounded validation by default.** The system's natural unit of work is a workflow slice and a path through it, not an entire workflow.

2. **Locality over breadth.** Validation effort and diagnostics stay close to the change. Unrelated graph regions are not re-proven.

3. **Trusted boundary reuse.** Previously validated, unchanged regions are treated as stable context. The system does not require heavy manual contract authoring to establish trust.

4. **Compact diagnostics as product output.** The canonical result is a structured JSON summary small enough for agent consumption. Verbose transcripts and pass spam are failure modes.

5. **Static before execution.** Static analysis is the cheap, local, default path. Execution-backed validation is a deliberate compile+test step with real cost.

6. **Agent-only operation.** The tool surface is optimized for structured machine input/output. Human legibility is secondary.

7. **Guardrails as product identity.** When a validation request is low-value, the system warns, narrows, redirects, or refuses -- always with explanation.

---

## 3. System context

```
                  ┌──────────────────────────┐
                  │    Supervising human      │
                  │  (reads diagnostics,      │
                  │   oversees agent work)    │
                  └────────────┬─────────────┘
                               │ oversight
                  ┌────────────▼─────────────┐
                  │       Coding agent        │
                  │  (edits workflows,        │
                  │   calls n8n-vet + n8nac,  │
                  │   consumes diagnostics)   │
                  └──┬─────────────────┬──────┘
                     │ MCP tool calls  │ MCP tool calls
          ┌──────────▼──┐     ┌────────▼────────┐
          │   n8n-vet   │     │     n8nac       │
          │ (validation)│     │ (authoring/     │
          │             │     │  deploy)        │
          └──┬──────────┘     └────────┬────────┘
             │                         │
    ┌────────▼─────────┐    ┌──────────▼────────┐
    │  Local workflow   │    │   n8n instance    │
    │  artifacts        │    │   (MCP)           │
    └──────────────────┘    └───────────────────┘
```

**Local workflow artifacts** are the source of truth. Workflows are authored as n8n-as-code TypeScript files and versioned locally. n8n is a deployment/runtime surface, not the authoring environment.

**n8n-vet and n8nac are sibling tools**, not dependency/wrapper. The agent coordinates both independently: n8nac for workflow authoring and deployment, n8n-vet for validation. n8n-vet uses `@n8n-as-code/transformer` as a library dependency for `.ts` workflow parsing, but does not wrap, proxy, or orchestrate n8nac itself.

**n8n instance** is the execution backend. It is required only for execution-backed validation. Static analysis operates entirely offline.

**n8n MCP tools** are used for whole-workflow execution (`test_workflow`), execution result inspection (`get_execution`), and pin data schema discovery (`prepare_test_pin_data`). MCP is the sole execution backend.

**The agent** is the sole direct consumer. It calls both n8n-vet and n8nac as independent MCP tool surfaces, receives structured diagnostic summaries from n8n-vet, and decides what to fix or deploy next.

**The supervising human** reads diagnostic summaries when needed but does not operate the tool directly.

---

## 4. Architectural overview

The system is organized as a library core with a thin MCP surface on top and a secondary CLI surface for development/debug use.

### Subsystems

```
┌─────────────────────────────────────────────────────────┐
│                   Agent-facing surface                    │
│              (MCP server / secondary CLI)                 │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                  Request interpretation                   │
│  (target parsing, scope resolution, guardrail gating)    │
└──────┬──────────┬──────────┬────────────┬───────────────┘
       │          │          │            │
┌──────▼───┐ ┌───▼────┐ ┌───▼──────┐ ┌──▼──────────────┐
│  Static  │ │Execution│ │  Trust & │ │   Diagnostic    │
│ analysis │ │ orches- │ │  change  │ │    summary      │
│          │ │ tration │ │reasoning │ │   synthesis     │
└──────────┘ └────────┘ └──────────┘ └─────────────────┘
```

#### Agent-facing surface

Exposes the product's capabilities as MCP tools for agent consumption and optionally as CLI commands for development use. Accepts structured validation requests. Returns structured diagnostic summaries. This layer is thin; it delegates immediately to request interpretation.

#### Request interpretation

Receives a validation request and determines what the system should actually do. Responsibilities:

- Parse and validate the requested target (workflow, slice, path, node set)
- Resolve the validation scope against the current workflow graph
- Consult the trust and change model to determine what is already trusted, what changed, and what needs validation
- Apply guardrail logic: decide whether to proceed, warn, narrow, redirect, or refuse
- Route to static analysis, execution orchestration, or both

This subsystem is the product's control center. It is where bounded validation, guardrails, and trusted boundary reuse are enforced.

#### Static analysis

Performs local, offline analysis of workflow structure and data flow. Responsibilities:

- Parse workflow files into a traversable graph representation
- Trace expression references through the graph (`$json.field`, `$('NodeName').first().json.field`, `$input.first().json.field`)
- Classify nodes by behavior (shape-preserving, shape-replacing, shape-opaque)
- Detect data-loss-through-replacement patterns
- Check output shape compatibility across connections when schema information is available
- Validate node parameters and structure

Does not require a running n8n instance. Produces structured findings that feed into the diagnostic summary.

#### Execution orchestration

Manages execution-backed validation when runtime evidence is needed. Responsibilities:

- Construct pin data for mocked execution
- Push workflows to n8n if needed
- Execute workflows via MCP (`test_workflow`)
- Execute bounded subgraphs via MCP tools
- Poll for and retrieve execution results
- Extract per-node results, errors, and path information from execution data

This is the expensive path. It is invoked only when request interpretation determines that static analysis alone is insufficient.

#### Trust and change reasoning

Maintains and queries the trust state. Responsibilities:

- Compute node-level change sets between workflow snapshots
- Track which nodes and boundaries have been validated
- Determine what trust is current and what has been invalidated by changes
- Provide evidence for guardrail decisions (unchanged targets, redundant requests)
- Support rerun assessment: is a requested validation likely to add useful information?

Operates on local state. Does not require a running n8n instance.

#### Diagnostic summary synthesis

Assembles the final structured result from evidence produced by the other subsystems. Responsibilities:

- Merge static analysis findings with execution results
- Reconstruct the executed path from run data
- Extract and classify errors
- Annotate which nodes were trusted, mocked, skipped, or validated
- Produce a compact JSON diagnostic summary
- Ensure that every guardrail action, trust decision, and scope adjustment is visible in the result

---

## 5. Primary control flow

### Static-only validation path

This is the cheap, local, default path. No n8n instance required.

```
Agent request
  → Request interpretation
    → Resolve target against workflow graph
    → Consult trust state: identify trusted vs. changed regions
    → Apply guardrails (may warn, narrow, or refuse)
    → Route to static analysis
  → Static analysis
    → Parse workflow into graph
    → Trace expression references in target slice
    → Classify nodes; detect data-loss-through-replacement
    → Check output shape compatibility where schemas exist
    → Run schema-level validation (node params, types, credentials)
  → Diagnostic summary synthesis
    → Assemble structured result from static findings
    → Annotate trusted regions, validation scope, and any guardrail actions
  → Return diagnostic summary to agent
```

### Execution-backed validation path

This is the expensive path. Used when runtime evidence is needed.

```
Agent request (requesting execution-backed validation)
  → Request interpretation
    → Resolve target; consult trust state; apply guardrails
    → Optionally run static analysis first (catch cheap errors before paying execution cost)
    → Determine execution strategy:
        - Bounded execution via MCP tools for slice validation
        - Whole-workflow execution (MCP test_workflow) for smoke tests
  → Execution orchestration
    → Discover or construct pin data for mocked nodes
    → Push workflow to n8n if local changes are not yet deployed
    → Execute via chosen backend
    → Poll for completion
    → Retrieve execution results (filtered to relevant nodes)
  → Diagnostic summary synthesis
    → Reconstruct executed path from run data
    → Extract and classify errors at execution, node, and item levels
    → Merge with any static analysis findings
    → Annotate mocked, skipped, trusted, and validated regions
    → Report which evidence layer (static, execution, or both) supports each finding
  → Return diagnostic summary to agent
```

The system should prefer running static analysis before execution whenever practical. Static analysis is fast enough to serve as a pre-flight check that catches cheap errors without paying the execution cost.

---

## 6. Validation model

### Workflow slice

A slice is the bounded region of the workflow graph relevant to the current change. The intended model for computing a slice considers:

1. The set of nodes that changed since the last validation
2. The downstream nodes affected by those changes (forward propagation through connections)
3. The upstream nodes needed to establish input context (back to a trigger or trusted boundary)

A slice is the **change unit**. The system is expected to support automatic slice computation from change sets and graph topology. The final precedence between automatic and agent-specified targeting is left to specification.

### Workflow path

A path is a concrete execution route through a slice. It is the **validation unit**.

In most cases, validating a slice means reasoning about or executing one path through it. The system defaults to the happy path: the route that avoids error outputs and follows the primary branch of conditional nodes.

The agent may explicitly request a specific path or request validation of multiple paths. The system will warn if a multi-path request is broad relative to what changed.

### Validation target

The target is what the agent asks the system to validate. It may be:

- A specific node or set of nodes
- A named slice or path
- "Whatever changed since last validation" (the system resolves this to a concrete target)

The system normalizes every target into a concrete set of nodes and a path (or paths) before proceeding.

### Happy-path default

When the agent does not specify a path, the system selects the happy path through the target slice. Feasibility research confirmed that the following signals are structurally available in the n8n graph model:

- **Error output marking**: connections have an explicit `isError` flag, providing a reliable signal for deprioritizing error branches
- **Branch output index**: conditional nodes (If, Switch) use output indices where index 0 is conventionally the primary/true case
- **Trust history**: prior validation records which paths have been validated

The exact ranking or weighting of these signals is a specification-level decision. The selected path is always reported in the diagnostic summary so the agent understands the validation scope.

### Trusted boundary reuse

A trusted boundary is a point in the graph where prior validation established confidence. When a boundary is trusted:

- Nodes beyond it are not re-validated
- The boundary node's output is treated as known/stable for the purposes of downstream analysis
- Prior validation artifacts (such as pin data or observed output shapes) may be reused at the boundary for execution-backed validation

Trust is derived, not manually authored. It comes from prior successful validation combined with evidence that nothing relevant has changed.

### Relationship between static and execution-backed validation

Static analysis and execution-backed validation are complementary, not alternative.

- **Static analysis** catches structural and data-flow problems: broken references, data loss through replacement, schema mismatches, missing parameters, invalid expressions.
- **Execution-backed validation** catches runtime problems: Code node output shape, LLM response format, conditional logic correctness, actual data values.

The system should recommend static-only validation when the change is purely structural (expression edits, connection changes, parameter adjustments) and execution-backed validation when runtime evidence is needed (Code node changes, new external integrations, complex conditional logic).

---

## 7. Runtime integration model

### Local artifacts (always available)

- n8n-as-code TypeScript workflow files: parsed via the `@n8n-as-code/transformer` package into a graph representation
- Trust state: maintained locally by n8n-vet

No n8n instance or network access required. This is the foundation for all static analysis.

### Relationship to n8nac

n8n-vet and n8nac are **independent sibling tools** that the agent coordinates. They are not in a dependency/wrapper relationship.

- **n8nac** is responsible for workflow authoring, sync, and deployment. The agent calls n8nac to create, edit, and push workflows.
- **n8n-vet** is responsible for validation. The agent calls n8n-vet to validate workflow slices and paths.
- The agent decides when to call each tool and in what order. n8n-vet does not invoke n8nac operations.

n8n-vet uses `@n8n-as-code/transformer` as a **library dependency** for parsing `.ts` workflow files into AST form. This is a package-level dependency on the transformer, not a runtime integration with the n8nac tool itself.

### MCP tools (execution backend)

Used for all execution-backed validation:

- `test_workflow`: workflow execution with pin data (synchronous)
- `get_execution`: execution result inspection with node-name filtering and data truncation
- `prepare_test_pin_data`: pin data schema discovery (tiered: execution history, node type schemas, empty stubs)

MCP tools are required for execution-backed validation. If unavailable (n8n instance unreachable, MCP server not running), the system degrades to static-only mode. The system never fails hard because MCP is unavailable.

### Capability degradation

The system operates in progressively reduced modes depending on what is available:

| Available | Capabilities |
|-----------|-------------|
| Local files + `@n8n-as-code/transformer` | Full static analysis |
| + n8n MCP tools | + workflow execution, pin data discovery, execution inspection |

The diagnostic summary always reports which capabilities were available and which evidence layers were used, so the agent understands the basis for the result.

---

## 8. Diagnostic result model

The canonical output of every validation run is a structured JSON diagnostic summary. The summary must be compact enough for agent consumption without heavy context burn, and legible enough for a supervising human to follow.

### Required information

Every diagnostic summary must communicate:

| Field | Purpose |
|-------|---------|
| **Status** | Overall outcome: pass, fail, error, or skipped |
| **Target** | What was validated (slice, path, node set) |
| **Evidence basis** | What layer produced the findings (static, execution, or both) |
| **Executed path** | Which nodes ran and in what order (for execution-backed validation) |
| **Error information** | Classified error with node attribution, error type, and actionable message |
| **Node annotations** | Which nodes were validated, trusted, mocked, or skipped |
| **Guardrail actions** | Any scope adjustments, warnings, or refusals with explanations |

### Error classification

Errors are classified to help the agent decide its next action. Feasibility research into n8n's error hierarchy (`NodeApiError`, `ExpressionError`, `ExecutionCancelledError`) confirmed that the following general categories are structurally distinguishable at the error object level. The exact classification taxonomy and its mapping to n8n error types is a specification-level decision, but the system must at minimum distinguish:

- **Errors the agent can fix by editing the workflow** (structural wiring, broken expressions, data-flow problems)
- **Errors that require user or environmental intervention** (missing credentials, external service failures)
- **Errors outside the workflow domain entirely** (platform infrastructure, cancelled executions)

The classification must be stable enough for the agent to branch on programmatically. It is reported per-node, with attribution to the specific node that produced the error.

### What the summary excludes

- Raw node output data (large, rarely needed for agent decision-making)
- Full execution logs or transcripts
- Long lists of passing checks
- Surrounding code excerpts larger than the useful diagnostic context

If the agent needs raw data for a specific node, it can request it separately. The diagnostic summary is not a data dump.

---

## 9. Guardrail model

Guardrails are active product behaviors that steer validation toward higher-value, lower-cost patterns. They are not advisory messages; they are control decisions that shape what the system does.

### Guardrail actions

| Action | When | Effect |
|--------|------|--------|
| **Proceed** | Request is well-scoped and targets changed nodes | Normal validation |
| **Warn** | Request is valid but broader than needed | Validate with a warning in the result |
| **Narrow** | Request can be automatically reduced in scope | Validate a smaller target; report the narrowing |
| **Redirect** | Execution requested but static would suffice | Perform static analysis instead; explain why |
| **Refuse** | Request is demonstrably wasteful (identical rerun, no changes) | Do not validate; return explanation only |

Refusal is the strongest guardrail action and should be reserved for cases where the system has high confidence that the request would produce no new information. The preferred stance is visible narrowing or redirection — keeping the agent moving forward with reduced scope rather than blocking it outright.

### Evidence for guardrail decisions

Guardrail decisions are based on concrete evidence from the trust and change model:

- **Unchanged target**: no nodes in the requested target have changed since the last successful validation
- **Broad scope**: only a small fraction of the requested target has changed
- **Identical rerun**: same target, same fixtures, no changes
- **Static sufficiency**: the change is purely structural (expression or connection edit) and static analysis can catch the relevant failure modes

### Transparency requirements

Every guardrail action must be visible in the diagnostic summary with:

1. What was detected (the specific condition)
2. What the system did (the specific action taken)
3. How to override (the agent can always force a broader or execution-backed validation)

The system must never silently narrow, skip, or refuse without explanation.

---

## 10. Trust and change model

### Derived trust

Trust is derived from two sources of evidence:

1. **Prior successful validation**: a validation run that passed establishes trust for the validated nodes and boundaries
2. **Unchanged state**: nodes whose content has not changed since validation retain their trust

Trust does not require manually authored contracts. It is computed from validation history and change detection.

### Node-level change detection

The system computes change sets at node granularity by comparing two workflow snapshots:

- **Content-affecting changes** (trust-breaking): parameter changes, expression changes, connection changes, type version changes, credential changes
- **Cosmetic changes** (trust-preserving): position changes, metadata/notes changes, workflow name changes

Change detection uses node name as the stable identity key, consistent with n8n's own connection model and expression reference system.

### Trust invalidation

When a node's trust is invalidated:

- The node itself loses trust
- Invalidation propagates forward through connections to downstream nodes in the validated path
- Upstream nodes are not invalidated (their outputs have not changed)
- Trusted boundaries whose upstream node is in the invalidation set are also invalidated

This forward-only propagation limits the blast radius of changes.

### Trust persistence

Trust state is maintained locally, separate from n8nac's sync state. The system must persist enough local state to support trust reuse across validation runs, change-driven invalidation, and rerun assessment. At minimum this implies per-node content hashes, validation provenance, and fixture identity, but the exact persistence format and storage mechanism are specification-level decisions.

---

## 11. Failure model

The system must distinguish three categories of failure and surface them distinctly in the diagnostic result.

### Workflow validation failures

The validation ran and the workflow target failed. The agent should fix the workflow.

Examples: broken expression reference, data loss through replacement node, schema mismatch, execution error in a node.

### Tool and infrastructure failures

The validation could not be performed or completed due to problems outside the workflow itself.

Examples: n8n instance unreachable, execution timeout, push/deploy failure, malformed workflow file, pin data construction failure.

These must not be conflated with workflow errors. The agent cannot fix them by editing the workflow.

### Unavailable capability

The requested validation requires a capability that is not currently available.

Examples: execution-backed validation requested but no n8n instance configured, MCP tool needed but not available.

The system should degrade gracefully: offer what it can (e.g., static analysis instead of execution) and report what it cannot do and why.

### Why distinct failure categories matter

If tool failures are reported as workflow failures, the agent will waste cycles trying to fix code that is not broken. If unavailable capabilities are treated as errors, the system becomes brittle instead of degrading gracefully. Clean failure categorization is an architectural requirement, not a UX nicety.
