#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const eventName = process.env.GITHUB_EVENT_NAME;
const eventPath = process.env.GITHUB_EVENT_PATH;
const headSha = process.env.GITHUB_SHA;

if (!eventName || !eventPath || !headSha) {
  console.error(
    'Release-note validation requires GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, and GITHUB_SHA.'
  );
  process.exit(2);
}

const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const pullRequest = event.pull_request;
const baseSha = pullRequest?.base?.sha ?? event.before;
const body = pullRequest?.body ?? event.head_commit?.message ?? '';

if (!baseSha) {
  console.error(
    `Release-note validation does not support ${eventName} without a base SHA.`
  );
  process.exit(2);
}

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'seerr-release-notes-')
);
const bodyFile = path.join(temporaryDirectory, 'event-body.md');
fs.writeFileSync(bodyFile, body, 'utf8');

const run = (script, args = []) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

try {
  const releaseNoteArgs = [
    '--base',
    baseSha,
    '--head',
    headSha,
    '--pr-body',
    bodyFile,
  ];
  if (process.env.GITHUB_STEP_SUMMARY)
    releaseNoteArgs.push('--summary-file', process.env.GITHUB_STEP_SUMMARY);
  if (eventName === 'push')
    releaseNoteArgs.push('--allow-mixed-push-batch', 'true');

  const releaseNoteStatus = run(
    'scripts/check-release-notes.mjs',
    releaseNoteArgs
  );
  if (releaseNoteStatus !== 0) process.exitCode = releaseNoteStatus;
  else process.exitCode = run('scripts/check-changelog-tags.mjs');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
