// Copyright (c) snapetech and SeerrNG contributors.
// Pure adaptive scheduling primitives for heterogeneous distributed workers.
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA =
  'seerrng-distributed-adaptive-profile/v1';
export const DISTRIBUTED_ADAPTIVE_SCHEDULE_SCHEMA =
  'seerrng-distributed-adaptive-schedule/v1';
export const DISTRIBUTED_WORKER_CAPACITY_SCHEMA =
  'seerrng-distributed-worker-capacity/v1';

const DEFAULT_POLICY = Object.freeze({
  acceptedRunWindow: 32,
  coldStartDurationMs: 60_000,
  coldStartPerformanceScorePermille: 100,
  controllerReserveThreads: 1,
  fallbackQuantilePermille: 900,
  maximumSamplesPerTest: 9,
  rollingQuantilePermille: 750,
  unknownEstimateMultiplierPermille: 1_250,
  unmeasuredPerformanceFractionPermille: 500,
});

const HASH64 = /^[a-f0-9]{64}$/;

const compareText = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0;
const compareNumberDescending = (left, right) =>
  left === right ? 0 : left > right ? -1 : 1;

function plainObject(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object`);
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Object.keys(value).toSorted(compareText);
  const wanted = [...expected].toSorted(compareText);
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    throw new Error(`${label} fields are not canonical`);
  return value;
}

function nonemptyText(value, label) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0
  )
    throw new Error(`${label} must be nonempty trimmed text`);
  return value;
}

function sha256Digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`${label} must be a SHA-256 digest`);
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative safe integer`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function permille(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000)
    throw new Error(`${label} must be an integer from 0 through 1000`);
  return value;
}

function checkedAdd(left, right, label) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds range`);
  return result;
}

function checkedMultiply(left, right, label) {
  const result = left * right;
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds range`);
  return result;
}

function multiplyPermille(value, multiplier, label) {
  const product = checkedMultiply(value, multiplier, label);
  return Math.ceil(product / 1_000);
}

function uniqueSorted(values, label) {
  const sorted = [...values].toSorted(compareText);
  if (new Set(sorted).size !== sorted.length)
    throw new Error(`${label} contains duplicates`);
  return sorted;
}

function normalizePolicy(policy = {}) {
  plainObject(policy, 'distributed adaptive policy');
  const unknown = Object.keys(policy).filter(
    (key) => !Object.hasOwn(DEFAULT_POLICY, key)
  );
  if (unknown.length)
    throw new Error(`Unknown distributed adaptive policy field: ${unknown[0]}`);
  const normalized = { ...DEFAULT_POLICY, ...policy };
  positiveInteger(normalized.acceptedRunWindow, 'accepted-run window');
  positiveInteger(normalized.coldStartDurationMs, 'cold-start duration');
  positiveInteger(
    normalized.coldStartPerformanceScorePermille,
    'cold-start performance score'
  );
  nonnegativeInteger(
    normalized.controllerReserveThreads,
    'controller reserve'
  );
  permille(
    normalized.fallbackQuantilePermille,
    'fallback estimate quantile'
  );
  if (normalized.fallbackQuantilePermille < 500)
    throw new Error('Fallback estimate quantile cannot be below median');
  positiveInteger(
    normalized.maximumSamplesPerTest,
    'maximum samples per test'
  );
  if (normalized.acceptedRunWindow < normalized.maximumSamplesPerTest)
    throw new Error('Accepted-run window cannot be shorter than sample window');
  permille(
    normalized.rollingQuantilePermille,
    'rolling estimate quantile'
  );
  if (normalized.rollingQuantilePermille < 500)
    throw new Error('Rolling estimate quantile cannot be below median');
  positiveInteger(
    normalized.unknownEstimateMultiplierPermille,
    'unknown-test estimate multiplier'
  );
  if (normalized.unknownEstimateMultiplierPermille < 1_000)
    throw new Error('Unknown-test estimate multiplier cannot reduce work');
  permille(
    normalized.unmeasuredPerformanceFractionPermille,
    'unmeasured performance fraction'
  );
  return normalized;
}

function quantile(values, quantilePermille) {
  if (!values.length) throw new Error('Cannot estimate an empty sample set');
  permille(quantilePermille, 'sample quantile');
  const sorted = [...values].toSorted((left, right) => left - right);
  const rank = Math.max(
    0,
    Math.ceil((sorted.length * quantilePermille) / 1_000) - 1
  );
  return sorted[rank];
}

