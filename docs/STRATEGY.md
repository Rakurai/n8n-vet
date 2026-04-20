# Strategy

## Purpose

This document defines the validation strategy that the product encodes.

It sits between the product definition (`VISION.md`, `PRD.md`, `SCOPE.md`) and the implementation specifications. It answers two questions:

> What validation processes should this tool encode, and why are those the right ones?
>
> What named engineering patterns, algorithms, and heuristics should implementations follow?

The project is not building a generic testing framework. It is building a **guardrailed validation control tool** for agent-built n8n workflows. The tool is opinionated about what kinds of validation are useful, what kinds are wasteful, and how effort should be concentrated.

This document records those opinions with their basis, then specifies the concrete patterns and heuristics that translate them into implementable behavior. Later specifications should align to the principles and patterns described here.

---

## Strategic thesis

**Run less, but select and explain better.**

The tool should prefer the smallest useful validation step that is expected to produce meaningful new information relative to its cost.

---

## Strategic problem

Agents building n8n workflows tend to validate badly unless constrained.

Common failure modes:

* validating too often after tiny edits
* validating too broadly relative to what changed
* inventing ad hoc tests and reruns
* spending execution cost where static reasoning would have been sufficient
* rerunning validations that do not exercise the changed slice
* surfacing outputs that are too noisy to guide the next fix

The result is **agent thrash**: repeated, expensive, low-signal validation loops that slow convergence instead of improving it. See `VISION.md` and `CONCEPTS.md` for the full problem description.

The strategy of this product is to replace that behavior with a bounded, local, evidence-aware validation process.

---

## Strategic principles

### 1. Validation should be change-based

The default reason to validate is that something changed. Validation should begin from the changed slice and expand only as much as needed to answer the current development question. The product should not default to broad retesting of unchanged graph regions.

This principle has the strongest direct support in the strategy. Industrial work on regression test selection (RTS) and test impact analysis (TIA) demonstrates that change-based selection preserves a high proportion of defect-detection value while drastically reducing execution time and time-to-signal. One industrial study reported detecting 90% of failed builds in 2% of test execution time [R4]. Meta's predictive test selection reduced total testing infrastructure cost by approximately a factor of two while still reporting more than 95% of individual test failures and more than 99.9% of faulty changes [R7].

**Implication.** The product should prefer changed-node detection, slice computation from changes, path validation through changed slices, and reuse of previously validated unchanged boundaries. It should avoid whole-workflow validation and retest-all behavior as defaults.

---

### 2. Validation should be cost-aware

Validation is not free. In this environment:

* local static analysis is cheap
* deployment and sync to n8n have real cost
* execution-backed validation is more expensive than static analysis
* whole-workflow execution is more expensive than bounded execution
* repeated reruns are often expensive without adding new information

Google's risk-driven testing guidance frames testing effort as a matter of maximizing return rather than treating all tests equally [R2]. A validation step should run only when its expected informational value justifies its cost.

**Implication.** The product should explicitly consider whether the target changed, whether the run is broader than necessary, whether static analysis can answer the question cheaply, and whether a previous result still applies. This is why guardrails are part of the product identity.

---

### 3. Validation should preserve locality

Validation effort and diagnostics should stay close to the slice under development.

Locality reduces context burn, debugging effort, accidental revalidation of unrelated graph regions, and the temptation to inspect the whole latest n8n execution log just to understand a local issue. This follows from the practical lessons behind change-based testing and interface-level testing: broad tests are expensive, noisy, and harder to interpret, while narrower validation produces more actionable signals [R1].

**Implication.** The product should structure validation around workflow slices as the change unit, workflow paths as the validation unit, and trusted boundaries that let the tool stop re-proving unchanged context.

---

### 4. Static analysis is the first-class cheap layer

Static analysis is the cheapest evidence source available and should be treated as a first-class layer, not an optional extra.

Static analysis is especially valuable for:

