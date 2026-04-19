# Feasibility Questions

## Purpose

This document identifies the main questions that should be researched before detailed specification and implementation planning.

These are not general brainstorming prompts. They are the concrete unknowns most likely to determine whether the product can deliver its promised behavior with acceptable complexity, reliability, and maintenance cost.

The goal is to answer:

> Can this product be built in a way that actually improves the agent development loop, without becoming more complex or expensive than the workflow validation problems it is trying to solve?

This document assumes the strategic decisions already made in:

* `VISION.md`
* `CONCEPTS.md`
* `SCOPE.md`
* `PRD.md`
* `TECH.md`

---

## 1. Static analysis feasibility

### 1.1 Expression reference coverage

How well can the product detect meaningful data flow mistakes using bounded, heuristic static analysis?

Research questions:

* What percentage of real expression references in our target workflows fall into a small set of analyzable patterns such as:

  * `$json.field`
  * `$('NodeName').first().json.field`
  * `$input.first().json.field`
* How often do real workflows rely on patterns that are not statically tractable, such as:

  * dynamic key access
  * arbitrary JavaScript in expressions
  * Code node-generated output with no stable inferred structure
* Is the bounded analysis sufficient to catch the most common and costly workflow wiring mistakes in agent-built graphs?

Why this matters:

* The product’s cheap validation layer depends on partial but useful static analysis.
* If the analyzable cases do not cover the dominant workflow patterns, the core value proposition weakens.

### 1.2 Upstream output-shape reasoning

Can the product reliably reason about whether downstream field references are compatible with upstream output shapes?

Research questions:

* What shape information is practically available from:

  * local workflow/node schemas
  * prior successful execution data
  * pin-data preparation schemas
  * sub-workflow boundaries
* How often is that shape information accurate enough to support useful warnings/errors?
* Can we identify node classes that are known to preserve shape vs replace shape vs transform shape unpredictably?

Why this matters:

* A core promised capability is catching high-value graph mistakes such as field references that no longer exist because a node changed or replaced the payload.

### 1.3 Data-loss-through-replacement detection

Can the product reliably detect the class of bugs where a replacement node (for example, an HTTP/API node) overwrites `$json`, causing downstream references to silently point at the wrong structure?

Research questions:

* Which n8n node types are effectively replacement nodes in practice?
* Can those node types be identified deterministically from schema/type metadata?
* Can a graph walker plus simple expression analysis catch this failure mode with acceptable false positives/negatives?

Why this matters:

* This is one of the highest-value bug classes the product aims to catch.

### 1.4 Local graph parsing and traversal

Can local workflow artifacts be parsed and traversed reliably enough to support slice/path reasoning without depending on live n8n state?

Research questions:

* How robust is `n8nac` as a dependency for parsing workflow files into usable graph structures?
* Is it more reliable to consume n8nac parsing capabilities, or should graph traversal be performed on normalized workflow JSON after conversion?
* Are `n8n-workflow` traversal utilities stable and lightweight enough to reuse, or should the product own its own graph walker?

Why this matters:

* Local-first graph analysis is foundational to the cheap validation path.

---

## 2. Execution-backed validation feasibility

### 2.1 Bounded execution reality

Can the product actually perform path/slice-oriented execution in a way that matches the product vision?

Research questions:

* How reliable is n8n’s `destinationNode` execution behavior in practice?
* Under what conditions does bounded execution succeed or fail?
* How does bounded execution interact with:

  * triggers
  * pin data
  * branching
  * sub-workflows
  * large workflows
* Is bounded execution available only through the REST API in practice, or can similar behavior be achieved through other stable surfaces?

Why this matters:

* The vision strongly prefers validating a path through a workflow slice, not the whole workflow.

### 2.2 Pin-data construction cost

Can fixture-backed or generated pin data be created cheaply enough to support normal development validation without creating a new source of agent thrash?

Research questions:

* How much manual or generated structure is required to build valid pin data for real workflows?
* How useful is `prepare_test_pin_data` in reducing that cost?
* Can a fixture-to-pin-data bridge be made simple and reliable?
* What classes of workflows become painful because of pin-data requirements?

Why this matters:

* If pin-data construction is too cumbersome, the product may simply shift validation cost rather than reduce it.

### 2.3 Execution backend split

What is the practical division of responsibility between REST API use, MCP use, and local dependency/library use?

Research questions:

