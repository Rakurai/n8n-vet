# Product Requirements Document

## 1. Purpose

This document defines the product requirements for a guardrailed validation control tool for agent-built n8n workflows.

It translates the project vision into concrete product behavior without prematurely committing to a specific implementation.

The product is not meant to be a broad testing framework or a universal workflow QA system. Its purpose is to improve the development loop for agent-built workflows by keeping validation **local, bounded, diagnostic, and cheap**.

---

## 2. Product summary

The product is a validation control layer used during local, agent-driven workflow development.

It constrains and improves agent validation behavior by:

* focusing validation on the workflow slice under development
* usually validating one or a small number of meaningful paths through that slice
* reusing trusted unchanged boundaries
* reducing redundant or low-value reruns
* returning compact, structured diagnostic summaries rather than verbose execution transcripts

The agent is the sole direct consumer of the product's tool interface. The supervising human benefits from the structured results but does not operate the tool directly.

The intended effect is faster convergence from specification to working workflow with lower token and time cost.

---

## 3. Problem statement

The product addresses the agent validation thrash problem described in `VISION.md`: agents building n8n workflows waste significant time and tokens on broad, repetitive, low-signal validation loops. The product exists to constrain and improve that validation behavior.

---

## 4. Goals

The product must optimize for the following goals.

### 4.1 Lower validation cost

The product should reduce the token, time, and operational cost of validation during agent-driven development.

### 4.2 Reduce redundant reruns

The product should reduce validation runs that add little new information relative to their cost.

### 4.3 Preserve validation locality

The product should keep validation effort and resulting diagnostics close to the workflow slice under development.

### 4.4 Improve diagnostic usefulness

The product should provide compact, actionable summaries that help an agent or supervising human understand what was validated, what path executed, and what failed or is suspicious.

### 4.5 Speed up convergence

The product should reduce the number of development cycles needed to move from intended change to a working validated slice.

---

## 5. Non-goals

See `SCOPE.md` for explicit exclusions and scope boundaries. In short: the product does not provide exhaustive correctness guarantees, full CI, general observability, universal debugging, or broad LLM evaluation.

---

## 6. Users and usage model

### 6.1 Direct consumer

The direct consumer of the product is the **coding agent**.

The agent:

* edits local workflow definitions
* initiates validation by calling the tool
* consumes structured diagnostic results
* decides what to fix next based on those results

The product's tool interface is designed exclusively for agent consumption. Outputs are optimized for structured, machine-readable use.

### 6.2 Supervising stakeholder

The **human developer or engineer** supervising agent-driven workflow development is the primary stakeholder and beneficiary.

The human:

* oversees the agent's development loop
* may read diagnostic summaries to understand what was validated
* benefits from the agent's improved validation behavior

The human does not directly operate the tool as a normal part of the workflow. Human-readable interpretation of results is a secondary, downstream concern.

### 6.3 Product implication

The product optimizes for one direct consumer:

* the agent needs structured, bounded, machine-usable outputs with stable fields and explicit scope metadata

Human legibility of those outputs is desirable but secondary. It should not constrain the design of the agent-facing interface.

---

## 7. Product principles

The product's core philosophy is defined in `VISION.md`. The engineering strategy, evidence basis, and named patterns are defined in `STRATEGY.md`. The following behavioral principles translate that philosophy into product requirements:

### 7.1 Bounded validation

The product must prefer validating a workflow slice and usually a path through that slice rather than an entire workflow.

### 7.2 Guardrails by default

The product must actively constrain wasteful validation behavior rather than merely document best practices.

### 7.3 Diagnostic compactness

The product must prefer compact summaries over verbose logs or long lists of passing checks.

### 7.4 Happy-path bias

Happy-path validation is the default mode. The product validates the intended, normal execution route through a slice unless the agent explicitly requests otherwise.

The product does not proactively expand validation scope into edge cases or alternative branches. Non-happy-path validation may be supported, but it is not the default behavior and should not be encouraged as part of the normal development loop.

---

## 8. Operational model and functional requirements

The following subsections define how the product operates and what behaviors it must support.

### 8.0.1 Validation initiation

Validation is initiated by the agent calling the tool. The product does not auto-trigger validation runs, watch for file changes, or schedule validation autonomously.

The agent specifies a bounded validation target. The tool performs validation against that target and returns a structured diagnostic summary.

### 8.0.2 Validation layers

The product uses two validation layers with different cost profiles:

