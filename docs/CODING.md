# TypeScript Best Practices

Voice: imperative, rule-based. Audience: expert coding agent.
Scope: clean, consistent TypeScript for a publishable package consumed by external agents and developers.

---

## Core Philosophy

* **No legacy adapters**: no migration bridges, compatibility shims, or temporary bridging code. If old code needs updating, update it. Do not create adapter layers between old and new patterns -- they become permanent dead weight.
* **Explicit errors**: invalid configuration, missing dependencies, and contract violations must produce typed, catchable errors with clear messages. Never silently degrade or return partial results.
* **Schema-first**: define strict typed contracts before logic; enforce at the edges.
* **Program to contract**: trust validated types; **no defensive programming** against inputs already guaranteed by the contract.
* **Composition over inheritance**: prefer composition; keep inheritance shallow and local if used.
* **Agent-oriented documentation**: documentation exists to help agents (and their operators) understand contracts, constraints, and non-obvious intent. Do not restate what is visible in the type signature. Do not write for human scanners who will never read it.
* **No fallbacks**: the word and practice are **forbidden**. If something is required, it must be present or the caller receives a clear error.
* **No in-code history**: no versioning, change logs, references to changed/removed code in source. History is the role of the version control system.

---

## Type Safety as Contract

**Principle**: Types are executable contracts.

**Rules**

* Enable `strict: true` in `tsconfig.json`. No exceptions.
* No `any` in production paths. If unavoidable, annotate with `any` and add `// TODO refine type`.
* Narrow types aggressively: use literal types, discriminated unions, enums, and branded types over loosening types.
* Public interfaces must be fully typed; return `T | undefined` **only** when absence is intentional.
* Prefer `unknown` over `any` when the type is genuinely not known; narrow before use.
* Use `as const` for literal tuples and objects that define fixed shapes.
* Do not use type assertions (`as T`) to silence the compiler. If the compiler disagrees, fix the types.

---

## Error Handling

**Principle**: Handle only where you own the responsibility; otherwise propagate. Public API boundaries must expose typed domain errors, not raw internal failures.

**Rules**

* Never mask or downgrade errors. No silent catches. No broad `catch (e)` without re-throwing.
* If an error cannot be meaningfully handled at the current layer, **let it propagate**.
* Define a small set of typed error classes for the public API surface. Consumers should be able to catch specific error types, not parse message strings.
* Wrap external/library exceptions into domain errors at the public boundary. Internal code can let them propagate raw.
* Do not use `try/catch` as control flow.
* Return `Result<T, E>` patterns or throw -- pick one convention per project and enforce it. Do not mix.

---

## Silent Failure Patterns (Prohibited)

These are the most common agent-introduced anti-patterns. All are prohibited.

* `catch (e) { console.log(e) }` -- logging as the sole response to an exception.
* `catch (e) { return defaultValue }` -- returning defaults on error paths instead of propagating.
* `x ?? fallbackValue` or `x || fallbackValue` on values that **must** exist -- masks bugs instead of enforcing contracts.
* `if (x !== undefined)` guards that silently skip logic rather than failing when data is missing.
* `try { ... } catch { /* ignore */ }` -- swallowing exceptions entirely.

---

## Dependency Injection

**Principle**: Explicit, testable dependencies.

**Rules**

* Declare dependencies in constructors or factory parameters. No hidden globals or dynamic imports in business logic.
* Make dependencies mockable. Do not create them inside business logic.
* Avoid service locator patterns. If a function needs something, it takes it as a parameter.

---

## Interfaces & Contracts

**Principle**: Predictable, schema-first boundaries.

**Rules**

* All payloads must be schema-first and typed. No ad-hoc JSON shapes.
* Define explicit input/output types for all public functions and API boundaries.
* Use discriminated unions for polymorphic data rather than optional fields and runtime checks.
* Validate at system boundaries (external input, API responses); trust internally after validation.
* Use a validation library (Zod, ArkType, etc.) at edges. Do not hand-roll validation logic.
* Do not re-validate data that has already passed through a validated boundary.

