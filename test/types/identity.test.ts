/**
 * Runtime tests for the NodeIdentity factory function.
 */

import { describe, expect, it } from 'vitest';
import { nodeIdentity, NodeIdentityError } from '../../src/types/identity.js';

describe('nodeIdentity', () => {
  it('returns a value equal to the input string', () => {
    const id = nodeIdentity('myNode');
    expect(id).toBe('myNode');
  });

  it('throws NodeIdentityError on empty string', () => {
    expect(() => nodeIdentity('')).toThrow(NodeIdentityError);
  });
});
