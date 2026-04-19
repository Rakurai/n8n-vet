# Release Plan — n8n-vet v0.1.0

Target: Claude Code plugin release at `github.com/Rakurai/n8n-vet`.
Copilot agent support: deferred (post-v0.1.0).

---

## Decision Log

Decisions made during planning. Reference these when questions come up during execution.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Distribution | Claude Code plugin (GitHub repo) | Plugin system reads from git repos. No registry needed. |
| Copilot | Deferred | Needs separate config files + marketplace listing. Same MCP core works later. |
| Version | 0.1.0 | Pre-release / early access. Signals "usable but not stable API." |
| Audit scope | All S0 + S1 before release | S2/S3 tracked but not blocking. |
| MCP execution | Wire it up for v0.1.0 | Dead code branch is worse than missing feature. |
| n8nac dependency | npm registry | `@n8n-as-code/transformer` is published to npm (latest n8nac release: v1.7.0). Use normal semver deps. n8nac is a sibling tool, not a dependency. |
| CI | GitHub Actions (lightweight) | Auto-runs typecheck + test + lint on push/PR. |
| Docs | Clean public-facing set | README, CHANGELOG, CONCEPTS. Archive/move internal docs. |

---

## Open Decisions

~~All resolved.~~ See Decision Log above.

1. ~~**n8nac version pinning.**~~ **Resolved:** `@n8n-as-code/transformer` is on npm. Pin to latest compatible version. n8nac itself is a sibling tool coordinated by the agent.

2. ~~**n8n instance for integration testing.**~~ **Resolved:** localhost:5678 available. API key stored in `.env` (gitignored). `.env.example` committed as template.

3. ~~**LICENSE file.**~~ Needs adding (MIT).

4. ~~**Repo rename.**~~ Remote is `Rakurai/n8n-vet`. Local folder is `n8n-check` — cosmetic only, no action needed.

---

## Work Breakdown

### You (human) — decisions, accounts, infrastructure

These can't be delegated to agents.

| # | Task | Blocking? |
|---|------|-----------|
| H1 | ~~Create GitHub repo at `Rakurai/n8n-vet`~~ | Done |
| H2 | ~~Decide n8nac dependency resolution~~ | Done — npm registry |
| H3 | ~~Provision n8n test instance~~ | Done — localhost:5678. Add API key to `.env`. |
| H4 | Add `LICENSE` file (MIT) | No — quick, do anytime |
| H5 | Set up GitHub Actions (agent can scaffold, you enable) | No — can ship without CI |
| H6 | Test Claude plugin installation on a fresh machine / clean Claude Code session | Yes — final acceptance |
| H7 | Write CHANGELOG entries for v0.1.0 | No — agent can draft, you review |
| H8 | Review and approve the final README before publish | No |
| H9 | Push to GitHub and verify Claude plugin appears in marketplace (if applicable) | Yes — actual release |

### Agents — code fixes, docs, tooling

Organized by dependency order. Items marked `[blocked]` need a human decision first.

#### Phase A: Audit Fixes (S0 + S1)

Already in progress. These are the audit.findings.md items.

| # | Task | Deps |
|---|------|------|
| A1 | S0-1: Unify ExecutionData types, wire extractExecutionData | — |
| A2 | S0-3: Replace shadow isTrusted with canonical version | — |
| A3 | S0-4: Pass computeWorkflowHash instead of workflowId | — |
| A4 | S0-5: Add backward edge comparison to nodeEdgesChanged | — |
| A5 | S1-1: Change WorkflowGraph to NodeIdentity keys | A1 (type unification first) |
| A6 | S1-2: Include execution settings in serialized snapshots | — |
| A7 | S1-4: Wire MCP execution or remove dead branch | A1 |
| A8 | S1-5: Wire pin data caching in orchestrator | — |
| A9 | S1-7: Atomic writes for trust-state.json | — |
| A10 | S1-8: Add staleness timeout to execution lock | — |
| A11 | S1-9: Replace file: deps with npm registry versions | — |

#### Phase B: Code Polish