---

## Configuration

**Principle**: Explicit, environment-driven, validated at initialization.

**Rules**

* Define a typed configuration schema. Validate all required values at initialization; throw a typed error describing the specific misconfiguration if invalid.
* No magic constants scattered in code. Centralize configuration.
* Prefer environment variables for deployment-sensitive values.
* Use `as const` objects or enums for fixed option sets, not string literals repeated across files.

---

## Logging

**Principle**: Structured context; signal, not noise. Libraries do not own the consumer's logging stack.

**Rules**

* Log **start**, **error**, **completion** of meaningful operations with contextual fields (resource IDs, operation names).
* Do not duplicate logs and errors; prefer one precise log at the owner boundary.
* Never use `console.log` in library/production code.
* Library code should accept an optional logger interface or use a lightweight internal logger that consumers can replace. Do not bundle an opinionated logging framework that conflicts with the consumer's setup.
* `console.log` is acceptable only in CLI entry points and development scripts.

---

## File Organization

**Principle**: Small, cohesive units; clarity first.

**Rules**

* One clear responsibility per file. No hard line-count cap, but a file should not become a dumping ground.
* Do not split code so aggressively that understanding a feature requires opening ten tiny files. Do not let one file become the dumping ground for an entire subsystem. Use judgment.
* Every new function, handler, config key, or command must be reachable from at least one entry point. Dead code on creation is prohibited.
* After renaming, moving, or changing a function signature, verify that every call site uses the new name, location, and signature. No stale references.

---

## Naming

**Rules**

* `camelCase` for functions, methods, variables, and parameters.
* `PascalCase` for types, interfaces, classes, and enums.
* `UPPER_SNAKE_CASE` for module-level constants only.
* Names carry intent. If a name needs a comment to explain itself, rename it.
* Short names are acceptable for loop variables and common abbreviations (`i`, `db`, `ctx`, `err`).

---

## Imports

**Rules**

* Use named imports. Avoid `import * as`.
* Group imports: Node.js builtins, then third-party packages, then project modules. Separate groups with blank lines.
* Do not import types at runtime when `import type` suffices.
* Remove unused imports immediately. Do not leave them commented out.

---

## Comments & Documentation

**Principle**: Documentation exists to help agents understand contracts and non-obvious intent.

**Rules**

* No boilerplate JSDoc that restates parameter names and types already visible in the signature. Agents can read the signature.
* **Public API surfaces** require doc comments that explain: what the function/class does, what constraints apply, what errors it throws, and a usage example when the contract is not obvious from the signature alone. These comments are consumed by agents operating on downstream code.
* Module-level doc comments are required: describe what the module contains and why it exists.
* Class/interface doc comments are required: describe purpose and responsibilities.
* Internal/private functions: doc comments required only when behavior is not obvious from the name and signature.
* Do not narrate obvious operations or restate symbol names.
* Do not include historical commentary (moved/updated/legacy notes). Source reflects current truth; history lives in git.

---

## Testing

**Principle**: Confidence, not ceremony. No trivial tests, no redundant tests.

**Rules**

* Tests exist to give confidence that the code works correctly. A smaller number of clear, meaningful tests is better than broad shallow coverage. Do not target a coverage percentage.
* **Happy-path tests are mandatory.** Correct inputs produce correct outputs. These should always pass and run fast.
* **Error-path tests are mandatory for public API boundaries.** If the public API defines typed errors, test that they are thrown under the documented conditions. Do not test internal error paths that consumers never see.
* **Edge/exhaustive tests are opt-in.** Boundary values, combinatorial coverage, and rare conditions are valuable but should be marked or separated so the default test run stays fast.
* **Test where the logic lives.** Framework plumbing is already tested by the framework. Do not retest it.
* Tests should fail explicitly when something is wrong. Avoid broad `catch` blocks, loose assertions, or tests that assert only that "no exception was raised."
* Assert behavior, not implementation. Test through public interfaces, not private state.
* Mock dependencies, not the code being tested. Signs of over-mocking: the mock mirrors production logic; the test passes regardless of production changes.
* **No trivial tests.** Do not test that an enum has its value, that a constructor sets a field, or that a getter returns what was set. If the test would pass even with a broken implementation, it has no value.
* **No redundant tests.** If two tests verify the same contract through the same path, delete one. Each test must justify its existence by covering a distinct behavior.
* If tests or code fail, fix the **implementation**, not by trivializing tests.
* Prefer a few high-signal integration/contract tests over broad unit coverage.

