import assert from 'node:assert/strict';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These tests run in native Node without application TS aliases.
import {
  assessDistributedWorkerCapacity,
  createAdaptiveTimingProfile,
  createDistributedAdaptiveSchedule,
  estimateAdaptiveTestWork,
  updateAdaptiveTimingProfile,
  verifyDistributedAdaptiveSchedule,
} from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These tests run in native Node without application TS aliases.
import {
  canonicalJsonSha256,
} from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const repositoryIdentitySha256 = '9'.repeat(64);
const alternateRepositoryIdentitySha256 = '8'.repeat(64);

const scope = (
  environment,
  workerClass,
  {
    applicationId = 'seerrng',
    laneId = 'unit',
    adapterId = 'native-generic',
    repositoryIdentity = repositoryIdentitySha256,
    selectedN = 1,
  } = {}
) => ({
  applicationId,
  laneId,
  adapterId,
  repositoryIdentitySha256: repositoryIdentity,
  environment,
  workerClass,
  selectedN,
});

const timingTestEntry = (id, fingerprint = `${id}-v1`) => ({
  id,
  fingerprint,
});

const testEntry = (
  id,
  fingerprint = `${id}-v1`,
  {
    applicationId = 'seerrng',
    laneId = 'unit',
    adapterId = 'native-generic',
    repositoryIdentity = repositoryIdentitySha256,
    dependencies = [],
  } = {}
) => ({
  id,
  fingerprint,
  applicationId,
  laneId,
  adapterId,
  repositoryIdentitySha256: repositoryIdentity,
  dependencies,
});

const resultEntry = (id, durationMs, fingerprint = `${id}-v1`) => ({
  testId: id,
  fingerprint,
  durationMs,
  status: 'passed',
});

const observation = ({
  selectedScope,
  runId,
  performanceScorePermille,
  results,
  candidateSha256 = 'a'.repeat(64),
  revision = 'candidate-revision-1',
}) => ({
  scope: selectedScope,
  runId,
  candidateSha256,
  revision,
  valid: true,
  complete: true,
  status: 'passed',
  benchmark: {
    valid: true,
    performanceScorePermille,
  },
  inventory: results.map((result) => ({
    id: result.testId,
    fingerprint: result.fingerprint,
  })),
  results,
});

const worker = ({
  id,
  selectedScope,
  threads,
  performanceScorePermille,
  concurrency = { mode: 'auto' },
  role = 'worker',
  currentLoadPermille = 0,
  memory = null,
  localInteractiveReserveThreads,
  runsOnControllerHost = false,
  adapterIds = ['native-generic'],
}) => ({
  id,
  scope: selectedScope,
  adapterIds,
  effectiveLogicalThreads: threads,
  concurrency,
  role,
  currentLoadPermille,
  memory,
  localInteractiveReserveThreads,
  runsOnControllerHost,
  benchmark: {
    valid: true,
    performanceScorePermille,
  },
});

const scheduleExpectations = (schedule) => ({
  expectedApplicationId: schedule.applicationId,
  expectedProfileSha256: schedule.profileSha256,
  expectedRepositoryIdentitySha256: schedule.repositoryIdentitySha256,
  expectedScheduleSha256: schedule.scheduleSha256,
  expectedTestInventorySha256: schedule.testInventorySha256,
});

const scheduledTest = (schedule, testId) =>
  schedule.slots
    .flatMap((slot) => slot.tests)
    .find((entry) => entry.id === testId);

const rehashSchedule = (schedule, mutate) => {
  const changed = structuredClone(schedule);
  mutate(changed);
  const { scheduleSha256: _scheduleSha256, ...unsigned } = changed;
  changed.scheduleSha256 = canonicalJsonSha256(unsigned);
  return changed;
};

