# Vision

## One-line promise

**Install this, and your agent stops wasting hours inventing sloppy validation loops for the workflow graph it just built.**

## Summary

This project is a **guardrailed validation control tool** for agent-built n8n workflows.

It is not trying to be the ultimate testing framework, a full CI system, or a path to exhaustive workflow coverage. Its job is narrower and more practical: keep agent-driven workflow development **local, bounded, diagnostic, and cheap**.

The tool exists because agents are good at producing workflows, but they are also prone to wasting large amounts of time and tokens on low-value validation behavior:

* inventing ad hoc tests
* rerunning too much of the graph
* repeatedly deploying small changes to n8n without enough new information gained
* surfacing noisy results that force additional inspection work
* chasing failures outside the slice they were actually modifying

This project aims to replace that behavior with a validation loop that is intentionally constrained, focused on the part of the graph being changed, and optimized for fast convergence from specification to working workflow.

---

## Problem

n8n is a powerful workflow runtime, but it is not the right place to perform granular, iterative, agent-friendly workflow development.

For this project, **n8n is treated as a deployment and execution surface**, not the primary authoring environment. The source of truth lives locally in an n8n-as-code workflow.

That creates a development pattern with real cost:

* local edits are cheap
* deployment/sync to n8n is comparatively expensive
* execution-based validation is expensive enough that it should not be treated as a trivial inner loop action

Without strong guidance, agents respond badly to that environment. They tend to:

* validate too often
* validate too broadly
* invent redundant or low-signal tests
* rerun validations that add little information
* spend excessive time inspecting latest-run data to understand what broke

The result is a slow, sloppy development loop where validation itself becomes a major source of waste.

---

## Vision

The vision is a tool that makes agent-driven workflow validation behave like a disciplined engineering loop rather than improvised trial and error.

The tool should:

* keep validation focused on the **workflow slice** being changed
* usually validate a **path through that slice**, not an entire workflow
* treat previously validated, unchanged boundaries as **trusted interfaces**
* prevent or skip low-value reruns when they add little new information
* return compact, actionable diagnostics instead of verbose test transcripts
* make it unnecessary for the agent to dig through n8n execution data in most normal failure cases

In short, the tool should concentrate validation effort where it matters and reduce the amount of graph, history, and runtime noise an agent needs to reason about.

---

## What this project is

This project is:

* a **validation control layer** for agent-driven n8n workflow development
* a **guardrailed development aid** that shapes how agents validate workflows
* a way to preserve **locality** in a graph-based system by using trusted boundaries between workflow regions
* a mechanism for producing **compact diagnostic summaries** about what was validated, what path ran, what was mocked or skipped, and what errors or warnings matter

This project is not just there to say pass or fail. It is there to ensure that the validation loop itself stays efficient and informative.

For explicit scope boundaries and exclusions, see `SCOPE.md`. For concrete product requirements and success criteria, see `PRD.md`.

---

## Core principles

These principles express the product's philosophy. For the engineering strategy, named patterns, and locked heuristics that implement them, see `STRATEGY.md`.

### 1. Local-first development

Workflows are authored locally and versioned locally. n8n is the deployment/runtime target, not the center of development.

### 2. Validation should be bounded

The default validation target is not an entire workflow. It is the smallest useful path through the workflow slice that changed.

### 3. Validation should stay local

Agents should be validating the thing they are working on, not incidentally re-proving unrelated regions of the graph.

### 4. Trusted boundaries matter

Previously green-lit, unchanged parts of the graph should be reusable as trusted interfaces. The more stable those boundaries are, the more local validation can remain.

### 5. Diagnostic output beats pass spam

The tool should not flood the agent with verbose logs or long lists of passing checks. It should summarize what matters:

* which slice/path was validated
* which path actually executed, when relevant
* what was mocked, skipped, or trusted
* the errors and warnings that matter for the current change

### 6. Guardrails are a feature, not an afterthought

The tool should actively constrain wasteful validation behavior rather than merely documenting better practices.

### 7. Development speed matters more than exhaustive certainty

The objective is faster convergence from spec to working workflow with lower token and time cost, not broad proof that nothing anywhere could have broken.

---

## Product stance

This tool is intentionally opinionated.

It should prefer:

* focused validation over broad validation
* bounded batches over micro-reruns and over entangled large reruns
* trusted interfaces over repeated re-validation of unchanged graph regions
* compact diagnostics over verbose logs
* high-value signals over exhaustive activity

In other words, the product is not neutral about validation behavior. It exists to make that behavior better.

---

## Closing statement

This project should be remembered as the thing you install when you want an agent to stop thrashing on workflow validation.

It does not promise perfect proof. It promises disciplined, local, low-waste validation that helps the agent fix the graph it just built without burning hours on sloppy loops.
