# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

n8n-vet is a guardrailed validation control tool for agent-built n8n workflows. It reduces agent thrash by keeping validation local, bounded, diagnostic, and cheap — focusing on workflow slices and paths rather than whole-workflow reruns.

**Status:** Pre-implementation. The repo contains design docs only (vision, PRD, scope, concepts, tech stack, feasibility, research). No source code, package.json, or build system exists yet.

## Architecture (Locked Decisions)

- **Language:** TypeScript on Node.js
- **Product shape:** Standalone package with n8nac (n8n-as-code) as a dependency
- **Primary interface:** MCP server (agent-facing, structured JSON input/output)
- **Secondary interface:** CLI (development/debug only)
- **Core architecture:** Library core with thin interface layers (MCP, CLI) on top
- **Output format:** Structured JSON diagnostic summaries (primary), human-readable secondary
- **Workflow source of truth:** Local n8n-as-code artifacts, not the n8n editor
- **Static analysis:** Heuristic and high-value, not exhaustive — partial/pattern-based expression analysis is acceptable
- **Execution backend:** Pragmatic choice between REST API, MCP tools, and package APIs — not locked to one
- **Trusted boundaries:** Primarily derived from prior validation, not manually authored contracts

## Key Domain Concepts

Understand these before working on the codebase (defined in `docs/CONCEPTS.md`):

- **Workflow slice** — bounded region of the graph relevant to current change (the change unit)
- **Workflow path** — concrete execution route through a slice (the validation unit)
- **Trusted boundary** — previously validated, unchanged region treated as stable
- **Guardrail** — product behavior that actively steers toward higher-value, lower-cost validation patterns
- **Diagnostic summary** — compact validation output; must never devolve into pass spam or verbose transcripts
- **Low-value rerun** — validation expected to provide little new information relative to cost

## Design Documents

Read these before making architectural decisions:

| Doc | Purpose |
|-----|---------|
| `docs/VISION.md` | Why this project exists, core philosophy |
| `docs/PRD.md` | Product requirements, goals, non-goals |
| `docs/SCOPE.md` | What the project claims and explicitly does not |
| `docs/CONCEPTS.md` | Shared vocabulary — read first if terms are unclear |
| `docs/STRATEGY.md` | Validation strategy, named engineering patterns, locked heuristics |
| `docs/CODING.md` | TypeScript best practices — all implementation code must follow these rules |
| `docs/TECH.md` | Locked technology decisions |
| `docs/FEASIBILITY.md` | Open research questions and proof points needed |
| `docs/research/` | Platform capability research (n8n, n8nac, field testing notes) |

## Critical Constraints

These are non-negotiable product principles that should guide all implementation. See `docs/STRATEGY.md` for the reasoning, evidence basis, and named engineering patterns behind these constraints.

1. **Default target is NOT the whole workflow.** Validation defaults to the smallest useful slice/path.
2. **Broad validation is a failure mode**, not a neutral option.
3. **Compact diagnostics are a product requirement**, not polish. Never produce verbose transcript output.
4. **Guardrails are core product identity.** When a rerun is low-value, the tool warns, narrows, redirects, or refuses — always with explanation.
5. **Static analysis before execution.** Static is cheap and local; execution is a deliberate compile+test step with real cost.
6. **The agent is the user.** Optimize for structured machine-usable output, not human console experience.
7. **Trusted boundaries reduce work.** Don't force re-proving unchanged, previously validated regions.

## Code Discipline

- **Fail-fast**: No defensive programming, no fallback logic. Let errors raise.
- **Contract-driven**: Validate at boundaries, then trust internally. Don't re-check conditions deeper in the call stack.
- **Comments**: Explain intent or invariants only. Don't narrate obvious operations or restate symbol names.
- **Refactoring**: Update interfaces everywhere, remove dead code, no compatibility shims. Source reflects current truth; history lives in git.
- **No silent fallbacks**: If something fails, it should fail visibly.

## Shell & Terminal Rules

- Never use heredoc (`<<EOF`) syntax — use explicit file writes instead.
- Never set `PYTHONIOENCODING` or `NO_COLOR` env vars.
- Use `--no-color` / `--color=never` flags where available.
- For multi-line scripts: write to `.scratch/` first, then run. **Never use `python3 -c` or `bash -c` with inline multi-line code** — `#` characters (comments, dict literals, f-strings) after newlines inside quoted arguments trigger path-validation security warnings that block autonomous agents. Always write the script to `.scratch/` and execute the file.
- **Never use compound shell commands** (`&&`, `||`, `;`, pipes). Each Bash call must be a single command. If you need sequential steps, make separate Bash calls or write a script to `.scratch/` and run it. Compound commands trigger approval prompts that block autonomous agents.
- **Never use Bash for read-only verification.** File existence checks (`test -f`, `[ -f`), content searches (`grep -q`), and file listing loops (`for f in ...`) must use the Glob, Grep, or Read tools instead. Reserve Bash exclusively for commands that require execution (git, lint, test runners, docker, etc.).

## Active Technologies
- TypeScript (strict mode, ESM) on Node.js 20+ + All internal subsystems (static-analysis, trust, guardrails, execution, diagnostics), `@n8n-as-code/transformer` (workflow parsing), `zod` (edge validation) (007-request-interpretation)
- `.n8n-vet/trust-state.json` (trust persistence, handled by trust subsystem), `.n8n-vet/snapshots/` (workflow graph snapshots, new in this phase) (007-request-interpretation)

## Recent Changes
- 007-request-interpretation: Added TypeScript (strict mode, ESM) on Node.js 20+ + All internal subsystems (static-analysis, trust, guardrails, execution, diagnostics), `@n8n-as-code/transformer` (workflow parsing), `zod` (edge validation)
