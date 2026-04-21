# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

n8n-proctor is a guardrailed validation control tool for agent-built n8n workflows. It reduces agent thrash by keeping validation local, bounded, diagnostic, and cheap — focusing on workflow slices and paths rather than whole-workflow reruns.

**Status:** v0.2.0

## Development Commands

```sh
npm run build          # TypeScript compilation (tsc)
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode
npm run test:integration  # Integration tests (dotenv -- tsx)
npm run typecheck      # Type-check without emitting (tsc --noEmit)
npm run lint           # Lint with Biome (biome check src/)
npm run lint:fix       # Auto-fix lint issues
npm run format         # Format with Biome
npm run check-version  # Verify version-bearing files match package.json
npm run ci             # typecheck + lint + test + check-version
```

Run a single test file: `npx vitest run test/guardrails/evaluate.test.ts`

Run tests matching a pattern: `npx vitest run -t "pattern"`

For the full testing guide (scenarios, fixtures, assertion helpers, known gaps), see `test/TESTING.md`.

## Version Management

`package.json` is the single source of truth for the version number.

- **Runtime (`.ts` files)**: Import `VERSION` from `src/version.ts`, which reads `package.json` at runtime via `createRequire`. Never hardcode a version string in TypeScript.
- **Non-TS files** (`.claude-plugin/plugin.json`, `skills/validate-workflow/SKILL.md`): Checked by `scripts/check-version.js`. Run `node scripts/check-version.js --fix` to sync them after bumping `package.json`.
- **CI**: `npm run ci` includes `check-version`, so version drift is caught automatically.

**Release-prep checklist:**
1. Bump `version` in `package.json`.
2. Run `node scripts/check-version.js --fix` to update non-TS files.
3. Update `CHANGELOG.md` with the new version entry.
4. Run `npm run ci` to confirm everything is in sync.

## Code Architecture

ESM package (`"type": "module"`). Strict TypeScript. Node >= 20.

The library core lives in `src/` with thin interface layers (MCP server, CLI) on top. The single barrel file is `src/index.ts` (package entry point). All other imports go directly to source files (no intermediate barrel files).

**Subsystem pipeline** (data flows left to right):

```
parse → graph → trust → target → guardrails → static analysis → execution → diagnostics → trust update
```

| Subsystem | Location | Responsibility |
|-----------|----------|----------------|
| Static Analysis | `src/static-analysis/` | Graph parsing, expression tracing, data-loss detection, schema/param validation, node classification |
| Trust | `src/trust/` | Content hashing, change detection, trust state persistence, rerun assessment |
| Guardrails | `src/guardrails/` | Evaluate whether to proceed/narrow/redirect/refuse; evidence and narrowing logic |
| Execution | `src/execution/` | Execution preparation (`prepare.ts`), MCP client (`test_workflow`, `get_execution`), pin data construction, capability detection (`'mcp' \| 'static-only'`) |
| Diagnostics | `src/diagnostics/` | Synthesize structured summaries from static + execution results, error classification, hints |
| Orchestrator | `src/orchestrator/` | Request interpretation, path selection, workflow snapshots, phase delegation (`phases/validate`, `phases/synthesize`, `phases/persist`) |
| MCP Surface | `src/mcp/` | MCP server exposing `validate`, `test`, `trust_status`, `explain` tools |
| CLI | `src/cli/` | CLI commands and human-readable formatting |
| Types | `src/types/` | Shared domain types (graph, slice, target, trust, guardrail, diagnostic, surface) |

**Key wiring files:**
- `src/deps.ts` — grouped dependency injection container (`buildDeps`) with 7 subsystem contracts
- `src/surface.ts` — public surface helpers (trust status reports, guardrail explanations)
- `src/errors.ts` — error mapping to MCP error types

## Design Documents

Read these before making architectural decisions:

| Doc | Purpose |
|-----|---------|
| `docs/VISION.md` | Why this project exists, core philosophy |
| `docs/SCOPE.md` | What the project claims and explicitly does not |
| `docs/CONCEPTS.md` | Shared vocabulary — read first if terms are unclear |
| `docs/STRATEGY.md` | Validation strategy, named engineering patterns, locked heuristics |
| `docs/CODING.md` | TypeScript best practices — all implementation code must follow these rules |
| `docs/TECH.md` | Locked technology decisions |
| `docs/internal/PRD.md` | Product requirements, goals, non-goals |
| `docs/internal/research/` | Platform capability research (n8n, n8nac, field testing notes) |

## Key Domain Concepts

Understand these before working on the codebase. See `docs/CONCEPTS.md` for full definitions with context and relationships.

- **Workflow slice** — bounded region of the graph relevant to current change (the change unit)
- **Workflow path** — concrete execution route through a slice (the validation unit)
- **Trusted boundary** — previously validated, unchanged region treated as stable
- **Guardrail** — product behavior that actively steers toward higher-value, lower-cost validation patterns
- **Diagnostic summary** — compact validation output; must never devolve into pass spam or verbose transcripts
- **Low-value rerun** — validation expected to provide little new information relative to cost

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

See `docs/CODING.md` for the full standard. Key principles:

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
