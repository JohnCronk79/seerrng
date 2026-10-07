import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { createAdaptiveTimingProfile } from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { executeDistributedLinuxProductionRun } from '../tools/validation-engine/runtime/distributed-linux-production-runner.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (character) => character.repeat(64);

function repositoryEvidence(profile) {
  return {
    schema: 'seerrng-distributed-repository-evidence/v3',
    completed: true,
    localChecks: [],
    attemptedSteps: [],
    unexecutedSteps: [],
    attemptedShardIds: ['task-a'],
    unexecutedShardIds: [],
    duplicateShardIds: [],
    foreignShardIds: [],
    catalog: {
      applicationId: 'seerrng',
      candidate: { candidateSha256: digest('a') },
      catalogSha256: digest('b'),
      tasks: [{ taskId: 'task-a', adapterId: 'vitest', files: ['a.test.ts'] }],
    },
    schedule: {
      applicationId: 'seerrng',
      policySha256: canonicalJsonSha256({
        acceptedRunWindow: 32,
        coldStartDurationMs: 60_000,
        coldStartPerformanceScorePermille: 100,
        controllerReserveThreads: 1,
        fallbackQuantilePermille: 900,
        maximumSamplesPerTest: 9,
        rollingQuantilePermille: 750,
        unknownEstimateMultiplierPermille: 1_250,
      }),
      profileSha256: canonicalJsonSha256(profile),
      repositoryIdentitySha256: digest('c'),
      scheduleSha256: digest('d'),
      testInventorySha256: digest('e'),
      nodes: [
        {
          nodeId: 'controller',
          scope: { environment: 'linux-x64', nodeId: 'controller' },
          admittedThreads: 2,
          performanceScorePermille: 100,
        },
      ],
      threadSlots: [
        {
          nodeId: 'controller',
          threadSlotId: 'controller.thread-1',
          tests: [
            {
              adapterId: 'vitest',
              fingerprint: 'task-a',
              id: 'task-a',
              laneId: 'repository-native',
            },
          ],
        },
      ],
    },
    report: {
      reportSha256: digest('f'),
      status: 'passed',
      wallMs: 5,
    },
    shards: [
      {
        nodeId: 'controller',
        result: { wallMs: 3 },
        shardId: 'task-a',
        status: 'passed',
        threadSlotId: 'controller.thread-1',
        wallMs: 4,
      },
    ],
    onlineNodes: [],
    offlineNodes: [],
    applicationAdmission: {},
    dependencyAdmission: {},
    resultReuse: false,
  };
}

function stagedResult(profile, { passed = true } = {}) {
  const evidence = repositoryEvidence(profile);
  const stageIds = ['repository', 'codeql', 'build', 'browser'];
  return {
    schemaVersion: 2,
    runId: 'production-run-1',
    candidate: { commit: 'candidate-revision-1' },
    status: passed ? 'passed' : 'failed',
    ok: passed,
    stats: { wallMs: 20 },
    lanes: stageIds.map((id, index) => ({
      id,
      kind: id,
      required: true,
      status: passed || index > 0 ? 'passed' : 'failed',
      unitCount: 1,
      unitsExecuted: 1,
      unitWallMs: index + 1,
      spanWallMs: index + 1,
      cpuMs: null,
      caseAttempts: { passed: 1, failed: 0, skipped: 0 },
    })),
    results: stageIds.map((lane, index) => ({
      id: `${lane}-unit`,
      lane,
      status: passed || index > 0 ? 'passed' : 'failed',
      wallMs: index + 1,
      startOffsetMs: index * 2,
      endOffsetMs: index * 2 + 1,
    })),
    pendingRequired: [],
    nativeEvidence: {
      'native-repository': {
        status: passed ? 'passed' : 'failed',
        repositoryEvidence: evidence,
      },
    },
    resultReuse: false,
  };
}