const refreshScheduleInventoryHash = (schedule) => {
  schedule.testInventorySha256 = canonicalJsonSha256(
    schedule.slots
      .flatMap((slot) => slot.tests)
      .map((entry) => ({
        id: entry.id,
        fingerprint: entry.fingerprint,
        applicationId: schedule.applicationId,
        laneId: entry.laneId,
        adapterId: entry.adapterId,
        repositoryIdentitySha256: schedule.repositoryIdentitySha256,
        dependencies: entry.dependencies,
      }))
      .toSorted((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      )
  );
};

const continuousDependencyFixture = () => {
  const selectedScope = scope('linux-x64', 'worker-standard', {
    selectedN: 2,
  });
  const results = [
    resultEntry('unit/long.test.ts', 100),
    resultEntry('unit/short.test.ts', 10),
    resultEntry('unit/followup.test.ts', 10),
    resultEntry('unit/final.test.ts', 10),
  ];
  const profile = updateAdaptiveTimingProfile(
    createAdaptiveTimingProfile(),
    observation({
      selectedScope,
      runId: 'continuous-green',
      performanceScorePermille: 100,
      results,
    })
  ).profile;
  const tests = [
    testEntry('unit/final.test.ts', 'unit/final.test.ts-v1', {
      dependencies: ['unit/followup.test.ts'],
    }),
    testEntry('unit/followup.test.ts', 'unit/followup.test.ts-v1', {
      dependencies: ['unit/short.test.ts'],
    }),
    testEntry('unit/long.test.ts'),
    testEntry('unit/short.test.ts'),
  ];
  const workers = [
    worker({
      id: 'worker-a',
      selectedScope,
      threads: 4,
      performanceScorePermille: 100,
      concurrency: { mode: 'explicit', threads: 2 },
    }),
  ];
  return {
    profile,
    tests,
    workers,
    schedule: createDistributedAdaptiveSchedule({ tests, workers, profile }),
  };
};

test('worker admission applies explicit N, load, memory, and local reserve without using clock speed', () => {
  const candidate = {
    ...worker({
      id: 'developer-main',
      selectedScope: scope('windows-x64', 'desktop-fast'),
      threads: 16,
      performanceScorePermille: 200,
      concurrency: { mode: 'explicit', threads: 4 },
      role: 'worker',
      runsOnControllerHost: true,
      currentLoadPermille: 250,
      memory: {
        availableBytes: 6_000,
        reserveBytes: 2_000,
        bytesPerThread: 1_000,
      },
      localInteractiveReserveThreads: 2,
    }),
    clockSpeedMhz: 9_999,
  };
  const admitted = assessDistributedWorkerCapacity(candidate);
  assert.equal(admitted.schema, 'seerrng-distributed-worker-capacity/v2');
  assert.equal(admitted.concurrencyPolicy, 'explicit');
  assert.equal(admitted.configuredThreadBudget, 4);
  assert.equal(admitted.loadReservedThreads, 4);
  assert.equal(admitted.interactiveReservedThreads, 2);
  assert.equal(admitted.memoryLimitedThreads, 4);
  assert.equal(admitted.availableThreads, 4);
  assert.equal(admitted.admissionStatus, 'admitted');
  assert.equal(admitted.admittedThreads, 4);
  assert.equal(admitted.performanceScoreSource, 'measured-benchmark');
  assert.equal(admitted.capacityWeight, 800);
  assert.equal(Object.hasOwn(admitted, 'clockSpeedMhz'), false);
});

test('explicit N fails closed while auto N adapts to current capacity', () => {
  const common = {
    id: 'worker-a',
    selectedScope: scope('linux-x64', 'standard'),
    threads: 8,
    performanceScorePermille: 100,
    currentLoadPermille: 250,
    role: 'worker',
    runsOnControllerHost: true,
  };
  const rejected = assessDistributedWorkerCapacity(
    worker({
      ...common,
      concurrency: { mode: 'explicit', threads: 6 },
    })
  );
  assert.equal(rejected.availableThreads, 5);
  assert.equal(rejected.admissionStatus, 'rejected');
  assert.equal(rejected.admissionReason, 'explicit-thread-budget-unavailable');
  assert.equal(rejected.admittedThreads, 0);
  assert.equal(rejected.capacityWeight, 0);

  const adaptive = assessDistributedWorkerCapacity(worker(common));
  assert.equal(adaptive.concurrencyPolicy, 'auto');
  assert.equal(adaptive.admissionStatus, 'admitted');
  assert.equal(adaptive.admittedThreads, 5);
  assert.equal(adaptive.capacityWeight, 500);

  const unavailable = assessDistributedWorkerCapacity(
    worker({
      ...common,
      role: 'worker',
      currentLoadPermille: 1_000,
    })
  );
  assert.equal(unavailable.admissionStatus, 'unavailable');
  assert.equal(unavailable.admissionReason, 'no-current-capacity');
  assert.equal(unavailable.admittedThreads, 0);
});

test('worker role and controller-host placement remain independent', () => {
  const selectedScope = scope('linux-x64', 'standard');
  const remote = assessDistributedWorkerCapacity(
    worker({
      id: 'remote-worker',
      selectedScope,
      threads: 8,
      performanceScorePermille: 100,
      localInteractiveReserveThreads: 3,
      runsOnControllerHost: false,
    })
  );
  assert.equal(remote.role, 'worker');
  assert.equal(remote.runsOnControllerHost, false);
  assert.equal(remote.interactiveReservedThreads, 0);
  assert.equal(remote.availableThreads, 8);

  const local = assessDistributedWorkerCapacity(
    worker({
      id: 'local-worker',
      selectedScope,
      threads: 8,
      performanceScorePermille: 100,
      runsOnControllerHost: true,
    })
  );
  assert.equal(local.role, 'worker');
  assert.equal(local.runsOnControllerHost, true);
  assert.equal(local.interactiveReservedThreads, 1);
  assert.equal(local.availableThreads, 7);

  assert.throws(
    () =>
      assessDistributedWorkerCapacity(
        worker({
          id: 'invalid-role',
          selectedScope,
          threads: 8,
          performanceScorePermille: 100,
          role: 'controller',
          runsOnControllerHost: true,
        })
      ),
    /role must be worker/
  );
});

test('an unmeasured worker receives a conservative benchmark weight', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  const measured = worker({
    id: 'measured',
    selectedScope,
    threads: 4,
    performanceScorePermille: 100,
    concurrency: { mode: 'explicit', threads: 1 },
  });
  const unmeasured = {
    ...worker({
      id: 'unmeasured',
      selectedScope,
      threads: 4,
      performanceScorePermille: 9_999,
      concurrency: { mode: 'explicit', threads: 1 },
    }),
    benchmark: null,
  };
  const schedule = createDistributedAdaptiveSchedule({
    tests: [testEntry('unit/a.test.ts')],
    workers: [unmeasured, measured],
    profile: createAdaptiveTimingProfile(),
  });
  assert.deepEqual(
    schedule.workers.map((entry) => [
      entry.workerId,
      entry.performanceScoreSource,
      entry.performanceScorePermille,
    ]),
    [
      ['measured', 'measured-benchmark', 100],
      ['unmeasured', 'cold-start-conservative', 50],
    ]
  );
  assert.deepEqual(
    schedule.slots[0].tests.map((entry) => entry.id),
    ['unit/a.test.ts']
  );
  assert.deepEqual(schedule.slots[1].tests, []);
});