* **Static analysis (cheap/local)**: structural inspection, reference tracing, and boundary checking performed against local workflow artifacts. Does not require a running n8n instance. This is the preferred default layer.
* **Execution-backed validation (expensive/runtime)**: mocked or bounded execution against an n8n instance, followed by inspection of execution results. Used when runtime evidence is needed that static analysis cannot provide.

A validation run may use either layer or both. The diagnostic result must indicate what kind of evidence was used, so the agent and supervising human can understand the basis for the reported outcome.

### 8.0.3 Guardrail behavior

When the product determines that a requested validation run is likely low-value, redundant, or wastefully broad, it may **warn, narrow, redirect, or refuse** the request depending on the available evidence and confidence level.

When it does so, it must explain the decision in the structured result. The agent must always be able to understand what action the tool took and why.

---

## 8.1 Local workflow-centered operation

The product must operate against local workflow development artifacts rather than assuming the n8n editor is the primary authoring surface.

The product must support the concept that execution-backed validation is a compile+test step with real cost.

### Acceptance intent

* the product can be used in a local workflow repository
* the product does not require workflow authoring to happen in the n8n editor
* the product’s behavior reflects that deployment/execution is not free

---

## 8.2 Validation target selection

The product must support selecting a bounded validation target.

A validation target should usually correspond to:

* a workflow slice
* a path through a workflow slice
* a trusted boundary or interface relevant to the current change

The product must not assume that the whole workflow is the default validation target.

### Acceptance intent

* the product can express validation against less than the whole workflow
* the product’s normal flow does not force whole-workflow validation
* the product terminology and outputs identify what target was actually validated

---

## 8.3 Path-aware validation behavior

The product must support path-oriented validation within a slice.

The product should be able to communicate, when relevant:

* the intended path
* the observed path
* when the observed path differs from what the validation target implied

### Acceptance intent

* validation results can identify the relevant path or route taken
* the product can surface path mismatches as useful diagnostics

---

## 8.4 Trusted boundary reuse

The product must support reusing prior validation confidence for unchanged boundaries or regions.

This may be implemented through explicit contracts, derived trust from prior validation, cached validation state, or another mechanism, but the product behavior must preserve the following principle:

> unchanged, previously validated regions should not need to be broadly revalidated unless there is evidence they are affected.

### Acceptance intent

* the product can designate some parts of the graph as trusted for the current validation question
* the product can communicate when trust was reused
* the product can keep validation focused on the changed slice because of that trust

---

## 8.5 Mocking and skipping support

The product must support narrowing validation effort by distinguishing between:

* nodes or regions that are genuinely being validated
* nodes whose behavior is mocked or substituted
* nodes or regions that are skipped because they are outside the useful scope
* nodes or regions treated as trusted context

### Acceptance intent

* a validation result can state what was mocked, skipped, or trusted
* the product can support deterministic validation by avoiding unnecessary live behavior
* the product can isolate the slice under development from unrelated cost or noise

---

## 8.6 Diagnostic summary output

The product must return a compact diagnostic summary for each validation run.

The summary must be optimized to help the agent answer:

* what was validated?
* what path executed?
* what was mocked, skipped, or trusted?
* what evidence layer was used (static, execution-backed, or both)?
* what errors matter?
* what warnings indicate incomplete or suspicious validation?

The product must not rely on long raw transcripts or pass spam as its primary output.

### Acceptance intent

* routine validation results are understandable without opening large run logs
* summaries are compact enough for agent consumption without heavy context burn
* summaries contain actionable error/warning information

---

## 8.7 Low-value rerun suppression

The product must discourage, suppress, skip, or redirect low-value reruns when there is enough evidence that they add little information.

Validation cost should remain proportional to the new information gained. When the product determines a requested run is likely redundant or low-yield, it may warn, narrow, redirect, or refuse the request. When it does so, it must explain the decision in the structured result.

### Acceptance intent

* the product does not default to broad reruns after every change
* the product can identify when a requested run is likely redundant or low-yield
* when the product narrows, redirects, or refuses a request, the structured result explains why
* the product encourages bounded batches of changes and meaningful validation steps rather than micro-rerun loops

---

## 8.8 Guardrailed agent experience

The product must make wasteful validation behavior harder by default.

This includes product-level guardrails such as:

* discouraging "validate everything" as a default behavior
* shaping the agent toward bounded validation targets
* making the scope of a requested run explicit in the result
* communicating when trust or prior validation evidence was reused
* explaining when and why a request was narrowed, redirected, or refused

### Acceptance intent