function harness(t, failure = null) {
  const root = mkdtempSync(join(tmpdir(), 'seerrng-production-runner-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const evidenceDirectory = join(root, 'production-run-1');
  const timingProfilePath = join(root, 'timing-profile.json');
  const ledgerPath = join(root, 'source-native-ledger.jsonl');
  const nativeLogs = join(root, 'logs');
  mkdirSync(nativeLogs);
  const stdoutLog = join(nativeLogs, 'native-command-1.stdout.log');
  const stderrLog = join(nativeLogs, 'native-command-1.stderr.log');
  const stdoutBytes = Buffer.from('focused output\n', 'utf8');
  const stderrBytes = Buffer.alloc(0);
  writeFileSync(stdoutLog, stdoutBytes, { flag: 'wx' });
  writeFileSync(stderrLog, stderrBytes, { flag: 'wx' });
  const ledgerBytes = Buffer.from(
    `${JSON.stringify({ schema: 1, candidate: { sourceSha256: digest('a') } })}\n${JSON.stringify(
      {
        sequence: 1,
        id: 'native-command-1',
        commandId: 'repository-check',
        role: 'command',
        status: 'passed',
        exitCode: 0,
        signal: null,
        aborted: false,
        timedOut: false,
        spawnError: null,
        wallMs: 1,
        lifecycle: {
          spawned: true,
          completed: true,
          cleanupVerified: true,
          cleanupError: null,
        },
        stdoutLog,
        stderrLog,
        stdoutBytes: stdoutBytes.length,
        stderrBytes: stderrBytes.length,
        stdoutSha256: hash(stdoutBytes),
        stderrSha256: hash(stderrBytes),
      }
    )}\n`,
    'utf8'
  );
  writeFileSync(ledgerPath, ledgerBytes, { flag: 'wx' });
  const events = [];
  const initialProfile = createAdaptiveTimingProfile();
  let durableProfile = structuredClone(initialProfile);
  let profilePersistCalls = 0;
  const application = {
    entryId: 'application-01',
    applicationId: 'SeerrNG 3.48.3',
    name: 'SeerrNG',
    profilePath: '/profiles/seerrng-test-suite-dependancies.cfg',
  };
  const active = {
    configPath: '/config/test-suite-multi-computer-user.cfg',
    role: 'controller',
    config: { supportedApplications: [application] },
  };
  const result = stagedResult(initialProfile, {
    passed: failure !== 'stage',
  });
  const containment = {
    verifyDockerFixture: async () => ({}),
    verifyGitHistory: async () => ({}),
    verifyNetworkBoundary: async () => ({}),
    withRepositoryIsolation: async (operation) => await operation(),
    withDistributedNetwork: async (operation) => {
      events.push('network:enter');
      try {
        return await operation();
      } finally {
        events.push('network:restored');
      }
    },
  };
  const options = {
    activeConfigMarkerPath: join(root, 'active-config'),
    applicationEntryId: application.entryId,
    containment,
    evidenceDirectory,
    runAttempt: 1,
    runId: 'production-run-1',
    runtimeApplicationKey: 'seerrng',
    sourceRoot: root,
    timingProfilePath,
  };
  const dependencies = {
    createApplicationListing: () => ({ applications: [application] }),
    createNativeContext: async (_sourceRoot, nativeOptions) => {
      events.push('context:create');
      for (const name of [
        'verifyDockerFixture',
        'verifyGitHistory',
        'verifyNetworkBoundary',
        'withRepositoryIsolation',
      ])
        assert.equal(nativeOptions[name], containment[name]);
      return {
        report: { blockedRequired: [] },
        pendingMetadata: [],
        describeNativeProcessReceipts: () => ({
          file: ledgerPath,
          sha256: hash(ledgerBytes),
          records: 1,
          pending: [],
          cleanupVerified: true,
        }),
        cleanup: async () => {
          events.push('context:cleanup');
          if (failure === 'cleanup') throw new Error('Focused cleanup failure');
        },
      };
    },
    executeStagedValidation: async (_context, _launch, bridgeDependencies) =>
      await bridgeDependencies.withDistributedNetwork(async () => {
        events.push('stages:four');
        return result;
      }),
    persistTimingProfile: async (_path, profile) => {
      events.push('profile:persist');
      profilePersistCalls += 1;
      if (failure === 'persist')
        throw new Error('Focused profile persistence failure');
      durableProfile = structuredClone(profile);
      return profile;
    },
    readEvidenceFile: (path) => readFileSync(path),
    readTimingProfile: async () => {
      events.push('profile:read');
      return structuredClone(durableProfile);
    },
    reconcileEvidence: async ({ files }) => {
      events.push('evidence:reconcile');
      assert.equal(existsSync(files.result), true);
      assert.equal(existsSync(files.timings), true);
      assert.equal(existsSync(files.processLedger), true);
      assert.equal(existsSync(files.processLedgerSummary), true);
      assert.equal(existsSync(files.processStreams), true);
      if (failure === 'reconciliation')
        throw new Error('Focused reconciliation failure');
      const durableResult = JSON.parse(readFileSync(files.result, 'utf8'));
      return {
        schema: 'test-independent-reconciliation/v1',
        ok: true,
        status: 'passed',
        repositoryEvidence:
          durableResult.nativeEvidence['native-repository'].repositoryEvidence,
      };
    },
    resolveActiveConfig: async () => {
      events.push('config:resolve');
      return active;
    },
    writeEvidenceFile: (path, bytes) => {
      events.push(`write:${basename(path)}`);
      if (
        failure === 'contained-receipt' &&
        basename(path) === 'contained-run-verification.json'
      )
        throw new Error('Focused contained-run receipt failure');
      writeFileSync(path, bytes, { flag: 'wx' });
      return { bytes: bytes.length, sha256: hash(bytes) };
    },
  };
  if (failure === 'profile')
    dependencies.updateTimingProfileBatch = (_profile, observations) => ({
      profile: structuredClone(initialProfile),
      accepted: false,
      reason: 'focused-profile-failure',
      updatedTests: 0,
      observationCount: observations.length,
    });
  return {
    dependencies,
    events,
    getDurableProfile: () => structuredClone(durableProfile),
    getProfilePersistCalls: () => profilePersistCalls,
    initialProfile,
    options,
  };
}

test('green production lifecycle persists one profile and writes its contained-run receipt last', async (t) => {
  const fixture = harness(t);
  const outcome = await executeDistributedLinuxProductionRun(
    fixture.options,
    fixture.dependencies
  );

  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, 'passed');
  assert.equal(fixture.getProfilePersistCalls(), 1);
  assert.equal(fixture.getDurableProfile().scopes.length, 1);
  assert.equal(existsSync(outcome.files.containedRunVerification), true);
  assert.equal(
    fixture.events.indexOf('network:restored') <
      fixture.events.indexOf('write:staged-validation-result.json'),
    true
  );
  assert.equal(
    fixture.events.indexOf('context:cleanup') <
      fixture.events.indexOf('evidence:reconcile'),
    true
  );
  assert.equal(
    fixture.events.indexOf('evidence:reconcile') <
      fixture.events.indexOf('profile:persist'),
    true
  );
  assert.equal(fixture.events.at(-1), 'write:contained-run-verification.json');
  const marker = JSON.parse(
    readFileSync(outcome.files.containedRunVerification, 'utf8')
  );
  assert.equal(marker.ok, true);
  assert.equal(marker.status, 'passed');
  const retainedLedger = readFileSync(outcome.files.processLedger);
  const retainedLedgerSummary = readFileSync(
    outcome.files.processLedgerSummary
  );
  const retainedStreams = readFileSync(outcome.files.processStreams);
  const streamBundle = JSON.parse(retainedStreams.toString('utf8'));
  assert.equal(marker.processLedgerSha256, hash(retainedLedger));
  assert.equal(marker.processLedgerSummarySha256, hash(retainedLedgerSummary));
  assert.equal(marker.processStreamsSha256, hash(retainedStreams));
  assert.equal(streamBundle.sourceLedgerSha256, hash(retainedLedger));
  assert.equal(streamBundle.recordCount, 1);
  assert.equal(streamBundle.streamCount, 2);
  assert.equal(
    Buffer.from(
      streamBundle.records[0].streams.stdout.contentBase64,
      'base64'
    ).toString('utf8'),
    'focused output\n'
  );
  assert.equal(
    Buffer.from(streamBundle.records[0].streams.stderr.contentBase64, 'base64')
      .length,
    0
  );
  assert.equal(
    marker.updatedProfileSha256,
    outcome.timingUpdate.updatedProfileSha256
  );
});

for (const failure of [
  'stage',
  'reconciliation',
  'cleanup',
  'profile',
  'persist',
])
  test(`${failure} failure preserves evidence without a marker or unintended profile update`, async (t) => {
    const fixture = harness(t, failure);
    await assert.rejects(
      executeDistributedLinuxProductionRun(
        fixture.options,
        fixture.dependencies
      )
    );

    assert.equal(existsSync(fixture.options.evidenceDirectory), true);
    assert.equal(
      existsSync(
        join(
          fixture.options.evidenceDirectory,
          'contained-run-verification.json'
        )
      ),
      false
    );
    assert.equal(
      existsSync(join(fixture.options.evidenceDirectory, 'failure.json')),
      true
    );
    assert.deepEqual(fixture.getDurableProfile(), fixture.initialProfile);
    if (failure === 'persist')
      assert.equal(fixture.getProfilePersistCalls(), 1);
    else assert.equal(fixture.getProfilePersistCalls(), 0);
  });

test('production options reject a native worker override before launch', async (t) => {
  const fixture = harness(t);
  fixture.options.nativeContextOptions = { workerOverride: 24 };
  await assert.rejects(
    executeDistributedLinuxProductionRun(fixture.options, fixture.dependencies),
    /native context options contains unsupported fields/u
  );
  assert.equal(existsSync(fixture.options.evidenceDirectory), false);
});

test('production options reject a non-AbortSignal before launch', async (t) => {
  const fixture = harness(t);
  fixture.options.signal = null;
  await assert.rejects(
    executeDistributedLinuxProductionRun(fixture.options, fixture.dependencies),
    /signal must be an AbortSignal/u
  );
  assert.equal(existsSync(fixture.options.evidenceDirectory), false);
});

test('contained-run receipt failure preserves the accepted timing update without claiming success', async (t) => {
  const fixture = harness(t, 'contained-receipt');
  await assert.rejects(
    executeDistributedLinuxProductionRun(fixture.options, fixture.dependencies),
    /contained-run receipt failure/u
  );

  assert.equal(fixture.getProfilePersistCalls(), 1);
  assert.equal(fixture.getDurableProfile().scopes.length, 1);
  assert.equal(
    existsSync(
      join(fixture.options.evidenceDirectory, 'contained-run-verification.json')
    ),
    false
  );
  assert.equal(
    existsSync(join(fixture.options.evidenceDirectory, 'failure.json')),
    true
  );
});
