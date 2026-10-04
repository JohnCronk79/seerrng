#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

const repository = process.cwd();
const tags = execFileSync(
  'git',
  ['tag', '--sort=version:refname', '--list', 'v3.*'],
  { cwd: repository, encoding: 'utf8' }
)
  .trim()
  .split(/\s+/u)
  .filter(Boolean);
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const versions = [...changelog.matchAll(/^## \[?(\d+\.\d+\.\d+)\]?/gmu)].map(
  (match) => match[1]
);
const counts = new Map();
for (const version of versions) {
  counts.set(version, (counts.get(version) ?? 0) + 1);
}

const missing = tags
  .map((tag) => tag.slice(1))
  .filter((version) => !counts.has(version));
const duplicate = tags
  .map((tag) => tag.slice(1))
  .filter((version) => (counts.get(version) ?? 0) > 1)
  .map((version) => `${version} (${counts.get(version)} sections)`);

if (missing.length > 0 || duplicate.length > 0) {
  if (missing.length > 0) {
    console.error(
      `Changelog is missing tagged releases: ${missing.join(', ')}`
    );
  }
  if (duplicate.length > 0) {
    console.error(
      `Changelog contains duplicate release sections: ${duplicate.join(', ')}`
    );
  }
  process.exit(1);
}

console.log(`Changelog covers all ${tags.length} SeerrNG tag(s).`);