* broken references
* data-loss-through-replacement patterns
* schema and parameter problems
* obvious contract incompatibilities
* structural validation of changed slices

This is consistent with the testing-pyramid style of test structuring and with cost-aware engineering practice: cheap checks should carry as much of the normal development load as they can, with more expensive validation reserved for what cheaper methods cannot answer [R1] [R2].

**Strategic stance.** Static analysis does not need to prove graph correctness. It needs to catch a useful portion of meaningful structural mistakes cheaply.

**Implication.** The product should run static analysis by default, prefer static-only validation when sufficient, and escalate to execution only when runtime evidence is needed.

---

### 5. Testing is a separate step

Execution-backed testing is a separate operation from validation. It is justified when runtime behavior matters:

* opaque or shape-unknown nodes
* runtime-only branch behavior
* sub-workflow and output boundary confirmation
* LLM and agent outputs
* actual execution failures that static analysis cannot prove or disprove

**Strategic stance.** Execution-backed testing should be treated as a **compile+test step**, not as a cheap default loop. See `CONCEPTS.md` for the definition.

**Implication.** The product provides a separate `test` tool for execution. It should prefer bounded execution over whole-workflow execution, mocked or pinned execution over live external behavior where possible, and static pre-flight checks before paying execution cost.

**v0.1.0 execution scoping.** Execution is scoped through pin data placement: placing pin data at trusted boundaries prevents those nodes from re-executing, effectively limiting execution to the unpinned (changed) region of the graph. The MCP `test_workflow` tool is the sole execution trigger; it initiates a full workflow run whose effective scope is controlled by which nodes carry pinned data.

---

### 6. Whole-workflow validation should be rare

Whole-workflow validation has a role, but a limited one:

* smoke checks
* broad sanity checks
* situations where the target genuinely spans the entire workflow

It is not the normal validation unit.

Google's testing guidance explicitly argues against piling on end-to-end tests and recommends a pyramid shape with relatively few broad tests [R1]. The widely cited 70/20/10 rule-of-thumb for unit/integration/end-to-end tests is a first approximation. The exact ratios differ by context, but the shared lesson is clear: broad end-to-end validation is valuable, but it should not dominate the development loop.

**Implication.** The tool should discourage workflow-wide validation as a habitual default, warn when the requested target is broad relative to the change, and prefer narrowing and redirection over broad execution.

---

### 7. Trusted boundaries are the main locality mechanism

The product cannot remain local if every run has to re-prove the entire graph behind the current slice.

The answer is **trusted boundaries**. A trusted boundary is prior evidence that an unchanged region can be treated as stable enough for the current validation question. See `CONCEPTS.md` for the full definition.

The broader principle of interface-level validation is well supported by contract-testing literature [R6]. Consumer-driven contract testing demonstrates that syntactic compatibility can be ensured through isolated test execution without requiring broad system-level revalidation. This product's specific choice to derive trusted boundaries from prior validation evidence is a local design extension of that principle.

**Strategic stance.** Trusted boundaries should be primarily **derived** from prior validation evidence, not dependent on heavy manual contract authoring.

**Implication.** The product should record prior successful validation, invalidate trust when relevant content changes, reuse trust to avoid redundant validation, and prefer natural boundaries such as sub-workflow boundaries and stable graph stages.

---

### 8. Diagnostics should optimize for next action

The product's main output is not a test transcript. It is a structured diagnostic summary that helps the agent decide what to do next.

A good result gives enough information to act without reopening the test spec, graph, or full execution log in most ordinary cases.

**Diagnostics should answer:** what was validated, what path ran, what was trusted/mocked/skipped/validated, what failed and where, what kind of problem it is, and what warnings limit confidence in the result.

**Diagnostics should avoid:** pass spam, raw data dumps, verbose execution transcripts, and surrounding code larger than the useful context.

**Implication.** The product should convert evidence into a compact, decision-oriented result. See `PRD.md` section 8.6 for the formal requirement.

---

### 9. Guardrails should optimize information gain

