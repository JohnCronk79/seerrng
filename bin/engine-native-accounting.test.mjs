// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tests cannot resolve application TS aliases.
import { executeNativeRepository } from '../tools/validation-engine/runtime/native-stage-context.mjs';
import { executePlan } from './local-validation.mjs';
const quiet = { write() {} };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const tap = (failed = false) =>
  `TAP version 13\n# Subtest: native fixture\n${failed ? 'not ok' : 'ok'} 1 - native fixture\n  ---\n  duration_ms: 1\n  type: 'test'\n${failed ? "  error: 'native assertion'\n  failureType: 'testCodeFailure'\n" : ''}  ...\n1..1\n# tests 1\n# suites 0\n# pass ${failed ? 0 : 1}\n# fail ${failed ? 1 : 0}\n# cancelled 0\n# skipped 0\n# todo 0\n`;
function fixture(t, mode = {}) {
  const scratchRoot = mkdtempSync(
    path.join(os.tmpdir(), 'seerrng-native-accounting-')
  );
  t.after(() => rmSync(scratchRoot, { recursive: true, force: true }));
  const root = path.join(scratchRoot, 'source');
  mkdirSync(root);
  const plan = {
    root,
    steps: [
      {
        name: 'Vitest',
        kind: 'vitest',
        command: process.execPath,
        config: path.join(root, 'vitest.config.mts'),
        files: ['server/fixture.test.ts'],
        args: [
          '--config',
          '<temporary-vitest-config>',
          '--outputFile.json=<temporary-vitest-report>',
        ],
      },
      {
        name: 'Node',
        kind: 'node-js',
        command: process.execPath,
        files: ['bin/fixture.test.mjs'],
        args: [],
      },
      {
        name: 'Tooling',
        kind: 'tooling',
        command: process.execPath,
        files: ['bin/tooling.test.mjs'],
        args: [],
      },
    ],
  };
  const calls = [];
  let ordinal = 0;
  const nativeRun = async (command) => {
    calls.push(command.kind);
    assert.equal(
      command.env.NODE_OPTIONS,
      command.kind === 'tooling' ? '--test-reporter=tap' : undefined
    );
    const failed =
      (mode.failedVitest && command.kind === 'vitest') ||
      (mode.failedNode && command.kind === 'node-js');
    if (command.kind === 'vitest' && !mode.missingReport) {
      const report = {
        success: !failed,
        numPassedTests: failed ? 0 : 1,
        numFailedTests: failed ? 1 : 0,
        numTotalTests: 1,
        testResults: [
          {
            name: path.join(root, 'server/fixture.test.ts'),
            assertionResults: [
              {
                fullName: 'native fixture',
                status: failed ? 'failed' : 'passed',
                failureMessages: failed ? ['native assertion'] : [],
              },
            ],
          },
        ],
      };
      if (mode.mutateReport) mode.mutateReport(report);
      const file = command.args
        .find((arg) => arg.startsWith('--outputFile.json='))
        .slice('--outputFile.json='.length);
      writeFileSync(
        file,
        mode.malformedReport ? '{bad' : JSON.stringify(report)
      );
    }
    const stdout =
      command.kind === 'vitest' ? 'native vitest stdout' : tap(failed);
    const receipt = {
      id: command.name,
      status: failed ? 'failed' : 'passed',
      exitCode: failed ? 1 : 0,
      stdout,
      stderr: '',
      stdoutBytes: Buffer.byteLength(stdout),
      stderrBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutSha256: sha(stdout),
      stderrSha256: sha(''),
      aborted: false,
      timedOut: false,
      signal: null,
      spawnError: null,
      wallMs: 1,
      lifecycle: { spawned: true, completed: true, cleanupVerified: true },
    };
    for (const stream of ['stdout', 'stderr']) {
      receipt[`${stream}Log`] = path.join(
        scratchRoot,
        `${ordinal}-${stream}.log`
      );
      writeFileSync(receipt[`${stream}Log`], receipt[stream]);
    }
    ordinal++;
    if (mode.mutateReceipt) mode.mutateReceipt(receipt, command);
    if (failed || receipt.timedOut || receipt.aborted)
      throw Object.assign(new Error('actual native exit'), { receipt });
    return receipt;
  };
  return { plan, calls, nativeRun, scratchRoot };
}
const options = (value) => ({
  ...value,
  stdout: quiet,
  stderr: quiet,
  inherited: {},
  workers: 2,
});