function robustRollingEstimate(samples, quantilePermille) {
  const median = quantile(samples, 500);
  const deviations = samples.map((sample) => Math.abs(sample - median));
  const medianAbsoluteDeviation = quantile(deviations, 500);
  const bounded =
    medianAbsoluteDeviation === 0
      ? samples
      : samples.map((sample) => {
          const radius = checkedMultiply(
            medianAbsoluteDeviation,
            3,
            'rolling estimate deviation'
          );
          return Math.min(
            checkedAdd(median, radius, 'rolling estimate upper bound'),
            Math.max(1, median - radius, sample)
          );
        });
  return quantile(bounded, quantilePermille);
}

function workerScopeIdentity(value, label = 'distributed worker scope') {
  plainObject(value, label);
  return {
    environment: nonemptyText(value.environment, `${label} environment`),
    workerClass: nonemptyText(value.workerClass, `${label} worker class`),
  };
}

function scopeIdentity(value, label = 'adaptive timing scope') {
  plainObject(value, label);
  return {
    applicationId: nonemptyText(
      value.applicationId,
      `${label} application ID`
    ),
    laneId: nonemptyText(value.laneId, `${label} lane ID`),
    adapterId: nonemptyText(value.adapterId, `${label} adapter ID`),
    repositoryIdentitySha256: sha256Digest(
      value.repositoryIdentitySha256,
      `${label} repository identity`
    ),
    environment: nonemptyText(value.environment, `${label} environment`),
    workerClass: nonemptyText(value.workerClass, `${label} worker class`),
    selectedN: positiveInteger(value.selectedN, `${label} selected N`),
  };
}

function compareScope(left, right) {
  return (
    compareText(left.applicationId, right.applicationId) ||
    compareText(left.laneId, right.laneId) ||
    compareText(left.adapterId, right.adapterId) ||
    compareText(
      left.repositoryIdentitySha256,
      right.repositoryIdentitySha256
    ) ||
    compareText(left.environment, right.environment) ||
    compareText(left.workerClass, right.workerClass) ||
    left.selectedN - right.selectedN
  );
}

function matchingScope(left, right) {
  return (
    left.applicationId === right.applicationId &&
    left.laneId === right.laneId &&
    left.adapterId === right.adapterId &&
    left.repositoryIdentitySha256 === right.repositoryIdentitySha256 &&
    left.environment === right.environment &&
    left.workerClass === right.workerClass &&
    left.selectedN === right.selectedN
  );
}

function normalizeTimingTest(value, label = 'adaptive timing test') {
  plainObject(value, label);
  return {
    id: nonemptyText(value.id, `${label} id`),
    fingerprint: nonemptyText(value.fingerprint, `${label} fingerprint`),
  };
}

function normalizeAdapterIds(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return uniqueSorted(
    value.map((adapterId) => nonemptyText(adapterId, `${label} entry`)),
    label
  );
}

function normalizeScheduleTest(value, label = 'distributed test') {
  exactKeys(
    value,
    [
      'adapterId',
      'applicationId',
      'dependencies',
      'fingerprint',
      'id',
      'laneId',
      'repositoryIdentitySha256',
    ],
    label
  );
  if (!Array.isArray(value.dependencies))
    throw new Error(`${label} dependencies must be an array`);
  return {
    id: nonemptyText(value.id, `${label} id`),
    fingerprint: nonemptyText(value.fingerprint, `${label} fingerprint`),
    applicationId: nonemptyText(
      value.applicationId,
      `${label} application ID`
    ),
    laneId: nonemptyText(value.laneId, `${label} lane ID`),
    adapterId: nonemptyText(value.adapterId, `${label} adapter ID`),
    repositoryIdentitySha256: sha256Digest(
      value.repositoryIdentitySha256,
      `${label} repository identity`
    ),
    dependencies: uniqueSorted(
      value.dependencies.map((dependency) =>
        nonemptyText(dependency, `${label} dependency`)
      ),
      `${label} dependencies`
    ),
  };
}

export function createAdaptiveTimingProfile() {
  return {
    schema: DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA,
    scopes: [],
  };
}