test('timing calibration is isolated by environment and worker class', () => {
  const windowsScope = scope('windows-x64', 'desktop-fast');
  const linuxScope = scope('linux-x64', 'github-standard');
  const first = updateAdaptiveTimingProfile(
    createAdaptiveTimingProfile(),
    observation({
      selectedScope: windowsScope,
      runId: 'windows-1',
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 40)],
    })
  );
  const second = updateAdaptiveTimingProfile(
    first.profile,
    observation({
      selectedScope: linuxScope,
      runId: 'linux-1',
      performanceScorePermille: 200,
      results: [resultEntry('unit/a.test.ts', 30)],
    })
  );
  assert.equal(second.profile.scopes.length, 2);
  assert.deepEqual(
    second.profile.scopes.map((entry) => [
      entry.environment,
      entry.workerClass,
      entry.tests[0].estimateWorkUnits,
    ]),
    [
      ['linux-x64', 'github-standard', 6_000],
      ['windows-x64', 'desktop-fast', 4_000],
    ]
  );
});

test('timing scopes isolate repository, application, lane, adapter, environment, worker class, and selected N', () => {
  const scopes = [
    scope('linux-x64', 'worker-standard'),
    scope('linux-x64', 'worker-standard', { applicationId: 'other-app' }),
    scope('linux-x64', 'worker-standard', { laneId: 'cypress' }),
    scope('linux-x64', 'worker-standard', { adapterId: 'cypress-native' }),
    scope('linux-x64', 'worker-standard', {
      repositoryIdentity: alternateRepositoryIdentitySha256,
    }),
    scope('windows-x64', 'worker-standard'),
    scope('linux-x64', 'worker-fast'),
    scope('linux-x64', 'worker-standard', { selectedN: 2 }),
  ];
  let profile = createAdaptiveTimingProfile();
  for (const [index, selectedScope] of scopes.entries())
    profile = updateAdaptiveTimingProfile(
      profile,
      observation({
        selectedScope,
        runId: `scope-${index}`,
        performanceScorePermille: 100,
        results: [resultEntry('unit/a.test.ts', 10 + index)],
      })
    ).profile;
  assert.equal(profile.scopes.length, scopes.length);
  assert.deepEqual(
    scopes.map((selectedScope) =>
      estimateAdaptiveTestWork(profile, {
        scope: selectedScope,
        test: timingTestEntry('unit/a.test.ts'),
      }).workUnits
    ),
    scopes.map((_, index) => (10 + index) * 100)
  );
});

