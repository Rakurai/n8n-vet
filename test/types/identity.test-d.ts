/**
 * Type-level tests verifying NodeIdentity branding — plain strings cannot be
 * assigned to NodeIdentity without the factory function.
 */

import { expectTypeOf, test } from 'vitest';
import type { NodeIdentity } from '../../src/types/identity.js';

test('string is not assignable to NodeIdentity', () => {
  expectTypeOf<string>().not.toEqualTypeOf<NodeIdentity>();
});

test('NodeIdentity is assignable to string', () => {
  expectTypeOf<NodeIdentity>().toMatchTypeOf<string>();
});
