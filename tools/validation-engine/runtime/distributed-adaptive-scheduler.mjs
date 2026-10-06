// Copyright (c) snapetech and SeerrNG contributors.
// Pure adaptive scheduling primitives for heterogeneous distributed workers.
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA =
  'seerrng-distributed-adaptive-profile/v2';
export const DISTRIBUTED_ADAPTIVE_OBSERVATION_SCHEMA =
  'seerrng-distributed-adaptive-observation/v1';
export const DISTRIBUTED_ADAPTIVE_SCHEDULE_SCHEMA =
  'seerrng-distributed-adaptive-schedule/v2';
export const DISTRIBUTED_WORKER_CAPACITY_SCHEMA =
  'seerrng-distributed-worker-capacity/v2';
export const MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_TESTS = 65_536;
export const MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_BYTES = 16 * 1024 * 1024;

const DISTRIBUTED_ADAPTIVE_SCHEDULE_ALGORITHM =
  'deterministic-heterogeneous-dependency-list/v1';
const SCHEDULE_KEYS = [
  'algorithm',
  'applicationId',
  'policySha256',
  'predictedWallMs',
  'profileSchema',
  'profileSha256',
  'repositoryIdentitySha256',
  'scheduleSha256',
  'schema',
  'slots',
  'testInventorySha256',
  'workerCapacitiesSha256',
  'workers',
];
const SCHEDULE_SLOT_KEYS = [
  'performanceScorePermille',
  'predictedBusyMs',
  'predictedFinishOffsetMs',
  'slotId',
  'slotIndex',
  'tests',
  'workerId',
];
const SCHEDULE_TEST_KEYS = [
  'adapterId',
  'criticalPathWorkUnits',
  'dependencies',
  'estimateSource',
  'estimatedWorkUnits',
  'fingerprint',
  'id',
  'laneId',
  'predictedDurationMs',
  'predictedFinishOffsetMs',
  'predictedStartOffsetMs',
  'sequence',
];
const CAPACITY_KEYS = [
  'adapterIds',
  'admissionReason',
  'admissionStatus',
  'admittedThreads',
  'availableThreads',
  'capacityWeight',
  'concurrencyPolicy',
  'configuredThreadBudget',
  'effectiveLogicalThreads',
  'interactiveReservedThreads',
  'loadReservedThreads',
  'memoryLimitedThreads',
  'performanceScorePermille',
  'performanceScoreSource',
  'role',
  'runsOnControllerHost',
  'schema',
  'scope',
  'workerId',
];
const VERIFY_SCHEDULE_EXPECTATION_KEYS = [
  'expectedApplicationId',
  'expectedProfileSha256',
  'expectedRepositoryIdentitySha256',
  'expectedScheduleSha256',
  'expectedTestInventorySha256',
];
const ADAPTIVE_OBSERVATION_INPUT_KEYS = [
  'benchmark',
  'complete',
  'inventory',
  'results',
  'schema',
  'scope',
  'source',
  'status',
  'valid',
];
const ADAPTIVE_OBSERVATION_KEYS = [
  ...ADAPTIVE_OBSERVATION_INPUT_KEYS,
  'observationSha256',
  'observedInventorySha256',
];
const ADAPTIVE_OBSERVATION_SCOPE_KEYS = [
  'adapterId',
  'applicationId',
  'environment',
  'laneId',
  'repositoryIdentitySha256',
  'selectedN',
  'workerClass',
];
const ADAPTIVE_OBSERVATION_SOURCE_KEYS = [
  'applicationIsolationKeySha256',
  'brokerReconciliationInputSha256',
  'candidateSha256',
  'executionBridgeSha256',
  'executionId',
  'policySha256',
  'profileSha256',
  'revision',
  'runAttempt',
  'scheduleTestInventorySha256',
  'scheduleSha256',
  'submissionSha256',
  'terminalReconciliationSha256',
];
const ADAPTIVE_OBSERVATION_BENCHMARK_KEYS = [
  'performanceScorePermille',
  'valid',
];
const ADAPTIVE_OBSERVATION_INVENTORY_KEYS = ['fingerprint', 'id'];
const ADAPTIVE_OBSERVATION_RESULT_KEYS = [
  'durationMs',
  'fingerprint',
  'status',
  'testId',
];
const VERIFY_ADAPTIVE_OBSERVATION_EXPECTATION_KEYS = [
  'expectedObservationSha256',
];

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

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const compareNumberDescending = (left, right) =>
  left === right ? 0 : left > right ? -1 : 1;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

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
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string'))
    throw new Error(`${label} fields are not canonical`);
  const actual = ownKeys.toSorted(compareText);
  const wanted = [...expected].toSorted(compareText);
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    throw new Error(`${label} fields are not canonical`);
  return value;
}

function nonemptyText(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0)
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
  nonnegativeInteger(normalized.controllerReserveThreads, 'controller reserve');
  permille(normalized.fallbackQuantilePermille, 'fallback estimate quantile');
  if (normalized.fallbackQuantilePermille < 500)
    throw new Error('Fallback estimate quantile cannot be below median');
  positiveInteger(normalized.maximumSamplesPerTest, 'maximum samples per test');
  if (normalized.acceptedRunWindow < normalized.maximumSamplesPerTest)
    throw new Error('Accepted-run window cannot be shorter than sample window');
  permille(normalized.rollingQuantilePermille, 'rolling estimate quantile');
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