test('durable observation identity prevents replay after rolling run history', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  const policy = {
    acceptedRunWindow: 2,
    maximumSamplesPerTest: 2,
  };
  let profile = createAdaptiveTimingProfile();
  for (const runId of ['run-1', 'run-2', 'run-3'])
    profile = updateAdaptiveTimingProfile(
      profile,
      observation({
        selectedScope,
        runId,
        performanceScorePermille: 100,
        results: [resultEntry('unit/a.test.ts', 100)],
      }),
      policy
    ).profile;
  assert.deepEqual(profile.scopes[0].acceptedRunIds, ['run-2', 'run-3']);
  assert.equal(profile.scopes[0].acceptedObservations.length, 3);
  assert.deepEqual(
    profile.scopes[0].acceptedObservations.map(
      ({ runId, candidateSha256, revision }) => ({
        runId,
        candidateSha256,
        revision,
      })
    ),
    ['run-1', 'run-2', 'run-3'].map((runId) => ({
      runId,
      candidateSha256: 'a'.repeat(64),
      revision: 'candidate-revision-1',
    }))
  );
  const replay = updateAdaptiveTimingProfile(
    profile,
    observation({
      selectedScope,
      runId: 'run-1',
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 1)],
    }),
    policy
  );
  assert.equal(replay.accepted, false);
  assert.equal(replay.reason, 'duplicate-observation');
  assert.deepEqual(replay.profile, profile);
});

test('only complete valid successful runs update timing history', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  const passing = observation({
    selectedScope,
    runId: 'run-1',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 100)],
  });
  const empty = createAdaptiveTimingProfile();
  for (const patch of [
    { valid: false },
    { complete: false },
    { status: 'failed' },
  ]) {
    const ignored = updateAdaptiveTimingProfile(empty, {
      ...passing,
      ...patch,
    });
    assert.equal(ignored.accepted, false);
    assert.deepEqual(ignored.profile, empty);
  }
  const failedTest = updateAdaptiveTimingProfile(empty, {
    ...passing,
    results: [{ ...passing.results[0], status: 'failed', durationMs: 1 }],
  });
  assert.equal(failedTest.accepted, false);
  assert.equal(failedTest.reason, 'unsuccessful-test');
  assert.deepEqual(failedTest.profile, empty);

  const accepted = updateAdaptiveTimingProfile(empty, passing);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.updatedTests, 1);
  assert.equal(
    accepted.profile.scopes[0].tests[0].estimateWorkUnits,
    10_000
  );
  const duplicate = updateAdaptiveTimingProfile(accepted.profile, passing);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'duplicate-observation');
  assert.deepEqual(duplicate.profile, accepted.profile);
});

