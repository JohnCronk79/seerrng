#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];

if (mode !== '--check' && mode !== '--write') {
  console.error('Usage: node bin/run-prettier.mjs --check|--write');
  process.exit(2);
}

const listedFiles = spawnSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  }
);

if (listedFiles.error || listedFiles.status !== 0) {
  console.error(listedFiles.stderr || listedFiles.error?.message);
  process.exit(listedFiles.status ?? 1);
}

const files = listedFiles.stdout
  .split('\0')
  .filter(Boolean)
  .filter((file) => existsSync(path.join(root, file)))
  .sort((first, second) => first.localeCompare(second));
const prettierCli = path.join(
  root,
  'node_modules',
  'prettier',
  'bin',
  'prettier.cjs'
);
const batchSize = 100;

for (let index = 0; index < files.length; index += batchSize) {
  const batch = files.slice(index, index + batchSize);
  const result = spawnSync(
    process.execPath,
    [
      prettierCli,
      mode,
      '--cache',
      '--ignore-unknown',
      ...(mode === '--write' ? ['--log-level', 'warn'] : []),
      ...batch,
    ],
    { cwd: root, stdio: 'inherit' }
  );

  if (result.error || result.status !== 0) {
    if (result.error) {
      console.error(result.error.message);
    }
    process.exit(result.status ?? 1);
  }
}