export function assertAdaptiveTimingProfile(value) {
  exactKeys(value, ['schema', 'scopes'], 'distributed adaptive profile');
  if (value.schema !== DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA)
    throw new Error('Unsupported distributed adaptive profile schema');
  if (!Array.isArray(value.scopes))
    throw new Error('Distributed adaptive profile scopes must be an array');
  let previousScope = null;
  for (const scope of value.scopes) {
    exactKeys(
      scope,
      [
        'acceptedObservations',
        'acceptedRunIds',
        'adapterId',
        'applicationId',
        'environment',
        'laneId',
        'repositoryIdentitySha256',
        'selectedN',
        'tests',
        'workerClass',
      ],
      'distributed adaptive profile scope'
    );
    scopeIdentity(scope, 'distributed adaptive profile scope');
    if (previousScope && compareScope(previousScope, scope) >= 0)
      throw new Error('Distributed adaptive profile scopes are not canonical');
    previousScope = scope;
    if (
      !Array.isArray(scope.acceptedObservations) ||
      !Array.isArray(scope.acceptedRunIds) ||
      !Array.isArray(scope.tests)
    )
      throw new Error('Distributed adaptive profile scope arrays are invalid');
    const normalizedScope = scopeIdentity(
      scope,
      'distributed adaptive profile scope'
    );
    const observationRunIds = [];
    const observationIds = scope.acceptedObservations.map((observation) => {
      exactKeys(
        observation,
        ['candidateSha256', 'observationId', 'revision', 'runId'],
        'accepted adaptive observation provenance'
      );
      const provenance = {
        runId: nonemptyText(observation.runId, 'accepted observation run id'),
        candidateSha256: sha256Digest(
          observation.candidateSha256,
          'accepted observation candidate'
        ),
        revision: nonemptyText(
          observation.revision,
          'accepted observation revision'
        ),
      };
      observationRunIds.push(provenance.runId);
      const observationId = sha256Digest(
        observation.observationId,
        'accepted observation ID'
      );
      const expectedObservationId = canonicalJsonSha256({
        schema: 'seerrng-distributed-adaptive-observation-identity/v1',
        scope: normalizedScope,
        ...provenance,
      });
      if (observationId !== expectedObservationId)
        throw new Error(
          'Accepted observation ID does not match its recorded provenance'
        );
      return observationId;
    });
    if (new Set(observationIds).size !== observationIds.length)
      throw new Error('Distributed adaptive profile repeats an observation');
    if (new Set(observationRunIds).size !== observationRunIds.length)
      throw new Error('Distributed adaptive profile repeats an observation run');
    const runIds = scope.acceptedRunIds.map((runId) =>
      nonemptyText(runId, 'accepted run id')
    );
    if (new Set(runIds).size !== runIds.length)
      throw new Error('Distributed adaptive profile repeats a run id');
    let previousTestId = null;
    for (const entry of scope.tests) {
      exactKeys(
        entry,
        [
          'estimateWorkUnits',
          'fingerprint',
          'samplesWorkUnits',
          'testId',
        ],
        'distributed adaptive test timing'
      );
      nonemptyText(entry.testId, 'adaptive timing test id');
      nonemptyText(entry.fingerprint, 'adaptive timing fingerprint');
      if (
        previousTestId !== null &&
        compareText(previousTestId, entry.testId) >= 0
      )
        throw new Error('Distributed adaptive tests are not canonical');
      previousTestId = entry.testId;
      if (
        !Array.isArray(entry.samplesWorkUnits) ||
        !entry.samplesWorkUnits.length
      )
        throw new Error('Adaptive timing samples must be a nonempty array');
      for (const sample of entry.samplesWorkUnits)
        positiveInteger(sample, 'adaptive timing sample');
      positiveInteger(entry.estimateWorkUnits, 'adaptive timing estimate');
      const sampleMinimum = entry.samplesWorkUnits.reduce(
        (minimum, sample) => Math.min(minimum, sample),
        Number.MAX_SAFE_INTEGER
      );
      const sampleMaximum = entry.samplesWorkUnits.reduce(
        (maximum, sample) => Math.max(maximum, sample),
        0
      );
      if (
        entry.estimateWorkUnits < sampleMinimum ||
        entry.estimateWorkUnits > sampleMaximum
      )
        throw new Error('Adaptive timing estimate falls outside its samples');
    }
  }
  return value;
}