test('failed and partial observations cannot make a test appear artificially fast', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  const initial = updateAdaptiveTimingProfile(
    createAdaptiveTimingProfile(),
    observation({
      selectedScope,
      runId: 'green-1',
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 100)],
    })
  ).profile;
  const failed = updateAdaptiveTimingProfile(initial, {
    ...observation({
      selectedScope,
      runId: 'failed-2',
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 1)],
    }),
    status: 'failed',
  });
  const partial = updateAdaptiveTimingProfile(initial, {
    ...observation({
      selectedScope,
      runId: 'partial-2',
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 1)],
    }),
    complete: false,
  });
  assert.deepEqual(failed.profile, initial);
  assert.deepEqual(partial.profile, initial);
  assert.equal(
    estimateAdaptiveTestWork(initial, {
      scope: selectedScope,
      test: timingTestEntry('unit/a.test.ts'),
    }).workUnits,
    10_000
  );
});

test('new and changed tests receive conservative fallback estimates', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  const profile = updateAdaptiveTimingProfile(
    createAdaptiveTimingProfile(),
    observation({
      selectedScope,
      runId: 'green-1',
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 100)],
    })
  ).profile;
  const policy = {
    coldStartDurationMs: 100,
    coldStartPerformanceScorePermille: 10,
  };
  assert.deepEqual(
    estimateAdaptiveTestWork(
      profile,
      {
        scope: selectedScope,
        test: timingTestEntry('unit/b.test.ts'),
      },
      policy
    ),
    { workUnits: 12_500, source: 'new-test' }
  );
  assert.deepEqual(
    estimateAdaptiveTestWork(
      profile,
      {
        scope: selectedScope,
        test: timingTestEntry('unit/a.test.ts', 'a-v2'),
      },
      policy
    ),
    { workUnits: 10_000, source: 'changed-test' }
  );
  assert.deepEqual(
    estimateAdaptiveTestWork(
      profile,
      {
        scope: scope('macos-arm64', 'unknown'),
        test: timingTestEntry('unit/a.test.ts'),
      },
      policy
    ),
    { workUnits: 1_000, source: 'cold-start' }
  );
});

test('rolling calibration is bounded and robust against a single extreme sample', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  let profile = createAdaptiveTimingProfile();
  const durations = [100, 101, 99, 100, 10_000, 102, 98, 100, 101, 99];
  for (const [index, durationMs] of durations.entries()) {
    profile = updateAdaptiveTimingProfile(
      profile,
      observation({
        selectedScope,
        runId: `green-${index}`,
        performanceScorePermille: 100,
        results: [resultEntry('unit/a.test.ts', durationMs)],
      }),
      { maximumSamplesPerTest: 9 }
    ).profile;
  }
  const timing = profile.scopes[0].tests[0];
  assert.equal(timing.samplesWorkUnits.length, 9);
  assert.equal(timing.samplesWorkUnits.includes(1_000_000), true);
  assert.ok(timing.estimateWorkUnits >= 9_900);
  assert.ok(timing.estimateWorkUnits <= 10_200);
});

