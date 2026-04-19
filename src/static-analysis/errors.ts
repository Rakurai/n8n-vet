/**
 * Typed error classes for the static analysis subsystem.
 *
 * MalformedWorkflowError — raised when workflow structure is invalid.
 * ConfigurationError — raised when a required dependency is unavailable at init.
 */

export class MalformedWorkflowError extends Error {
  override readonly name = 'MalformedWorkflowError' as const;
  readonly detail: string;

  constructor(detail: string) {
    super(`Malformed workflow: ${detail}`);
    this.detail = detail;
  }
}

export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError' as const;
  readonly dependency: string;

  constructor(dependency: string) {
    super(`Required dependency unavailable: ${dependency}`);
    this.dependency = dependency;
  }
}
