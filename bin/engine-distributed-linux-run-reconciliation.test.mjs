import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import {
  createAdaptiveTimingProfile,
  createDistributedAdaptiveSchedule,
} from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import {
  DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
  DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
  DISTRIBUTED_NATIVE_TASK_SCHEMA,
  distributedNativeTaskId,
} from '../tools/validation-engine/runtime/distributed-native-adapter.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { reconcileDistributedLinuxRunEvidence } from '../tools/validation-engine/runtime/distributed-linux-run-reconciliation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { DISTRIBUTED_SHARD_RUN_SCHEMA } from '../tools/validation-engine/runtime/distributed-shard-executor.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Node tooling tests exercise the source module directly.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (character) => character.repeat(64);
const clone = (value) => structuredClone(value);

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJson(path, value) {
  writeFileSync(path, jsonBytes(value));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function passingReceipt(wallMs = 1) {
  return {
    status: 'passed',
    exitCode: 0,
    signal: null,
    aborted: false,
    timedOut: false,
    spawnError: null,
    wallMs,
    stdout: 'ok\n',
    stderr: '',
    stdoutBytes: 3,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutSha256: hash(Buffer.from('ok\n')),
    stderrSha256: hash(Buffer.alloc(0)),
    lifecycle: {
      spawned: true,
      completed: true,
      cleanupVerified: true,
      cleanupError: null,
    },
  };
}

function createCatalog(applicationId, candidate) {
  const task = {
    schema: DISTRIBUTED_NATIVE_TASK_SCHEMA,
    taskId: distributedNativeTaskId({
      applicationId,
      adapterId: 'vitest',
      files: ['server/example.test.ts'],
    }),
    adapterId: 'vitest',
    files: ['server/example.test.ts'],
  };
  const candidateCore = {
    schema: DISTRIBUTED_NATIVE_CANDIDATE_SCHEMA,
    commitSha: candidate.commit,
    treeSha: candidate.tree,
    lockfilePath: 'pnpm-lock.yaml',
    lockfileSha256: candidate.lockSha256,
  };
  const nativeCandidate = {
    ...candidateCore,
    candidateSha256: canonicalJsonSha256(candidateCore),
  };
  const tasks = [task];
  const inventorySha256 = canonicalJsonSha256({
    schema: 'seerrng-distributed-native-inventory-identity/v1',
    applicationId,
    platform: 'linux',
    candidateSha256: nativeCandidate.candidateSha256,
    tasks,
  });
  const catalogCore = {
    schema: DISTRIBUTED_NATIVE_CATALOG_SCHEMA,
    applicationId,
    platform: 'linux',
    candidate: nativeCandidate,
    inventorySha256,
    tasks,
  };
  return {
    ...catalogCore,
    catalogSha256: canonicalJsonSha256(catalogCore),
  };
}

function createSchedule(catalog, candidate, profile) {
  return createDistributedAdaptiveSchedule({
    tests: catalog.tasks.map((task) => ({
      id: task.taskId,
      fingerprint: task.taskId,
      applicationId: catalog.applicationId,
      laneId: 'repository-native',
      adapterId: task.adapterId,
      repositoryIdentitySha256: candidate.sourceSha256,
      dependencies: [],
    })),
    nodes: [
      {
        id: 'controller',
        scope: {
          applicationId: catalog.applicationId,
          laneId: 'repository-native',
          adapterId: 'vitest',
          repositoryIdentitySha256: candidate.sourceSha256,
          environment: 'linux-x64',
          nodeId: 'controller',
          selectedN: 1,
        },
        adapterIds: ['vitest'],
        effectiveLogicalThreads: 2,
        concurrency: { mode: 'explicit', threads: 1 },
        currentLoadPermille: 0,
        memory: null,
        localInteractiveReserveThreads: 0,
        runsOnControllerHost: true,
        benchmark: { valid: true, performanceScorePermille: 100 },
      },
    ],
    profile,
  });
}

function createNativeTaskResult(catalog, task) {
  const receipt = passingReceipt(3);
  delete receipt.spawnError;
  const core = {
    schema: DISTRIBUTED_NATIVE_TASK_RESULT_SCHEMA,
    applicationId: catalog.applicationId,
    candidateSha256: catalog.candidate.candidateSha256,
    catalogSha256: catalog.catalogSha256,
    taskId: task.taskId,
    adapterId: task.adapterId,
    files: task.files,
    status: 'passed',
    totals: { [task.adapterId]: { active: 1, total: 1 } },
    receipt,
    wallMs: receipt.wallMs,
  };
  return { ...core, resultSha256: canonicalJsonSha256(core) };
}

function createRunReport(schedule, catalog, runId) {
  const slot = schedule.threadSlots.find((entry) => entry.tests.length > 0);
  const scheduled = slot.tests[0];
  const task = catalog.tasks.find((entry) => entry.taskId === scheduled.id);
  const outcome = {
    sequence: scheduled.sequence,
    shardId: scheduled.id,
    nodeId: slot.nodeId,
    threadSlotId: slot.threadSlotId,
    status: 'passed',
    wallMs: 4,
    result: createNativeTaskResult(catalog, task),
    failureCode: null,
  };
  const core = {
    schema: DISTRIBUTED_SHARD_RUN_SCHEMA,
    runId,
    applicationId: schedule.applicationId,
    scheduleSha256: schedule.scheduleSha256,
    testInventorySha256: schedule.testInventorySha256,
    startedAt: '2026-10-07T12:00:00.000Z',
    wallMs: 4,
    status: 'passed',
    outcomes: [outcome],
    resultReuse: false,
  };
  return { ...core, reportSha256: canonicalJsonSha256(core) };
}

function createRepositoryEvidence({ catalog, schedule, report }) {
  const localReceipt = passingReceipt();
  localReceipt.stdoutLog = '/removed-scratch/repository.stdout.log';
  localReceipt.stderrLog = '/removed-scratch/repository.stderr.log';
  return {
    schema: 'seerrng-distributed-repository-evidence/v3',
    completed: true,
    localChecks: [
      {
        index: 0,
        name: 'repository-check',
        kind: 'check',
        receipt: localReceipt,
      },
    ],
    attemptedSteps: [{ index: 0, name: 'repository-check', kind: 'check' }],
    unexecutedSteps: [],
    attemptedShardIds: catalog.tasks.map((task) => task.taskId),
    unexecutedShardIds: [],
    duplicateShardIds: [],
    foreignShardIds: [],
    catalog,
    schedule,
    report,
    shards: clone(report.outcomes),
    onlineNodes: [
      {
        nodeId: 'controller',
        computerName: 'controller-host',
        ipAddress: '127.0.0.1',
        port: 5443,
        cpuName: 'test-cpu',
        availableThreads: 2,
        applicationId: catalog.applicationId,
        platform: catalog.platform,
        candidateSha256: catalog.candidate.candidateSha256,
        catalogSha256: catalog.catalogSha256,
        inventorySha256: catalog.inventorySha256,
        taskCount: catalog.tasks.length,
      },
    ],
    offlineNodes: [],
    applicationAdmission: {
      schema: 'test-application-admission/v1',
      applicationId: catalog.applicationId,
      availableNodes: [{ nodeId: 'controller' }],
      usableNodes: [{ nodeId: 'controller' }],
      excludedNodes: [],
    },
    dependencyAdmission: null,
    resultReuse: false,
  };
}

function createStageResult({ candidate, repositoryEvidence, runId }) {
  const evidence = {
    'native-repository': {
      status: 'passed',
      cases: { passed: 1, failed: 0, skipped: 0 },
      caseLedgers: [],
      totals: { vitest: { active: 1, total: 1 } },
      commands: repositoryEvidence.localChecks.map(({ receipt }) => receipt),
      failures: [],
      repositoryEvidence,
      resultReuse: false,
    },
    'native-codeql': { status: 'passed' },
    'native-build': { status: 'passed' },
    'native-browser': { status: 'passed' },
  };
  const stages = ['repository', 'codeql', 'build', 'browser'];
  const stageCounts = {
    repository: { passed: 1, failed: 0, skipped: 0 },
    codeql: { passed: 0, failed: 0, skipped: 0 },
    build: { passed: 0, failed: 0, skipped: 0 },
    browser: { passed: 1, failed: 0, skipped: 0 },
  };
  const results = stages.map((lane, index) => {
    const id = `native-${lane}`;
    return {
      id,
      lane,
      slots: 1,
      files: lane === 'repository' ? ['server/example.test.ts'] : [],
      runId,
      candidate,
      contractSha256: null,
      inputHashes: null,
      executionEnvironmentSha256: digest('e'),
      status: 'passed',
      reason: null,
      executed: true,
      wallMs: index + 1,
      cpuMs: null,
      caseAttempts: stageCounts[lane],
      startOffsetMs: index * 2,
      endOffsetMs: index * 2 + 1,
      scheduling: {},
      evidenceSha256: hash(Buffer.from(JSON.stringify(evidence[id]), 'utf8')),
    };
  });
  const lanes = stages.map((id) => {
    const units = results.filter((unit) => unit.lane === id);
    return {
      id,
      kind: id === 'build' ? 'compile' : 'check',
      required: true,
      status: 'passed',
      unitCount: units.length,
      unitsExecuted: units.length,
      unitWallMs: units.reduce((sum, unit) => sum + unit.wallMs, 0),
      spanWallMs:
        Math.max(...units.map((unit) => unit.endOffsetMs)) -
        Math.min(...units.map((unit) => unit.startOffsetMs)),
      cpuMs: null,
      caseAttempts: stageCounts[id],
    };
  });
  const aggregateCounts = lanes.reduce(
    (sum, lane) => ({
      passed: sum.passed + lane.caseAttempts.passed,
      failed: sum.failed + lane.caseAttempts.failed,
      skipped: sum.skipped + lane.caseAttempts.skipped,
    }),
    { passed: 0, failed: 0, skipped: 0 }
  );
  return {
    schemaVersion: 2,
    runId,
    candidate,
    executionEnvironmentSha256: digest('e'),
    mode: 'execute',
    status: 'passed',
    ok: true,
    stats: {
      unitsQueued: results.length,
      unitsExecuted: results.length,
      activeUnits: 0,
      peakActiveUnits: 1,
      reservedSlots: 0,
      peakReservedSlots: 1,
      configuredSlotCap: 1,
      caseAttempts: aggregateCounts,
      selectedFileCount: 1,
      executedFileCount: 1,
      osThreads: null,
      childCpuMs: null,
      wallMs: 8,
    },
    lanes,
    results,
    limitations: [],
    localStatus: 'passed',
    pendingRequired: [],
    applicability: [],
    nativeEvidence: evidence,
    capacity: {
      effectiveLogicalCpus: 2,
      configuredWorkers: 1,
      githubActions: false,
    },
    resultReuse: false,
    distributedApplication: {
      runtimeApplicationKey: 'seerrng',
      configuredApplicationId: 'SeerrNG 3.48.3',
      dependencyProfilePath: '/profiles/seerrng-test-suite-dependancies.cfg',
      supportedApplication: {
        entryId: '01',
        applicationId: 'SeerrNG 3.48.3',
        name: 'SeerrNG',
        profilePath: '/profiles/seerrng-test-suite-dependancies.cfg',
      },
    },
  };
}

function createTimingEvidence(result, repositoryEvidence, runId) {
  return {
    schema: 'seerrng-distributed-linux-production-timings/v1',
    runId,
    totalWallMs: result.stats.wallMs,
    stages: result.lanes.map((lane) => ({
      id: lane.id,
      spanWallMs: lane.spanWallMs,
      status: lane.status,
      unitWallMs: lane.unitWallMs,
      unitsExecuted: lane.unitsExecuted,
    })),
    units: result.results.map((unit) => ({
      endOffsetMs: unit.endOffsetMs,
      id: unit.id,
      lane: unit.lane,
      startOffsetMs: unit.startOffsetMs,
      status: unit.status,
      wallMs: unit.wallMs,
    })),
    distributed: {
      nodeTotals: [
        {
          nodeId: 'controller',
          shardCount: repositoryEvidence.shards.length,
          shardWallMs: repositoryEvidence.shards.reduce(
            (sum, shard) => sum + shard.wallMs,
            0
          ),
        },
      ],
      reportWallMs: repositoryEvidence.report.wallMs,
      shards: repositoryEvidence.shards.map((shard) => ({
        nodeId: shard.nodeId,
        shardId: shard.shardId,
        status: shard.status,
        threadSlotId: shard.threadSlotId,
        wallMs: shard.wallMs,
      })),
    },
    resultReuse: false,
  };
}

function createProcessLedger(candidate) {
  const record = {
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
    stdoutLog: '/removed-scratch/native-command-1.stdout.log',
    stderrLog: '/removed-scratch/native-command-1.stderr.log',
    stdoutBytes: 3,
    stderrBytes: 0,
    stdoutSha256: hash(Buffer.from('ok\n')),
    stderrSha256: hash(Buffer.alloc(0)),
  };
  return Buffer.from(
    `${JSON.stringify({ schema: 1, candidate })}\n${JSON.stringify(record)}\n`,
    'utf8'
  );
}

function createProcessStreams(ledgerBytes) {
  const [, record] = ledgerBytes
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  const contents = { stdout: Buffer.from('ok\n'), stderr: Buffer.alloc(0) };
  return {
    schema: 'seerrng-distributed-linux-process-streams/v1',
    sourceLedgerSha256: hash(ledgerBytes),
    recordCount: 1,
    streamCount: 2,
    records: [
      {
        sequence: record.sequence,
        id: record.id,
        commandId: record.commandId,
        streams: Object.fromEntries(
          ['stdout', 'stderr'].map((stream) => [
            stream,
            {
              fileName: `native-command-1.${stream}.log`,
              bytes: contents[stream].length,
              sha256: hash(contents[stream]),
              contentBase64: contents[stream].toString('base64'),
            },
          ])
        ),
      },
    ],
    resultReuse: false,
  };
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'seerrng-run-reconciliation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const evidenceDirectory = join(root, 'production-run-1');
  mkdirSync(evidenceDirectory);
  const runId = 'production-run-1';
  const candidate = {
    repository: 'JohnCronk79/seerrng',
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    lockSha256: digest('c'),
    sourceSha256: digest('d'),
  };
  const profile = createAdaptiveTimingProfile();
  const catalog = createCatalog('seerrng', candidate);
  const schedule = createSchedule(catalog, candidate, profile);
  const report = createRunReport(schedule, catalog, runId);
  const repositoryEvidence = createRepositoryEvidence({
    catalog,
    schedule,
    report,
  });
  const result = createStageResult({ candidate, repositoryEvidence, runId });
  const timings = createTimingEvidence(result, repositoryEvidence, runId);
  const paths = {
    processLedger: join(evidenceDirectory, 'native-command-receipts.jsonl'),
    processLedgerSummary: join(evidenceDirectory, 'native-process-ledger.json'),
    processStreams: join(evidenceDirectory, 'native-process-streams.json'),
    result: join(evidenceDirectory, 'staged-validation-result.json'),
    timings: join(evidenceDirectory, 'timings.json'),
  };
  writeJson(paths.result, result);
  writeJson(paths.timings, timings);
  const ledgerBytes = createProcessLedger(candidate);
  writeFileSync(paths.processLedger, ledgerBytes);
  writeJson(paths.processStreams, createProcessStreams(ledgerBytes));
  writeJson(paths.processLedgerSummary, {
    schema: 'seerrng-distributed-linux-process-ledger/v1',
    records: 1,
    pending: [],
    cleanupVerified: true,
    sourceSha256: hash(ledgerBytes),
    evidenceSha256: hash(ledgerBytes),
    evidenceFile: paths.processLedger,
  });
  const input = {
    evidenceDirectory,
    files: paths,
    expected: {
      activeConfigPath: join(root, 'active-config'),
      applicationEntryId: '01',
      profileSha256: canonicalJsonSha256(profile),
      runId,
      runtimeApplicationKey: 'seerrng',
    },
  };
  return { input, paths, result };
}

function rewriteResult(selected, mutate) {
  const result = readJson(selected.paths.result);
  mutate(result);
  writeJson(selected.paths.result, result);
  return result;
}

function resealRepositoryEvidence(result) {
  const evidence = result.nativeEvidence['native-repository'];
  const report = evidence.repositoryEvidence.report;
  const reportCore = { ...report };
  delete reportCore.reportSha256;
  report.reportSha256 = canonicalJsonSha256(reportCore);
  const unit = result.results.find(({ id }) => id === 'native-repository');
  unit.evidenceSha256 = hash(Buffer.from(JSON.stringify(evidence), 'utf8'));
}

function rewriteLedger(selected, mutate) {
  const lines = readFileSync(selected.paths.processLedger, 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  mutate(lines);
  const bytes = Buffer.from(
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    'utf8'
  );
  writeFileSync(selected.paths.processLedger, bytes);
  const summary = readJson(selected.paths.processLedgerSummary);
  summary.sourceSha256 = hash(bytes);
  summary.evidenceSha256 = hash(bytes);
  writeJson(selected.paths.processLedgerSummary, summary);
}

function rewriteProcessStreams(selected, mutate) {
  const streams = readJson(selected.paths.processStreams);
  mutate(streams);
  writeJson(selected.paths.processStreams, streams);
}

test('independently reconciles all durable pre-success evidence', (t) => {
  const selected = fixture(t);
  const result = reconcileDistributedLinuxRunEvidence(selected.input);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'passed');
  assert.equal(result.runId, selected.input.expected.runId);
  assert.equal(result.repositoryEvidence.completed, true);
  assert.equal(result.evidenceManifest.files.length, 5);
  assert.match(result.evidenceManifestSha256, /^[a-f0-9]{64}$/u);
  assert.match(result.repositoryEvidenceSha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.cleanup.verified, true);
  assert.equal(result.cleanup.processReceiptCount, 1);
  assert.equal(result.cleanup.rawStreamCount, 2);
  assert.equal(result.timing.stageCount, 4);
});

test('rejects a staged result changed after its durable write', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    result.runId = 'another-run';
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /run ID differs/u
  );
});

