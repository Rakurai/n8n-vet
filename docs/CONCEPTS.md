# Concepts

This document defines the core vocabulary for the project. Its purpose is to keep later design, product, and implementation documents aligned around a single set of meanings.

These terms are intentionally opinionated. They reflect the philosophy that this project is a **guardrailed validation control tool** for agent-built n8n workflows, not a general-purpose exhaustive testing framework.

---

## Workflow

A **workflow** is an n8n graph that represents executable logic deployed to the n8n runtime.

In this project, a workflow is treated as a **deployment/runtime artifact**, not the ideal unit of iterative development reasoning. The full workflow exists as context, but most validation decisions should be narrower than “the whole workflow.”

---

## Workflow slice

A **workflow slice** is the bounded region of workflow logic relevant to the current change or validation question.

A slice is larger than a single node and smaller than an entire workflow. It is the practical unit of development focus.

A slice may be defined by:

* a sub-workflow
* a segment between two stable boundaries
* a region touched by a refactor
* a contract-affecting transformation path
* a feature-oriented region of the graph

A slice is the normal **change unit** for this project.

### Why it matters

The tool is designed to keep validation local. That means agents should usually validate the slice they are changing, not the entire workflow graph.

---

## Workflow path

A **workflow path** is a concrete execution route through part of a workflow.

A path usually passes through a workflow slice and represents the specific route used for validation. In many cases, validating a slice means executing or reasoning about one meaningful path through it.

A path is the normal **validation unit** for this project.

### Relationship to slices

* A **slice** is the region under consideration
* A **path** is the route through that region that is actually validated

A slice may contain multiple possible paths, but the tool should generally prefer validating one or a small number of meaningful paths rather than all possible branches.

---

## Validation target

A **validation target** is the specific thing the tool is being asked to validate.

A validation target is usually:

* a workflow path through a slice
* a boundary between slices
* a sub-workflow interface
* a specific transformation chain

The validation target should be as small as possible while still answering the development question at hand.

This project discourages broad or vague targets such as “the whole workflow” unless there is a compelling reason.

---

## Validation run

A **validation run** is one bounded act of validation performed by the tool.

A validation run uses one of two evidence types:

* **static validation** (cheap, local, no n8n instance needed) — structural inspection, reference tracing, data-flow analysis
* **execution-backed testing** (expensive, requires n8n instance) — live smoke test, path observation, runtime error detection

These are separate operations invoked via separate tools (`validate` and `test`). A single call produces one type of evidence, not both.

Within a run, the tool may perform:

* reference tracing and structural checking
* contract/interface checking
* mocked or pinned execution
* path observation
* compact diagnostic reporting

A validation run is not just "run the tests." It is a focused attempt to learn whether a specific target remains valid after a change.

The diagnostic result of a validation run indicates which evidence type was used (`static` or `execution`), so the agent and supervising human can understand the basis for the outcome.

---

## Bounded validation

**Bounded validation** is the principle that validation should be limited to the smallest useful scope.

Bounded validation avoids both:

* validating the entire workflow when only one slice changed
* triggering many tiny low-value reruns that each add little information

Bounded validation is central to the project. It is the opposite of broad, reflexive, suite-style execution.

---

## Validation locality

**Validation locality** is the property that failures and validation effort remain close to the slice being changed.

High validation locality means:

* the agent is validating or testing the thing it is working on
* errors are attributed near the actual change
* unrelated graph regions do not need to be re-proven
* the human or agent does not need to inspect distant parts of the workflow to understand the result

Low validation locality means the validation loop has become noisy, broad, or entangled.

---

## Trusted boundary

A **trusted boundary** is a previously validated boundary or region that is treated as stable unless there is evidence that it changed or became invalid.

A trusted boundary may exist between:

* sub-workflows
* stable graph regions
* producer/consumer boundaries
* known transformation stages

The point of a trusted boundary is to allow validation to stay local. If an unchanged boundary has already passed validation, the tool should not force the agent to re-prove it unnecessarily.

Trusted boundaries are a key mechanism for reducing redundant reruns.

A trusted boundary may be represented by:

* an explicit contract
* a stable interface inferred from prior successful validation
* a previously validated sub-workflow connection
* a cached structural understanding of the graph

The project does not require that all trusted boundaries be manually authored artifacts. Trust may be derived from prior validation evidence without requiring heavy manual contract authoring.

### Related informal terms

A **trusted region** is an informal way to refer to a broader area of the graph — potentially multiple nodes or an entire stable subgraph — that has been validated and has not changed in a way that invalidates that status. Unchanged trusted regions can be treated as context while validation focuses on the modified slice.

In diagnostic output, a **trusted node** is a node that the tool treated as stable for the current validation question — due to prior validation, unchanged status, or location beyond a trusted boundary. This is a diagnostic annotation, not a separate concept.

---

## Contract

A **contract** is an explicit or derived description of what a workflow boundary is expected to consume, produce, or preserve.

A contract may describe things such as:

* required fields
* optional fields
* output shape
* expected input shape
* whether a node or region preserves or replaces item structure

In this project, contracts are useful because they can help preserve validation locality. However, the project vision does **not** require that every graph region be manually described with formal contracts.

Contracts are one possible mechanism for establishing trusted boundaries.

---

## Mocked node

A **mocked node** is a node whose real behavior is intentionally replaced during validation.

Nodes are mocked to:

* avoid unnecessary external calls
* isolate the slice under development
* keep validation deterministic
* reduce time and token cost

Common examples include:

* LLM nodes
* HTTP/API integrations
* database nodes
* expensive orchestration nodes

A mocked node is not being validated for its live behavior in that run.

---

## Skipped node

A **skipped node** is a node that is intentionally not exercised as part of a validation run.

A node may be skipped because:

* it is outside the validation target
* a trusted boundary makes it unnecessary to revisit
* it lies beyond the useful validation point
* it would add cost without adding useful information

A skipped node differs from a mocked node:

* a **mocked node** participates through substituted behavior
* a **skipped node** is excluded from meaningful validation scope

---

## Low-value rerun

A **low-value rerun** is a validation run that is expected to provide little or no meaningful new information relative to its cost.

Examples include:

* rerunning the same effective path after no relevant change
* revalidating an unchanged green-lit region
* broad validation that does not increase confidence about the slice being worked on
* repeated execution triggered by small edits that do not affect the validation target

Reducing low-value reruns is one of the project’s core goals.

---

## Redundant validation

**Redundant validation** is validation whose informational value is substantially overlapped by previous validation or by trusted boundaries.

Low-value reruns are one form of redundant validation, but the term also applies more broadly to wasteful overlap in test design or execution.

The tool should aim to detect, discourage, skip, collapse, or redirect redundant validation whenever possible.

---

## Compile+test step

A **compile+test step** is the project’s model for execution-backed testing.

Because workflows are authored locally and deployed to n8n for execution, testing is not a trivial in-memory action. It has real operational cost:

* sync/push/deploy overhead
* execution time
* possible credentialed or external behavior
* inspection overhead if diagnostics are poor

The phrase “compile+test step” expresses that reality. It reminds us that execution-backed testing is a separate, deliberate step — not a mode of validation, but a distinct operation invoked after the workflow is deployed.

---

## Development lifecycle

The **development lifecycle** is the operational model for how validation and testing map to the workflow development process.

The lifecycle has three steps:

1. **Validate (before push).** Static analysis runs locally against workflow source files. It does not require a running n8n instance. It catches structural and data-flow problems: broken expression references, data loss through replacement, schema mismatches, missing parameters. This step is cheap, fast, and always available.

2. **Push.** The agent pushes the workflow to n8n via n8nac. This assigns `metadata.id` and deploys the workflow. n8n-vet does not push — the agent coordinates this step independently.

3. **Test (after push).** Execution-backed testing runs against a live n8n instance after the workflow has been pushed/deployed. It catches runtime problems that static analysis cannot: Code node output shape, LLM response format, conditional logic correctness, actual data values. This step has real cost and requires the workflow to exist in n8n.

Validate and test are separate tools producing separate evidence types (`static` and `execution` respectively). The agent coordinates the push step between them via n8nac.

---

## Guardrail

A **guardrail** is a product behavior that actively steers validation toward higher-value, lower-cost patterns.

A guardrail may:

* narrow the validation target
* discourage broad reruns
* skip redundant validation
* summarize the scope of a run
* make wasteful behavior harder by default

In this project, guardrails are not an optional layer of advice. They are part of the product’s identity.

---

## Validation control

**Validation control** is the broader idea that the product does not merely provide validation primitives. It shapes how validation is selected, scoped, and reported.

This includes:

* what should be validated
* what should not be revalidated
* how much of the graph should be touched
* what information is returned to the agent
* how validation cost is kept proportional to development need

Validation control is the project’s defining function.

---

## Diagnostic summary

A **diagnostic summary** is the compact output of a validation run.

A diagnostic summary should communicate the minimum high-value information needed to understand the result without forcing the agent to inspect large logs or execution history. A supervising human reading the same summary should also be able to follow the outcome.

A good diagnostic summary may include:

* the validation target
* the slice/path actually validated
* the path observed during execution, if relevant
* mocked, skipped, and trusted regions
* key errors
* important warnings

A diagnostic summary should not devolve into pass spam or verbose transcript output.

---

## Path observation

**Path observation** is the ability to report which execution path was actually taken during a validation run.

This matters especially when:

* the graph is nondeterministic
* multiple branches are possible
* a validation target assumes a specific route
* a compact result needs to explain why the observed behavior differed from expectation

Path observation is important because it can reduce the need for manual run inspection in n8n.

---

## Happy-path validation

**Happy-path validation** is validation focused on confirming that the intended, meaningful, normal route still works.

This project is intentionally biased toward happy-path validation during development. It is not trying to accumulate exhaustive edge-case coverage as part of the normal agent loop.

Edge cases may matter later, but they are not the center of this project’s value proposition.

---

## Agent thrash

**Agent thrash** is the wasteful pattern in which an agent repeatedly edits, deploys, reruns, and inspects workflows without converging efficiently on the real issue.

This often includes:

* overly frequent reruns
* overly broad validation
* reinvestigation of already validated graph regions
* noisy outputs that force further digging
* ad hoc tests that do not improve confidence proportionally to their cost

Preventing agent thrash is a central reason this project exists.

---

## Working definition of the product

Using the concepts above, the project can be described as:

> A guardrailed validation control tool for agent-built n8n workflows that keeps validation local, bounded, diagnostic, and cheap by focusing on workflow slices, validating meaningful paths, and reusing trusted boundaries wherever possible.
