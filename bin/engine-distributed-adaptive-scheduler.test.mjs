import assert from 'node:assert/strict';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These tests run in native Node without application TS aliases.
import {
  assessDistributedWorkerCapacity,
  createAdaptiveTimingObservation,
  createAdaptiveTimingProfile,
  createDistributedAdaptiveSchedule,
  distributedAdaptivePolicySha256,
  estimateAdaptiveTestWork,
  MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_BYTES,
  MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_TESTS,
  updateAdaptiveTimingProfile,
  verifyAdaptiveTimingObservation,
  verifyDistributedAdaptiveSchedule,
} from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- These tests run in native Node without application TS aliases.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

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
  profile,
  selectedScope,
  runId,
  performanceScorePermille,
  results,
  inventory = results.map((result) => ({
    id: result.testId,
    fingerprint: result.fingerprint,
  })),
  candidateSha256 = 'a'.repeat(64),
  revision = 'candidate-revision-1',
  valid = true,
  complete = true,
  status = 'passed',
  benchmarkValid = true,
  runAttempt = 1,
  policy = {},
  source = {},
}) =>
  createAdaptiveTimingObservation({
    schema: 'seerrng-distributed-adaptive-observation/v1',
    source: {
      applicationIsolationKeySha256: 'b'.repeat(64),
      brokerReconciliationInputSha256: 'c'.repeat(64),
      candidateSha256,
      executionBridgeSha256: 'd'.repeat(64),
      executionId: runId,
      policySha256: distributedAdaptivePolicySha256(policy),
      profileSha256: canonicalJsonSha256(profile),
      revision,
      runAttempt,
      scheduleTestInventorySha256: '2'.repeat(64),
      scheduleSha256: 'e'.repeat(64),
      submissionSha256: 'f'.repeat(64),
      terminalReconciliationSha256: '1'.repeat(64),
      ...source,
    },
    scope: selectedScope,
    valid,
    complete,
    status,
    benchmark: {
      valid: benchmarkValid,
      performanceScorePermille: benchmarkValid
        ? performanceScorePermille
        : null,
    },
    inventory,
    results,
  });

const observationExpectations = (sealedObservation) => ({
  expectedObservationSha256: sealedObservation.observationSha256,
});

const applyObservation = (profile, options, policy = {}) => {
  const sealedObservation = observation({ ...options, profile, policy });
  return updateAdaptiveTimingProfile(
    profile,
    sealedObservation,
    observationExpectations(sealedObservation),
    policy
  );
};

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

const rehashObservation = (sealedObservation, mutate) => {
  const changed = structuredClone(sealedObservation);
  mutate(changed);
  const { observationSha256: _observationSha256, ...unsigned } = changed;
  changed.observationSha256 = canonicalJsonSha256(unsigned);
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
  const profile = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope,
    runId: 'continuous-green',
    performanceScorePermille: 100,
    results,
  }).profile;
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

test('timing observations are canonical, sealed, bounded, and deeply frozen', () => {
  const profile = createAdaptiveTimingProfile();
  const selectedScope = scope('linux-x64', 'worker-standard');
  const results = [
    resultEntry('unit/b.test.ts', 20),
    resultEntry('unit/a.test.ts', 10),
  ];
  const sealed = observation({
    profile,
    selectedScope,
    runId: 'execution-1',
    performanceScorePermille: 100,
    results,
    inventory: [...results].reverse().map((result) => ({
      id: result.testId,
      fingerprint: result.fingerprint,
    })),
  });
  const reordered = observation({
    profile,
    selectedScope,
    runId: 'execution-1',
    performanceScorePermille: 100,
    results: [...results].reverse(),
  });
  assert.deepEqual(reordered, sealed);
  assert.deepEqual(
    sealed.inventory.map((entry) => entry.id),
    ['unit/a.test.ts', 'unit/b.test.ts']
  );
  assert.deepEqual(
    sealed.results.map((entry) => entry.testId),
    ['unit/a.test.ts', 'unit/b.test.ts']
  );
  assert.deepEqual(
    verifyAdaptiveTimingObservation(sealed, observationExpectations(sealed)),
    sealed
  );
  assert.equal(Object.isFrozen(sealed), true);
  assert.equal(Object.isFrozen(sealed.source), true);
  assert.equal(Object.isFrozen(sealed.scope), true);
  assert.equal(Object.isFrozen(sealed.inventory), true);
  assert.equal(Object.isFrozen(sealed.inventory[0]), true);
  assert.equal(Object.isFrozen(sealed.results), true);
  assert.equal(Object.isFrozen(sealed.results[0]), true);
  assert.deepEqual(Object.keys(sealed.source).toSorted(), [
    'applicationIsolationKeySha256',
    'brokerReconciliationInputSha256',
    'candidateSha256',
    'executionBridgeSha256',
    'executionId',
    'policySha256',
    'profileSha256',
    'revision',
    'runAttempt',
    'scheduleSha256',
    'scheduleTestInventorySha256',
    'submissionSha256',
    'terminalReconciliationSha256',
  ]);
  assert.equal(
    sealed.observedInventorySha256,
    canonicalJsonSha256({
      schema: 'seerrng-distributed-adaptive-observed-inventory/v1',
      scope: sealed.scope,
      inventory: sealed.inventory,
    })
  );
  assert.notEqual(
    sealed.source.scheduleTestInventorySha256,
    sealed.observedInventorySha256
  );

  const {
    observationSha256: _observationSha256,
    observedInventorySha256: _observedInventorySha256,
    ...observationInput
  } = structuredClone(sealed);
  assert.throws(
    () =>
      createAdaptiveTimingObservation({
        ...observationInput,
        unexpected: true,
      }),
    /fields are not canonical/
  );
  assert.throws(
    () =>
      observation({
        profile,
        selectedScope,
        runId: 'too-many-tests',
        performanceScorePermille: 100,
        inventory: Array.from(
          { length: MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_TESTS + 1 },
          () => timingTestEntry('unit/too-many.test.ts')
        ),
        results: [],
      }),
    /inventory limit/
  );
  assert.throws(
    () =>
      observation({
        profile,
        selectedScope,
        runId: 'too-many-bytes',
        performanceScorePermille: 100,
        results: [
          resultEntry(
            'unit/large.test.ts',
            1,
            'x'.repeat(MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_BYTES)
          ),
        ],
      }),
    /byte limit/
  );
});