test('rejects a missing durable evidence file', (t) => {
  const selected = fixture(t);
  unlinkSync(selected.paths.timings);

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /timings evidence file is missing/u
  );
});

test('rejects duplicate evidence paths before reading roles', (t) => {
  const selected = fixture(t);
  const input = clone(selected.input);
  input.files.timings = input.files.result;

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(input),
    /paths contain a duplicate/u
  );
});

test('rejects a failed required stage even when the top-level label is green', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    result.lanes[0].status = 'failed';
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Required repository lane did not pass/u
  );
});

test('rejects a shard outcome moved off its sealed node assignment', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    const repository =
      result.nativeEvidence['native-repository'].repositoryEvidence;
    repository.report.outcomes[0].nodeId = 'wrong-node';
    repository.shards[0].nodeId = 'wrong-node';
    resealRepositoryEvidence(result);
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /sealed assignment|changed assignment/u
  );
});

test('rejects an available application node omitted from the admission partition', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    const repository =
      result.nativeEvidence['native-repository'].repositoryEvidence;
    repository.applicationAdmission.availableNodes.push({
      nodeId: 'orphan-node',
    });
    resealRepositoryEvidence(result);
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Application node admission partition differs/u
  );
});

test('rejects an available dependency node omitted from the admission partition', (t) => {
  const selected = fixture(t);
  rewriteResult(selected, (result) => {
    const repository =
      result.nativeEvidence['native-repository'].repositoryEvidence;
    repository.dependencyAdmission = {
      schema: 'test-dependency-admission/v1',
      availableNodes: [{ nodeId: 'controller' }, { nodeId: 'orphan-node' }],
      usableNodes: [{ nodeId: 'controller' }],
      excludedNodes: [],
    };
    resealRepositoryEvidence(result);
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Dependency node admission partition differs/u
  );
});

test('rejects incomplete durable timing evidence', (t) => {
  const selected = fixture(t);
  const timings = readJson(selected.paths.timings);
  timings.units.pop();
  writeJson(selected.paths.timings, timings);

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /Durable timing evidence differs/u
  );
});