test('heterogeneous scheduling is deterministic across N discrete per-worker slots', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  const twoSlotScope = scope('linux-x64', 'worker-standard', {
    selectedN: 2,
  });
  const results = [
    resultEntry('unit/a.test.ts', 100),
    resultEntry('unit/b.test.ts', 50),
    resultEntry('unit/c.test.ts', 50),
  ];
  const twoSlotProfile = updateAdaptiveTimingProfile(
    createAdaptiveTimingProfile(),
    observation({
      selectedScope: twoSlotScope,
      runId: 'green-n2',
      performanceScorePermille: 100,
      results,
    })
  ).profile;
  const profile = updateAdaptiveTimingProfile(
    twoSlotProfile,
    observation({
      selectedScope,
      runId: 'green-n1',
      performanceScorePermille: 200,
      results: [
        resultEntry('unit/a.test.ts', 50),
        resultEntry('unit/b.test.ts', 25),
        resultEntry('unit/c.test.ts', 25),
      ],
    })
  ).profile;
  const workers = [
    worker({
      id: 'worker-a',
      selectedScope,
      threads: 8,
      performanceScorePermille: 100,
      concurrency: { mode: 'explicit', threads: 2 },
    }),
    worker({
      id: 'worker-b',
      selectedScope,
      threads: 8,
      performanceScorePermille: 200,
      concurrency: { mode: 'explicit', threads: 1 },
    }),
  ];
  const tests = results.map((result) =>
    testEntry(result.testId, result.fingerprint)
  );
  const first = createDistributedAdaptiveSchedule({
    tests,
    workers,
    profile,
  });
  const reordered = createDistributedAdaptiveSchedule({
    tests: [...tests].reverse(),
    workers: [...workers].reverse(),
    profile,
  });
  assert.deepEqual(reordered, first);
  assert.deepEqual(
    verifyDistributedAdaptiveSchedule(first, scheduleExpectations(first)),
    first
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.workers), true);
  assert.equal(Object.isFrozen(first.workers[0]), true);
  assert.equal(Object.isFrozen(first.slots), true);
  assert.equal(Object.isFrozen(first.slots[0].tests), true);
  assert.equal(Object.isFrozen(first.slots[0].tests[0]), true);
  assert.equal(first.schema, 'seerrng-distributed-adaptive-schedule/v2');
  assert.equal(
    first.algorithm,
    'deterministic-heterogeneous-dependency-list/v1'
  );
  assert.equal(first.applicationId, 'seerrng');
  assert.equal(first.repositoryIdentitySha256, repositoryIdentitySha256);
  assert.deepEqual(
    first.workers.map((entry) => [
      entry.workerId,
      entry.admittedThreads,
      entry.capacityWeight,
    ]),
    [
      ['worker-a', 2, 200],
      ['worker-b', 1, 200],
    ]
  );
  assert.deepEqual(
    first.slots.map((slot) => [
      slot.slotId,
      slot.tests.map((entry) => entry.id),
      slot.predictedFinishOffsetMs,
    ]),
    [
      ['worker-a.slot-1', ['unit/b.test.ts'], 50],
      ['worker-a.slot-2', ['unit/c.test.ts'], 50],
      ['worker-b.slot-1', ['unit/a.test.ts'], 50],
    ]
  );
  assert.equal(first.predictedWallMs, 50);
});

test('one test occupies one slot and cannot claim divisible N speedup', () => {
  const selectedScope = scope('linux-x64', 'worker-standard', {
    selectedN: 4,
  });
  const profile = updateAdaptiveTimingProfile(
    createAdaptiveTimingProfile(),
    observation({
      selectedScope,
      runId: 'green-n4',
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 100)],
    })
  ).profile;
  const schedule = createDistributedAdaptiveSchedule({
    tests: [testEntry('unit/a.test.ts')],
    workers: [
      worker({
        id: 'worker-a',
        selectedScope,
        threads: 8,
        performanceScorePermille: 100,
        concurrency: { mode: 'explicit', threads: 4 },
      }),
    ],
    profile,
  });
  assert.equal(schedule.slots.length, 4);
  assert.equal(schedule.slots[0].predictedFinishOffsetMs, 100);
  assert.deepEqual(
    schedule.slots.map((slot) => slot.tests.length),
    [1, 0, 0, 0]
  );
  assert.equal(schedule.predictedWallMs, 100);
});

test('one schedule cannot mix application or repository namespaces', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  const workers = [
    worker({
      id: 'worker-a',
      selectedScope,
      threads: 4,
      performanceScorePermille: 100,
      concurrency: { mode: 'explicit', threads: 1 },
    }),
  ];
  const schedule = (tests) =>
    createDistributedAdaptiveSchedule({
      tests,
      workers,
      profile: createAdaptiveTimingProfile(),
    });
  assert.throws(
    () =>
      schedule([
        testEntry('unit/a.test.ts'),
        testEntry('unit/b.test.ts', 'b-v1', {
          applicationId: 'another-app',
          dependencies: ['unit/a.test.ts'],
        }),
      ]),
    /exactly one application namespace/
  );
  assert.throws(
    () =>
      schedule([
        testEntry('unit/a.test.ts'),
        testEntry('unit/b.test.ts', 'b-v1', {
          repositoryIdentity: alternateRepositoryIdentitySha256,
          dependencies: ['unit/a.test.ts'],
        }),
      ]),
    /exactly one repository namespace/
  );
});

