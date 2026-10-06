// Copyright (c) snapetech and SeerrNG contributors.
// Sealed, transport-neutral lifecycle state for one native worker attempt.
import {
  brokerApplicationIsolationKeySha256,
  verifyBrokerBinding,
  verifyBrokerTask,
} from './broker-protocol.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_WORKER_ATTEMPT_STATE_SCHEMA =
  'seerrng-distributed-worker-attempt-state/v1';
export const DISTRIBUTED_WORKER_ATTEMPT_IDENTITY_SCHEMA =
  'seerrng-distributed-worker-attempt-identity/v1';
export const DISTRIBUTED_WORKER_NATIVE_PROCESS_SCHEMA =
  'seerrng-distributed-worker-native-process/v1';
export const MAX_DISTRIBUTED_WORKER_ATTEMPT_ADAPTERS = 256;
export const MAX_DISTRIBUTED_WORKER_ATTEMPT_EVIDENCE = 256;
export const MAX_DISTRIBUTED_WORKER_ATTEMPT_BYTES = 16 * 1024 * 1024;

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const ATTEMPT_STATUSES = new Set([
  'pending',
  'running',
  'finished',
  'cleanup-required',
  'cleaned',
]);
const BASE_STATUSES = new Set(['pending', 'running', 'finished']);
const STATE_KEYS = [
  'adapters',
  'applicationIsolationKeySha256',
  'attemptIdentitySha256',
  'binding',
  'bindingSha256',
  'bridgeSha256',
  'cleanup',
  'createdAtMs',
  'evidenceReferences',
  'failureReference',
  'finishedAtMs',
  'lease',
  'nativeProcess',
  'outcome',
  'previousStateSha256',
  'resultReference',
  'revision',
  'schema',
  'sourceWorkspaceIdentitySha256',
  'startedAtMs',
  'stateSha256',
  'status',
  'task',
  'updatedAtMs',
];
const ADAPTER_KEYS = ['adapterId', 'adapterIdentitySha256'];
const LEASE_KEYS = [
  'attempt',
  'expiresAtMs',
  'grantedAtMs',
  'instanceId',
  'leaseId',
  'machineIdentitySha256',
  'workerId',
  'workerSessionId',
];
const PROCESS_INPUT_KEYS = [
  'launchIdentitySha256',
  'pid',
  'processStartIdentitySha256',
];
const PROCESS_KEYS = [...PROCESS_INPUT_KEYS, 'processIdentitySha256', 'schema'];
const REFERENCE_KEYS = [
  'bytes',
  'mediaType',
  'referenceId',
  'schema',
  'sha256',
  'storageIdentitySha256',
];
const OUTCOME_KEYS = [
  'cancelled',
  'completed',
  'exitCode',
  'status',
  'timedOut',
];
const CLEANUP_KEYS = [
  'completedAtMs',
  'evidenceReference',
  'originStatus',
  'reasonCode',
  'requiredAtMs',
];
const CREATE_KEYS = [
  'adapters',
  'applicationIsolationKeySha256',
  'binding',
  'bridgeSha256',
  'createdAtMs',
  'lease',
  'sourceWorkspaceIdentitySha256',
  'task',
];
const START_KEYS = ['nativeProcess', 'startedAtMs'];
const FINISH_KEYS = [
  'evidenceReferences',
  'failureReference',
  'finishedAtMs',
  'outcome',
  'resultReference',
];
const REQUIRE_CLEANUP_KEYS = ['failureReference', 'reasonCode', 'requiredAtMs'];
const COMPLETE_CLEANUP_KEYS = ['cleanedAtMs', 'evidenceReference'];
const VERIFY_EXPECTATION_KEYS = new Set([
  'expectedApplicationIsolationKeySha256',
  'expectedAttempt',
  'expectedAttemptIdentitySha256',
  'expectedBinding',
  'expectedBridgeSha256',
  'expectedInstanceId',
  'expectedLeaseId',
  'expectedMachineIdentitySha256',
  'expectedSlotId',
  'expectedSourceWorkspaceIdentitySha256',
  'expectedStateSha256',
  'expectedTaskSha256',
  'expectedWorkerId',
  'expectedWorkerSessionId',
]);
const WORKER_ATTEMPT_TRANSITION_KINDS = new Set([
  'genesis',
  'attempt-start',
  'attempt-finish',
  'attempt-cleanup-required',
  'attempt-cleanup-complete',
]);
const trustedStates = new WeakSet();
// Runtime-only provenance is intentionally absent from persisted snapshots.
const trustedTransitionProvenance = new WeakMap();

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

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

