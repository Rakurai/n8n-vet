/**
 * Type-level tests verifying that all discriminated unions narrow correctly.
 *
 * These tests use vitest's `expectTypeOf` and run as compile-time checks only —
 * no runtime execution. The `.test-d.ts` extension is vitest's convention for
 * type-check-only test files.
 */

import { expectTypeOf, test } from 'vitest';
import type { GuardrailDecision, GuardrailAction } from '../../src/types/guardrail.js';
import type { DiagnosticError, ErrorClassification } from '../../src/types/diagnostic.js';
import type { ValidationTarget, AgentTarget } from '../../src/types/target.js';
import type { SliceDefinition, PathDefinition } from '../../src/types/slice.js';
import type { NodeIdentity } from '../../src/types/identity.js';

// --- GuardrailDecision narrowing ---

test('GuardrailDecision narrows on action: proceed', () => {
  const decision = {} as GuardrailDecision;
  if (decision.action === 'proceed') {
    expectTypeOf(decision.action).toEqualTypeOf<'proceed'>();
    expectTypeOf(decision.explanation).toBeString();
  }
});

test('GuardrailDecision narrows on action: warn', () => {
  const decision = {} as GuardrailDecision;
  if (decision.action === 'warn') {
    expectTypeOf(decision.action).toEqualTypeOf<'warn'>();
  }
});

test('GuardrailDecision narrows on action: narrow — narrowedTarget is present', () => {
  const decision = {} as GuardrailDecision;
  if (decision.action === 'narrow') {
    expectTypeOf(decision.narrowedTarget).toEqualTypeOf<ValidationTarget>();
  }
});

test('GuardrailDecision narrows on action: refuse', () => {
  const decision = {} as GuardrailDecision;
  if (decision.action === 'refuse') {
    expectTypeOf(decision.action).toEqualTypeOf<'refuse'>();
  }
});

// --- DiagnosticError narrowing ---

test('DiagnosticError narrows on classification: wiring', () => {
  const error = {} as DiagnosticError;
  if (error.classification === 'wiring') {
    expectTypeOf(error.context).toHaveProperty('parameter');
    expectTypeOf(error.context).toHaveProperty('referencedNode');
    expectTypeOf(error.context).toHaveProperty('fieldPath');
  }
});

test('DiagnosticError narrows on classification: expression', () => {
  const error = {} as DiagnosticError;
  if (error.classification === 'expression') {
    expectTypeOf(error.context).toHaveProperty('expression');
    expectTypeOf(error.context).toHaveProperty('parameter');
    expectTypeOf(error.context).toHaveProperty('itemIndex');
  }
});

test('DiagnosticError narrows on classification: credentials', () => {
  const error = {} as DiagnosticError;
  if (error.classification === 'credentials') {
    expectTypeOf(error.context).toHaveProperty('credentialType');
    expectTypeOf(error.context).toHaveProperty('httpCode');
  }
});

test('DiagnosticError narrows on classification: external-service', () => {
  const error = {} as DiagnosticError;
  if (error.classification === 'external-service') {
    expectTypeOf(error.context).toHaveProperty('httpCode');
    expectTypeOf(error.context).toHaveProperty('errorCode');
  }
});

test('DiagnosticError narrows on classification: platform', () => {
  const error = {} as DiagnosticError;
  if (error.classification === 'platform') {
    expectTypeOf(error.context).toHaveProperty('runIndex');
  }
});

test('DiagnosticError narrows on classification: cancelled', () => {
  const error = {} as DiagnosticError;
  if (error.classification === 'cancelled') {
    expectTypeOf(error.context).toHaveProperty('reason');
  }
});

test('DiagnosticError narrows on classification: unknown', () => {
  const error = {} as DiagnosticError;
  if (error.classification === 'unknown') {
    expectTypeOf(error.context).toHaveProperty('runIndex');
    expectTypeOf(error.context).toHaveProperty('itemIndex');
  }
});

// --- ValidationTarget narrowing ---

test('ValidationTarget narrows on kind: nodes', () => {
  const target = {} as ValidationTarget;
  if (target.kind === 'nodes') {
    expectTypeOf(target.nodes).toEqualTypeOf<NodeIdentity[]>();
  }
});

test('ValidationTarget narrows on kind: changed', () => {
  const target = {} as ValidationTarget;
  if (target.kind === 'changed') {
    expectTypeOf(target.kind).toEqualTypeOf<'changed'>();
  }
});

test('ValidationTarget narrows on kind: workflow', () => {
  const target = {} as ValidationTarget;
  if (target.kind === 'workflow') {
    expectTypeOf(target.kind).toEqualTypeOf<'workflow'>();
  }
});

test('ValidationTarget narrows on kind: slice', () => {
  const target = {} as ValidationTarget;
  if (target.kind === 'slice') {
    expectTypeOf(target.slice).toEqualTypeOf<SliceDefinition>();
  }
});

test('ValidationTarget narrows on kind: path', () => {
  const target = {} as ValidationTarget;
  if (target.kind === 'path') {
    expectTypeOf(target.path).toEqualTypeOf<PathDefinition>();
  }
});

// --- AgentTarget narrowing ---

test('AgentTarget narrows on kind: nodes', () => {
  const target = {} as AgentTarget;
  if (target.kind === 'nodes') {
    expectTypeOf(target.nodes).toEqualTypeOf<NodeIdentity[]>();
  }
});

test('AgentTarget narrows on kind: changed', () => {
  const target = {} as AgentTarget;
  if (target.kind === 'changed') {
    expectTypeOf(target.kind).toEqualTypeOf<'changed'>();
  }
});

test('AgentTarget narrows on kind: workflow', () => {
  const target = {} as AgentTarget;
  if (target.kind === 'workflow') {
    expectTypeOf(target.kind).toEqualTypeOf<'workflow'>();
  }
});

// --- Derived types ---

test('GuardrailAction is the union of action literals', () => {
  expectTypeOf<GuardrailAction>().toEqualTypeOf<'proceed' | 'warn' | 'narrow' | 'refuse'>();
});

test('ErrorClassification is the union of classification literals', () => {
  expectTypeOf<ErrorClassification>().toEqualTypeOf<
    'wiring' | 'expression' | 'credentials' | 'external-service' | 'platform' | 'cancelled' | 'unknown'
  >();
});