export function distributedAdaptivePolicySha256(policy = {}) {
  return canonicalJsonSha256(normalizePolicy(policy));
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
    applicationId: nonemptyText(value.applicationId, `${label} application ID`),
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

function normalizeAdaptiveTimingObservationInput(value) {
  exactKeys(
    value,
    ADAPTIVE_OBSERVATION_INPUT_KEYS,
    'adaptive timing observation input'
  );
  if (value.schema !== DISTRIBUTED_ADAPTIVE_OBSERVATION_SCHEMA)
    throw new Error('Unsupported distributed adaptive observation schema');
  exactKeys(
    value.scope,
    ADAPTIVE_OBSERVATION_SCOPE_KEYS,
    'adaptive timing observation scope'
  );
  const scope = scopeIdentity(value.scope, 'adaptive timing observation scope');
  exactKeys(
    value.source,
    ADAPTIVE_OBSERVATION_SOURCE_KEYS,
    'adaptive timing observation source'
  );
  const source = {
    applicationIsolationKeySha256: sha256Digest(
      value.source.applicationIsolationKeySha256,
      'adaptive timing application isolation key'
    ),
    brokerReconciliationInputSha256: sha256Digest(
      value.source.brokerReconciliationInputSha256,
      'adaptive timing broker reconciliation input'
    ),
    candidateSha256: sha256Digest(
      value.source.candidateSha256,
      'adaptive timing candidate'
    ),
    executionBridgeSha256: sha256Digest(
      value.source.executionBridgeSha256,
      'adaptive timing execution bridge'
    ),
    executionId: nonemptyText(
      value.source.executionId,
      'adaptive timing execution ID'
    ),
    policySha256: sha256Digest(
      value.source.policySha256,
      'adaptive timing update policy'
    ),
    profileSha256: sha256Digest(
      value.source.profileSha256,
      'adaptive timing source profile'
    ),
    revision: nonemptyText(value.source.revision, 'adaptive timing revision'),
    runAttempt: positiveInteger(
      value.source.runAttempt,
      'adaptive timing run attempt'
    ),
    scheduleTestInventorySha256: sha256Digest(
      value.source.scheduleTestInventorySha256,
      'adaptive timing full schedule test inventory'
    ),
    scheduleSha256: sha256Digest(
      value.source.scheduleSha256,
      'adaptive timing schedule'
    ),
    submissionSha256: sha256Digest(
      value.source.submissionSha256,
      'adaptive timing submission'
    ),
    terminalReconciliationSha256: sha256Digest(
      value.source.terminalReconciliationSha256,
      'adaptive timing terminal reconciliation'
    ),
  };
  if (typeof value.valid !== 'boolean')
    throw new Error('Adaptive timing observation validity must be boolean');
  if (typeof value.complete !== 'boolean')
    throw new Error('Adaptive timing observation completeness must be boolean');
  if (!['passed', 'failed', 'cancelled'].includes(value.status))
    throw new Error('Adaptive timing observation status is invalid');
  exactKeys(
    value.benchmark,
    ADAPTIVE_OBSERVATION_BENCHMARK_KEYS,
    'adaptive timing observation benchmark'
  );
  if (typeof value.benchmark.valid !== 'boolean')
    throw new Error('Adaptive timing benchmark validity must be boolean');
  const performanceScorePermille = value.benchmark.valid
    ? positiveInteger(
        value.benchmark.performanceScorePermille,
        'adaptive timing benchmark performance score'
      )
    : value.benchmark.performanceScorePermille;
  if (!value.benchmark.valid && performanceScorePermille !== null)
    throw new Error(
      'An invalid adaptive timing benchmark cannot claim a performance score'
    );
  if (!Array.isArray(value.inventory))
    throw new Error('Adaptive timing observation inventory must be an array');
  if (value.inventory.length > MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_TESTS)
    throw new Error('Adaptive timing observation exceeds its inventory limit');
  if (!Array.isArray(value.results))
    throw new Error('Adaptive timing observation results must be an array');
  if (value.results.length > MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_TESTS)
    throw new Error('Adaptive timing observation exceeds its result limit');
  const inventory = value.inventory
    .map((test, index) => {
      exactKeys(
        test,
        ADAPTIVE_OBSERVATION_INVENTORY_KEYS,
        `adaptive timing observation inventory entry ${index}`
      );
      return normalizeTimingTest(
        test,
        `adaptive timing observation inventory entry ${index}`
      );
    })
    .toSorted((left, right) => compareText(left.id, right.id));
  if (new Set(inventory.map((test) => test.id)).size !== inventory.length)
    throw new Error(
      'Adaptive timing observation inventory contains duplicates'
    );
  const results = value.results
    .map((result, index) => {
      const label = `adaptive timing observation result ${index}`;
      exactKeys(result, ADAPTIVE_OBSERVATION_RESULT_KEYS, label);
      if (!['passed', 'failed', 'cancelled'].includes(result.status))
        throw new Error(`${label} status is invalid`);
      return {
        testId: nonemptyText(result.testId, `${label} test ID`),
        fingerprint: nonemptyText(result.fingerprint, `${label} fingerprint`),
        durationMs: positiveInteger(result.durationMs, `${label} duration`),
        status: result.status,
      };
    })
    .toSorted((left, right) => compareText(left.testId, right.testId));
  if (new Set(results.map((result) => result.testId)).size !== results.length)
    throw new Error('Adaptive timing observation results contain duplicates');
  return {
    schema: DISTRIBUTED_ADAPTIVE_OBSERVATION_SCHEMA,
    source,
    scope,
    valid: value.valid,
    complete: value.complete,
    status: value.status,
    benchmark: {
      valid: value.benchmark.valid,
      performanceScorePermille,
    },
    inventory,
    results,
  };
}

function sealAdaptiveTimingObservation(value) {
  const normalized = normalizeAdaptiveTimingObservationInput(value);
  const unsigned = {
    ...normalized,
    // This digest covers only the scope-specific inventory represented by this
    // observation. source.scheduleTestInventorySha256 separately binds the
    // full schedule inventory that the controller reconciled externally.
    observedInventorySha256: canonicalJsonSha256({
      schema: 'seerrng-distributed-adaptive-observed-inventory/v1',
      scope: normalized.scope,
      inventory: normalized.inventory,
    }),
  };
  const sealed = {
    ...unsigned,
    observationSha256: canonicalJsonSha256(unsigned),
  };
  if (
    Buffer.byteLength(JSON.stringify(sealed), 'utf8') >
    MAX_DISTRIBUTED_ADAPTIVE_OBSERVATION_BYTES
  )
    throw new Error('Adaptive timing observation exceeds its byte limit');
  return deepFreeze(sealed);
}

export function createAdaptiveTimingObservation(value) {
  return sealAdaptiveTimingObservation(value);
}

export function verifyAdaptiveTimingObservation(value, expectations) {
  exactKeys(
    value,
    ADAPTIVE_OBSERVATION_KEYS,
    'sealed adaptive timing observation'
  );
  exactKeys(
    expectations,
    VERIFY_ADAPTIVE_OBSERVATION_EXPECTATION_KEYS,
    'adaptive timing observation expectations'
  );
  const input = Object.fromEntries(
    ADAPTIVE_OBSERVATION_INPUT_KEYS.map((key) => [key, value[key]])
  );
  const sealed = sealAdaptiveTimingObservation(input);
  const expectedObservationSha256 = sha256Digest(
    expectations.expectedObservationSha256,
    'expected adaptive timing observation hash'
  );
  const observedInventorySha256 = sha256Digest(
    value.observedInventorySha256,
    'adaptive timing observed inventory hash'
  );
  if (
    observedInventorySha256 !== sealed.observedInventorySha256 ||
    value.observationSha256 !== sealed.observationSha256 ||
    sealed.observationSha256 !== expectedObservationSha256
  )
    throw new Error(
      'Adaptive timing observation does not match its trusted hash'
    );
  return sealed;
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
    applicationId: nonemptyText(value.applicationId, `${label} application ID`),
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
        [
          'candidateSha256',
          'observationId',
          'observationSha256',
          'revision',
          'runAttempt',
          'runId',
          'scheduleSha256',
          'submissionSha256',
        ],
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
        runAttempt: positiveInteger(
          observation.runAttempt,
          'accepted observation run attempt'
        ),
        scheduleSha256: sha256Digest(
          observation.scheduleSha256,
          'accepted observation schedule'
        ),
        submissionSha256: sha256Digest(
          observation.submissionSha256,
          'accepted observation submission'
        ),
        observationSha256: sha256Digest(
          observation.observationSha256,
          'accepted observation hash'
        ),
      };
      observationRunIds.push(provenance.runId);
      const observationId = sha256Digest(
        observation.observationId,
        'accepted observation ID'
      );
      const expectedObservationId = canonicalJsonSha256({
        schema: 'seerrng-distributed-adaptive-observation-identity/v2',
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
      throw new Error(
        'Distributed adaptive profile repeats an observation run'
      );
    const runIds = scope.acceptedRunIds.map((runId) =>
      nonemptyText(runId, 'accepted run id')
    );
    if (new Set(runIds).size !== runIds.length)
      throw new Error('Distributed adaptive profile repeats a run id');
    let previousTestId = null;
    for (const entry of scope.tests) {
      exactKeys(
        entry,
        ['estimateWorkUnits', 'fingerprint', 'samplesWorkUnits', 'testId'],
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
  if (role !== 'worker')
    throw new Error('Distributed worker role must be worker');
  const runsOnControllerHost = worker.runsOnControllerHost ?? false;
  if (typeof runsOnControllerHost !== 'boolean')
    throw new Error('Controller-host placement must be boolean');
  const requestedInteractiveReserve =
    worker.localInteractiveReserveThreads ??
    (runsOnControllerHost ? normalizedPolicy.controllerReserveThreads : 0);
  nonnegativeInteger(
    requestedInteractiveReserve,
    'local interactive thread reserve'
  );
  const interactiveReservedThreads = runsOnControllerHost
    ? requestedInteractiveReserve
    : 0;
  const loadReservedThreads = Math.ceil(
    checkedMultiply(
      effectiveLogicalThreads,
      currentLoadPermille,
      'worker load reservation'
    ) / 1_000
  );
  const cpuAvailableThreads = Math.max(
    0,
    effectiveLogicalThreads - loadReservedThreads - interactiveReservedThreads
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
    benchmarkPerformanceScore(worker, normalizedPolicy);
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
    runsOnControllerHost,
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
        quantile(otherEstimates, normalizedPolicy.fallbackQuantilePermille),
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
  observationValue,
  expectations,
  policy = {}
) {
  assertAdaptiveTimingProfile(profile);
  const observation = verifyAdaptiveTimingObservation(
    observationValue,
    expectations
  );
  const normalizedPolicy = normalizePolicy(policy);
  const scope = scopeIdentity(observation.scope);
  const runId = observation.source.executionId;
  const candidateSha256 = observation.source.candidateSha256;
  const revision = observation.source.revision;
  const runAttempt = observation.source.runAttempt;
  const scheduleSha256 = observation.source.scheduleSha256;
  const submissionSha256 = observation.source.submissionSha256;
  const observationSha256 = observation.observationSha256;
  const observationId = canonicalJsonSha256({
    schema: 'seerrng-distributed-adaptive-observation-identity/v2',
    scope,
    runId,
    candidateSha256,
    revision,
    runAttempt,
    scheduleSha256,
    submissionSha256,
    observationSha256,
  });
  const existingScope = profileScope(profile, scope);
  if (
    existingScope?.acceptedObservations.some(
      (entry) => entry.observationId === observationId || entry.runId === runId
    )
  )
    return ignoredUpdate(profile, 'duplicate-observation');
  if (observation.source.profileSha256 !== canonicalJsonSha256(profile))
    throw new Error(
      'Adaptive timing observation belongs to another source profile'
    );
  if (observation.source.policySha256 !== canonicalJsonSha256(normalizedPolicy))
    throw new Error(
      'Adaptive timing observation belongs to another update policy'
    );
  if (observation.valid !== true) return ignoredUpdate(profile, 'invalid-run');
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
  const inventory = observation.inventory;
  const results = observation.results;
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
  selectedScope.acceptedRunIds = [...selectedScope.acceptedRunIds, runId].slice(
    -normalizedPolicy.acceptedRunWindow
  );
  selectedScope.acceptedObservations = [
    ...selectedScope.acceptedObservations,
    {
      observationId,
      observationSha256,
      runId,
      candidateSha256,
      revision,
      runAttempt,
      scheduleSha256,
      submissionSha256,
    },
  ].slice(-normalizedPolicy.acceptedRunWindow);
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
      ) / 1_000
    )
  );
  return Math.min(policy.coldStartPerformanceScorePermille, fraction);
}

function dependencyGraph(tests) {
  const testsById = new Map(tests.map((test) => [test.id, test]));
  const successors = new Map(tests.map((test) => [test.id, []]));
  const remainingDependencies = new Map(
    tests.map((test) => [test.id, test.dependencies.length])
  );
  for (const test of tests)
    for (const dependency of test.dependencies) {
      if (dependency === test.id)
        throw new Error(`Distributed test cannot depend on itself: ${test.id}`);
      if (!testsById.has(dependency))
        throw new Error(
          `Distributed test ${test.id} has unknown dependency: ${dependency}`
        );
      successors.get(dependency).push(test.id);
    }
  for (const entries of successors.values()) entries.sort(compareText);
  const ready = tests
    .filter((test) => test.dependencies.length === 0)
    .map((test) => test.id)
    .toSorted(compareText);
  const topologicalIds = [];
  while (ready.length) {
    const testId = ready.shift();
    topologicalIds.push(testId);
    for (const successorId of successors.get(testId)) {
      const remaining = remainingDependencies.get(successorId) - 1;
      remainingDependencies.set(successorId, remaining);
      if (remaining === 0) {
        ready.push(successorId);
        ready.sort(compareText);
      }
    }
  }
  if (topologicalIds.length !== tests.length)
    throw new Error('Distributed schedule test dependencies contain a cycle');
  return { successors, topologicalIds };
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
      predictedBusyMs: 0,
      predictedFinishOffsetMs: 0,
      tests: [],
    }))
  );
}

