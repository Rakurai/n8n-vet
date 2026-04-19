# Technology Stack Decisions

## Purpose

This document locks down the current technology stack decisions for the project.

It is not a detailed implementation plan. Its purpose is to establish the core technical direction so that future specification and feasibility work can proceed without reopening the major platform-level choices.

This document should be read together with:

* `VISION.md`
* `CONCEPTS.md`
* `SCOPE.md`
* `PRD.md`
* `STRATEGY.md`

---

## 1. Product shape

The product will be built as a **standalone package** with **n8n-as-code (`n8nac`) as a dependency**.

### Why

This preserves the project’s distinct identity as a validation control tool rather than turning it into “more n8nac commands,” while still allowing it to reuse the most valuable capabilities already present in the n8nac ecosystem.

This project is philosophically aligned with n8nac:

* local files are the source of truth
* n8n is treated as a deployment/runtime surface
* workflow development is local-first and code-oriented

But it remains a separate product because its purpose is different:

* n8nac manages workflow authoring, sync, and knowledge access
* this project controls validation behavior for agent-built workflows

### Locked decision

**Decision:** standalone package, not an n8nac-native built-in package.

---

## 2. Language and runtime

The implementation language will be **TypeScript running on Node.js**.

### Why

TypeScript is the strongest fit because:

* n8n is implemented in TypeScript
* n8nac is implemented in TypeScript
* the project will likely consume n8nac packages and n8n workflow-related structures
* the product is expected to expose an MCP-oriented surface, which fits naturally in the Node/TypeScript ecosystem
* shared types, schemas, and graph semantics matter more here than rapid one-off prototyping convenience

### Locked decision

**Decision:** TypeScript is the product language.

### Non-decision

Short-lived prototype or spike code may still be written in another language if useful for research, but that does not affect the product direction.

---

## 3. Primary interface

The product is **agent-only**. A human is not expected to directly operate it as the normal user.

The primary interface will therefore be a **structured tool surface**, not a human-oriented CLI experience.

### Preferred primary interface

The preferred primary interface is **MCP**.

### Why

Because the product is intended to shape agent behavior directly, the interface should:

* accept structured inputs
* return structured outputs
* avoid forcing agents to parse human-oriented console text
* expose explicit scope, diagnostics, and validation decisions in machine-usable form

### Locked decision

**Decision:** the product is agent-only and should optimize for a structured agent-facing interface.

### Clarification

This decision does **not** automatically mean that the product itself should call MCP tools internally.

MCP is the preferred **surface exposed by the product**.

Internally, the product may call:

* n8nac libraries
* n8n REST APIs
* n8n MCP tools, if appropriate
* direct package APIs

Internal transport should be chosen pragmatically based on capability, stability, and control.

---

## 4. Secondary interface

A CLI may still exist, but it is **not** part of the primary product identity.

### Role of CLI

A CLI, if present, is a secondary/internal surface for:

* development
* debugging
* local experimentation
* fallback operation

It should not be treated as the main user experience.

### Locked decision

**Decision:** CLI is secondary/supporting, not primary.

---

## 5. Core architecture shape

The product should be organized around a **library core**.

### Why

A library core makes it possible to:

* expose an MCP surface cleanly
* support a debug/development CLI without duplicating logic
* isolate graph analysis, execution orchestration, trust reasoning, and diagnostic summarization into composable internal modules

### Locked decision

**Decision:** library core with one or more thin interfaces on top.

---

## 6. Workflow source of truth

The workflow source of truth is local, n8n-as-code-compatible workflow artifacts.

### Why

This project inherits the same local-first model as n8nac:

* workflow development happens locally
* validation decisions should be made from local artifacts whenever possible
* execution-backed validation is a deliberate compile+test step against n8n

### Locked decision

**Decision:** local workflow artifacts are authoritative for static analysis and validation planning.

---

## 7. Static analysis strategy

Static analysis is a core part of the product and should be designed as a **high-value heuristic system**, not a proof system.

### What is being accepted

The product will not attempt to fully prove graph correctness.

Instead, it will aim to catch the majority of meaningful structural problems in normal agent-built workflows by focusing on a bounded set of analyzable patterns.

### Expected strategy

The static layer should center around:

* local workflow graph inspection
* reference tracing across connections
* output/interface compatibility reasoning
* identification of common high-value failure modes

### Expression handling stance

