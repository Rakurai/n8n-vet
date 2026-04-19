/**
 * Push utility — wraps n8nac push with OCC conflict handling.
 *
 * Retries once with --mode keep-current if the initial push fails
 * due to an optimistic concurrency conflict.
 */

import { execFileSync } from 'node:child_process';

const OCC_PATTERN = /conflict|version mismatch|concurrency/i;

/**
 * Push a fixture file to n8n via n8nac.
 *
 * 1. Run `n8nac push <fixturePath>`
 * 2. If OCC conflict → retry with `--mode keep-current`
 * 3. If second push fails → throw
 */
export function pushFixture(fixturePath: string): void {
  try {
    execFileSync('n8nac', ['push', fixturePath], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!OCC_PATTERN.test(message)) {
      throw new Error(`n8nac push failed: ${message}`);
    }

    // OCC conflict — retry with keep-current
    try {
      execFileSync('n8nac', ['push', fixturePath, '--mode', 'keep-current'], {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    } catch (retryErr: unknown) {
      const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(`n8nac push retry failed: ${retryMessage}`);
    }
  }
}