function testInventorySha256(tests) {
  return canonicalJsonSha256(
    [...tests]
      .toSorted((left, right) => compareText(left.id, right.id))
      .map((test) => ({
        id: test.id,
        fingerprint: test.fingerprint,
        applicationId: test.applicationId,
        laneId: test.laneId,
        adapterId: test.adapterId,
        repositoryIdentitySha256: test.repositoryIdentitySha256,
        dependencies: test.dependencies,
      }))
  );
}

function prepareSchedulingCandidates({
  tests,
  capacities,
  profile,
  policy,
  graph,
}) {
  const candidates = new Map();
  for (const test of tests) {
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
    candidates.set(test.id, {
      test,
      estimates,
      orderingWeight: [...estimates.values()].reduce(
        (maximum, estimate) => Math.max(maximum, estimate.workUnits),
        0
      ),
      criticalPathWorkUnits: 0,
    });
  }
  for (const testId of [...graph.topologicalIds].reverse()) {
    const candidate = candidates.get(testId);
    const successorWeight = graph.successors
      .get(testId)
      .reduce(
        (maximum, successorId) =>
          Math.max(maximum, candidates.get(successorId).criticalPathWorkUnits),
        0
      );
    candidate.criticalPathWorkUnits = checkedAdd(
      candidate.orderingWeight,
      successorWeight,
      `critical path work for ${testId}`
    );
  }
  return candidates;
}