* Which execution/inspection operations are best served by:

  * direct REST API calls
  * n8n MCP tools
  * n8nac-provided capabilities
* Is any one integration surface sufficient for the critical product behaviors, or is a hybrid backend unavoidable?
* What are the real operational tradeoffs in using MCP internally versus calling REST directly?

Why this matters:

* The product has already accepted that internal use of MCP is optional and capability-driven.
* This needs to be grounded in actual platform capability and reliability, not assumption.

### 2.4 Execution inspection quality

Can execution results be inspected narrowly enough to support compact diagnostics without forcing the agent to pull large execution logs?

Research questions:

* How effectively can execution data be filtered to:

  * specific nodes
  * specific outputs
  * error states
  * truncated item sets
* What information is always available versus inconsistently available?
* Is path reconstruction possible from the returned execution data alone?

Why this matters:

* Diagnostic compactness is part of the product promise.

---

## 3. Diagnostic summary feasibility

### 3.1 Minimum useful summary shape

What is the smallest structured result that still gives the agent enough information to act without re-reading specs or opening n8n execution history?

Research questions:

* What fields are essential in the canonical JSON summary?
* Which fields are optional but high-value?
* What level of detail is enough to identify the failed slice/path without dumping large payloads?

Why this matters:

* The diagnostic summary is the main product output.
* Overly minimal summaries will force further inspection; overly rich summaries will recreate the context-burn problem.

### 3.2 Path observation fidelity

How reliably can the product report which path actually executed?

Research questions:

* Can executed nodes be reconstructed accurately from run data?
* Can branch decisions be inferred clearly enough to explain why a specific route was taken?
* Are there workflow patterns where path reporting becomes ambiguous or expensive?

Why this matters:

* Path observation is one of the most valuable ways to reduce agent digging after a failed run.

### 3.3 Error extraction quality

Can the product consistently extract the true error context rather than just generic platform messages?

Research questions:

* What information is available at the failing node versus only in surrounding node inputs/outputs?
* Can generic n8n errors be enriched with enough local context to be useful?
* Can the product distinguish likely workflow wiring failures from runtime environmental failures?

Why this matters:

* The product must make normal failures easier to understand, not simply repackage unhelpful error strings.

---

## 4. Trusted-boundary feasibility

### 4.1 Derived trust model viability

Can trusted boundaries be derived from prior validation state in a way that is useful and safe enough for the product’s locality goals?

Research questions:

* What evidence is sufficient to mark a boundary as trusted?
* What kinds of changes should invalidate that trust?
* How durable is trust across:

  * local workflow edits
  * n8n sync/push cycles
  * fixture changes
  * path changes

Why this matters:

* The product has chosen derived trust over mandatory manual contracts.
* This only works if the invalidation model is credible.

### 4.2 Node-level change detection

Can the product compute changed slices accurately enough from local workflow snapshots?

Research questions:

* How feasible is node-level or edge-level diffing across workflow versions?
* Can relevant change categories be distinguished, such as:

  * node parameter change
  * expression change
  * connection change
  * position-only change
  * metadata-only change
* Is workflow-level hashing sufficient anywhere, or is node-level diffing required from the beginning?

Why this matters:

* Trusted-boundary reuse and rerun suppression depend on detecting what actually changed.

### 4.3 Boundary invalidation rules

What should break trust?

Research questions:

* Which changes are definitely trust-breaking?
* Which changes are safe to ignore?
* Can trust be invalidated conservatively without creating too many false revalidations?

Why this matters:

* Over-aggressive trust invalidation destroys locality gains.
* Over-permissive trust reuse risks false confidence.

---

## 5. Guardrail feasibility

### 5.1 Low-value rerun detection

Can the product identify when a requested validation is unlikely to add useful information?

Research questions:

* What signals are available to judge likely redundancy?
* Can validation requests be compared against:

  * unchanged target slices
  * prior validation state
  * repeated fixtures
  * identical observed paths
* Can this be done cheaply enough that rerun suppression does not itself become expensive?

Why this matters:

* Reducing redundant reruns is one of the product’s top stated goals.

### 5.2 Guardrail action selection

When the product decides a request is low-value, what kinds of actions are feasible and understandable?

Research questions:

* Can the tool reliably:

  * warn
  * narrow scope
  * redirect to a cheaper/static-only check
  * refuse