test('adapter eligibility excludes workers that cannot run a test', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  const schedule = createDistributedAdaptiveSchedule({
    tests: [
      testEntry('cypress/a.cy.ts', 'a-v1', {
        laneId: 'cypress',
        adapterId: 'cypress-native',
      }),
    ],
    workers: [
      worker({
        id: 'unit-only',
        selectedScope,
        threads: 4,
        performanceScorePermille: 100,
        concurrency: { mode: 'explicit', threads: 1 },
        adapterIds: ['native-generic'],
      }),
      worker({
        id: 'cypress-capable',
        selectedScope,
        threads: 4,
        performanceScorePermille: 100,
        concurrency: { mode: 'explicit', threads: 1 },
        adapterIds: ['cypress-native'],
      }),
    ],
    profile: createAdaptiveTimingProfile(),
  });
  assert.deepEqual(
    schedule.slots.map((slot) => [
      slot.workerId,
      slot.tests.map((entry) => entry.id),
    ]),
    [
      ['cypress-capable', ['cypress/a.cy.ts']],
      ['unit-only', []],
    ]
  );
  assert.throws(
    () =>
      createDistributedAdaptiveSchedule({
        tests: [
          testEntry('cypress/a.cy.ts', 'a-v1', {
            laneId: 'cypress',
            adapterId: 'cypress-native',
          }),
        ],
        workers: [
          worker({
            id: 'unit-only',
            selectedScope,
            threads: 4,
            performanceScorePermille: 100,
            concurrency: { mode: 'explicit', threads: 1 },
            adapterIds: ['native-generic'],
          }),
        ],
        profile: createAdaptiveTimingProfile(),
      }),
    /No admitted worker supports adapter cypress-native/
  );
});

test('dependencies release continuously without a global stage barrier', () => {
  const { profile, schedule, tests, workers } = continuousDependencyFixture();
  const reordered = createDistributedAdaptiveSchedule({
    tests: [...tests].reverse(),
    workers,
    profile,
  });
  assert.deepEqual(reordered, schedule);

  const long = scheduledTest(schedule, 'unit/long.test.ts');
  const short = scheduledTest(schedule, 'unit/short.test.ts');
  const followup = scheduledTest(schedule, 'unit/followup.test.ts');
  const final = scheduledTest(schedule, 'unit/final.test.ts');
  assert.deepEqual(
    [
      [long.predictedStartOffsetMs, long.predictedFinishOffsetMs],
      [short.predictedStartOffsetMs, short.predictedFinishOffsetMs],
      [followup.predictedStartOffsetMs, followup.predictedFinishOffsetMs],
      [final.predictedStartOffsetMs, final.predictedFinishOffsetMs],
    ],
    [
      [0, 100],
      [0, 10],
      [10, 20],
      [20, 30],
    ]
  );
  assert.deepEqual(
    schedule.slots.map((slot) => slot.tests.map((entry) => entry.id)),
    [
      ['unit/long.test.ts'],
      [
        'unit/short.test.ts',
        'unit/followup.test.ts',
        'unit/final.test.ts',
      ],
    ]
  );
  assert.equal(schedule.predictedWallMs, 100);

  const selectedScope = scope('linux-x64', 'worker-standard');
  assert.throws(
    () =>
      createDistributedAdaptiveSchedule({
        tests: [
          testEntry('unit/a.test.ts', 'a-v1', {
            dependencies: ['unit/b.test.ts'],
          }),
          testEntry('unit/b.test.ts', 'b-v1', {
            dependencies: ['unit/a.test.ts'],
          }),
        ],
        workers: [
          worker({
            id: 'worker-a',
            selectedScope,
            threads: 4,
            performanceScorePermille: 100,
          }),
        ],
        profile: createAdaptiveTimingProfile(),
      }),
    /dependencies contain a cycle/
  );
});