---

## Over-Engineering (Prohibited)

These patterns are common agent failure modes. All are prohibited unless a current requirement demands them.

* Base classes, abstract classes, or interfaces with only one implementor.
* Helper/utility functions called from exactly one site.
* Configuration or factory patterns for things that could be direct.
* Layers of indirection that serve a future requirement, not a current one.
* Generic type parameters on types that are only ever instantiated with one concrete type.
* Wrapper classes that add no behavior beyond delegation.

---

## Phantom Implementations (Prohibited)

Code that claims to do something but does not.

* Functions with names or doc comments promising behavior the body does not deliver.
* Stub bodies: `throw new Error('Not implemented')`, `// TODO`, empty function bodies.
* Return values that do not match the stated contract (always returns `undefined`, returns hardcoded values).

If something is not implemented yet, do not create it. The absence of code is better than the presence of a lie.

---

## Hallucinated APIs (Prohibited)

Do not call methods, use parameters, or import modules that do not exist in the dependency versions used by this project. Verify against actual framework and library APIs. This is the single most common agent failure mode in unfamiliar ecosystems.

---

## Async/Await Discipline

**Principle**: Async boundaries must be intentional; floating promises are silent failure vectors.

**Rules**

* Do not mark a function `async` unless it contains `await`. An `async` function that never awaits is just wrapping a return value in a promise for no reason.
* Every promise-returning call must be `await`ed, returned, or explicitly voided with `void` (and only when fire-and-forget is genuinely intentional and documented). Floating promises swallow errors silently.
* Do not wrap synchronous code in `Promise.resolve()` or `new Promise()`. If the work is synchronous, the function should be synchronous.
* Use `Promise.all()` for independent concurrent work. Do not `await` in a loop when the iterations are independent.
* Enable the `@typescript-eslint/no-floating-promises` lint rule. This is the only reliable guard -- code review alone will not catch these consistently.

---

## Classes vs Functions

**Principle**: Use the simplest construct that fits.

**Rules**

* A module with exported functions is often the right unit of organization. Do not create a class when a plain function or a plain object suffices.
* Classes are appropriate when you need instance state, polymorphism, or lifecycle management. They are not appropriate as namespaces.
* Do not create a class with only static methods. Use a module with named exports.
* Do not create a class with a single method. Use a function.

---

## Dependency Sprawl

**Principle**: Every dependency is a cost. Justify it.

**Rules**

* Do not add an npm package for an operation that Node.js or the language provides natively. Examples: `crypto.randomUUID()` instead of `uuid`, `structuredClone()` instead of `lodash.cloneDeep`, `Object.groupBy()` / `Map.groupBy()` instead of `lodash.groupBy`, `Array.prototype.at()` instead of utility wrappers.
* Before adding a dependency, verify the operation cannot be done in a few lines of project code. A 5-line function is better than a transitive dependency tree.
* Do not add competing packages that solve the same problem (e.g., `axios` and `node-fetch` in the same project, or multiple validation libraries).
* Audit what a package pulls in. A small API surface can hide a large transitive tree.

---

## Barrel Files & Re-exports

**Principle**: Import from the source, not from an intermediary.

**Rules**

* Do not create `index.ts` barrel files that re-export everything from a directory.
* Barrel files cause circular dependency issues, slow down tooling (TypeScript language server, bundlers), and obscure where symbols actually live.
* Import directly from the file that defines the symbol: `import { validate } from './validation.js'`, not `import { validate } from './index.js'`.
* A single `index.ts` is acceptable only as the package entry point defined in `package.json`.

---

## Module System

**Principle**: One module system per project. No mixing.