| # | Task | Deps |
|---|------|------|
| B1 | Fix biome lint errors (`biome check --write src/`) | A5 (after NodeIdentity refactor touches most files) |
| B2 | Fix cli-binary.test.ts exit code mismatch (S3-24) | — |
| B3 | Fix floating promises in cli/index.ts and bin/n8n-vet (S3-15, S3-23) | — |
| B4 | Remove `passWithNoTests: true` from vitest config (S3-3) | — |
| B5 | Run full test suite, verify green | B1–B4 |

#### Phase C: Documentation

| # | Task | Deps |
|---|------|------|
| C1 | Update README: fix repo URL, add Claude plugin install instructions, verify CLI examples still work | A11 |
| C2 | Write CHANGELOG.md with actual v0.1.0 entries | B5 (needs final feature list) |
| C3 | Review and trim CONCEPTS.md for public audience | — |
| C4 | Move internal docs to `docs/internal/`: audit files, PRD, research, specs | — |
| C5 | Update plugin.json: set repo to `Rakurai/n8n-vet` | — |
| C6 | Update SKILL.md: verify tool descriptions match current API | B5 |

#### Phase D: Tooling & CI

| # | Task | Deps |
|---|------|------|
| D1 | Scaffold GitHub Actions workflow: typecheck + test + lint on push/PR | — |
| D2 | Add `npm run ci` script that runs typecheck + test + lint in sequence | — |
| D3 | Verify `npm pack` produces a clean tarball (no test/, docs/internal/, .scratch/) | A11 |
| D4 | Add `.npmignore` or `files` field to package.json if needed | D3 |

#### Phase E: Integration Testing & Verification

| # | Task | Deps |
|---|------|------|
| E1 | Run integration tests against live n8n (localhost:5678) | A1 |
| E2 | Fix any failures from E1 | E1 |
| E3 | Run `npm run ci` on clean checkout to verify reproducible build | D2, B5 |
| E4 | Test Claude plugin install from git URL in clean session | `[blocked: H6]` |

---

## What's NOT in v0.1.0

Explicitly deferred. Don't let these creep in.

- **Bounded execution via REST (`POST /workflows/:id/run`)** — Editor-only internal API, not suitable for automated tooling. Execution uses MCP `test_workflow` exclusively.
- **REST-based execution triggering** — All `executeBounded()` code, `destinationNode` request fields, `--destination` CLI flag removed in phase-12. REST public API retained for read-only operations only.
- **Opportunistic trust harvesting from execution results** — Collecting trust evidence from nodes outside the target slice that happen to execute during validation. Deferred pending confirmation of whole-workflow execution as permanent model.
- GitHub Copilot agent support (separate config files, marketplace listing)
- npm registry publishing (git URL is sufficient for Claude plugin)
- S2/S3 audit findings (tracked, not blocking)
- Full STRATEGY.md alignment (path scoring, guardrail order — document deviations instead)
- MCP `prepare_test_pin_data` integration
- Per-workflow MCP availability checking

---

## Release Checklist

Final verification before pushing the release tag.

```
[ ] All S0 fixed and tested
[ ] All S1 fixed and tested
[ ] npm run typecheck — passes
[ ] npm run test — passes (0 failures)
[ ] npm run lint — passes (0 errors)
[ ] Integration tests pass against live n8n (or document which scenarios are deferred)
[ ] README has correct repo URL and install instructions
[ ] CHANGELOG has v0.1.0 entries
[ ] plugin.json version matches package.json version (0.1.0)
[ ] plugin.json repo URL is Rakurai/n8n-vet
[ ] No file: dependencies in package.json
[ ] LICENSE file present
[ ] npm pack produces clean tarball (inspect contents)
[ ] Clean git clone → npm install → npm run build → npm test passes
[ ] Claude plugin install from git URL works in clean session
[ ] git tag v0.1.0 created and pushed
```

---

## Suggested Execution Order

1. **You:** H1 (create repo), H2 (n8nac decision), H3 (n8n instance)
2. **Agents:** Phase A (audit fixes) — already in progress
3. **Agents:** Phase B (code polish) — starts as A finishes
4. **Agents:** Phase C + D (docs + tooling) — parallel with B
5. **You + Agents:** Phase E (integration testing + verification)
6. **You:** H6 (test plugin install), H8 (review README), H9 (push + tag)