function concurrencyBudget(worker) {
  const concurrency = worker.concurrency ?? { mode: 'auto' };
  plainObject(concurrency, 'distributed worker concurrency');
  if (concurrency.mode === 'auto') {
    if (Object.keys(concurrency).length !== 1)
      throw new Error('Automatic worker concurrency fields are not canonical');
    return {
      configuredThreadBudget: worker.effectiveLogicalThreads,
      concurrencyPolicy: 'auto',
    };
  }
  if (concurrency.mode !== 'explicit')
    throw new Error('Worker concurrency mode must be auto or explicit');
  exactKeys(
    concurrency,
    ['mode', 'threads'],
    'explicit distributed worker concurrency'
  );
  return {
    configuredThreadBudget: positiveInteger(
      concurrency.threads,
      'explicit worker thread budget'
    ),
    concurrencyPolicy: 'explicit',
  };
}

function benchmarkPerformanceScore(worker, policy) {
  if (worker.benchmark === undefined || worker.benchmark === null)
    return {
      performanceScorePermille: policy.coldStartPerformanceScorePermille,
      performanceScoreSource: 'cold-start-conservative',
    };
  plainObject(worker.benchmark, 'distributed worker benchmark');
  if (worker.benchmark.valid !== true)
    return {
      performanceScorePermille: policy.coldStartPerformanceScorePermille,
      performanceScoreSource: 'cold-start-conservative',
    };
  return {
    performanceScorePermille: positiveInteger(
      worker.benchmark.performanceScorePermille,
      'measured benchmark performance score'
    ),
    performanceScoreSource: 'measured-benchmark',
  };
}

export function assessDistributedWorkerCapacity(worker, policy = {}) {
  plainObject(worker, 'distributed worker');
  const normalizedPolicy = normalizePolicy(policy);
  const workerId = nonemptyText(worker.id, 'distributed worker id');
  const scope = workerScopeIdentity(worker.scope);
  const adapterIds = normalizeAdapterIds(
    worker.adapterIds,
    'distributed worker adapter IDs'
  );
  const effectiveLogicalThreads = positiveInteger(
    worker.effectiveLogicalThreads,
    'effective logical thread count'
  );
  const { configuredThreadBudget, concurrencyPolicy } =
    concurrencyBudget(worker);
  const currentLoadPermille = permille(
    worker.currentLoadPermille ?? 0,
    'current worker load'
  );
  const role = worker.role ?? 'worker';
  if (!['controller', 'worker'].includes(role))
    throw new Error('Distributed worker role must be controller or worker');
  const requestedInteractiveReserve =
    worker.localInteractiveReserveThreads ??
    (role === 'controller'
      ? normalizedPolicy.controllerReserveThreads
      : 0);
  nonnegativeInteger(
    requestedInteractiveReserve,
    'local interactive thread reserve'
  );
  const interactiveReservedThreads =
    role === 'controller' ? requestedInteractiveReserve : 0;
  const loadReservedThreads = Math.ceil(
    checkedMultiply(
      effectiveLogicalThreads,
      currentLoadPermille,
      'worker load reservation'
    ) / 1_000
  );
  const cpuAvailableThreads = Math.max(
    0,
    effectiveLogicalThreads -
      loadReservedThreads -
      interactiveReservedThreads
  );
  let memoryLimitedThreads = effectiveLogicalThreads;
  if (worker.memory !== undefined && worker.memory !== null) {
    plainObject(worker.memory, 'distributed worker memory');
    const availableBytes = nonnegativeInteger(
      worker.memory.availableBytes,
      'available worker memory'
    );
    const reserveBytes = nonnegativeInteger(
      worker.memory.reserveBytes,
      'worker memory reserve'
    );
    const bytesPerThread = positiveInteger(
      worker.memory.bytesPerThread,
      'worker memory per thread'
    );
    memoryLimitedThreads = Math.floor(
      Math.max(0, availableBytes - reserveBytes) / bytesPerThread
    );
  }
  const availableThreads = Math.min(
    effectiveLogicalThreads,
    cpuAvailableThreads,
    memoryLimitedThreads
  );
  const explicitRejected =
    concurrencyPolicy === 'explicit' &&
    configuredThreadBudget > availableThreads;
  const admittedThreads = explicitRejected
    ? 0
    : concurrencyPolicy === 'explicit'
      ? configuredThreadBudget
      : Math.min(configuredThreadBudget, availableThreads);
  const { performanceScorePermille, performanceScoreSource } =
    benchmarkPerformanceScore(
      worker,
      normalizedPolicy
    );
  const capacityWeight = checkedMultiply(
    admittedThreads,
    performanceScorePermille,
    `distributed capacity for ${workerId}`
  );
  const admissionStatus = explicitRejected
    ? 'rejected'
    : admittedThreads > 0
      ? 'admitted'
      : 'unavailable';
  return {
    schema: DISTRIBUTED_WORKER_CAPACITY_SCHEMA,
    workerId,
    scope,
    adapterIds,
    role,
    concurrencyPolicy,
    configuredThreadBudget,
    effectiveLogicalThreads,
    loadReservedThreads,
    interactiveReservedThreads,
    memoryLimitedThreads,
    availableThreads,
    admissionStatus,
    admissionReason: explicitRejected
      ? 'explicit-thread-budget-unavailable'
      : admittedThreads === 0
        ? 'no-current-capacity'
        : null,
    admittedThreads,
    performanceScoreSource,
    performanceScorePermille,
    capacityWeight,
  };
}

