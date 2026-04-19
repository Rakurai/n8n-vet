/**
 * Node identity — branded string type for stable graph keys.
 *
 * Nodes are identified by `propertyName` within the workflow graph (the camelCase
 * identifier from `NodeAST.propertyName`). This branded type prevents accidental
 * assignment from arbitrary strings such as display names or user input.
 */

/** Branded type — prevents accidental assignment from arbitrary strings. */
export type NodeIdentity = string & { readonly __brand: 'NodeIdentity' };

/**
 * Create a `NodeIdentity` from a validated property name string.
 *
 * @throws {NodeIdentityError} if the name is empty.
 */
export function nodeIdentity(name: string): NodeIdentity {
  if (name === '') {
    throw new NodeIdentityError('NodeIdentity cannot be empty');
  }
  return name as NodeIdentity;
}

/** Typed error for invalid NodeIdentity construction. */
export class NodeIdentityError extends Error {
  override readonly name = 'NodeIdentityError' as const;
}