function compareReadyCandidates(left, right) {
  return (
    compareNumberDescending(
      left.criticalPathWorkUnits,
      right.criticalPathWorkUnits
    ) ||
    compareNumberDescending(left.orderingWeight, right.orderingWeight) ||
    compareText(left.test.id, right.test.id)
  );
}

function predictedDurationMs(estimate, capacity, label) {
  positiveInteger(estimate.workUnits, `${label} work estimate`);
  positiveInteger(
    capacity.performanceScorePermille,
    `${label} performance score`
  );
  return positiveInteger(
    Math.ceil(estimate.workUnits / capacity.performanceScorePermille),
    `${label} predicted duration`
  );
}

function createContinuousSchedule({ tests, capacities, profile, policy }) {
  const graph = dependencyGraph(tests);
  const candidates = prepareSchedulingCandidates({
    tests,
    capacities,
    profile,
    policy,
    graph,
  });
  const states = slotStates(capacities);
  const pending = new Set(tests.map((test) => test.id));
  const completed = new Set();
  const running = new Map();
  let currentOffsetMs = 0;
  let nextSequence = 1;

  while (pending.size > 0) {
    for (const [testId, finishOffsetMs] of running)
      if (finishOffsetMs <= currentOffsetMs) {
        running.delete(testId);
        completed.add(testId);
      }

    while (true) {
      const freeSlots = states.filter(
        (state) => state.predictedFinishOffsetMs <= currentOffsetMs
      );
      if (!freeSlots.length) break;
      const ready = [...pending]
        .map((testId) => candidates.get(testId))
        .filter((candidate) =>
          candidate.test.dependencies.every((dependency) =>
            completed.has(dependency)
          )
        )
        .toSorted(compareReadyCandidates);
      let selectedCandidate = null;
      let eligibleSlots = [];
      for (const candidate of ready) {
        const matching = freeSlots.filter((state) =>
          candidate.estimates.has(state.capacity.workerId)
        );
        if (matching.length) {
          selectedCandidate = candidate;
          eligibleSlots = matching;
          break;
        }
      }
      if (!selectedCandidate) break;
      const choices = eligibleSlots
        .map((state) => {
          const estimate = selectedCandidate.estimates.get(
            state.capacity.workerId
          );
          return {
            state,
            estimate,
            durationMs: predictedDurationMs(
              estimate,
              state.capacity,
              selectedCandidate.test.id
            ),
          };
        })
        .toSorted(
          (left, right) =>
            left.durationMs - right.durationMs ||
            compareText(
              left.state.capacity.workerId,
              right.state.capacity.workerId
            ) ||
            left.state.slotIndex - right.state.slotIndex
        );
      const selected = choices[0];
      const finishOffsetMs = checkedAdd(
        currentOffsetMs,
        selected.durationMs,
        `predicted finish for ${selectedCandidate.test.id}`
      );
      selected.state.tests.push({
        sequence: nextSequence,
        id: selectedCandidate.test.id,
        fingerprint: selectedCandidate.test.fingerprint,
        laneId: selectedCandidate.test.laneId,
        adapterId: selectedCandidate.test.adapterId,
        dependencies: selectedCandidate.test.dependencies,
        criticalPathWorkUnits: selectedCandidate.criticalPathWorkUnits,
        estimatedWorkUnits: selected.estimate.workUnits,
        estimateSource: selected.estimate.source,
        predictedStartOffsetMs: currentOffsetMs,
        predictedDurationMs: selected.durationMs,
        predictedFinishOffsetMs: finishOffsetMs,
      });
      selected.state.predictedBusyMs = checkedAdd(
        selected.state.predictedBusyMs,
        selected.durationMs,
        `predicted busy time for ${selected.state.slotId}`
      );
      selected.state.predictedFinishOffsetMs = finishOffsetMs;
      pending.delete(selectedCandidate.test.id);
      running.set(selectedCandidate.test.id, finishOffsetMs);
      nextSequence += 1;
    }

    if (pending.size === 0) break;
    const futureFinishes = [...running.values()].filter(
      (finishOffsetMs) => finishOffsetMs > currentOffsetMs
    );
    if (!futureFinishes.length)
      throw new Error('Distributed scheduler cannot make dependency progress');
    currentOffsetMs = Math.min(...futureFinishes);
  }

  const slots = states.map((state) => ({
    slotId: state.slotId,
    workerId: state.capacity.workerId,
    slotIndex: state.slotIndex,
    performanceScorePermille: state.capacity.performanceScorePermille,
    predictedBusyMs: state.predictedBusyMs,
    predictedFinishOffsetMs: state.predictedFinishOffsetMs,
    tests: state.tests,
  }));
  return {
    slots,
    predictedWallMs: slots.reduce(
      (maximum, slot) => Math.max(maximum, slot.predictedFinishOffsetMs),
      0
    ),
  };
}

function equalArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizeScheduleCapacity(value, index) {
  const label = `distributed schedule worker capacity ${index}`;
  exactKeys(value, CAPACITY_KEYS, label);
  if (value.schema !== DISTRIBUTED_WORKER_CAPACITY_SCHEMA)
    throw new Error('Unsupported distributed worker capacity schema');
  exactKeys(value.scope, ['environment', 'workerClass'], `${label} scope`);
  if (!Array.isArray(value.adapterIds))
    throw new Error(`${label} adapter IDs must be an array`);
  const adapterIds = uniqueSorted(
    value.adapterIds.map((adapterId) =>
      nonemptyText(adapterId, `${label} adapter ID`)
    ),
    `${label} adapter IDs`
  );
  if (!equalArray(adapterIds, value.adapterIds))
    throw new Error(`${label} adapter IDs are not canonical`);
  if (value.role !== 'worker') throw new Error(`${label} role is invalid`);
  if (typeof value.runsOnControllerHost !== 'boolean')
    throw new Error(`${label} controller-host placement is invalid`);
  if (!['auto', 'explicit'].includes(value.concurrencyPolicy))
    throw new Error(`${label} concurrency policy is invalid`);
  if (!['admitted', 'rejected', 'unavailable'].includes(value.admissionStatus))
    throw new Error(`${label} admission status is invalid`);
  if (
    !['measured-benchmark', 'cold-start-conservative'].includes(
      value.performanceScoreSource
    )
  )
    throw new Error(`${label} performance score source is invalid`);
  if (
    value.admissionReason !== null &&
    !['explicit-thread-budget-unavailable', 'no-current-capacity'].includes(
      value.admissionReason
    )
  )
    throw new Error(`${label} admission reason is invalid`);
  const capacity = {
    schema: DISTRIBUTED_WORKER_CAPACITY_SCHEMA,
    workerId: nonemptyText(value.workerId, `${label} worker ID`),
    scope: workerScopeIdentity(value.scope, `${label} scope`),
    adapterIds,
    role: value.role,
    runsOnControllerHost: value.runsOnControllerHost,
    concurrencyPolicy: value.concurrencyPolicy,
    configuredThreadBudget: positiveInteger(
      value.configuredThreadBudget,
      `${label} configured thread budget`
    ),
    effectiveLogicalThreads: positiveInteger(
      value.effectiveLogicalThreads,
      `${label} effective logical threads`
    ),
    loadReservedThreads: nonnegativeInteger(
      value.loadReservedThreads,
      `${label} load-reserved threads`
    ),
    interactiveReservedThreads: nonnegativeInteger(
      value.interactiveReservedThreads,
      `${label} interactive-reserved threads`
    ),
    memoryLimitedThreads: nonnegativeInteger(
      value.memoryLimitedThreads,
      `${label} memory-limited threads`
    ),
    availableThreads: nonnegativeInteger(
      value.availableThreads,
      `${label} available threads`
    ),
    admissionStatus: value.admissionStatus,
    admissionReason: value.admissionReason,
    admittedThreads: nonnegativeInteger(
      value.admittedThreads,
      `${label} admitted threads`
    ),
    performanceScoreSource: value.performanceScoreSource,
    performanceScorePermille: positiveInteger(
      value.performanceScorePermille,
      `${label} performance score`
    ),
    capacityWeight: nonnegativeInteger(
      value.capacityWeight,
      `${label} capacity weight`
    ),
  };
  if (
    capacity.availableThreads > capacity.effectiveLogicalThreads ||
    capacity.admittedThreads > capacity.availableThreads ||
    (!capacity.runsOnControllerHost &&
      capacity.interactiveReservedThreads !== 0) ||
    capacity.capacityWeight !==
      checkedMultiply(
        capacity.admittedThreads,
        capacity.performanceScorePermille,
        `${label} capacity weight`
      )
  )
    throw new Error(`${label} capacity arithmetic is inconsistent`);
  if (
    (capacity.admissionStatus === 'admitted' &&
      (capacity.admittedThreads === 0 || capacity.admissionReason !== null)) ||
    (capacity.admissionStatus === 'rejected' &&
      (capacity.admittedThreads !== 0 ||
        capacity.concurrencyPolicy !== 'explicit' ||
        capacity.admissionReason !== 'explicit-thread-budget-unavailable')) ||
    (capacity.admissionStatus === 'unavailable' &&
      (capacity.admittedThreads !== 0 ||
        capacity.admissionReason !== 'no-current-capacity'))
  )
    throw new Error(`${label} admission state is inconsistent`);
  return capacity;
}