function profileScope(profile, scope) {
  return profile.scopes.find((candidate) => matchingScope(candidate, scope));
}

function coldStartWorkUnits(policy) {
  return checkedMultiply(
    policy.coldStartDurationMs,
    policy.coldStartPerformanceScorePermille,
    'cold-start work estimate'
  );
}

export function estimateAdaptiveTestWork(
  profile,
  { scope: rawScope, test: rawTest },
  policy = {}
) {
  assertAdaptiveTimingProfile(profile);
  const normalizedPolicy = normalizePolicy(policy);
  const scope = scopeIdentity(rawScope);
  const test = normalizeTimingTest(rawTest);
  const selectedScope = profileScope(profile, scope);
  const existing = selectedScope?.tests.find(
    (entry) => entry.testId === test.id
  );
  if (existing?.fingerprint === test.fingerprint)
    return {
      workUnits: existing.estimateWorkUnits,
      source: 'profile',
    };
  const otherEstimates =
    selectedScope?.tests
      .filter((entry) => entry.testId !== test.id)
      .map((entry) => entry.estimateWorkUnits) ?? [];
  const distributionFallback = otherEstimates.length
    ? multiplyPermille(
        quantile(
          otherEstimates,
          normalizedPolicy.fallbackQuantilePermille
        ),
        normalizedPolicy.unknownEstimateMultiplierPermille,
        'unknown-test fallback estimate'
      )
    : 0;
  return {
    workUnits: Math.max(
      coldStartWorkUnits(normalizedPolicy),
      distributionFallback,
      existing?.estimateWorkUnits ?? 0
    ),
    source: !selectedScope
      ? 'cold-start'
      : existing
        ? 'changed-test'
        : 'new-test',
  };
}

function ignoredUpdate(profile, reason) {
  return {
    profile: structuredClone(profile),
    accepted: false,
    reason,
    updatedTests: 0,
  };
}