* Which of those actions are best supported by available evidence?
* What explanation must accompany those actions to keep the behavior understandable to the agent and supervising human?

Why this matters:

* Guardrails are part of the product identity, not an afterthought.

### 5.3 Happy-path default enforcement

How can the tool preserve happy-path bias without becoming overly rigid?

Research questions:

* What signals identify the intended/normal path for a slice?
* Can the tool default to happy-path validation while still allowing explicit broader requests?
* What would constitute overreach by the tool in trying to force happy-path scope?

Why this matters:

* Happy-path bias is central to keeping development validation cheap and focused.

---

## 6. Integration feasibility

### 6.1 n8nac dependency robustness

How stable and usable is n8nac as a product dependency rather than just a CLI tool?

Research questions:

* Which n8nac packages are intended to be imported programmatically?
* What parts of n8nac are stable enough to treat as dependency surfaces?
* Are there internal APIs the product should avoid depending on directly?

Why this matters:

* The product has chosen to be standalone but dependent on n8nac.

### 6.2 n8n API and MCP stability

How stable are the n8n execution and inspection surfaces the product would depend on?

Research questions:

* Which REST endpoints and MCP tools are stable enough for product use?
* Are there important capability gaps or version-specific behaviors that need to be accounted for?
* What fallback strategy is needed if a preferred capability surface is unavailable?

Why this matters:

* The product expects to mix static/local behavior with runtime-backed validation.

### 6.3 Authentication and environment model

How much environment complexity is involved in actually operating the tool in a real development repo?

Research questions:

* What credentials/configuration are required for:

  * local workflow analysis
  * n8n deployment/sync
  * execution-backed validation
  * REST access
  * MCP access
* How much of that can be discovered/reused from n8nac configuration?
* What environment setups are likely to create support burden or hidden failure modes?

Why this matters:

* Feasibility is not just whether the logic can be built, but whether the tool can be operated predictably in real development contexts.

---

## 7. Failure-mode feasibility

### 7.1 Tool-failure handling

Can the product cleanly distinguish workflow failures from tool/integration failures in practice?

Research questions:

* How often do expected failure modes arise from:

  * malformed workflow artifacts
  * unreachable n8n instances
  * bad authentication
  * push/deploy problems
  * pin-data construction problems
  * execution timeouts
* Can those be classified consistently into structured failure categories?

Why this matters:

* The product must not make failures harder to understand by conflating infrastructure/tool failures with workflow failures.

### 7.2 Timeout and scale behavior

How does the product behave on large workflows or slow execution paths?

Research questions:

* What are the practical timeout limits of each runtime surface?
* How do large graphs affect:

  * static analysis speed
  * partial execution reliability
  * execution-data retrieval size
  * diagnostic summarization cost
* Where are the likely performance cliffs?

Why this matters:

* The product’s value depends on staying cheaper and tighter than the unbounded agent behavior it is trying to replace.

---

## 8. Minimum viable proof points

Before moving into detailed implementation planning, research should establish whether the following core proofs are achievable.

### Proof 1

The product can statically catch a meaningful portion of real graph/dataflow mistakes in target workflows.

### Proof 2

The product can perform sufficiently bounded execution to validate a slice/path rather than always running the whole workflow.

### Proof 3

The product can produce a compact diagnostic summary that is materially more useful than raw n8n/n8nac execution output for agent iteration.

### Proof 4

The product can derive and reuse trust/locality information without requiring heavy manual metadata authoring.

### Proof 5

The product can suppress or redirect at least some low-value reruns without becoming opaque or expensive.

If these proofs cannot be demonstrated, the product should be reconsidered or narrowed.

---

## 9. Recommended research outputs

Research should ideally produce concrete artifacts, not just conclusions.

Recommended outputs:

* a corpus analysis of real workflow expression patterns
* a small static-analysis spike showing what bug classes can be caught
* an execution experiment showing whether bounded execution via REST behaves as needed
* a prototype diagnostic summary schema with examples from real failures
* a change-detection/trusted-boundary experiment on real workflow revisions
* a short recommendation on internal backend usage (REST vs MCP vs dependency surfaces)

These outputs will make the later spec work much sharper.

---

## 10. Final question

All research in this phase should stay anchored to one practical test:

> Will this capability materially reduce agent validation thrash in real workflow development, or does it add complexity without enough control value?

If a line of research does not clearly answer that question, it is likely outside the useful feasibility scope.