Expressions in n8n can contain arbitrary JavaScript, so full static analysis is not realistic.

The product is therefore explicitly allowed to use partial, pattern-based analysis that captures the dominant useful cases.

### Locked decision

**Decision:** static analysis is intentionally heuristic, bounded, and high-value rather than exhaustive.

---

## 8. Workflow graph access

The product should prefer **local graph access** for static analysis.

### Preferred approach

Use n8nac-compatible/local workflow representations as the primary graph source.

This may involve:

* consuming n8nac parsing/transform capabilities
* reading local workflow JSON
* reading local TypeScript workflow definitions through n8nac-aligned tooling

### Why

Static work should not require a running n8n instance.
Local-first analysis is cheaper, faster, and better aligned with the product’s anti-thrash philosophy.

### Locked decision

**Decision:** static graph analysis is local-first and should not depend on live n8n access.

---

## 9. Execution-backed validation strategy

Execution-backed validation is required, but it is not the default answer to every question.

It is the expensive path used when execution evidence is needed.

### Locked principle

Execution-backed validation should be treated as a **compile+test step with real cost**.

---

## 10. Runtime integration surfaces

The product may use multiple runtime integration surfaces depending on what capability is required.

### 10.1 n8n REST API

The n8n REST API is an acceptable and important integration surface.

It should be used whenever it provides a meaningful capability advantage.

### Why

Current research shows that the REST API exposes execution capabilities that map well to this project’s needs, especially around bounded or partial execution semantics.

This is important because slice/path-oriented validation is central to the product vision.

### Locked decision

**Decision:** REST API use is explicitly allowed and expected when it provides a meaningful product advantage.

### 10.2 n8n MCP tools

n8n MCP tools may also be used where they provide the best available execution or inspection path.

However, using MCP internally is not assumed to be the default or only integration strategy.

### Clarification

The fact that the product exposes an MCP interface to agents does **not** imply that the product itself must be implemented primarily as a wrapper around MCP tool calls.

Internal use of MCP should be judged pragmatically.

Questions to evaluate in later design work include:

* whether MCP provides the needed capability directly
* whether REST offers more control or better slice/path support
* whether package/library access is more stable or easier to reason about
* whether MCP introduces unnecessary indirection inside the product

### Locked decision

**Decision:** internal use of MCP is optional and capability-driven, not ideological.

---

## 11. Execution backend stance

The product should not hard-code itself to a single execution backend too early.

### Why

Research across n8n and n8nac surfaces shows that useful execution-related capabilities are split across:

* direct API surfaces
* MCP tools
* existing n8nac functionality

A single backend is unlikely to expose the entire validation surface the product wants.

### Locked decision

**Decision:** execution and inspection should be treated as backend-capable concerns, even if one backend is used first in practice.

This is a product architecture stance, not a phased implementation commitment.

---

## 12. Trusted interfaces and contracts

The project will treat **trusted interfaces as primarily derived state**, not mandatory manually-authored metadata.

### Why

The product’s value depends on keeping validation local and cheap. Requiring extensive manual contract authoring would work against that.

The preferred stance is:

* trust can come from prior successful validation
* trust can be invalidated by relevant changes
* explicit contracts may exist, but they are not required to define the product

### Locked decision

**Decision:** trusted boundaries/interfaces are primarily derived rather than required as manually maintained artifacts.

---

## 13. Primary result format

The product’s primary output will be a **structured diagnostic summary**, suitable for agent consumption.

### Output format stance

JSON is the preferred canonical result format.

### Why

JSON:

* is natural for agent/tool consumption
* avoids wasting implementation effort on formatting verbose human-facing output
* can be transformed later into human-readable summaries if needed
* fits the product’s emphasis on structured diagnostics rather than transcript-like output

### Locked decision

**Decision:** structured JSON diagnostic summaries are the primary output format.

---

## 14. Human-facing formatting stance

Human-readable formatting is secondary and may be layered on later if useful.

### Why

The product’s primary job is not to print pleasing console output. It is to provide compact, high-value diagnostics to an agentic development loop.

### Locked decision

**Decision:** human-oriented rendering is optional and downstream of the canonical JSON result.

---

## 15. Relationship to push/resolve friction

The project is **not** locking itself into solving the broader workflow push/resolve lifecycle inside n8nac.

### Why

Absorbing n8nac’s sync/push conflict behavior directly would broaden scope significantly and move the project toward partially replacing or wrapping n8nac itself.