The product should not decide purely from target size. It should decide from **expected information gain relative to cost**.

A small validation request can be low-value if it adds nothing new. A somewhat broader request can be justified if it is the smallest practical way to answer the current question.

Evidence the guardrails should consider:

* what changed
* what is already trusted
* whether the requested run duplicates a prior one
* whether the changed slice is exercised by the requested path
* whether static analysis can answer the question without runtime cost

**Implication.** The tool should be able to warn, narrow, or refuse. Refusal should be reserved for high-confidence low-value cases (including test-refusal when execution is unnecessary). Visible narrowing is preferred when possible.

---

### 10. Reruns should be treated skeptically

A rerun is not valuable just because a previous run failed.

The product should actively ask:

* did the changed slice actually execute?
* did the fixture or input change?
* did the trusted context change?
* is the failure likely infrastructural, external, or unrelated to the current change?

Google's flaky-test research reports a continual flaky-result rate of approximately 1.5% of all test runs and documents the substantial debugging cost this creates [R3]. The DeFlaker project demonstrates a key rule: a newly failing test that did not execute changed code is strong evidence of flakiness or irrelevance [R5].

**Strategic stance.** The tool should not default to "rerun the same validation" as the next move.

**Implication.** The product should suppress, redirect, or explain low-value reruns, especially when nothing relevant changed, the failing path never touched the changed slice, or the failure is clearly external.

---

### 11. Happy-path validation is the default

The normal development loop should validate the intended, meaningful path through the changed slice — the path most likely to answer "did the thing I just changed still work the way I meant it to?"

The default to happy-path validation is primarily a product policy choice, chosen because it aligns with the broader evidence favoring narrower, high-value inner-loop checks.

**Strategic stance.** Happy-path validation is the default mode, not the only mode.

**Implication.** The product should default to the primary, non-error route through the slice, avoid proactively widening into edge cases, and allow broader or alternate path validation when explicitly requested.

---

### 12. Opaque boundaries require escalation

Some workflow regions cannot be meaningfully reasoned about statically:

* Code nodes
* custom or community nodes with poor schema visibility
* nodes whose outputs are too dynamic to reason about locally

**Strategic stance.** The tool should be honest about where static confidence ends.

**Implication.** When static analysis crosses an opaque boundary, the product should report reduced confidence, warn about the opaque boundary, and recommend execution-backed validation if the changed slice depends on runtime evidence beyond that point. The strategy is not to pretend unknowns are known.

---

### 13. Useful before clever

Advanced strategies exist in the wider testing literature: learned test prioritization, mutation-based calibration, property-based testing, metamorphic testing. More advanced approaches can outperform simple heuristics in mature environments with large historical datasets, but that is not the starting condition for this product.

**Strategic stance.** The initial product should prefer simple, explainable, evidence-backed heuristics over sophisticated optimization mechanisms that require large amounts of data or create opaque behavior.

---

## Named engineering patterns

The strategic principles above are grounded in recognized software-engineering patterns. This section names those patterns explicitly so that implementation has concrete anchors rather than abstract philosophy.

These are not adopted literally from code-level testing. They are the closest proven templates, adapted to the workflow-graph domain.

### Regression Test Selection / Test Impact Analysis (RTS/TIA)

This is the primary parent pattern for the tool's validation-targeting behavior.

The established idea: select only the tests affected by a change instead of retesting everything [R4] [R7] [R8].

The workflow adaptation: compute the set of changed nodes, propagate to find the affected slice, and validate paths through that slice. See "Validation target selection" in locked heuristics below.

**Applies to:** principles 1, 3, 6.

### Additional Greedy Prioritization

When more than one candidate path or slice exists, the product needs a principled way to order them. "Additional greedy" is one of the most studied approaches in test-case prioritization: at each step, prefer the next item that covers the most new uncovered elements, then update what remains uncovered [R9].

The workflow adaptation: instead of code-coverage elements, score paths by uncovered changed nodes, untrusted boundaries, opaque nodes, and previously unexercised branches. See "Path prioritization" in locked heuristics below.