export function updateAdaptiveTimingProfile(
  profile,
  observation,
  policy = {}
) {
  assertAdaptiveTimingProfile(profile);
  plainObject(observation, 'adaptive timing observation');
  const normalizedPolicy = normalizePolicy(policy);
  const scope = scopeIdentity(observation.scope);
  const runId = nonemptyText(observation.runId, 'adaptive timing run id');
  const candidateSha256 = sha256Digest(
    observation.candidateSha256,
    'adaptive timing candidate'
  );
  const revision = nonemptyText(
    observation.revision,
    'adaptive timing revision'
  );
  const observationId = canonicalJsonSha256({
    schema: 'seerrng-distributed-adaptive-observation-identity/v1',
    scope,
    runId,
    candidateSha256,
    revision,
  });
  const existingScope = profileScope(profile, scope);
  if (
    existingScope?.acceptedObservations.some(
      (entry) =>
        entry.observationId === observationId || entry.runId === runId
    )
  )
    return ignoredUpdate(profile, 'duplicate-observation');
  if (observation.valid !== true)
    return ignoredUpdate(profile, 'invalid-run');
  if (observation.complete !== true)
    return ignoredUpdate(profile, 'incomplete-run');
  if (observation.status !== 'passed')
    return ignoredUpdate(profile, 'unsuccessful-run');
  if (
    !observation.benchmark ||
    observation.benchmark.valid !== true ||
    !Number.isSafeInteger(observation.benchmark.performanceScorePermille) ||
    observation.benchmark.performanceScorePermille < 1
  )
    return ignoredUpdate(profile, 'unmeasured-run');
  if (!Array.isArray(observation.inventory) || !observation.inventory.length)
    throw new Error('Adaptive timing inventory must be a nonempty array');
  if (!Array.isArray(observation.results) || !observation.results.length)
    throw new Error('Adaptive timing results must be a nonempty array');
  const inventory = observation.inventory.map((test, index) =>
    normalizeTimingTest(test, `adaptive timing inventory entry ${index}`)
  );
  uniqueSorted(
    inventory.map((test) => test.id),
    'adaptive timing inventory'
  );
  const results = observation.results.map((result, index) => {
    plainObject(result, `adaptive timing result ${index}`);
    return {
      testId: nonemptyText(result.testId, 'adaptive timing result test id'),
      fingerprint: nonemptyText(
        result.fingerprint,
        'adaptive timing result fingerprint'
      ),
      durationMs: positiveInteger(
        result.durationMs,
        'adaptive timing result duration'
      ),
      status: nonemptyText(result.status, 'adaptive timing result status'),
    };
  });
  uniqueSorted(
    results.map((result) => result.testId),
    'adaptive timing results'
  );
  if (results.some((result) => result.status !== 'passed'))
    return ignoredUpdate(profile, 'unsuccessful-test');
  const inventoryById = new Map(inventory.map((test) => [test.id, test]));
  if (
    results.length !== inventory.length ||
    results.some((result) => {
      const planned = inventoryById.get(result.testId);
      return !planned || planned.fingerprint !== result.fingerprint;
    })
  )
    return ignoredUpdate(profile, 'inventory-closure-mismatch');

  const next = structuredClone(profile);
  let selectedScope = profileScope(next, scope);
  if (!selectedScope) {
    selectedScope = {
      ...scope,
      acceptedObservations: [],
      acceptedRunIds: [],
      tests: [],
    };
    next.scopes.push(selectedScope);
    next.scopes.sort(compareScope);
  }
  selectedScope.acceptedRunIds = [
    ...selectedScope.acceptedRunIds,
    runId,
  ].slice(-normalizedPolicy.acceptedRunWindow);
  // This identity ledger is intentionally durable; only the display-oriented
  // run-ID history rolls, so an older observation cannot become eligible again.
  selectedScope.acceptedObservations = [
    ...selectedScope.acceptedObservations,
    { observationId, runId, candidateSha256, revision },
  ];
  const entries = new Map(
    selectedScope.tests.map((entry) => [entry.testId, entry])
  );
  for (const result of results) {
    const workUnits = checkedMultiply(
      result.durationMs,
      observation.benchmark.performanceScorePermille,
      `adaptive timing work for ${result.testId}`
    );
    const prior = entries.get(result.testId);
    const samplesWorkUnits = [
      ...(prior?.fingerprint === result.fingerprint
        ? prior.samplesWorkUnits
        : []),
      workUnits,
    ].slice(-normalizedPolicy.maximumSamplesPerTest);
    entries.set(result.testId, {
      testId: result.testId,
      fingerprint: result.fingerprint,
      samplesWorkUnits,
      estimateWorkUnits: robustRollingEstimate(
        samplesWorkUnits,
        normalizedPolicy.rollingQuantilePermille
      ),
    });
  }
  selectedScope.tests = [...entries.values()].toSorted((left, right) =>
    compareText(left.testId, right.testId)
  );
  assertAdaptiveTimingProfile(next);
  return {
    profile: next,
    accepted: true,
    reason: 'accepted',
    updatedTests: results.length,
  };
}

function conservativeColdPerformanceScore(workers, policy) {
  const measured = workers
    .filter((worker) => worker.benchmark?.valid === true)
    .map((worker) =>
      positiveInteger(
        worker.benchmark.performanceScorePermille,
        'measured benchmark performance score'
      )
    );
  if (!measured.length) return policy.coldStartPerformanceScorePermille;
  const slowestMeasured = measured.reduce(
    (slowest, performanceScore) => Math.min(slowest, performanceScore),
    Number.MAX_SAFE_INTEGER
  );
  const fraction = Math.max(
    1,
    Math.floor(
      checkedMultiply(
        slowestMeasured,
        policy.unmeasuredPerformanceFractionPermille,
        'unmeasured performance estimate'
      ) /
        1_000
    )
  );
  return Math.min(policy.coldStartPerformanceScorePermille, fraction);
}