test('timing observation updates reject hostile rehashes and source-profile drift', () => {
  const profile = createAdaptiveTimingProfile();
  const selectedScope = scope('linux-x64', 'worker-standard');
  const sealed = observation({
    profile,
    selectedScope,
    runId: 'execution-trusted',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 100)],
  });
  const changedDuration = rehashObservation(sealed, (changed) => {
    changed.results[0].durationMs = 1;
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        changedDuration,
        observationExpectations(sealed)
      ),
    /trusted hash/
  );
  const changedBridge = rehashObservation(sealed, (changed) => {
    changed.source.executionBridgeSha256 = '3'.repeat(64);
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        changedBridge,
        observationExpectations(sealed)
      ),
    /trusted hash/
  );
  const changedScheduleInventory = rehashObservation(sealed, (changed) => {
    changed.source.scheduleTestInventorySha256 = '6'.repeat(64);
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        changedScheduleInventory,
        observationExpectations(sealed)
      ),
    /trusted hash/
  );
  const changedObservedInventory = rehashObservation(sealed, (changed) => {
    changed.observedInventorySha256 = '5'.repeat(64);
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        changedObservedInventory,
        observationExpectations(changedObservedInventory)
      ),
    /trusted hash/
  );
  const changedProfile = rehashObservation(sealed, (changed) => {
    changed.source.profileSha256 = '4'.repeat(64);
  });
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        changedProfile,
        observationExpectations(changedProfile)
      ),
    /another source profile/
  );
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        sealed,
        observationExpectations(sealed),
        { rollingQuantilePermille: 900 }
      ),
    /another update policy/
  );
  assert.deepEqual(profile, createAdaptiveTimingProfile());
});

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
  const first = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope: windowsScope,
    runId: 'windows-1',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 40)],
  });
  const second = applyObservation(first.profile, {
    selectedScope: linuxScope,
    runId: 'linux-1',
    performanceScorePermille: 200,
    results: [resultEntry('unit/a.test.ts', 30)],
  });
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
    profile = applyObservation(profile, {
      selectedScope,
      runId: `scope-${index}`,
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 10 + index)],
    }).profile;
  assert.equal(profile.scopes.length, scopes.length);
  assert.deepEqual(
    scopes.map(
      (selectedScope) =>
        estimateAdaptiveTestWork(profile, {
          scope: selectedScope,
          test: timingTestEntry('unit/a.test.ts'),
        }).workUnits
    ),
    scopes.map((_, index) => (10 + index) * 100)
  );
});