**Applies to:** principles 1, 9.

### DeFlaker-style changed-code relevance

DeFlaker's core rule: if a newly failing test did not execute changed code, treat it as likely flaky or irrelevant rather than blaming the change [R5].

The workflow adaptation: before encouraging a rerun or escalating blame, determine whether the failing execution path actually touched the changed slice. If not, downgrade the result. See "Rerun suppression" in locked heuristics below.

**Applies to:** principle 10.

### Consumer-Driven Contract Testing (CDCT)

The pattern behind trusted boundaries: validate interface expectations in isolation, then reuse that evidence to avoid broad end-to-end revalidation [R6].

The workflow adaptation: use isolated interface checks at stage boundaries within a workflow, record successful validation, and reuse that trust to preserve locality. This product's specific choice to derive trust state from prior validation is a local extension of the CDCT principle, not a literal adoption of Pact-style tooling.

In v1, the CDCT pattern applies to intra-workflow boundaries — stable graph stages and trusted regions within a single workflow. Cross-workflow boundaries (sub-workflow call nodes) are treated as opaque in v1; the extension of CDCT to sub-workflow interfaces is deferred.

**Applies to:** principle 7.

### Testing Pyramid

Not an algorithm, but a governing structural pattern. The validation mix should follow the pyramid shape: many cheap static/slice checks, fewer bounded execution checks, very few whole-workflow smoke checks [R1].

**Applies to:** principles 4, 5, 6.

---

## Locked heuristics

This section defines the concrete heuristics that translate the strategic principles and named patterns into implementable behavior. These are locked as the product's starting position. Exact thresholds and weights are calibratable defaults, not research-backed constants.

### Validation target selection

Adapted from RTS/TIA. This is the algorithmic backbone of the product.

1. Compute the set of changed nodes and edges since the last validation.
2. Forward-propagate through consumers until a trusted boundary or workflow exit.
3. Backward-propagate only to the nearest trigger or trusted boundary to establish input context.
4. The result is the default validation slice.

The agent may override or refine the slice. The product should not silently expand beyond it.

### Path prioritization

Adapted from additional greedy prioritization. Used when a slice contains multiple candidate paths.

Score each candidate path by newly covered validation value:

* high weight: changed opaque or shape-replacing nodes not yet validated
* high weight: crossing untrusted boundaries not yet exercised
* medium weight: changed branching logic
* medium weight: paths with prior failures
* negative weight: estimated execution cost
* negative weight: overlap with already-validated coverage

Select the highest-value path first. If more than one path is justified, update covered elements after each selection and repeat.

### Rerun suppression

Adapted from DeFlaker. A rerun is classified as low-value when **all** of the following hold:

* same effective target as a prior run
* same fixture/input hash
* same trusted state (no relevant change since last run)
* the previous failing path did not touch the changed slice, **or** the failure class is clearly external/infrastructural

When a rerun is low-value, the product should explain why and redirect rather than silently execute.

### Static-execution escalation

Derived from the testing pyramid and cost-awareness principles. Defines when the development workflow should proceed from validation to testing.

**Static-only (`validate`) is sufficient when:**

* all changed nodes are structurally analyzable
* no changed node is opaque
* no changed node is a shape-replacing risk with downstream expression dependence
* no boundary or output contract changed in a way requiring runtime evidence

**Testing (`test`) is warranted when any of these hold:**

* changed opaque node (Code node, community node with no schema)
* changed shape-replacing node with downstream shape sensitivity
* sub-workflow boundary change
* path ambiguity that static analysis cannot disambiguate
* LLM/agent output validation requested

When an agent calls `test` but none of these conditions hold, the test-refusal guardrail prevents unnecessary execution cost by recommending `validate` instead.

### Guardrail action order

When a guardrail triggers, the product should prefer actions in this order:

1. **Narrow** to the smallest affected slice
2. **Warn** when a broad request is still reasonable but carries cost
3. **Refuse** on high-confidence redundant or no-information requests, or when `test` is called but all changes are structurally analyzable (test-refusal)

Narrowing is first because the largest savings often come from reducing scope. Refusal includes the test-refusal guardrail, which prevents unnecessary execution cost by recommending `validate` when no escalation triggers are present.

---

## Evidence basis

The strategic principles and named patterns draw on different levels of evidence. This section is explicit about what is strongly supported, what is a reasonable extrapolation, and what is product judgment requiring calibration.

### Strongly supported

These principles have direct support from industrial testing research and practice:

| Principle | Basis |
|---|---|
| Change-based validation (1) | Industrial TIA and RTS [R4] [R8]. Meta predictive test selection [R7]. |
| Cost-aware validation (2) | Google risk-driven testing guidance [R2]. Cost/value framing in TIA literature. |
| Whole-workflow validation is rare (6) | Google's guidance against end-to-end test accumulation [R1]. Testing-pyramid principle. |
| Skepticism toward reruns (10) | Google flaky-test research [R3]. DeFlaker's changed-code coverage rule [R5]. |
| Boundary/interface validation (7) | Consumer-driven contract-testing literature [R6]. |

### Reasonable extrapolations

These are well-motivated applications of the supported principles to the n8n workflow domain:

| Principle | Basis |
|---|---|
| Locality preservation (3) | Follows from change-based selection and interface-level testing [R4] [R6]. |
| Static-first escalation (4, 5) | Follows from cost-awareness and the testing-pyramid principle [R1] [R2]. |
| Happy-path default (11) | Product policy choice, consistent with guidance favoring narrow inner-loop checks. |
| Opaque boundary escalation (12) | Sound methodological stance: surface limits rather than fabricate certainty. |
| Diagnostics for next action (8) | Product design choice grounded in agent-as-consumer reality. |

### Product judgment

These are local design choices that should be treated as calibratable defaults, not established facts:

| Choice | Status |
|---|---|
| Exact guardrail thresholds and trigger conditions | Requires calibration against real workflows. |
| Exact path-prioritization weights | Plausible defaults, not research-backed constants. |
| Trust invalidation mechanics (forward propagation, granularity) | Reasonable architecture, requires feasibility validation. |
| Specific narrowing and redirection policies | Product defaults, expected to evolve with use. |
| Rerun suppression conditions | Grounded in DeFlaker principle, but exact conditions are local. |

The strategy does not claim that every product heuristic has a published paper behind it. It claims that the major structural commitments are grounded in well-established principles, and that the product-specific choices are consistent with those principles. The references in this document support the strategy's major structural commitments, not every later implementation detail. Thresholds, ranking heuristics, and invalidation mechanics remain local product choices and should be calibrated using real workflow data.

---

## References

* [R1] Google Testing Blog. "Just Say No to More End-to-End Tests." 2015.
* [R2] Google Testing Blog. "Testing on the Toilet: Risk-Driven Testing." 2014.
* [R3] Google Testing Blog. "Flaky Tests at Google and How We Mitigate Them." 2016.
* [R4] Teamscale. "Test Impact Analysis: Detecting Errors Early Despite Large, Long-Running Test Suites." 2018.
* [R5] Bell, Legunsen, Hilton, Eloussi, Yung, Marinov. "DeFlaker: Automatically Detecting Flaky Tests." ICSE 2018.
* [R6] Riehle et al. "Ensuring Syntactic Interoperability Using Consumer-Driven Contract Testing." Software Testing, Verification and Reliability. 2025.
* [R7] Machalica, Samber, Porth, Xia. "Predictive Test Selection." Meta / arXiv:1810.05286. 2018.
* [R8] Gligoric et al. "Practical Regression Test Selection with Dynamic File Dependencies." ISSTA 2015.
* [R9] Rothermel, Untch, Chu, Harrold. "Prioritizing Test Cases for Regression Testing." IEEE TSE. 2001.