function normalizeScheduledTest(value, label) {
  exactKeys(value, SCHEDULE_TEST_KEYS, label);
  if (!Array.isArray(value.dependencies))
    throw new Error(`${label} dependencies must be an array`);
  const dependencies = uniqueSorted(
    value.dependencies.map((dependency) =>
      nonemptyText(dependency, `${label} dependency`)
    ),
    `${label} dependencies`
  );
  if (!equalArray(dependencies, value.dependencies))
    throw new Error(`${label} dependencies are not canonical`);
  if (
    !['profile', 'cold-start', 'changed-test', 'new-test'].includes(
      value.estimateSource
    )
  )
    throw new Error(`${label} estimate source is invalid`);
  const test = {
    sequence: positiveInteger(value.sequence, `${label} sequence`),
    id: nonemptyText(value.id, `${label} ID`),
    fingerprint: nonemptyText(value.fingerprint, `${label} fingerprint`),
    laneId: nonemptyText(value.laneId, `${label} lane ID`),
    adapterId: nonemptyText(value.adapterId, `${label} adapter ID`),
    dependencies,
    criticalPathWorkUnits: positiveInteger(
      value.criticalPathWorkUnits,
      `${label} critical path work`
    ),
    estimatedWorkUnits: positiveInteger(
      value.estimatedWorkUnits,
      `${label} estimated work`
    ),
    estimateSource: value.estimateSource,
    predictedStartOffsetMs: nonnegativeInteger(
      value.predictedStartOffsetMs,
      `${label} predicted start offset`
    ),
    predictedDurationMs: positiveInteger(
      value.predictedDurationMs,
      `${label} predicted duration`
    ),
    predictedFinishOffsetMs: nonnegativeInteger(
      value.predictedFinishOffsetMs,
      `${label} predicted finish offset`
    ),
  };
  if (
    test.predictedFinishOffsetMs !==
    checkedAdd(
      test.predictedStartOffsetMs,
      test.predictedDurationMs,
      `${label} predicted timeline`
    )
  )
    throw new Error(`${label} predicted timeline is inconsistent`);
  return test;
}

function normalizeScheduleSlot(value, index) {
  const label = `distributed schedule slot ${index}`;
  exactKeys(value, SCHEDULE_SLOT_KEYS, label);
  if (!Array.isArray(value.tests))
    throw new Error(`${label} tests must be an array`);
  return {
    slotId: nonemptyText(value.slotId, `${label} ID`),
    workerId: nonemptyText(value.workerId, `${label} worker ID`),
    slotIndex: positiveInteger(value.slotIndex, `${label} index`),
    performanceScorePermille: positiveInteger(
      value.performanceScorePermille,
      `${label} performance score`
    ),
    predictedBusyMs: nonnegativeInteger(
      value.predictedBusyMs,
      `${label} predicted busy time`
    ),
    predictedFinishOffsetMs: nonnegativeInteger(
      value.predictedFinishOffsetMs,
      `${label} predicted finish offset`
    ),
    tests: value.tests.map((test, testIndex) =>
      normalizeScheduledTest(test, `${label} test ${testIndex}`)
    ),
  };
}