test('rejects a process receipt whose cleanup did not complete', (t) => {
  const selected = fixture(t);
  rewriteLedger(selected, (lines) => {
    lines[1].lifecycle.cleanupVerified = false;
    lines[1].lifecycle.cleanupError = 'focused cleanup failure';
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /cleanup did not complete/u
  );
});

test('rejects a raw process stream whose bytes differ from its ledger', (t) => {
  const selected = fixture(t);
  rewriteProcessStreams(selected, (streams) => {
    streams.records[0].streams.stdout.contentBase64 = Buffer.from(
      'tampered\n',
      'utf8'
    ).toString('base64');
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /stdout content differs/u
  );
});

test('rejects a raw process stream bundle bound to another ledger', (t) => {
  const selected = fixture(t);
  rewriteProcessStreams(selected, (streams) => {
    streams.sourceLedgerSha256 = digest('f');
  });

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /stream bundle is incomplete/u
  );
});

test('rejects evidence with a timestamp predating the fresh run directory', (t) => {
  const selected = fixture(t);
  const stale = new Date('2000-01-01T00:00:00.000Z');
  utimesSync(selected.paths.result, stale, stale);

  assert.throws(
    () => reconcileDistributedLinuxRunEvidence(selected.input),
    /evidence is stale/u
  );
});