function compareProjectedSlotLoad(left, right) {
  const leftProduct =
    BigInt(left.projectedWorkUnits) *
    BigInt(right.capacity.performanceScorePermille);
  const rightProduct =
    BigInt(right.projectedWorkUnits) *
    BigInt(left.capacity.performanceScorePermille);
  if (leftProduct < rightProduct) return -1;
  if (leftProduct > rightProduct) return 1;
  return (
    compareText(left.capacity.workerId, right.capacity.workerId) ||
    left.state.slotIndex - right.state.slotIndex
  );
}

function dependencyReadyStages(tests) {
  const testsById = new Map(tests.map((test) => [test.id, test]));
  for (const test of tests)
    for (const dependency of test.dependencies) {
      if (dependency === test.id)
        throw new Error(`Distributed test cannot depend on itself: ${test.id}`);
      if (!testsById.has(dependency))
        throw new Error(
          `Distributed test ${test.id} has unknown dependency: ${dependency}`
        );
    }
  const remaining = new Map(testsById);
  const completed = new Set();
  const stages = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((test) =>
        test.dependencies.every((dependency) => completed.has(dependency))
      )
      .toSorted((left, right) => compareText(left.id, right.id));
    if (!ready.length)
      throw new Error('Distributed schedule test dependencies contain a cycle');
    stages.push(ready);
    for (const test of ready) {
      remaining.delete(test.id);
      completed.add(test.id);
    }
  }
  return stages;
}

function timingScopeFor(test, capacity) {
  return {
    applicationId: test.applicationId,
    laneId: test.laneId,
    adapterId: test.adapterId,
    repositoryIdentitySha256: test.repositoryIdentitySha256,
    environment: capacity.scope.environment,
    workerClass: capacity.scope.workerClass,
    selectedN: capacity.admittedThreads,
  };
}

function slotStates(capacities) {
  return capacities.flatMap((capacity) =>
    Array.from({ length: capacity.admittedThreads }, (_, index) => ({
      capacity,
      slotId: `${capacity.workerId}.slot-${index + 1}`,
      slotIndex: index + 1,
      estimatedWorkUnits: 0,
      tests: [],
    }))
  );
}

function scheduleDependencyStage({
  stageIndex,
  tests,
  capacities,
  profile,
  policy,
}) {
  const states = slotStates(capacities);
  const candidates = tests
    .map((test) => {
      const eligibleCapacities = capacities.filter((capacity) =>
        capacity.adapterIds.includes(test.adapterId)
      );
      if (!eligibleCapacities.length)
        throw new Error(
          `No admitted worker supports adapter ${test.adapterId} for ${test.id}`
        );
      const estimates = new Map(
        eligibleCapacities.map((capacity) => [
          capacity.workerId,
          estimateAdaptiveTestWork(
            profile,
            { scope: timingScopeFor(test, capacity), test },
            policy
          ),
        ])
      );
      return {
        test,
        estimates,
        orderingWeight: [...estimates.values()].reduce(
          (maximum, estimate) => Math.max(maximum, estimate.workUnits),
          0
        ),
      };
    })
    .toSorted(
      (left, right) =>
        compareNumberDescending(left.orderingWeight, right.orderingWeight) ||
        compareText(left.test.id, right.test.id)
    );
  for (const candidate of candidates) {
    const choices = states
      .filter((state) => candidate.estimates.has(state.capacity.workerId))
      .map((state) => {
        const estimate = candidate.estimates.get(state.capacity.workerId);
        return {
          state,
          estimate,
          capacity: state.capacity,
          projectedWorkUnits: checkedAdd(
            state.estimatedWorkUnits,
            estimate.workUnits,
            `projected work for ${state.slotId}`
          ),
        };
      });
    choices.sort(compareProjectedSlotLoad);
    const selected = choices[0];
    selected.state.estimatedWorkUnits = selected.projectedWorkUnits;
    selected.state.tests.push({
      id: candidate.test.id,
      fingerprint: candidate.test.fingerprint,
      applicationId: candidate.test.applicationId,
      laneId: candidate.test.laneId,
      adapterId: candidate.test.adapterId,
      repositoryIdentitySha256: candidate.test.repositoryIdentitySha256,
      dependencies: candidate.test.dependencies,
      estimatedWorkUnits: selected.estimate.workUnits,
      estimateSource: selected.estimate.source,
    });
  }
  const slots = states.map((state) => ({
    slotId: state.slotId,
    slotIndex: state.slotIndex,
    workerId: state.capacity.workerId,
    performanceScorePermille: state.capacity.performanceScorePermille,
    estimatedWorkUnits: state.estimatedWorkUnits,
    predictedWallMs: Math.ceil(
      state.estimatedWorkUnits / state.capacity.performanceScorePermille
    ),
    tests: state.tests,
  }));
  const predictedWallMs = slots.reduce(
    (maximum, slot) => Math.max(maximum, slot.predictedWallMs),
    0
  );
  return {
    stageIndex,
    readyAfterTestIds: uniqueSorted(
      new Set(tests.flatMap((test) => test.dependencies)),
      `distributed dependency stage ${stageIndex}`
    ),
    testIds: tests.map((test) => test.id).toSorted(compareText),
    predictedWallMs,
    slots,
  };
}