function unsignedSchedule(value) {
  const { scheduleSha256: _scheduleSha256, ...unsigned } = value;
  return unsigned;
}

function normalizeAndValidateSchedule(value) {
  exactKeys(value, SCHEDULE_KEYS, 'distributed adaptive schedule');
  if (value.schema !== DISTRIBUTED_ADAPTIVE_SCHEDULE_SCHEMA)
    throw new Error('Unsupported distributed adaptive schedule schema');
  if (value.algorithm !== DISTRIBUTED_ADAPTIVE_SCHEDULE_ALGORITHM)
    throw new Error('Unsupported distributed adaptive schedule algorithm');
  if (value.profileSchema !== DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA)
    throw new Error('Unsupported distributed adaptive profile binding');
  if (!Array.isArray(value.workers) || !value.workers.length)
    throw new Error('Distributed adaptive schedule workers must be nonempty');
  const workers = value.workers.map(normalizeScheduleCapacity);
  for (let index = 1; index < workers.length; index += 1)
    if (compareText(workers[index - 1].workerId, workers[index].workerId) >= 0)
      throw new Error(
        'Distributed adaptive schedule workers are not canonical'
      );
  const workerCapacitiesSha256 = sha256Digest(
    value.workerCapacitiesSha256,
    'worker capacities hash'
  );
  if (workerCapacitiesSha256 !== canonicalJsonSha256(workers))
    throw new Error(
      'Distributed worker capacity hash does not match its contents'
    );
  if (!Array.isArray(value.slots) || !value.slots.length)
    throw new Error('Distributed adaptive schedule slots must be nonempty');
  const slots = value.slots.map(normalizeScheduleSlot);
  const expectedSlots = workers.flatMap((worker) =>
    Array.from({ length: worker.admittedThreads }, (_, index) => ({
      slotId: `${worker.workerId}.slot-${index + 1}`,
      workerId: worker.workerId,
      slotIndex: index + 1,
    }))
  );
  if (slots.length !== expectedSlots.length)
    throw new Error(
      'Distributed schedule slots do not match admitted capacity'
    );
  const workerById = new Map(
    workers.map((worker) => [worker.workerId, worker])
  );
  for (const [index, slot] of slots.entries()) {
    const expected = expectedSlots[index];
    const worker = workerById.get(slot.workerId);
    if (
      !expected ||
      slot.slotId !== expected.slotId ||
      slot.workerId !== expected.workerId ||
      slot.slotIndex !== expected.slotIndex ||
      !worker ||
      slot.performanceScorePermille !== worker.performanceScorePermille
    )
      throw new Error('Distributed schedule slots are not canonical');
    let priorFinishOffsetMs = 0;
    let predictedBusyMs = 0;
    for (const [testIndex, test] of slot.tests.entries()) {
      if (
        testIndex > 0 &&
        (test.predictedStartOffsetMs < priorFinishOffsetMs ||
          test.sequence <= slot.tests[testIndex - 1].sequence)
      )
        throw new Error(
          'Distributed schedule slot tests overlap or are not canonical'
        );
      if (!worker.adapterIds.includes(test.adapterId))
        throw new Error(
          'Distributed schedule assigned an incompatible adapter'
        );
      const expectedDurationMs = Math.ceil(
        test.estimatedWorkUnits / worker.performanceScorePermille
      );
      if (test.predictedDurationMs !== expectedDurationMs)
        throw new Error(
          'Distributed schedule predicted duration is inconsistent'
        );
      predictedBusyMs = checkedAdd(
        predictedBusyMs,
        test.predictedDurationMs,
        `predicted busy time for ${slot.slotId}`
      );
      priorFinishOffsetMs = test.predictedFinishOffsetMs;
    }
    if (
      slot.predictedBusyMs !== predictedBusyMs ||
      slot.predictedFinishOffsetMs !== priorFinishOffsetMs
    )
      throw new Error('Distributed schedule slot summary is inconsistent');
  }

  const scheduledTests = slots.flatMap((slot) => slot.tests);
  if (!scheduledTests.length)
    throw new Error('Distributed adaptive schedule must contain tests');
  const testIds = scheduledTests.map((test) => test.id);
  if (new Set(testIds).size !== testIds.length)
    throw new Error('Distributed adaptive schedule repeats a test');
  const testsBySequence = [...scheduledTests].toSorted(
    (left, right) => left.sequence - right.sequence
  );
  if (testsBySequence.some((test, index) => test.sequence !== index + 1))
    throw new Error('Distributed schedule sequences must be contiguous');
  for (let index = 1; index < testsBySequence.length; index += 1)
    if (
      testsBySequence[index].predictedStartOffsetMs <
      testsBySequence[index - 1].predictedStartOffsetMs
    )
      throw new Error(
        'Distributed schedule sequence timeline is not canonical'
      );
  dependencyGraph(scheduledTests);
  const testById = new Map(scheduledTests.map((test) => [test.id, test]));
  for (const test of scheduledTests)
    for (const dependencyId of test.dependencies) {
      const dependency = testById.get(dependencyId);
      if (dependency.predictedFinishOffsetMs > test.predictedStartOffsetMs)
        throw new Error(
          'Distributed schedule starts a test before its dependency'
        );
      if (dependency.criticalPathWorkUnits <= test.criticalPathWorkUnits)
        throw new Error(
          'Distributed schedule critical path priority is inconsistent'
        );
    }
  const applicationId = nonemptyText(
    value.applicationId,
    'schedule application ID'
  );
  const repositoryIdentitySha256 = sha256Digest(
    value.repositoryIdentitySha256,
    'schedule repository identity'
  );
  const inventoryTests = scheduledTests.map((test) => ({
    id: test.id,
    fingerprint: test.fingerprint,
    applicationId,
    laneId: test.laneId,
    adapterId: test.adapterId,
    repositoryIdentitySha256,
    dependencies: test.dependencies,
  }));
  const testInventoryIdentity = sha256Digest(
    value.testInventorySha256,
    'schedule test inventory hash'
  );
  if (testInventoryIdentity !== testInventorySha256(inventoryTests))
    throw new Error('Distributed schedule test inventory hash does not match');
  const predictedWallMs = nonnegativeInteger(
    value.predictedWallMs,
    'distributed schedule predicted wall time'
  );
  if (
    predictedWallMs !==
    slots.reduce(
      (maximum, slot) => Math.max(maximum, slot.predictedFinishOffsetMs),
      0
    )
  )
    throw new Error('Distributed schedule predicted wall time is inconsistent');
  const schedule = {
    schema: DISTRIBUTED_ADAPTIVE_SCHEDULE_SCHEMA,
    algorithm: DISTRIBUTED_ADAPTIVE_SCHEDULE_ALGORITHM,
    applicationId,
    repositoryIdentitySha256,
    testInventorySha256: testInventoryIdentity,
    profileSha256: sha256Digest(value.profileSha256, 'schedule profile hash'),
    policySha256: sha256Digest(value.policySha256, 'schedule policy hash'),
    workerCapacitiesSha256,
    profileSchema: DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA,
    workers,
    slots,
    predictedWallMs,
    scheduleSha256: sha256Digest(value.scheduleSha256, 'schedule hash'),
  };
  if (
    schedule.scheduleSha256 !== canonicalJsonSha256(unsignedSchedule(schedule))
  )
    throw new Error(
      'Distributed adaptive schedule seal does not match its contents'
    );
  return schedule;
}

