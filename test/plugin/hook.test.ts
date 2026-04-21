import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve('.');

interface HookEntry {
  type: string;
  command: string;
}

interface HooksJson {
  hooks: {
    SessionStart: Array<{ hooks: HookEntry[] }>;
  };
}

describe('hooks/hooks.json SessionStart hook', () => {
  const hooksJson: HooksJson = JSON.parse(
    readFileSync(resolve(ROOT, 'hooks/hooks.json'), 'utf-8'),
  );

  it('has a hooks.SessionStart array', () => {
    expect(Array.isArray(hooksJson.hooks.SessionStart)).toBe(true);
    expect(hooksJson.hooks.SessionStart.length).toBeGreaterThan(0);
  });

  const firstGroup = hooksJson.hooks.SessionStart[0]!;

  it('contains command-type hook entries', () => {
    expect(firstGroup.hooks.length).toBeGreaterThan(0);
    expect(firstGroup.hooks[0]!.type).toBe('command');
  });

  const command = firstGroup.hooks[0]!.command;

  it('command includes diff for change detection', () => {
    expect(command).toContain('diff');
  });

  it('command includes npm install for dependency installation', () => {
    expect(command).toContain('npm install');
  });

  it('command includes cp for caching package.json', () => {
    expect(command).toContain('cp');
  });

  it('command references CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA', () => {
    expect(command).toContain('CLAUDE_PLUGIN_ROOT');
    expect(command).toContain('CLAUDE_PLUGIN_DATA');
  });

  it('command removes cached copy on failure (fail-fast)', () => {
    // The rm clause is the final || fallback: `|| rm -f "${CLAUDE_PLUGIN_DATA}/package.json"`
    // Verify the specific rm -f pattern exists, not just that 'rm' appears somewhere
    expect(command).toMatch(/rm\s+-f\s+.*CLAUDE_PLUGIN_DATA.*package\.json/);
  });

  it('has a build hook that compiles dist/ in PLUGIN_ROOT when missing', () => {
    const buildHook = firstGroup.hooks[1];
    expect(buildHook).toBeDefined();
    expect(buildHook!.type).toBe('command');
    expect(buildHook!.command).toContain('test -d');
    expect(buildHook!.command).toContain('CLAUDE_PLUGIN_ROOT');
    expect(buildHook!.command).toContain('npm run build');
  });
});
