#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];

if (mode !== '--check' && mode !== '--write') {
  console.error('Usage: node bin/run-prettier.mjs --check|--write');
  process.exit(2);
}

const prettierCli = path.join(
  root,
  'node_modules',
  'prettier',
  'bin',
  'prettier.cjs'
);
const result = spawnSync(
  process.execPath,
  [
    prettierCli,
    mode,
    '--ignore-unknown',
    '--ignore-path',
    path.join(root, '.prettierignore'),
    ...(mode === '--write' ? ['--log-level', 'warn'] : []),
    '.',
  ],
  { cwd: root, stdio: 'inherit' }
);

if (result.error || result.status !== 0) {
  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(result.status ?? 1);
}