export function verifyDistributedAdaptiveSchedule(value, expectations) {
  exactKeys(
    expectations,
    VERIFY_SCHEDULE_EXPECTATION_KEYS,
    'distributed schedule expectations'
  );
  const expectedScheduleSha256 = sha256Digest(
    expectations.expectedScheduleSha256,
    'expected schedule hash'
  );
  const expectedApplicationId = nonemptyText(
    expectations.expectedApplicationId,
    'expected schedule application ID'
  );
  const expectedRepositoryIdentitySha256 = sha256Digest(
    expectations.expectedRepositoryIdentitySha256,
    'expected schedule repository identity'
  );
  const expectedTestInventorySha256 = sha256Digest(
    expectations.expectedTestInventorySha256,
    'expected schedule test inventory hash'
  );
  const expectedProfileSha256 = sha256Digest(
    expectations.expectedProfileSha256,
    'expected schedule profile hash'
  );
  const schedule = normalizeAndValidateSchedule(value);
  if (schedule.scheduleSha256 !== expectedScheduleSha256)
    throw new Error(
      'Distributed adaptive schedule does not match its trusted hash'
    );
  if (schedule.applicationId !== expectedApplicationId)
    throw new Error(
      'Distributed adaptive schedule belongs to another application'
    );
  if (schedule.repositoryIdentitySha256 !== expectedRepositoryIdentitySha256)
    throw new Error(
      'Distributed adaptive schedule belongs to another repository'
    );
  if (schedule.testInventorySha256 !== expectedTestInventorySha256)
    throw new Error('Distributed adaptive schedule has another test inventory');
  if (schedule.profileSha256 !== expectedProfileSha256)
    throw new Error('Distributed adaptive schedule has another timing profile');
  return deepFreeze(schedule);
}

function sealSchedule(value) {
  const schedule = {
    ...value,
    scheduleSha256: canonicalJsonSha256(value),
  };
  return verifyDistributedAdaptiveSchedule(schedule, {
    expectedScheduleSha256: schedule.scheduleSha256,
    expectedApplicationId: schedule.applicationId,
    expectedRepositoryIdentitySha256: schedule.repositoryIdentitySha256,
    expectedTestInventorySha256: schedule.testInventorySha256,
    expectedProfileSha256: schedule.profileSha256,
  });
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
  const { slots, predictedWallMs } = createContinuousSchedule({
    tests,
    capacities: admittedCapacities,
    profile,
    policy: normalizedPolicy,
  });
  return sealSchedule({
    schema: DISTRIBUTED_ADAPTIVE_SCHEDULE_SCHEMA,
    algorithm: DISTRIBUTED_ADAPTIVE_SCHEDULE_ALGORITHM,
    applicationId: applicationIds[0],
    repositoryIdentitySha256: repositoryIdentitySha256s[0],
    testInventorySha256: testInventorySha256(tests),
    profileSha256: canonicalJsonSha256(profile),
    policySha256: canonicalJsonSha256(normalizedPolicy),
    workerCapacitiesSha256: canonicalJsonSha256(capacities),
    profileSchema: profile.schema,
    workers: capacities,
    slots,
    predictedWallMs,
  });
}