* the default interaction model is not broad suite execution
* the product surface reinforces bounded validation as the normal behavior
* when the product adjusts a request, the structured result explains the adjustment and its reason
* the agent can distinguish between "validation passed," "validation failed," and "validation was not performed (with reason)"

---

## 8.9 Supervisable behavior

The product must keep its validation decisions understandable to both the consuming agent and a supervising human.

If the product narrows, skips, trusts, or suppresses part of a validation run, that choice must be visible in the resulting diagnostics.

### Acceptance intent

* the structured result contains enough information for the agent to act without further inspection
* a supervising human reading the result can understand why a run did not touch the whole graph
* the role of trusted, skipped, and mocked regions is explicit in the result
* the product does not behave like an opaque planner that silently hides validation choices

---

## 9. Output requirements

The product’s normal output must be compact and structured.

At minimum, a useful validation result should be able to represent:

* validation target
* workflow slice or path validated
* observed path, when relevant
* trusted regions or boundaries reused
* mocked regions or nodes
* skipped regions or nodes
* errors
* warnings

The product should avoid outputs dominated by:

* large raw execution dumps
* surrounding code excerpts that are larger than the useful diagnostic context
* long lists of passing checks with little decision value

---

## 10. Behavioral requirements

The product should shape the development loop toward the following behavior pattern:

1. Make a meaningful local batch of edits
2. Validate the relevant workflow slice
3. Usually validate one path through that slice
4. Reuse trusted unchanged context
5. Get a compact diagnostic summary
6. Fix the local issue without re-proving unrelated graph regions

The product should actively resist these patterns:

* validating after every tiny edit
* validating the entire workflow by habit
* rerunning the same effective validation repeatedly
* requiring routine manual inspection of n8n execution history to understand normal failures

---

## 11. Evidence requirements

The product may use any combination of the following evidence sources if they support the product goals:

* local workflow structure
* prior validation state
* trusted boundaries (explicit or derived)
* mocked execution results
* observed path information
* graph metadata

However, evidence use must satisfy this product rule:

> Evidence should reduce validation waste and improve diagnostics, not justify broader or noisier validation behavior.

---

## 12. Quality requirements

### 12.1 Predictability

The product should behave predictably enough that the agent can anticipate how validation scope is being chosen, and a supervising human can understand it from the result.

### 12.2 Legibility

The product should present validation outcomes in a way that minimizes follow-up inspection work.

### 12.3 Efficiency

The product should reduce the average cost of reaching a working workflow slice.

### 12.4 Locality

The product should preserve the connection between the modified slice and the diagnostics returned.

### 12.5 Restraint

The product should not encourage growth toward a broad, ever-expanding suite model as the default mode of operation.

---

## 13. Success criteria

The product is successful if, in normal agent-driven workflow development, it leads to:

* lower token and time cost for validation
* fewer redundant reruns
* fewer broad whole-workflow validations during local development
* faster convergence from spec to working slice
* fewer cases where ordinary debugging requires opening raw n8n run details

The product is not considered successful merely because it can execute many validations or because it accumulates a large set of test artifacts.

---

## 14. Anti-requirements

The product must avoid the following outcomes:

### 14.1 Becoming a broad suite runner

It must not normalize “run everything” as the primary user path.

### 14.2 Becoming verbose by default

It must not require long log reading for normal interpretation of a result.

### 14.3 Making validation metadata heavier than the workflow change

It must not demand so much manual setup that it creates a new source of thrash.

### 14.4 Hiding its own decisions

It must not silently narrow, skip, or trust regions in a way that obscures why the reported result should be believed.

### 14.5 Shifting cost instead of reducing it

It must not reduce one kind of validation waste only by introducing a different but equally expensive control burden.

---

## 15. Tool failure handling

When a validation run cannot be completed, the product must return a clear, structured failure result.

The failure result must distinguish between:

* **workflow validation failures** — the validation ran but the workflow target failed
* **tool/infrastructure failures** — the validation could not be performed (e.g., n8n unreachable, malformed workflow, pin data construction failed, execution timeout)
* **unavailable capability** — the requested validation requires a capability not currently available (e.g., execution-backed validation requested but no n8n instance configured)

Failures must be surfaced compactly and diagnostically, not swallowed or conflated with workflow errors.

---

## 16. Final requirement statement

The product must fulfill this practical promise:

> Give agent-built n8n workflows a validation loop that is focused enough to stay cheap, informative enough to drive the next fix, and constrained enough to prevent agents from wasting hours on sloppy graph validation behavior.