function exactKeys(value, expectedKeys, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const expected = [...expectedKeys].toSorted(compareText);
  const sorted = actual.toSorted(compareText);
  if (
    sorted.length !== expected.length ||
    sorted.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function exactText(value, label, maximum = 256) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > maximum ||
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- Persisted cross-machine text.
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function integer(
  value,
  label,
  { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${label} must be a safe integer from ${minimum} through ${maximum}`
    );
  return value;
}

function nullableInteger(value, label) {
  return value === null ? null : integer(value, label);
}

function sameCanonical(left, right) {
  return canonicalJsonSha256(left) === canonicalJsonSha256(right);
}

function createWorkerAttemptTransitionDescriptor(kind, input, occurredAtMs) {
  if (!WORKER_ATTEMPT_TRANSITION_KINDS.has(kind))
    throw new Error('Unsupported worker attempt transition kind');
  plainObject(input, 'worker attempt transition input');
  integer(occurredAtMs, 'Worker attempt transition event time');
  return deepFreeze({
    kind,
    inputSha256: canonicalJsonSha256(input),
    occurredAtMs,
  });
}

function bindWorkerAttemptTransitionProvenance(
  state,
  previousStateSha256,
  kind,
  input,
  occurredAtMs
) {
  if (previousStateSha256 !== null)
    digest(previousStateSha256, 'previous worker attempt state hash');
  if (state.previousStateSha256 !== previousStateSha256)
    throw new Error(
      'Worker attempt transition provenance has an invalid predecessor'
    );
  const descriptor = createWorkerAttemptTransitionDescriptor(
    kind,
    input,
    occurredAtMs
  );
  trustedTransitionProvenance.set(
    state,
    deepFreeze({ previousStateSha256, descriptor })
  );
  return state;
}

function assertBytes(value) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error('Worker attempt state must contain JSON values only');
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_DISTRIBUTED_WORKER_ATTEMPT_BYTES)
    throw new Error(
      `Worker attempt state exceeds ${MAX_DISTRIBUTED_WORKER_ATTEMPT_BYTES} bytes`
    );
}

function normalizeAdapters(value) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('Worker attempt requires adapter identities');
  if (value.length > MAX_DISTRIBUTED_WORKER_ATTEMPT_ADAPTERS)
    throw new Error(
      `Worker attempt exceeds ${MAX_DISTRIBUTED_WORKER_ATTEMPT_ADAPTERS} adapters`
    );
  const adapters = value
    .map((entry, index) => {
      exactKeys(entry, ADAPTER_KEYS, `worker adapter identity ${index}`);
      return {
        adapterId: identifier(entry.adapterId, 'adapter ID'),
        adapterIdentitySha256: digest(
          entry.adapterIdentitySha256,
          'adapter identity hash'
        ),
      };
    })
    .toSorted((left, right) => compareText(left.adapterId, right.adapterId));
  if (
    new Set(adapters.map((entry) => entry.adapterId)).size !== adapters.length
  )
    throw new Error('Worker attempt contains a duplicate adapter ID');
  if (
    new Set(adapters.map((entry) => entry.adapterIdentitySha256)).size !==
    adapters.length
  )
    throw new Error('Worker attempt contains a duplicate adapter identity');
  return adapters;
}

function normalizeTaskIdentity(value) {
  const task = verifyBrokerTask(value);
  if (task.expectedEvidence.length > MAX_DISTRIBUTED_WORKER_ATTEMPT_EVIDENCE)
    throw new Error(
      `Worker attempt task exceeds ${MAX_DISTRIBUTED_WORKER_ATTEMPT_EVIDENCE} evidence contracts`
    );
  return task;
}

function normalizeLease(value) {
  exactKeys(value, LEASE_KEYS, 'worker attempt lease identity');
  const lease = {
    leaseId: identifier(value.leaseId, 'lease ID'),
    attempt: integer(value.attempt, 'Task attempt', { minimum: 1 }),
    workerId: identifier(value.workerId, 'lease worker ID'),
    machineIdentitySha256: digest(
      value.machineIdentitySha256,
      'worker machine identity hash'
    ),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    grantedAtMs: integer(value.grantedAtMs, 'Lease grant time'),
    expiresAtMs: integer(value.expiresAtMs, 'Lease expiry time'),
  };
  if (lease.expiresAtMs <= lease.grantedAtMs)
    throw new Error('Worker attempt lease must expire after it was granted');
  return lease;
}

function normalizeReference(value, label) {
  exactKeys(value, REFERENCE_KEYS, label);
  if (typeof value.mediaType !== 'string' || !MEDIA_TYPE.test(value.mediaType))
    throw new Error(`Exact ${label} media type is required`);
  return {
    referenceId: identifier(value.referenceId, `${label} ID`),
    schema: exactText(value.schema, `${label} schema`),
    mediaType: value.mediaType,
    bytes: integer(value.bytes, `${label} byte count`, { minimum: 1 }),
    sha256: digest(value.sha256, `${label} content hash`),
    storageIdentitySha256: digest(
      value.storageIdentitySha256,
      `${label} storage identity hash`
    ),
  };
}

function nullableReference(value, label) {
  return value === null ? null : normalizeReference(value, label);
}

function normalizeEvidenceReferences(value, task) {
  if (!Array.isArray(value))
    throw new Error('Worker attempt evidence references must be an array');
  if (value.length > MAX_DISTRIBUTED_WORKER_ATTEMPT_EVIDENCE)
    throw new Error(
      `Worker attempt exceeds ${MAX_DISTRIBUTED_WORKER_ATTEMPT_EVIDENCE} evidence references`
    );
  const references = value
    .map((entry, index) =>
      normalizeReference(entry, `worker evidence reference ${index}`)
    )
    .toSorted((left, right) =>
      compareText(left.referenceId, right.referenceId)
    );
  if (
    new Set(references.map((entry) => entry.referenceId)).size !==
    references.length
  )
    throw new Error('Worker evidence references must be exact-once');
  if (
    new Set(references.map((entry) => entry.storageIdentitySha256)).size !==
    references.length
  )
    throw new Error('Worker evidence storage identities must be exact-once');
  const expected = new Map(
    task.expectedEvidence.map((entry) => [entry.evidenceId, entry])
  );
  for (const reference of references) {
    const contract = expected.get(reference.referenceId);
    if (!contract)
      throw new Error(
        `Worker attempt contains unexpected evidence: ${reference.referenceId}`
      );
    if (
      reference.schema !== contract.schema ||
      reference.mediaType !== contract.mediaType
    )
      throw new Error(
        `Worker attempt evidence contract drifted: ${reference.referenceId}`
      );
  }
  return references;
}

function normalizeOutcome(value) {
  exactKeys(value, OUTCOME_KEYS, 'worker attempt outcome');
  if (!['passed', 'failed'].includes(value.status))
    throw new Error('Worker attempt outcome must be passed or failed');
  if (value.completed !== true)
    throw new Error('Worker attempt outcome must represent completed work');
  if (
    typeof value.cancelled !== 'boolean' ||
    typeof value.timedOut !== 'boolean'
  )
    throw new Error('Worker attempt outcome flags must be boolean');
  if (
    value.exitCode !== null &&
    (!Number.isSafeInteger(value.exitCode) || value.exitCode < 0)
  )
    throw new Error('Worker attempt exit code must be null or nonnegative');
  if (
    value.status === 'passed' &&
    (value.exitCode !== 0 || value.cancelled || value.timedOut)
  )
    throw new Error('A passed worker attempt requires clean native completion');
  if (
    value.status === 'failed' &&
    value.exitCode === 0 &&
    !value.cancelled &&
    !value.timedOut
  )
    throw new Error('A failed worker attempt requires native failure evidence');
  return {
    status: value.status,
    exitCode: value.exitCode,
    completed: true,
    cancelled: value.cancelled,
    timedOut: value.timedOut,
  };
}

function processIdentitySha256(attemptIdentitySha256, value) {
  return canonicalJsonSha256({
    schema: DISTRIBUTED_WORKER_NATIVE_PROCESS_SCHEMA,
    attemptIdentitySha256,
    pid: value.pid,
    processStartIdentitySha256: value.processStartIdentitySha256,
    launchIdentitySha256: value.launchIdentitySha256,
  });
}

function createNativeProcess(attemptIdentitySha256, value) {
  exactKeys(value, PROCESS_INPUT_KEYS, 'native process identity input');
  const process = {
    schema: DISTRIBUTED_WORKER_NATIVE_PROCESS_SCHEMA,
    pid: integer(value.pid, 'Native process ID', { minimum: 1 }),
    processStartIdentitySha256: digest(
      value.processStartIdentitySha256,
      'native process start identity hash'
    ),
    launchIdentitySha256: digest(
      value.launchIdentitySha256,
      'native launch identity hash'
    ),
  };
  return {
    ...process,
    processIdentitySha256: processIdentitySha256(
      attemptIdentitySha256,
      process
    ),
  };
}

function normalizeNativeProcess(attemptIdentitySha256, value) {
  exactKeys(value, PROCESS_KEYS, 'native process identity');
  if (value.schema !== DISTRIBUTED_WORKER_NATIVE_PROCESS_SCHEMA)
    throw new Error('Unsupported native process identity schema');
  const process = createNativeProcess(attemptIdentitySha256, {
    pid: value.pid,
    processStartIdentitySha256: value.processStartIdentitySha256,
    launchIdentitySha256: value.launchIdentitySha256,
  });
  if (value.processIdentitySha256 !== process.processIdentitySha256)
    throw new Error('Native process identity seal does not match its attempt');
  return process;
}

function normalizeCleanup(value) {
  exactKeys(value, CLEANUP_KEYS, 'worker attempt cleanup state');
  if (!BASE_STATUSES.has(value.originStatus))
    throw new Error('Worker attempt cleanup origin is unsupported');
  const requiredAtMs = integer(value.requiredAtMs, 'Cleanup requirement time');
  const completedAtMs = nullableInteger(
    value.completedAtMs,
    'Cleanup completion time'
  );
  if (completedAtMs !== null && completedAtMs < requiredAtMs)
    throw new Error('Cleanup cannot complete before it was required');
  return {
    originStatus: value.originStatus,
    reasonCode: identifier(value.reasonCode, 'cleanup reason code'),
    requiredAtMs,
    completedAtMs,
    evidenceReference: nullableReference(
      value.evidenceReference,
      'cleanup evidence reference'
    ),
  };
}

function attemptIdentity(value) {
  return {
    schema: DISTRIBUTED_WORKER_ATTEMPT_IDENTITY_SCHEMA,
    bridgeSha256: value.bridgeSha256,
    bindingSha256: value.bindingSha256,
    applicationIsolationKeySha256: value.applicationIsolationKeySha256,
    taskId: value.task.taskId,
    taskSha256: value.task.taskSha256,
    leaseId: value.lease.leaseId,
    attempt: value.lease.attempt,
    grantedAtMs: value.lease.grantedAtMs,
    expiresAtMs: value.lease.expiresAtMs,
    workerId: value.lease.workerId,
    machineIdentitySha256: value.lease.machineIdentitySha256,
    instanceId: value.lease.instanceId,
    workerSessionId: value.lease.workerSessionId,
    slotId: value.task.assignment.slotId,
    slotIndex: value.task.assignment.slotIndex,
    slotPosition: value.task.assignment.slotPosition,
    sourceWorkspaceIdentitySha256: value.sourceWorkspaceIdentitySha256,
    adapters: value.adapters,
  };
}

export function distributedWorkerAttemptIdentitySha256(value) {
  plainObject(value, 'worker attempt identity source');
  const source = {
    bridgeSha256: digest(value.bridgeSha256, 'execution bridge hash'),
    bindingSha256: digest(value.bindingSha256, 'broker binding hash'),
    applicationIsolationKeySha256: digest(
      value.applicationIsolationKeySha256,
      'application isolation hash'
    ),
    task: normalizeTaskIdentity(value.task),
    lease: normalizeLease(value.lease),
    sourceWorkspaceIdentitySha256: digest(
      value.sourceWorkspaceIdentitySha256,
      'source workspace identity hash'
    ),
    adapters: normalizeAdapters(value.adapters),
  };
  if (
    source.task.applicationIsolationKeySha256 !==
      source.applicationIsolationKeySha256 ||
    source.task.assignment.workerId !== source.lease.workerId ||
    source.lease.attempt > source.task.maxAttempts
  )
    throw new Error(
      'Worker attempt identity source is internally inconsistent'
    );
  return canonicalJsonSha256(attemptIdentity(source));
}

function stateHash(value) {
  const unsigned = { ...value };
  delete unsigned.stateSha256;
  return canonicalJsonSha256(unsigned);
}

function assertReferenceSeparation(state) {
  const references = [
    ...state.evidenceReferences,
    state.resultReference,
    state.failureReference,
    state.cleanup?.evidenceReference,
  ].filter(Boolean);
  const storageIdentities = references.map(
    (entry) => entry.storageIdentitySha256
  );
  const referenceIds = references.map((entry) => entry.referenceId);
  if (new Set(referenceIds).size !== referenceIds.length)
    throw new Error('Worker attempt artifact reference IDs must be exact-once');
  if (new Set(storageIdentities).size !== storageIdentities.length)
    throw new Error(
      'Worker attempt artifact references must not alias storage'
    );
}

function assertBaseShape(state, baseStatus, allowUnfinishedFailure = false) {
  if (baseStatus === 'pending') {
    if (
      state.startedAtMs !== null ||
      state.finishedAtMs !== null ||
      state.nativeProcess !== null ||
      state.outcome !== null ||
      state.resultReference !== null ||
      state.evidenceReferences.length !== 0 ||
      (!allowUnfinishedFailure && state.failureReference !== null)
    )
      throw new Error('Pending worker attempt contains execution state');
    return;
  }

  if (
    state.startedAtMs === null ||
    state.nativeProcess === null ||
    state.startedAtMs < state.createdAtMs ||
    state.startedAtMs >= state.lease.expiresAtMs
  )
    throw new Error('Started worker attempt has an invalid native lifecycle');

  if (baseStatus === 'running') {
    if (
      state.finishedAtMs !== null ||
      state.outcome !== null ||
      state.resultReference !== null ||
      state.evidenceReferences.length !== 0 ||
      (!allowUnfinishedFailure && state.failureReference !== null)
    )
      throw new Error('Running worker attempt contains finished state');
    return;
  }

  if (
    state.finishedAtMs === null ||
    state.finishedAtMs < state.startedAtMs ||
    state.finishedAtMs >= state.lease.expiresAtMs ||
    state.outcome === null ||
    state.resultReference === null
  )
    throw new Error('Finished worker attempt has an invalid native lifecycle');
  if (
    state.outcome.status === 'passed' &&
    state.task.expectedEvidence.some(
      (expected) =>
        expected.required &&
        !state.evidenceReferences.some(
          (reference) => reference.referenceId === expected.evidenceId
        )
    )
  )
    throw new Error('Passed worker attempt is missing required evidence');
  if (
    (state.outcome.status === 'passed' && state.failureReference !== null) ||
    (state.outcome.status === 'failed' && state.failureReference === null)
  )
    throw new Error('Worker attempt failure reference contradicts its outcome');
}

function validateState(value, expectedStateSha256) {
  exactKeys(value, STATE_KEYS, 'persisted worker attempt state');
  if (value.schema !== DISTRIBUTED_WORKER_ATTEMPT_STATE_SCHEMA)
    throw new Error('Unsupported worker attempt state schema');
  digest(expectedStateSha256, 'expected worker attempt state hash');
  digest(value.stateSha256, 'worker attempt state hash');
  if (value.stateSha256 !== expectedStateSha256)
    throw new Error('Worker attempt state does not match its trusted hash');
  if (value.stateSha256 !== stateHash(value))
    throw new Error('Worker attempt state seal does not match its contents');
  assertBytes(value);

  const revision = integer(value.revision, 'Worker attempt revision', {
    minimum: 1,
  });
  if (
    (revision === 1 && value.previousStateSha256 !== null) ||
    (revision > 1 &&
      (value.previousStateSha256 === null ||
        !HASH64.test(value.previousStateSha256)))
  )
    throw new Error('Worker attempt revision hash chain is invalid');
  const createdAtMs = integer(
    value.createdAtMs,
    'Worker attempt creation time'
  );
  const updatedAtMs = integer(value.updatedAtMs, 'Worker attempt update time');
  if (updatedAtMs < createdAtMs)
    throw new Error('Worker attempt update precedes its creation');

  const binding = verifyBrokerBinding(value.binding);
  const bindingSha256 = canonicalJsonSha256(binding);
  digest(value.bindingSha256, 'broker binding hash');
  if (value.bindingSha256 !== bindingSha256)
    throw new Error('Worker attempt binding hash does not match');
  const applicationIsolationKeySha256 =
    brokerApplicationIsolationKeySha256(binding);
  digest(value.applicationIsolationKeySha256, 'application isolation hash');
  if (value.applicationIsolationKeySha256 !== applicationIsolationKeySha256)
    throw new Error('Worker attempt crossed an application isolation boundary');
  const bridgeSha256 = digest(value.bridgeSha256, 'execution bridge hash');
  const sourceWorkspaceIdentitySha256 = digest(
    value.sourceWorkspaceIdentitySha256,
    'source workspace identity hash'
  );
  const adapters = normalizeAdapters(value.adapters);
  const task = normalizeTaskIdentity(value.task);
  const lease = normalizeLease(value.lease);
  if (
    task.applicationIsolationKeySha256 !== applicationIsolationKeySha256 ||
    task.assignment.workerId !== lease.workerId ||
    lease.attempt > task.maxAttempts ||
    lease.expiresAtMs > lease.grantedAtMs + task.timeoutMs ||
    createdAtMs < lease.grantedAtMs ||
    createdAtMs >= lease.expiresAtMs
  )
    throw new Error(
      'Worker attempt task, lease, or application identity drifted'
    );
  if (!adapters.some((entry) => entry.adapterId === task.adapterId))
    throw new Error('Worker attempt lacks its task native adapter identity');

  const normalizedIdentitySource = {
    bridgeSha256,
    bindingSha256,
    applicationIsolationKeySha256,
    task,
    lease,
    sourceWorkspaceIdentitySha256,
    adapters,
  };
  const attemptIdentitySha256 = distributedWorkerAttemptIdentitySha256(
    normalizedIdentitySource
  );
  digest(value.attemptIdentitySha256, 'worker attempt identity hash');
  if (value.attemptIdentitySha256 !== attemptIdentitySha256)
    throw new Error('Worker attempt identity seal does not match its contents');

  if (!ATTEMPT_STATUSES.has(value.status))
    throw new Error('Unsupported worker attempt lifecycle status');
  const startedAtMs = nullableInteger(
    value.startedAtMs,
    'Worker attempt start time'
  );
  const finishedAtMs = nullableInteger(
    value.finishedAtMs,
    'Worker attempt finish time'
  );
  const nativeProcess =
    value.nativeProcess === null
      ? null
      : normalizeNativeProcess(attemptIdentitySha256, value.nativeProcess);
  const outcome =
    value.outcome === null ? null : normalizeOutcome(value.outcome);
  const evidenceReferences = normalizeEvidenceReferences(
    value.evidenceReferences,
    task
  );
  const resultReference = nullableReference(
    value.resultReference,
    'worker result reference'
  );
  const failureReference = nullableReference(
    value.failureReference,
    'worker failure reference'
  );
  const cleanup =
    value.cleanup === null ? null : normalizeCleanup(value.cleanup);

  const normalized = {
    schema: DISTRIBUTED_WORKER_ATTEMPT_STATE_SCHEMA,
    revision,
    previousStateSha256: value.previousStateSha256,
    bridgeSha256,
    binding,
    bindingSha256,
    applicationIsolationKeySha256,
    sourceWorkspaceIdentitySha256,
    adapters,
    task,
    lease,
    attemptIdentitySha256,
    status: value.status,
    createdAtMs,
    updatedAtMs,
    startedAtMs,
    finishedAtMs,
    nativeProcess,
    outcome,
    evidenceReferences,
    resultReference,
    failureReference,
    cleanup,
    stateSha256: value.stateSha256,
  };

  if (!sameCanonical(normalized, value))
    throw new Error('Worker attempt state is not in canonical form');
  if (BASE_STATUSES.has(normalized.status)) {
    if (normalized.cleanup !== null)
      throw new Error('Live or finished worker attempt contains cleanup state');
    assertBaseShape(normalized, normalized.status);
    const expectedRevision = {
      pending: 1,
      running: 2,
      finished: 3,
    }[normalized.status];
    if (normalized.revision !== expectedRevision)
      throw new Error(
        'Worker attempt revision contradicts its lifecycle state'
      );
  } else {
    if (normalized.cleanup === null)
      throw new Error('Cleanup state requires an exact cleanup record');
    assertBaseShape(normalized, normalized.cleanup.originStatus, true);
    if (
      normalized.cleanup.requiredAtMs < normalized.createdAtMs ||
      (normalized.cleanup.originStatus === 'running' &&
        normalized.cleanup.requiredAtMs < normalized.startedAtMs) ||
      (normalized.cleanup.originStatus === 'finished' &&
        normalized.cleanup.requiredAtMs < normalized.finishedAtMs)
    )
      throw new Error(
        'Cleanup requirement time contradicts the attempt history'
      );
    if (normalized.status === 'cleanup-required') {
      if (
        normalized.cleanup.completedAtMs !== null ||
        normalized.cleanup.evidenceReference !== null ||
        normalized.updatedAtMs !== normalized.cleanup.requiredAtMs
      )
        throw new Error('Cleanup-required attempt contains completed cleanup');
    } else if (
      normalized.cleanup.completedAtMs === null ||
      normalized.cleanup.evidenceReference === null ||
      normalized.updatedAtMs !== normalized.cleanup.completedAtMs
    )
      throw new Error('Cleaned worker attempt lacks exact cleanup evidence');
    const originRevision = {
      pending: 1,
      running: 2,
      finished: 3,
    }[normalized.cleanup.originStatus];
    const expectedRevision =
      originRevision + (normalized.status === 'cleanup-required' ? 1 : 2);
    if (normalized.revision !== expectedRevision)
      throw new Error('Worker attempt revision contradicts its cleanup state');
  }
  if (normalized.status === 'running' && normalized.updatedAtMs !== startedAtMs)
    throw new Error('Running worker attempt revision time is ambiguous');
  if (
    normalized.status === 'finished' &&
    normalized.updatedAtMs !== finishedAtMs
  )
    throw new Error('Finished worker attempt revision time is ambiguous');
  if (normalized.status === 'pending' && normalized.updatedAtMs !== createdAtMs)
    throw new Error('Pending worker attempt revision time is ambiguous');
  assertReferenceSeparation(normalized);
  return normalized;
}

function sealState(value) {
  const unsigned = { ...value };
  delete unsigned.stateSha256;
  const state = deepFreeze({
    ...unsigned,
    stateSha256: canonicalJsonSha256(unsigned),
  });
  assertBytes(state);
  trustedStates.add(state);
  return state;
}

function assertTrustedState(value) {
  if (!trustedStates.has(value))
    throw new Error(
      'Worker attempt state was not created or rehydrated by this state machine'
    );
  if (value.stateSha256 !== stateHash(value))
    throw new Error('Worker attempt state seal does not match its contents');
  return value;
}

function nextState(state, updatedAtMs, changes, kind, input) {
  integer(updatedAtMs, 'Worker attempt transition time');
  if (updatedAtMs < state.updatedAtMs)
    throw new Error('Worker attempt transition time is not monotonic');
  const next = sealState({
    ...state,
    ...changes,
    revision: state.revision + 1,
    previousStateSha256: state.stateSha256,
    updatedAtMs,
  });
  return bindWorkerAttemptTransitionProvenance(
    next,
    state.stateSha256,
    kind,
    input,
    updatedAtMs
  );
}

export function createDistributedWorkerAttemptState(value) {
  exactKeys(value, CREATE_KEYS, 'worker attempt creation input');
  const binding = verifyBrokerBinding(value.binding);
  const task = normalizeTaskIdentity(value.task);
  const lease = normalizeLease(value.lease);
  const adapters = normalizeAdapters(value.adapters);
  const applicationIsolationKeySha256 =
    brokerApplicationIsolationKeySha256(binding);
  digest(value.applicationIsolationKeySha256, 'application isolation hash');
  if (value.applicationIsolationKeySha256 !== applicationIsolationKeySha256)
    throw new Error('Worker attempt crossed an application isolation boundary');
  if (
    task.applicationIsolationKeySha256 !== applicationIsolationKeySha256 ||
    task.assignment.workerId !== lease.workerId ||
    lease.attempt > task.maxAttempts ||
    lease.expiresAtMs > lease.grantedAtMs + task.timeoutMs
  )
    throw new Error('Worker attempt task and lease identities do not match');
  if (!adapters.some((entry) => entry.adapterId === task.adapterId))
    throw new Error('Worker attempt lacks its task native adapter identity');
  const createdAtMs = integer(
    value.createdAtMs,
    'Worker attempt creation time'
  );
  if (createdAtMs < lease.grantedAtMs || createdAtMs >= lease.expiresAtMs)
    throw new Error('Worker attempt creation is outside its lease');
  const bridgeSha256 = digest(value.bridgeSha256, 'execution bridge hash');
  const sourceWorkspaceIdentitySha256 = digest(
    value.sourceWorkspaceIdentitySha256,
    'source workspace identity hash'
  );
  const input = {
    binding,
    bridgeSha256,
    applicationIsolationKeySha256,
    task,
    lease,
    sourceWorkspaceIdentitySha256,
    adapters,
    createdAtMs,
  };
  const base = {
    schema: DISTRIBUTED_WORKER_ATTEMPT_STATE_SCHEMA,
    revision: 1,
    previousStateSha256: null,
    bridgeSha256,
    binding,
    bindingSha256: canonicalJsonSha256(binding),
    applicationIsolationKeySha256,
    sourceWorkspaceIdentitySha256,
    adapters,
    task,
    lease,
  };
  const attemptIdentitySha256 = distributedWorkerAttemptIdentitySha256(base);
  const state = sealState({
    ...base,
    attemptIdentitySha256,
    status: 'pending',
    createdAtMs,
    updatedAtMs: createdAtMs,
    startedAtMs: null,
    finishedAtMs: null,
    nativeProcess: null,
    outcome: null,
    evidenceReferences: [],
    resultReference: null,
    failureReference: null,
    cleanup: null,
  });
  return bindWorkerAttemptTransitionProvenance(
    state,
    null,
    'genesis',
    input,
    createdAtMs
  );
}

export function startDistributedWorkerAttempt(stateValue, value) {
  const state = assertTrustedState(stateValue);
  exactKeys(value, START_KEYS, 'worker attempt start input');
  if (state.status !== 'pending')
    throw new Error('Only a pending worker attempt can start');
  const startedAtMs = integer(value.startedAtMs, 'Worker attempt start time');
  if (startedAtMs < state.createdAtMs || startedAtMs >= state.lease.expiresAtMs)
    throw new Error('Worker attempt start is outside its active lease');
  const nativeProcess = createNativeProcess(
    state.attemptIdentitySha256,
    value.nativeProcess
  );
  const input = {
    startedAtMs,
    nativeProcess: {
      pid: nativeProcess.pid,
      processStartIdentitySha256: nativeProcess.processStartIdentitySha256,
      launchIdentitySha256: nativeProcess.launchIdentitySha256,
    },
  };
  return nextState(
    state,
    startedAtMs,
    {
      status: 'running',
      startedAtMs,
      nativeProcess,
    },
    'attempt-start',
    input
  );
}

export function finishDistributedWorkerAttempt(stateValue, value) {
  const state = assertTrustedState(stateValue);
  exactKeys(value, FINISH_KEYS, 'worker attempt finish input');
  if (state.status !== 'running')
    throw new Error('Only a running worker attempt can finish');
  const finishedAtMs = integer(
    value.finishedAtMs,
    'Worker attempt finish time'
  );
  if (
    finishedAtMs < state.startedAtMs ||
    finishedAtMs >= state.lease.expiresAtMs
  )
    throw new Error('Worker attempt finish is outside its active lease');
  const outcome = normalizeOutcome(value.outcome);
  const evidenceReferences = normalizeEvidenceReferences(
    value.evidenceReferences,
    state.task
  );
  const resultReference = normalizeReference(
    value.resultReference,
    'worker result reference'
  );
  const failureReference = nullableReference(
    value.failureReference,
    'worker failure reference'
  );
  if (
    outcome.status === 'passed' &&
    state.task.expectedEvidence.some(
      (expected) =>
        expected.required &&
        !evidenceReferences.some(
          (reference) => reference.referenceId === expected.evidenceId
        )
    )
  )
    throw new Error('Passed worker attempt is missing required evidence');
  if (
    (outcome.status === 'passed' && failureReference !== null) ||
    (outcome.status === 'failed' && failureReference === null)
  )
    throw new Error('Worker attempt failure reference contradicts its outcome');
  const input = {
    finishedAtMs,
    outcome,
    evidenceReferences,
    resultReference,
    failureReference,
  };
  const changes = { status: 'finished', ...input };
  assertReferenceSeparation({ ...state, ...changes });
  return nextState(state, finishedAtMs, changes, 'attempt-finish', input);
}

export function requireDistributedWorkerAttemptCleanup(stateValue, value) {
  const state = assertTrustedState(stateValue);
  exactKeys(value, REQUIRE_CLEANUP_KEYS, 'worker attempt cleanup input');
  if (!BASE_STATUSES.has(state.status))
    throw new Error(
      'Only a pending, running, or finished attempt can require cleanup'
    );
  const requiredAtMs = integer(value.requiredAtMs, 'Cleanup requirement time');
  if (requiredAtMs < state.updatedAtMs)
    throw new Error(
      'Cleanup cannot be required before the current attempt state'
    );
  const failureReference = nullableReference(
    value.failureReference,
    'worker failure reference'
  );
  if (state.status === 'finished' && failureReference !== null)
    throw new Error(
      'Finished attempt cleanup cannot replace its failure reference'
    );
  const reasonCode = identifier(value.reasonCode, 'cleanup reason code');
  const input = { requiredAtMs, reasonCode, failureReference };
  const changes = {
    status: 'cleanup-required',
    failureReference:
      state.status === 'finished' ? state.failureReference : failureReference,
    cleanup: {
      originStatus: state.status,
      reasonCode,
      requiredAtMs,
      completedAtMs: null,
      evidenceReference: null,
    },
  };
  assertReferenceSeparation({ ...state, ...changes });
  return nextState(
    state,
    requiredAtMs,
    changes,
    'attempt-cleanup-required',
    input
  );
}

export function cleanDistributedWorkerAttempt(stateValue, value) {
  const state = assertTrustedState(stateValue);
  exactKeys(value, COMPLETE_CLEANUP_KEYS, 'worker attempt cleaned input');
  if (state.status !== 'cleanup-required')
    throw new Error('Only a cleanup-required worker attempt can be cleaned');
  const cleanedAtMs = integer(value.cleanedAtMs, 'Cleanup completion time');
  if (cleanedAtMs < state.cleanup.requiredAtMs)
    throw new Error('Cleanup cannot complete before it was required');
  const evidenceReference = normalizeReference(
    value.evidenceReference,
    'cleanup evidence reference'
  );
  const input = { cleanedAtMs, evidenceReference };
  const changes = {
    status: 'cleaned',
    cleanup: {
      ...state.cleanup,
      completedAtMs: cleanedAtMs,
      evidenceReference,
    },
  };
  assertReferenceSeparation({ ...state, ...changes });
  return nextState(
    state,
    cleanedAtMs,
    changes,
    'attempt-cleanup-complete',
    input
  );
}

export function verifyDistributedWorkerAttemptState(value, expectations = {}) {
  plainObject(expectations, 'worker attempt verification expectations');
  const unknownExpectation = Reflect.ownKeys(expectations).find(
    (key) => typeof key !== 'string' || !VERIFY_EXPECTATION_KEYS.has(key)
  );
  if (unknownExpectation !== undefined)
    throw new Error(
      'Worker attempt verification expectations contain an unknown field'
    );
  const {
    expectedApplicationIsolationKeySha256,
    expectedAttempt,
    expectedAttemptIdentitySha256,
    expectedBinding,
    expectedBridgeSha256,
    expectedInstanceId,
    expectedLeaseId,
    expectedMachineIdentitySha256,
    expectedSlotId,
    expectedSourceWorkspaceIdentitySha256,
    expectedStateSha256,
    expectedTaskSha256,
    expectedWorkerId,
    expectedWorkerSessionId,
  } = expectations;
  const normalized = validateState(value, expectedStateSha256);
  const checks = [
    [
      expectedApplicationIsolationKeySha256,
      normalized.applicationIsolationKeySha256,
      'application isolation hash',
      digest,
    ],
    [
      expectedAttemptIdentitySha256,
      normalized.attemptIdentitySha256,
      'worker attempt identity hash',
      digest,
    ],
    [
      expectedBridgeSha256,
      normalized.bridgeSha256,
      'execution bridge hash',
      digest,
    ],
    [expectedLeaseId, normalized.lease.leaseId, 'lease ID', identifier],
    [
      expectedMachineIdentitySha256,
      normalized.lease.machineIdentitySha256,
      'worker machine identity hash',
      digest,
    ],
    [
      expectedSlotId,
      normalized.task.assignment.slotId,
      'assigned slot ID',
      identifier,
    ],
    [
      expectedSourceWorkspaceIdentitySha256,
      normalized.sourceWorkspaceIdentitySha256,
      'source workspace identity hash',
      digest,
    ],
    [expectedTaskSha256, normalized.task.taskSha256, 'task hash', digest],
    [expectedWorkerId, normalized.lease.workerId, 'worker ID', identifier],
    [
      expectedInstanceId,
      normalized.lease.instanceId,
      'worker instance ID',
      identifier,
    ],
    [
      expectedWorkerSessionId,
      normalized.lease.workerSessionId,
      'worker authentication session ID',
      identifier,
    ],
  ];
  for (const [expected, actual, label, validate] of checks) {
    if (expected === undefined) continue;
    validate(expected, `expected ${label}`);
    if (expected !== actual)
      throw new Error(`Worker attempt does not match its expected ${label}`);
  }
  if (expectedAttempt !== undefined) {
    integer(expectedAttempt, 'Expected task attempt', { minimum: 1 });
    if (expectedAttempt !== normalized.lease.attempt)
      throw new Error(
        'Worker attempt does not match its expected attempt number'
      );
  }
  if (
    expectedBinding !== undefined &&
    !sameCanonical(verifyBrokerBinding(expectedBinding), normalized.binding)
  )
    throw new Error('Worker attempt belongs to a different broker binding');
  const restored = deepFreeze(structuredClone(normalized));
  trustedStates.add(restored);
  return restored;
}

export function verifyDistributedWorkerAttemptTransition(
  previousStateValue,
  currentValue,
  expectations
) {
  const previous = assertTrustedState(previousStateValue);
  const current = verifyDistributedWorkerAttemptState(
    currentValue,
    expectations
  );
  if (
    current.previousStateSha256 !== previous.stateSha256 ||
    current.revision !== previous.revision + 1 ||
    current.attemptIdentitySha256 !== previous.attemptIdentitySha256
  )
    throw new Error('Worker attempt revision is not linked to its predecessor');

  let expected;
  if (previous.status === 'pending' && current.status === 'running') {
    expected = startDistributedWorkerAttempt(previous, {
      startedAtMs: current.startedAtMs,
      nativeProcess: {
        pid: current.nativeProcess.pid,
        processStartIdentitySha256:
          current.nativeProcess.processStartIdentitySha256,
        launchIdentitySha256: current.nativeProcess.launchIdentitySha256,
      },
    });
  } else if (previous.status === 'running' && current.status === 'finished') {
    expected = finishDistributedWorkerAttempt(previous, {
      finishedAtMs: current.finishedAtMs,
      outcome: current.outcome,
      evidenceReferences: current.evidenceReferences,
      resultReference: current.resultReference,
      failureReference: current.failureReference,
    });
  } else if (
    BASE_STATUSES.has(previous.status) &&
    current.status === 'cleanup-required'
  ) {
    expected = requireDistributedWorkerAttemptCleanup(previous, {
      requiredAtMs: current.cleanup.requiredAtMs,
      reasonCode: current.cleanup.reasonCode,
      failureReference:
        previous.status === 'finished' ? null : current.failureReference,
    });
  } else if (
    previous.status === 'cleanup-required' &&
    current.status === 'cleaned'
  ) {
    expected = cleanDistributedWorkerAttempt(previous, {
      cleanedAtMs: current.cleanup.completedAtMs,
      evidenceReference: current.cleanup.evidenceReference,
    });
  } else {
    throw new Error('Worker attempt lifecycle transition is not legal');
  }
  if (expected.stateSha256 !== current.stateSha256)
    throw new Error('Worker attempt state does not match its legal transition');
  return current;
}

export function describeDistributedWorkerAttemptTransition(
  previousStateValue,
  currentValue,
  expectations
) {
  const provenance = trustedTransitionProvenance.get(currentValue);
  if (!provenance)
    throw new Error(
      'Worker attempt lacks trusted runtime transition provenance'
    );
  if (previousStateValue === null) {
    const current = verifyDistributedWorkerAttemptState(
      currentValue,
      expectations
    );
    const input = {
      binding: current.binding,
      bridgeSha256: current.bridgeSha256,
      applicationIsolationKeySha256: current.applicationIsolationKeySha256,
      task: current.task,
      lease: current.lease,
      sourceWorkspaceIdentitySha256: current.sourceWorkspaceIdentitySha256,
      adapters: current.adapters,
      createdAtMs: current.createdAtMs,
    };
    const expected = createDistributedWorkerAttemptState(input);
    if (expected.stateSha256 !== current.stateSha256)
      throw new Error(
        'Worker attempt state does not match its exact genesis operation'
      );
    const descriptor = createWorkerAttemptTransitionDescriptor(
      'genesis',
      input,
      current.createdAtMs
    );
    if (
      provenance.previousStateSha256 !== null ||
      !sameCanonical(provenance.descriptor, descriptor)
    )
      throw new Error('Worker attempt genesis provenance does not match');
    return provenance.descriptor;
  }

  const previous = assertTrustedState(previousStateValue);
  const current = verifyDistributedWorkerAttemptTransition(
    previous,
    currentValue,
    expectations
  );
  let kind;
  let input;
  if (previous.status === 'pending' && current.status === 'running') {
    kind = 'attempt-start';
    input = {
      startedAtMs: current.startedAtMs,
      nativeProcess: {
        pid: current.nativeProcess.pid,
        processStartIdentitySha256:
          current.nativeProcess.processStartIdentitySha256,
        launchIdentitySha256: current.nativeProcess.launchIdentitySha256,
      },
    };
  } else if (previous.status === 'running' && current.status === 'finished') {
    kind = 'attempt-finish';
    input = {
      finishedAtMs: current.finishedAtMs,
      outcome: current.outcome,
      evidenceReferences: current.evidenceReferences,
      resultReference: current.resultReference,
      failureReference: current.failureReference,
    };
  } else if (
    BASE_STATUSES.has(previous.status) &&
    current.status === 'cleanup-required'
  ) {
    kind = 'attempt-cleanup-required';
    input = {
      requiredAtMs: current.cleanup.requiredAtMs,
      reasonCode: current.cleanup.reasonCode,
      failureReference:
        previous.status === 'finished' ? null : current.failureReference,
    };
  } else if (
    previous.status === 'cleanup-required' &&
    current.status === 'cleaned'
  ) {
    kind = 'attempt-cleanup-complete';
    input = {
      cleanedAtMs: current.cleanup.completedAtMs,
      evidenceReference: current.cleanup.evidenceReference,
    };
  } else {
    throw new Error('Worker attempt transition provenance is ambiguous');
  }
  const descriptor = createWorkerAttemptTransitionDescriptor(
    kind,
    input,
    current.updatedAtMs
  );
  if (
    provenance.previousStateSha256 !== previous.stateSha256 ||
    !sameCanonical(provenance.descriptor, descriptor)
  )
    throw new Error(
      'Worker attempt runtime provenance does not match its legal transition'
    );
  return provenance.descriptor;
}

export function snapshotDistributedWorkerAttemptState(stateValue) {
  return deepFreeze(structuredClone(assertTrustedState(stateValue)));
}

export function rehydrateDistributedWorkerAttemptState(value, expectations) {
  return verifyDistributedWorkerAttemptState(value, expectations);
}
