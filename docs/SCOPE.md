# Project Scope

## Purpose of this document

This document defines the practical scope of the project.

It answers a narrower question than the vision document: not just **why** this project exists, but **what problem space it is claiming**, **what outcomes it is responsible for**, and **what it explicitly does not try to become**.

This scope is intentionally strict. The project should remain focused on controlling validation behavior during agent-driven workflow development, not expand into a general-purpose testing or observability platform.

---

## In-scope problem

The project addresses the problem described in `VISION.md`: agents building n8n workflows waste significant time and tokens on broad, repetitive, low-signal validation loops. The project exists to improve that development loop by treating validation as a guardrailed control problem.

---

## Core claim

The project claims that validation for agent-built n8n workflows can be made substantially more efficient if it is treated as a **guardrailed control problem** rather than a generic "run more tests" problem. See `STRATEGY.md` for the evidence basis and named engineering patterns behind this claim.

More specifically, the project claims that it is possible to improve development efficiency by:

* keeping validation local to the workflow slice under development
* validating a path through that slice rather than an entire workflow by default
* reusing trusted boundaries instead of repeatedly re-proving them
* producing compact diagnostic summaries instead of verbose execution transcripts
* discouraging or skipping low-value reruns when they add little information

This is the project’s scope-defining claim.

---

## Primary objectives

See `PRD.md` sections 4 and 13 for product goals and success criteria. This document focuses on scope boundaries rather than restating objectives.

---

## In-scope capabilities

The project may include capabilities that support the objectives above, such as:

### Local-first validation workflow

* working from n8n-as-code as the source of truth
* treating n8n as a deployment/runtime surface
* supporting a compile+test model for execution-backed validation

### Localized validation targeting

* selecting a workflow slice as the main development focus
* validating one or a small number of paths through that slice
* avoiding full-workflow validation by default

### Trusted boundary reuse

* treating previously green-lit, unchanged regions as trusted context
* concentrating validation effort near modified graph regions
* reducing unnecessary revalidation of stable interfaces

### Selective execution shaping

* mocking expensive, external, or unstable nodes
* skipping irrelevant nodes or regions when appropriate
* narrowing validation effort to the part of the graph that matters for the current question

### Compact diagnostics

* summarizing what was validated
* reporting observed path information when relevant
* showing mocked, skipped, and trusted regions
* surfacing specific errors and warnings rather than long transcripts

### Guardrails on validation behavior

* discouraging broad or redundant validation behavior
* preventing low-value reruns when enough evidence exists to treat them as unnecessary
* shaping the validation loop toward bounded, high-value checks

These capabilities are in scope because they directly support the project’s stated outcomes.

---

## Explicitly out of scope

The project is not responsible for the following:

### Exhaustive workflow correctness

It does not promise broad proof that an entire workflow or workflow system is fully correct under all conditions.

### Five-nines style testing confidence

It is not an enterprise regression framework designed to maximize coverage or reliability guarantees across all paths.

### Full CI replacement

It is not a general CI system or a universal build/test/deploy platform.

### General workflow observability

It is not meant to become a logging, tracing, runtime analytics, or observability product for n8n workflows.

### Universal debugging and replay

It is not required to provide full replay, forking, checkpoint restoration, or arbitrary postmortem debugging of every execution scenario.

### Exhaustive edge-case testing during development

It is not trying to drive agents toward broad edge-case accumulation in the normal development loop.

### General-purpose LLM evaluation framework

It is not the universal place where all LLM or agent quality evaluation happens.

### Whole-system integration validation

It is not meant to guarantee that unrelated workflows or remote parts of the graph still behave correctly after every local change.

These exclusions are essential to keeping the project coherent.

---

## Target user and operating model

See `PRD.md` section 6 for the full user model. In brief: the agent is the direct consumer; the supervising human benefits from structured results but does not operate the tool directly. Validation is agent-initiated, not auto-triggered.

---

## Scope of validation responsibility

The project is responsible for helping answer questions like:

* Did the slice I just changed still behave correctly along its intended path?
* Did this change break a trusted boundary?
* Did validation exercise the route I expected?
* Is there a specific error or warning that explains why this slice is not yet working?
* Can a low-value rerun be avoided because nothing relevant changed or because the trusted context is still valid?

The project is **not** responsible for answering questions like:

* Is the entire workflow graph universally correct?
* Are all possible branches safe?
* Is every external integration healthy?
* Has the whole system been comprehensively regressed?

That distinction should guide both product design and implementation decisions.

---

## Scope of evidence

See `PRD.md` section 11. The key scope rule: evidence should reduce validation waste, not justify broader or noisier validation behavior.

---

## Anti-goals

The project should actively avoid drifting into these anti-goals:

### 1. Becoming a broad suite runner

If the default user behavior becomes “run everything,” the project has failed its core purpose.

### 2. Rewarding pass spam

If the output becomes a long list of successful checks with little diagnostic value, the project has become noisy rather than useful.

### 3. Forcing heavy manual metadata authoring everywhere

If using the tool requires manually describing every node or graph region in detail before any value is obtained, adoption cost will be too high.

### 4. Making validation logic harder to reason about than the workflow itself

If the control layer becomes more complex than the slice it is helping validate, it will create a new source of agent thrash.

### 5. Turning every change into a deployment-heavy ceremony

If the product encourages validation after every tiny edit without enough new information gained, it will amplify the cost structure it was meant to control.

---

## Design pressure that should remain visible

The following pressures from the project vision (see `VISION.md` core principles) should remain visible in every follow-on document:

* validation in n8n has real operational cost
* the whole workflow is usually the wrong default unit
* trusted unchanged boundaries are necessary for locality
* compact diagnostics are a product requirement, not a polish task
* guardrails are part of the value proposition
* broad validation behavior is a failure mode, not a neutral option

---

## Scope summary

In scope:

* controlling and improving validation behavior during agent-driven workflow development
* keeping validation local to slices and paths
* reusing trusted unchanged regions
* reducing low-value reruns
* returning compact, actionable diagnostics
* supporting faster convergence from spec to working workflow

Out of scope:

* exhaustive correctness
* broad regression guarantees
* general observability
* universal debugging/replay
* full CI replacement
* proving the entire graph every time a slice changes

---

## Final statement

This project should remain tightly focused on one practical promise:

> Help agents validate the workflow slice they are changing without wasting hours on broad, noisy, low-value validation loops.

If a proposed feature does not clearly support that promise, it is likely out of scope.