That is not the intended product identity.

### Locked decision

**Decision:** the product may surface validation-relevant consequences of push/deploy behavior, but it is not currently responsible for taking over the broader push/resolve lifecycle.

Agents can continue to handle on-push validation outcomes using the guidance and context philosophy imparted by this tool.

---

## 16. Packaging and distribution

The product is packaged as a standalone TypeScript project with a library core. It supports **dual distribution**: a Claude Code plugin (primary) and a standalone MCP server (secondary).

### Claude Code plugin (primary distribution)

The product ships as a Claude Code plugin that bundles the MCP server, skills, and optional hooks. When the plugin is enabled, the MCP server starts automatically, tools appear in Claude's toolkit, and skills guide the agent toward correct validation patterns.

Plugin components:

* `.mcp.json` — bundles the MCP server (auto-started on plugin enable)
* `skills/` — SKILL.md files encoding validation philosophy and tool usage patterns
* `hooks/` — `SessionStart` hook for dependency installation into `${CLAUDE_PLUGIN_DATA}`
* `plugin.json` — manifest with `userConfig` for n8n host/API key (prompted at enable time, sensitive values stored in keychain)
* `bin/` — CLI binary added to PATH when plugin is active
* `${CLAUDE_PLUGIN_DATA}` — persistent directory for trust state and snapshots (replaces `.n8n-vet/` in project root)

### Standalone MCP server (secondary distribution)

The same MCP server can run independently via `npx` or direct installation for use with other MCP clients (VS Code Copilot, Claude Desktop, other agents). Trust state falls back to `.n8n-vet/` in the project directory when not running as a plugin.

### Why dual

The library core + thin interface architecture already separates product logic from deployment concerns. The plugin wrapper is configuration (~5 files), not code. Supporting both paths costs almost nothing and avoids locking the product to a single agent platform.

### Locked decision

**Decision:** Claude Code plugin is the primary distribution. Standalone MCP server is the secondary distribution. Both share the same library core.

---

## 17. Summary of locked decisions

### Locked

* Standalone package
* n8nac as dependency
* TypeScript / Node.js
* Agent-only product stance
* MCP as preferred external surface
* CLI as secondary/support/debug surface
* Library core architecture
* Local workflow artifacts as source of truth
* Static analysis is heuristic and high-value, not exhaustive
* Local-first graph analysis
* REST API allowed and expected where it provides product advantage
* REST API (destinationNode) for bounded execution, MCP for smoke tests and inspection
* n8nac transformer for workflow parsing, custom graph walker for analysis
* Internal use of MCP is optional, not assumed
* Trusted interfaces are primarily derived
* Structured JSON diagnostic summaries are the primary output
* Human-readable formatting is secondary
* Product does not take over the broader n8nac push/resolve lifecycle
* Claude Code plugin is the primary distribution; standalone MCP server is the secondary distribution

### Intentionally not locked here

* Exact internal module breakdown
* Exact spec/fixture format details
* Exact trust persistence mechanism
* Exact static analysis algorithm details

Those belong in later feasibility and design work.

---

## 18. Testing strategy

### Framework

Vitest is the testing framework, consistent with the TypeScript ecosystem and n8nac's usage.

### Testing layers

**Unit tests (offline, fast, no dependencies beyond the library itself):**
Core library functions are pure transforms over data structures. Graph walking, expression reference parsing, node classification, change detection, trust computation, diagnostic synthesis, and guardrail assessment are all testable without a running n8n instance.

**Fixture-based tests (offline, fast):**
Static analysis accuracy is validated against real workflow snapshots containing known bug patterns (data-loss-through-replacement, broken expression references, schema mismatches). Fixtures are committed to the repo.

**Integration tests (require running n8n instance, slower):**
Execution orchestration, pin data construction, bounded execution via REST API, and diagnostic extraction from execution results require a live n8n instance. These tests are more expensive and may be gated behind an environment flag.

### Locked decision

**Decision:** Vitest. Unit and fixture-based tests are the primary quality gate. Integration tests are secondary and environment-gated.

---

## 19. Final statement

The technology stack is now intentionally aligned with the product vision:

* local-first where possible
* execution-backed where valuable
* structured for agents
* independent enough to remain opinionated
* close enough to n8nac and n8n to reuse the platform capabilities that already exist

This stack should let the project pursue its core promise without drifting into either a generic test framework or a partial replacement for n8nac.
