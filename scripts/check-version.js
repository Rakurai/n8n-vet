#!/usr/bin/env node

/**
 * Release-prep check: verify that all version-bearing files agree with package.json.
 *
 * Usage:
 *   node scripts/check-version.js          # verify only (exit 1 on mismatch)
 *   node scripts/check-version.js --fix    # update files to match package.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fix = process.argv.includes('--fix');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const expected = pkg.version;

/** @type {{ path: string, pattern: RegExp, replacement: (v: string) => string }[]} */
const targets = [
  {
    path: '.claude-plugin/plugin.json',
    pattern: /"version":\s*"[^"]+"/,
    replacement: (v) => `"version": "${v}"`,
  },
  {
    path: 'skills/validate-workflow/SKILL.md',
    pattern: /^compatibility:\s*">=.+"/m,
    replacement: (v) => `compatibility: ">=${v}"`,
  },
];

let failures = 0;

for (const { path, pattern, replacement } of targets) {
  const abs = resolve(root, path);
  const content = readFileSync(abs, 'utf8');
  const match = content.match(pattern);

  if (!match) {
    console.error(`✗ ${path}: pattern not found — cannot verify version`);
    failures++;
    continue;
  }

  const want = replacement(expected);
  if (match[0] === want) {
    console.log(`✓ ${path}`);
    continue;
  }

  if (fix) {
    writeFileSync(abs, content.replace(pattern, want), 'utf8');
    console.log(`✓ ${path} (updated)`);
  } else {
    console.error(`✗ ${path}: found ${match[0]}, expected ${want}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} file(s) out of sync with package.json version ${expected}.`);
  console.error('Run "node scripts/check-version.js --fix" to update them.');
  process.exit(1);
} else {
  console.log(`\nAll version-bearing files match package.json (${expected}).`);
}