**Rules**

* Choose ESM or CJS at project setup and enforce it via `"type": "module"` (or its absence) in `package.json`.
* Do not mix `require()` and `import` in the same project.
* Use `.js` extensions in relative import paths when targeting ESM (TypeScript resolves `.ts` → `.js`).
* Do not use dynamic `import()` for static dependencies. Dynamic import is for genuine runtime-conditional loading only.

---

## Enums vs Union Types

**Principle**: Prefer the simpler construct.

**Rules**

* For a fixed set of string values, prefer a string union type: `type Status = 'pending' | 'running' | 'done'`. It is simpler, generates no runtime code, and serializes naturally.
* Use `enum` only when you need reverse mapping (numeric enums) or when the enum is genuinely used as a runtime object (iteration, lookup).
* `const enum` is fragile across compilation boundaries. Avoid it.
* Do not use `enum` reflexively. The default should be a union type; escalate to `enum` when there is a concrete reason.

---

## Generics Discipline

**Principle**: Generics serve reuse. No reuse, no generic.

**Rules**

* Introduce a generic type parameter only when there are at least two concrete instantiations, or when the function is a genuine utility consumed by multiple callers with different types.
* Do not add generic parameters prophylactically ("in case we need it later").
* If a generic parameter is always constrained to one type, replace it with that type.
* Complex generic signatures (nested conditional types, mapped types with multiple parameters) are a code smell in application code. They belong in library internals, not business logic.

---

## Refactoring Rules

When refactoring:

* Update interfaces and call sites everywhere. Source reflects current truth.
* Remove dead code; do not keep it "just in case."
* Do not add compatibility shims or re-export removed symbols.
* Do not add `// removed`, `// deprecated`, or `// was: oldName` comments.
* If something breaks due to interface changes, **fix the consumer**, do not patch around it.

---

## Prohibited Practices (Summary)

* "Fallback" anything (terminology or behavior).
* `any` without a `// TODO refine type` comment.
* Defensive checks against already-validated inputs.
* Silent failure, log-and-continue, or catching without re-throwing.
* Legacy adapters, migration bridges, or temporary compatibility shims.
* `console.log` in library code.
* Dead code committed in the same change that creates it.
* Phantom implementations (stubs, empty bodies, TODO placeholders that claim to fulfill a contract).
* Over-abstraction (single-implementor abstractions, one-call helpers, speculative generality).
* Hallucinated APIs.
* Type assertions (`as T`) to silence compiler errors.
* Floating promises (un-awaited, un-returned promise-returning calls).
* Classes used as namespaces or with only static methods.
* `index.ts` barrel files that re-export a directory.
* npm packages for operations the platform provides natively.
* Mixing `require()` and `import` in the same project.
* `enum` where a string union type suffices.
* Generic type parameters with only one concrete instantiation.

---

## Quick Checklist

* [ ] `tsconfig.json` has `strict: true`.
* [ ] No `any` (or TODO-marked if unavoidable).
* [ ] DI explicit; no hidden globals or dynamic imports in business logic.
* [ ] Fail-fast on config/deps; typed errors with clear messages (not process crashes).
* [ ] Errors handled at owner layer only; typed domain errors at public API boundaries.
* [ ] Library logging is replaceable; no `console.log` in library code.
* [ ] Schema-first contracts at all boundaries; validation library at edges.
* [ ] Happy-path + public error-path tests; no trivial or redundant tests.
* [ ] Public API doc comments explain contracts, constraints, and errors.
* [ ] No fallbacks, no silent failures, no phantom implementations.
* [ ] Every new symbol is reachable from an entry point. No dead code.
* [ ] No floating promises; `no-floating-promises` lint rule enabled.
* [ ] Classes only for instance state/polymorphism; plain functions otherwise.
* [ ] No npm packages for platform-native operations.
* [ ] No barrel files; import from source.
* [ ] One module system (ESM or CJS); no mixing.
* [ ] String union types by default; `enum` only with concrete justification.
* [ ] Generics only when two or more concrete instantiations exist.