test('rolled observation provenance remains replay-safe through its source-profile binding', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  const policy = {
    acceptedRunWindow: 2,
    maximumSamplesPerTest: 2,
  };
  let profile = createAdaptiveTimingProfile();
  const sealedObservations = [];
  for (const runId of ['run-1', 'run-2', 'run-3']) {
    const sealedObservation = observation({
      profile,
      policy,
      selectedScope,
      runId,
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 100)],
    });
    sealedObservations.push(sealedObservation);
    profile = updateAdaptiveTimingProfile(
      profile,
      sealedObservation,
      observationExpectations(sealedObservation),
      policy
    ).profile;
  }
  const [firstObservation, secondObservation] = sealedObservations;
  assert.deepEqual(profile.scopes[0].acceptedRunIds, ['run-2', 'run-3']);
  assert.equal(profile.schema, 'seerrng-distributed-adaptive-profile/v2');
  assert.equal(profile.scopes[0].acceptedObservations.length, 2);
  assert.deepEqual(profile.scopes[0].acceptedObservations[0], {
    observationId: canonicalJsonSha256({
      schema: 'seerrng-distributed-adaptive-observation-identity/v2',
      scope: selectedScope,
      runId: 'run-2',
      candidateSha256: 'a'.repeat(64),
      revision: 'candidate-revision-1',
      runAttempt: 1,
      scheduleSha256: 'e'.repeat(64),
      submissionSha256: 'f'.repeat(64),
      observationSha256: secondObservation.observationSha256,
    }),
    observationSha256: secondObservation.observationSha256,
    runId: 'run-2',
    candidateSha256: 'a'.repeat(64),
    revision: 'candidate-revision-1',
    runAttempt: 1,
    scheduleSha256: 'e'.repeat(64),
    submissionSha256: 'f'.repeat(64),
  });
  assert.deepEqual(
    profile.scopes[0].acceptedObservations.map(
      ({ runId, candidateSha256, revision }) => ({
        runId,
        candidateSha256,
        revision,
      })
    ),
    ['run-2', 'run-3'].map((runId) => ({
      runId,
      candidateSha256: 'a'.repeat(64),
      revision: 'candidate-revision-1',
    }))
  );
  assert.throws(
    () =>
      updateAdaptiveTimingProfile(
        profile,
        firstObservation,
        observationExpectations(firstObservation),
        policy
      ),
    /another source profile/
  );
  assert.deepEqual(profile.scopes[0].acceptedRunIds, ['run-2', 'run-3']);
  assert.equal(profile.scopes[0].acceptedObservations.length, 2);
});

test('only complete valid successful runs update timing history', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  const empty = createAdaptiveTimingProfile();
  const passing = observation({
    profile: empty,
    selectedScope,
    runId: 'run-1',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 100)],
  });
  for (const patch of [
    { valid: false },
    { complete: false },
    { status: 'failed' },
  ]) {
    const ignored = applyObservation(empty, {
      selectedScope,
      runId: `ignored-${Object.keys(patch)[0]}`,
      performanceScorePermille: 100,
      results: [resultEntry('unit/a.test.ts', 100)],
      ...patch,
    });
    assert.equal(ignored.accepted, false);
    assert.deepEqual(ignored.profile, empty);
  }
  const failedTest = applyObservation(empty, {
    selectedScope,
    runId: 'failed-test',
    performanceScorePermille: 100,
    results: [{ ...resultEntry('unit/a.test.ts', 1), status: 'failed' }],
  });
  assert.equal(failedTest.accepted, false);
  assert.equal(failedTest.reason, 'unsuccessful-test');
  assert.deepEqual(failedTest.profile, empty);

  const accepted = updateAdaptiveTimingProfile(
    empty,
    passing,
    observationExpectations(passing)
  );
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.updatedTests, 1);
  assert.equal(accepted.profile.scopes[0].tests[0].estimateWorkUnits, 10_000);
  const duplicate = updateAdaptiveTimingProfile(
    accepted.profile,
    passing,
    observationExpectations(passing)
  );
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, 'duplicate-observation');
  assert.deepEqual(duplicate.profile, accepted.profile);
});

test('failed and partial observations cannot make a test appear artificially fast', () => {
  const selectedScope = scope('linux-x64', 'worker-standard');
  const initial = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope,
    runId: 'green-1',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 100)],
  }).profile;
  const failed = applyObservation(initial, {
    selectedScope,
    runId: 'failed-2',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 1)],
    status: 'failed',
  });
  const partial = applyObservation(initial, {
    selectedScope,
    runId: 'partial-2',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 1)],
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
  const profile = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope,
    runId: 'green-1',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 100)],
  }).profile;
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
    profile = applyObservation(
      profile,
      {
        selectedScope,
        runId: `green-${index}`,
        performanceScorePermille: 100,
        results: [resultEntry('unit/a.test.ts', durationMs)],
      },
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
  const twoSlotProfile = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope: twoSlotScope,
    runId: 'green-n2',
    performanceScorePermille: 100,
    results,
  }).profile;
  const profile = applyObservation(twoSlotProfile, {
    selectedScope,
    runId: 'green-n1',
    performanceScorePermille: 200,
    results: [
      resultEntry('unit/a.test.ts', 50),
      resultEntry('unit/b.test.ts', 25),
      resultEntry('unit/c.test.ts', 25),
    ],
  }).profile;
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
  const profile = applyObservation(createAdaptiveTimingProfile(), {
    selectedScope,
    runId: 'green-n4',
    performanceScorePermille: 100,
    results: [resultEntry('unit/a.test.ts', 100)],
  }).profile;
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
      ['unit/short.test.ts', 'unit/followup.test.ts', 'unit/final.test.ts'],
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
