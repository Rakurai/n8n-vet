# Research: Validate / Test Tool Separation

**Date**: 2026-04-19  
**Feature**: [spec.md](spec.md)

## Research Summary

No unknowns required research. The PRD (`docs/prd/validate-test-separation.md`) made all architectural decisions explicitly. The codebase exploration confirmed all assumptions about current architecture.

## Decisions

### 1. Test-refusal vs redirect semantics

**Decision**: Replace redirect guardrail with a refuse-action guardrail (test-refusal).  
**Rationale**: The PRD mandates this. A refusal is stronger than a redirect because it forces the agent to consciously override with `force: true`. The redirect was problematic because it silently changed the operation.  
**Alternatives considered**: (a) Keep redirect but make it visible in diagnostics -- rejected because it still hides the tool boundary. (b) Remove the guardrail entirely -- rejected because agents will habitually call `test` without justification.

### 2. Trust migration strategy for `'both'` → single evidence

**Decision**: Map old `'both'` values to `'execution'` when reading legacy trust records.  
**Rationale**: `'execution'` is the stronger evidence type. A record that had `'both'` was produced by a combined run that included execution, so `'execution'` is the conservative-correct mapping. `'static'` would lose information.  
**Alternatives considered**: (a) Map to `'static'` -- rejected, loses the fact that execution ran. (b) Delete records with `'both'` -- rejected, forces unnecessary re-validation. (c) Keep `'both'` as a legacy read-only value -- rejected, complicates all type checks.

### 3. Orchestrator split strategy

**Decision**: Keep a single `interpret()` function with an early branch on `tool` discriminator, not two separate functions.  
**Rationale**: The 10-step pipeline shares Steps 1-4 (parse, graph, trust, target resolution) regardless of tool. Only Steps 5-8 diverge. Two separate functions would duplicate the shared prefix. A single function with `if (tool === 'test')` branching at Step 5 is simpler.  
**Alternatives considered**: (a) Two top-level functions (`interpretValidate()`, `interpretTest()`) -- rejected, would require extracting Steps 1-4 into a shared helper, adding a new abstraction with only two consumers (borderline on Constitution Principle III). (b) Strategy pattern -- rejected, over-engineering for a binary branch.

### 4. `layer` parameter rejection mechanism

**Decision**: Use Zod `.strict()` mode on input schemas so any unknown property (including `layer`) produces a validation error.  
**Rationale**: This catches `layer` without special-casing it. Any future removed parameter also gets caught automatically. The error message from Zod's strict mode is clear ("Unrecognized key(s) in object: 'layer'").  
**Alternatives considered**: (a) Manual check for `layer` key with custom error message -- rejected, adds special-case code. Zod's error is clear enough. (b) Silently ignore unknown params -- rejected, explicitly forbidden by spec FR-001.

### 5. `explain` tool: `tool` parameter semantics

**Decision**: `explain` accepts `tool: 'validate' | 'test'` (default `'validate'`). When `tool: 'test'`, guardrail evaluation includes test-refusal check. When `tool: 'validate'`, test-refusal is skipped.  
**Rationale**: The PRD defines this explicitly. The `tool` parameter replaces the removed `layer` parameter and lets the agent ask "what would happen if I ran test?" vs "what would happen if I ran validate?"  
**Alternatives considered**: None -- the PRD was prescriptive.

### 6. File rename: redirect.ts

**Decision**: Keep `redirect.ts` filename but remove `buildRedirectDecision()`. Do not rename to `escalation.ts`.  
**Rationale**: Constitution Principle III (No Over-Engineering) -- renaming a file for aesthetic reasons adds churn without functional benefit. The file still contains `assessEscalationTriggers()` which is called from the test-refusal logic. The filename is adequate.  
**Alternatives considered**: Rename to `escalation.ts` -- rejected, unnecessary churn.
