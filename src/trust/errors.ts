/**
 * Typed error classes for the trust subsystem.
 */

/** Thrown when the trust state file is corrupt or unreadable. */
export class TrustPersistenceError extends Error {
  override readonly name = 'TrustPersistenceError' as const;
  constructor(
    readonly filePath: string,
    override readonly cause: Error,
  ) {
    super(`Corrupt trust state file: ${filePath}`);
  }
}

/** Thrown when canonical serialization fails during content hashing. */
export class ContentHashError extends Error {
  override readonly name = 'ContentHashError' as const;
  constructor(
    readonly nodeName: string,
    override readonly cause: Error,
  ) {
    super(`Failed to hash content for node: ${nodeName}`);
  }
}

/** Thrown when trust recording encounters an invalid state. */
export class TrustRecordingError extends Error {
  override readonly name = 'TrustRecordingError' as const;
}