export function createDistributedAdaptiveSchedule({
  tests: rawTests,
  workers: rawWorkers,
  profile,
  policy = {},
}) {
  assertAdaptiveTimingProfile(profile);
  if (!Array.isArray(rawTests) || !rawTests.length)
    throw new Error('Distributed schedule tests must be a nonempty array');
  if (!Array.isArray(rawWorkers) || !rawWorkers.length)
    throw new Error('Distributed schedule workers must be a nonempty array');
  const tests = rawTests.map((test, index) =>
    normalizeScheduleTest(test, `distributed schedule test ${index}`)
  );
  const applicationIds = [
    ...new Set(tests.map((test) => test.applicationId)),
  ].toSorted(compareText);
  if (applicationIds.length !== 1)
    throw new Error(
      'A distributed schedule must contain exactly one application namespace'
    );
  const repositoryIdentitySha256s = [
    ...new Set(tests.map((test) => test.repositoryIdentitySha256)),
  ].toSorted(compareText);
  if (repositoryIdentitySha256s.length !== 1)
    throw new Error(
      'A distributed schedule must contain exactly one repository namespace'
    );
  uniqueSorted(
    tests.map((test) => test.id),
    'distributed schedule tests'
  );
  for (const worker of rawWorkers)
    nonemptyText(worker?.id, 'distributed schedule worker id');
  uniqueSorted(
    rawWorkers.map((worker) => worker.id),
    'distributed schedule workers'
  );
  const normalizedPolicy = normalizePolicy(policy);
  const capacityPolicy = {
    ...normalizedPolicy,
    coldStartPerformanceScorePermille: conservativeColdPerformanceScore(
      rawWorkers,
      normalizedPolicy
    ),
  };
  const capacities = rawWorkers
    .map((worker) => assessDistributedWorkerCapacity(worker, capacityPolicy))
    .toSorted((left, right) => compareText(left.workerId, right.workerId));
  const rejectedExplicit = capacities.find(
    (capacity) =>
      capacity.concurrencyPolicy === 'explicit' &&
      capacity.admissionStatus !== 'admitted'
  );
  if (rejectedExplicit)
    throw new Error(
      `Explicit worker capacity unavailable: ${rejectedExplicit.workerId}`
    );
  const admittedCapacities = capacities.filter(
    (capacity) => capacity.admittedThreads > 0
  );
  if (!admittedCapacities.length)
    throw new Error('No distributed worker passed capacity admission');
  const stages = dependencyReadyStages(tests).map((stageTests, stageIndex) =>
    scheduleDependencyStage({
      stageIndex,
      tests: stageTests,
      capacities: admittedCapacities,
      profile,
      policy: normalizedPolicy,
    })
  );
  return {
    schema: DISTRIBUTED_ADAPTIVE_SCHEDULE_SCHEMA,
    algorithm: 'deterministic-heterogeneous-slot-lpt/v1',
    applicationId: applicationIds[0],
    repositoryIdentitySha256: repositoryIdentitySha256s[0],
    profileSchema: profile.schema,
    workers: capacities,
    predictedWallMs: stages.reduce(
      (total, stage) =>
        checkedAdd(
          total,
          stage.predictedWallMs,
          'distributed schedule predicted wall time'
        ),
      0
    ),
    stages,
  };
}