test('completed failed Vitest cases retain native receipts and run later independent Node/tooling owners', async (t) => {
  const value = fixture(t, { failedVitest: true });
  const receipt = await executeNativeRepository(value.plan, options(value));
  assert.equal(receipt.status, 'failed');
  assert.deepEqual(value.calls, ['vitest', 'node-js', 'tooling']);
  assert.deepEqual(receipt.cases, { passed: 2, failed: 1, skipped: 0 });
  assert.equal(receipt.commands[0].exitCode, 1);
  assert(receipt.commands[0].nativeReport.sha256);
  assert.equal(
    receipt.caseLedgers[0].cases[0].failureMessages[0],
    'native assertion'
  );
  assert.equal(receipt.failures.length, 1);
});
test('completed failed Node cases preserve exact native failure diagnostics and do not hide later tooling', async (t) => {
  const value = fixture(t, { failedNode: true });
  const receipt = await executeNativeRepository(value.plan, options(value));
  assert.equal(receipt.status, 'failed');
  assert.deepEqual(receipt.cases, { passed: 2, failed: 1, skipped: 0 });
  assert.deepEqual(value.calls, ['vitest', 'node-js', 'tooling']);
  assert.match(
    receipt.caseLedgers[1].cases[0].rawDiagnostic,
    /native assertion/
  );
});
test('missing/malformed/off-source/duplicate/unclosed/zero-active native reports abort independent owners', async (t) => {
  for (const mode of [
    { failedVitest: true, missingReport: true },
    { failedVitest: true, malformedReport: true },
    {
      failedVitest: true,
      mutateReport: (r) => {
        r.numFailedTests = 2;
      },
    },
    {
      failedVitest: true,
      mutateReport: (r) => {
        r.testResults[0].name = '/outside.test.ts';
      },
    },
    {
      failedVitest: true,
      mutateReport: (r) => {
        r.testResults.push(r.testResults[0]);
      },
    },
    {
      failedVitest: true,
      mutateReport: (r) => {
        r.testResults[0].assertionResults[0].failureMessages = [];
      },
    },
    {
      mutateReport: (r) => {
        r.numPassedTests = 0;
        r.numTotalTests = 0;
        r.testResults[0].assertionResults = [];
      },
    },
  ]) {
    const value = fixture(t, mode);
    await assert.rejects(
      executeNativeRepository(value.plan, options(value)),
      (error) => error.repositoryEvidence.completed === false
    );
    assert.deepEqual(value.calls, ['vitest']);
  }
});
test('timeout/abort/log-hash drift/cleanup uncertainty are infrastructure, never counted test failures', async (t) => {
  for (const patch of [
    { timedOut: true },
    { aborted: true },
    { signal: 'SIGTERM' },
    { stdoutSha256: '0'.repeat(64) },
    { id: 'another command' },
    { lifecycle: { spawned: true, completed: true, cleanupVerified: false } },
  ]) {
    const value = fixture(t, {
      failedVitest: true,
      mutateReceipt: (r) => Object.assign(r, patch),
    });
    await assert.rejects(executeNativeRepository(value.plan, options(value)));
    assert.deepEqual(value.calls, ['vitest']);
  }
});
test('default public execution still fails fast before independent test owners', async (t) => {
  const value = fixture(t, { failedVitest: true });
  await assert.rejects(
    executePlan(value.plan, {
      stdout: quiet,
      stderr: quiet,
      inherited: {},
      workers: 2,
      executor: async (command, execution) => {
        const receipt = await value.nativeRun({
          ...command,
          env: execution.env,
        });
        return receipt.stdout;
      },
    }),
    /actual native exit/
  );
  assert.deepEqual(value.calls, ['vitest']);
});

test('later infrastructure failure preserves earlier native case evidence without running further owners', async (t) => {
  const value = fixture(t, {
    failedNode: true,
    mutateReceipt: (receipt, command) => {
      if (command.kind === 'node-js') receipt.timedOut = true;
    },
  });
  await assert.rejects(
    executeNativeRepository(value.plan, options(value)),
    (error) => {
      assert.equal(error.repositoryEvidence.completed, false);
      assert.equal(error.repositoryEvidence.caseLedgers.length, 1);
      assert.deepEqual(error.repositoryEvidence.caseLedgers[0].counts, {
        passed: 1,
        failed: 0,
        skipped: 0,
      });
      assert.deepEqual(
        error.repositoryEvidence.unexecutedSteps.map((step) => step.name),
        ['Tooling']
      );
      return true;
    }
  );
  assert.deepEqual(value.calls, ['vitest', 'node-js']);
});