test('schedule verifier rejects external bindings and hostile rehashes', () => {
  const { schedule } = continuousDependencyFixture();
  assert.deepEqual(
    verifyDistributedAdaptiveSchedule(schedule, scheduleExpectations(schedule)),
    schedule
  );

  for (const [field, value, message] of [
    ['expectedScheduleSha256', 'f'.repeat(64), /trusted hash/],
    ['expectedApplicationId', 'another-app', /another application/],
    [
      'expectedRepositoryIdentitySha256',
      alternateRepositoryIdentitySha256,
      /another repository/,
    ],
    ['expectedTestInventorySha256', 'f'.repeat(64), /another test inventory/],
    ['expectedProfileSha256', 'f'.repeat(64), /another timing profile/],
  ])
    assert.throws(
      () =>
        verifyDistributedAdaptiveSchedule(schedule, {
          ...scheduleExpectations(schedule),
          [field]: value,
        }),
      message
    );

  const dependencyBeforePredecessor = rehashSchedule(schedule, (changed) => {
    const followup = scheduledTest(changed, 'unit/followup.test.ts');
    followup.dependencies = ['unit/long.test.ts'];
    refreshScheduleInventoryHash(changed);
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        dependencyBeforePredecessor,
        scheduleExpectations(dependencyBeforePredecessor)
      ),
    /before its dependency/
  );

  const overlappingSlot = rehashSchedule(schedule, (changed) => {
    const final = scheduledTest(changed, 'unit/final.test.ts');
    final.predictedStartOffsetMs = 15;
    final.predictedFinishOffsetMs = 25;
    changed.slots[1].predictedFinishOffsetMs = 25;
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        overlappingSlot,
        scheduleExpectations(overlappingSlot)
      ),
    /overlap/
  );

  const incompatibleAdapter = rehashSchedule(schedule, (changed) => {
    changed.workers[0].adapterIds = ['another-adapter'];
    changed.workerCapacitiesSha256 = canonicalJsonSha256(changed.workers);
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        incompatibleAdapter,
        scheduleExpectations(incompatibleAdapter)
      ),
    /incompatible adapter/
  );

  const duplicateSequence = rehashSchedule(schedule, (changed) => {
    scheduledTest(changed, 'unit/long.test.ts').sequence = 2;
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        duplicateSequence,
        scheduleExpectations(duplicateSequence)
      ),
    /sequences must be contiguous/
  );

  const reversedSequenceTimeline = rehashSchedule(schedule, (changed) => {
    scheduledTest(changed, 'unit/long.test.ts').sequence = 4;
    scheduledTest(changed, 'unit/short.test.ts').sequence = 1;
    scheduledTest(changed, 'unit/followup.test.ts').sequence = 2;
    scheduledTest(changed, 'unit/final.test.ts').sequence = 3;
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        reversedSequenceTimeline,
        scheduleExpectations(reversedSequenceTimeline)
      ),
    /sequence timeline is not canonical/
  );

  const wrongWall = rehashSchedule(schedule, (changed) => {
    changed.predictedWallMs = 99;
  });
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        wrongWall,
        scheduleExpectations(wrongWall)
      ),
    /predicted wall time is inconsistent/
  );

  const staleSeal = structuredClone(schedule);
  staleSeal.policySha256 = 'f'.repeat(64);
  assert.throws(
    () =>
      verifyDistributedAdaptiveSchedule(
        staleSeal,
        scheduleExpectations(schedule)
      ),
    /seal does not match/
  );
});

test('a distributed schedule refuses to silently reduce an explicit worker N', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  assert.throws(
    () =>
      createDistributedAdaptiveSchedule({
        tests: [testEntry('unit/a.test.ts')],
        workers: [
          worker({
            id: 'worker-a',
            selectedScope,
            threads: 4,
            performanceScorePermille: 100,
            concurrency: { mode: 'explicit', threads: 4 },
            currentLoadPermille: 500,
          }),
        ],
        profile: createAdaptiveTimingProfile(),
      }),
    /Explicit worker capacity unavailable: worker-a/
  );
});
