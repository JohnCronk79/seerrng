// Copyright (c) snapetech and SeerrNG contributors.
// Fail-closed lease and result accounting for one application submission.
// The controller queue serializes submissions; each state stays app-isolated.
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';
import {
  assertAuthenticatedBrokerMessage,
  brokerApplicationIsolationKeySha256,
  brokerSubmissionSha256,
  createBrokerWorkerConfig,
  evaluateConfiguredWorkerAdmission,
  verifyBrokerBinding,
  verifyBrokerCleanupEvidence,
  verifyBrokerTask,
} from './broker-protocol.mjs';

export const BROKER_LEASE_STATE_SCHEMA =
  'seerrng-validation-broker-lease-state/v1';
export const BROKER_RECONCILIATION_INPUT_SCHEMA =
  'seerrng-validation-broker-reconciliation-input/v1';
export const BROKER_WORKER_FRESHNESS_MS = 30_000;

const STATE_KEYS = [
  'applicationIsolationKeySha256',
  'binding',
  'expectedTasks',
  'leases',
  'results',
  'schema',
  'stateSha256',
  'workerConfig',
  'workers',
];
const HASH64 = /^[a-f0-9]{64}$/;
const WORKER_STATE_KEYS = [
  'admission',
  'capacity',
  'capacitySha256',
  'heartbeat',
  'registeredAtMs',
  'registration',
  'registrationSha256',
  'sessionId',
  'workerId',
];
const LEASE_STATE_KEYS = [
  'applicationIsolationKeySha256',
  'attempt',
  'cancellationMode',
  'cancellationReasonCode',
  'cancellationRequestedAtMs',
  'cleanupAcceptedAtMs',
  'cleanupEvidence',
  'expiresAtMs',
  'grantedAtMs',
  'leaseId',
  'maxAttempts',
  'state',
  'taskId',
  'taskSha256',
  'terminalAtMs',
  'workerId',
  'workerInstanceId',
  'workerSessionId',
];
const RESULT_STATE_KEYS = [
  'acceptedAtMs',
  'submission',
  'submissionSha256',
];
const trustedStates = new WeakSet();

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative safe integer`);
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stateHash(value) {
  const unsigned = { ...value };
  delete unsigned.stateSha256;
  return canonicalJsonSha256(unsigned);
}

function plainRecord(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object`);
  return value;
}

function exactRecord(value, label, keys) {
  plainRecord(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const sortedActual = actual.toSorted();
  const sortedExpected = [...keys].sort();
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((key, index) => key !== sortedExpected[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function exactDigest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function uniqueField(entries, field, label) {
  const values = entries.map((entry) => entry[field]);
  if (values.some((value) => typeof value !== 'string' || !value))
    throw new Error(`${label} requires exact ${field} values`);
  if (new Set(values).size !== values.length)
    throw new Error(`${label} contains duplicate ${field} values`);
}

function sealState(value) {
  const state = {
    schema: BROKER_LEASE_STATE_SCHEMA,
    binding: value.binding,
    applicationIsolationKeySha256: brokerApplicationIsolationKeySha256(
      value.binding
    ),
    workerConfig: value.workerConfig,
    expectedTasks: [...value.expectedTasks].toSorted((left, right) =>
      compareText(left.taskId, right.taskId)
    ),
    workers: [...value.workers].toSorted((left, right) =>
      compareText(left.workerId, right.workerId)
    ),
    leases: [...value.leases].toSorted((left, right) =>
      compareText(left.leaseId, right.leaseId)
    ),
    results: [...value.results].toSorted((left, right) =>
      compareText(
        left.submission.resultKeySha256,
        right.submission.resultKeySha256
      )
    ),
  };
  const sealed = deepFreeze({ ...state, stateSha256: stateHash(state) });
  trustedStates.add(sealed);
  return sealed;
}

export function verifyBrokerLeaseState(
  value,
  { expectedBinding, expectedStateSha256 } = {}
) {
  exactRecord(value, 'persisted broker lease state', STATE_KEYS);
  if (value.schema !== BROKER_LEASE_STATE_SCHEMA)
    throw new Error('Unsupported broker lease state schema');
  exactDigest(expectedStateSha256, 'expected broker state hash');
  exactDigest(value.stateSha256, 'persisted broker state hash');
  if (value.stateSha256 !== expectedStateSha256)
    throw new Error('Persisted broker state does not match its trusted hash');
  if (value.stateSha256 !== stateHash(value))
    throw new Error('Broker lease state seal does not match its contents');

  const binding = verifyBrokerBinding(value.binding);
  exactDigest(
    value.applicationIsolationKeySha256,
    'application isolation hash'
  );
  if (
    value.applicationIsolationKeySha256 !==
    brokerApplicationIsolationKeySha256(binding)
  )
    throw new Error('Persisted application isolation hash does not match');
  if (
    canonicalJsonSha256(binding) !==
    canonicalJsonSha256(verifyBrokerBinding(expectedBinding))
  )
    throw new Error('Persisted broker state belongs to a different execution');
  const workerConfig = createBrokerWorkerConfig(value.workerConfig);
  if (workerConfig.controllerId !== binding.controllerId)
    throw new Error('Persisted worker config belongs to another controller');
  if (!Array.isArray(value.expectedTasks) || value.expectedTasks.length === 0)
    throw new Error('Persisted broker state requires expected tasks');
  const expectedTasks = value.expectedTasks.map(verifyBrokerTask);
  if (
    expectedTasks.some(
      (task) =>
        task.applicationIsolationKeySha256 !==
        value.applicationIsolationKeySha256
    )
  )
    throw new Error('Persisted task crossed an application isolation boundary');
  uniqueField(expectedTasks, 'taskId', 'Persisted expected tasks');
  const taskById = new Map(
    expectedTasks.map((task) => [task.taskId, task])
  );

  if (!Array.isArray(value.workers))
    throw new Error('Persisted broker workers must be an array');
  value.workers.forEach((worker) => {
    exactRecord(worker, 'persisted broker worker', WORKER_STATE_KEYS);
    if (
      worker.workerId !== worker.registration?.workerId ||
      worker.registration?.instanceId === undefined ||
      typeof worker.sessionId !== 'string' ||
      !worker.sessionId
    )
      throw new Error('Persisted worker identity is inconsistent');
    safeInteger(worker.registeredAtMs, 'Persisted worker registration time');
    exactDigest(worker.registrationSha256, 'worker registration hash');
    if (
      worker.registrationSha256 !== canonicalJsonSha256(worker.registration)
    )
      throw new Error('Persisted worker registration hash does not match');
    if ((worker.capacity === null) !== (worker.capacitySha256 === null))
      throw new Error('Persisted worker capacity hash pairing is invalid');
    if (worker.capacity !== null) {
      exactDigest(worker.capacitySha256, 'worker capacity hash');
      if (worker.capacitySha256 !== canonicalJsonSha256(worker.capacity))
        throw new Error('Persisted worker capacity hash does not match');
      if (
        worker.capacity.workerId !== worker.workerId ||
        worker.capacity.instanceId !== worker.registration.instanceId ||
        worker.capacity.workerSessionId !== worker.sessionId
      )
        throw new Error('Persisted worker capacity binding is inconsistent');
    }
    if (
      worker.admission !== null &&
      (worker.admission.workerId !== worker.workerId ||
        worker.admission.instanceId !== worker.registration.instanceId ||
        worker.admission.workerSessionId !== worker.sessionId)
    )
      throw new Error('Persisted worker admission binding is inconsistent');
    if (
      worker.heartbeat !== null &&
      (worker.heartbeat.workerId !== worker.workerId ||
        worker.heartbeat.instanceId !== worker.registration.instanceId ||
        worker.heartbeat.workerSessionId !== worker.sessionId)
    )
      throw new Error('Persisted worker heartbeat binding is inconsistent');
  });
  uniqueField(value.workers, 'workerId', 'Persisted workers');
  const workerById = new Map(
    value.workers.map((worker) => [worker.workerId, worker])
  );

  if (!Array.isArray(value.leases))
    throw new Error('Persisted broker leases must be an array');
  value.leases.forEach((lease) => {
    exactRecord(lease, 'persisted broker lease', LEASE_STATE_KEYS);
    const task = taskById.get(lease.taskId);
    const worker = workerById.get(lease.workerId);
    if (!task || lease.taskSha256 !== task.taskSha256)
      throw new Error('Persisted lease task binding is inconsistent');
    if (
      lease.applicationIsolationKeySha256 !==
        value.applicationIsolationKeySha256 ||
      lease.applicationIsolationKeySha256 !==
        task.applicationIsolationKeySha256
    )
      throw new Error('Persisted lease crossed an application isolation boundary');
    if (!worker)
      throw new Error('Persisted lease references an unknown worker');
    safeInteger(lease.attempt, 'Persisted lease attempt');
    safeInteger(lease.maxAttempts, 'Persisted lease maximum attempts');
    safeInteger(lease.grantedAtMs, 'Persisted lease grant time');
    safeInteger(lease.expiresAtMs, 'Persisted lease expiry time');
    if (
      lease.attempt < 1 ||
      lease.attempt > lease.maxAttempts ||
      lease.expiresAtMs <= lease.grantedAtMs
    )
      throw new Error('Persisted lease attempt or grant timeline is invalid');
    if (
      !['active', 'cancelling', 'cleanup-required', 'cancelled', 'completed'].includes(
        lease.state
      )
    )
      throw new Error('Persisted lease has an unsupported lifecycle state');
    if (
      ['active', 'cancelling', 'cleanup-required'].includes(lease.state) &&
      (lease.workerInstanceId !== worker.registration.instanceId ||
        lease.workerSessionId !== worker.sessionId)
    )
      throw new Error('Persisted live lease worker binding is inconsistent');
    if (lease.state === 'active') {
      if (
        lease.cancellationMode !== null ||
        lease.cancellationReasonCode !== null ||
        lease.cancellationRequestedAtMs !== null ||
        lease.cleanupEvidence !== null ||
        lease.cleanupAcceptedAtMs !== null ||
        lease.terminalAtMs !== null
      )
        throw new Error('Persisted active lease contains terminal state');
    } else if (['cancelling', 'cleanup-required'].includes(lease.state)) {
      safeInteger(
        lease.cancellationRequestedAtMs,
        'Persisted cancellation request time'
      );
      if (
        !['abort-attempt', 'cancel-task'].includes(lease.cancellationMode) ||
        typeof lease.cancellationReasonCode !== 'string' ||
        !lease.cancellationReasonCode ||
        lease.cancellationRequestedAtMs < lease.grantedAtMs ||
        lease.cleanupEvidence !== null ||
        lease.cleanupAcceptedAtMs !== null ||
        lease.terminalAtMs !== null
      )
        throw new Error('Persisted cleanup-pending lease is already terminal');
    } else if (lease.state === 'cancelled') {
      safeInteger(lease.terminalAtMs, 'Persisted cancellation completion time');
      safeInteger(
        lease.cancellationRequestedAtMs,
        'Persisted cancellation request time'
      );
      safeInteger(
        lease.cleanupAcceptedAtMs,
        'Persisted cleanup acceptance time'
      );
      const cleanup = verifyBrokerCleanupEvidence(binding, lease.cleanupEvidence);
      if (
        !['abort-attempt', 'cancel-task'].includes(lease.cancellationMode) ||
        typeof lease.cancellationReasonCode !== 'string' ||
        !lease.cancellationReasonCode ||
        lease.cancellationRequestedAtMs < lease.grantedAtMs ||
        lease.terminalAtMs < lease.cancellationRequestedAtMs ||
        lease.cleanupAcceptedAtMs < lease.terminalAtMs ||
        cleanup.workerId !== lease.workerId ||
        cleanup.applicationIsolationKeySha256 !==
          value.applicationIsolationKeySha256 ||
        cleanup.instanceId !== lease.workerInstanceId ||
        cleanup.workerSessionId !== lease.workerSessionId ||
        cleanup.leaseId !== lease.leaseId ||
        cleanup.taskId !== lease.taskId ||
        cleanup.attempt !== lease.attempt ||
        cleanup.cancellationRequestedAtMs !== lease.cancellationRequestedAtMs ||
        cleanup.completedAtMs !== lease.terminalAtMs
      )
        throw new Error('Persisted cleanup evidence is not bound to its lease');
    } else if (lease.state === 'completed') {
      safeInteger(lease.terminalAtMs, 'Persisted result completion time');
      if (
        lease.terminalAtMs < lease.grantedAtMs ||
        lease.terminalAtMs >= lease.expiresAtMs ||
        lease.cancellationMode !== null ||
        lease.cancellationReasonCode !== null ||
        lease.cancellationRequestedAtMs !== null ||
        lease.cleanupEvidence !== null ||
        lease.cleanupAcceptedAtMs !== null
      )
        throw new Error('Persisted completed lease contains cleanup evidence');
    }
  });
  uniqueField(value.leases, 'leaseId', 'Persisted leases');

  if (!Array.isArray(value.results))
    throw new Error('Persisted broker results must be an array');
  value.results.forEach((result) => {
    exactRecord(result, 'persisted broker result', RESULT_STATE_KEYS);
    safeInteger(result.acceptedAtMs, 'Persisted result acceptance time');
    exactDigest(result.submissionSha256, 'persisted result submission hash');
    if (result.submissionSha256 !== canonicalJsonSha256(result.submission))
      throw new Error('Persisted result submission hash does not match');
    const lease = value.leases.find(
      (entry) => entry.leaseId === result.submission?.leaseId
    );
    if (
      !lease ||
      lease.state !== 'completed' ||
      result.submission.applicationIsolationKeySha256 !==
        value.applicationIsolationKeySha256 ||
      lease.taskId !== result.submission.taskId ||
      lease.attempt !== result.submission.attempt
    )
      throw new Error('Persisted result does not close its exact lease');
  });
  uniqueField(
    value.results.map((entry) => entry.submission),
    'resultKeySha256',
    'Persisted results'
  );
  uniqueField(
    value.results.map((entry) => entry.submission),
    'taskId',
    'Persisted logical task results'
  );
  value.leases.forEach((lease) => {
    const matchingResults = value.results.filter(
      (result) => result.submission.leaseId === lease.leaseId
    );
    if (
      (lease.state === 'completed' && matchingResults.length !== 1) ||
      (lease.state !== 'completed' && matchingResults.length !== 0)
    )
      throw new Error('Persisted lease/result closure is inconsistent');
  });

  const restored = deepFreeze(structuredClone(value));
  trustedStates.add(restored);
  return restored;
}

export function rehydrateBrokerLeaseState(value, expectations) {
  return verifyBrokerLeaseState(value, expectations);
}

function assertState(value) {
  if (!trustedStates.has(value))
    throw new Error('Broker state was not created by this lease state machine');
  if (value.schema !== BROKER_LEASE_STATE_SCHEMA)
    throw new Error('Unsupported broker lease state schema');
  if (Reflect.ownKeys(value).length !== STATE_KEYS.length)
    throw new Error('Broker lease state requires its exact field set');
  if (value.stateSha256 !== stateHash(value))
    throw new Error('Broker lease state seal does not match its contents');
  return value;
}

function assertWorkerMessageBinding(worker, message, body) {
  if (
    worker.registration.instanceId !== body.instanceId ||
    worker.sessionId !== body.workerSessionId ||
    worker.sessionId !== message.auth.sessionId
  )
    throw new Error('Broker message belongs to a stale worker instance or session');
}

function assertBoundMessage(state, message, kind) {
  assertAuthenticatedBrokerMessage(message, kind);
  if (
    canonicalJsonSha256(message.binding) !==
    canonicalJsonSha256(state.binding)
  )
    throw new Error(
      'Broker message belongs to a different application submission or execution'
    );
  return message;
}

function replaceWorker(state, worker) {
  return state.workers
    .filter((entry) => entry.workerId !== worker.workerId)
    .concat(worker);
}

function replaceLease(state, lease) {
  return state.leases
    .filter((entry) => entry.leaseId !== lease.leaseId)
    .concat(lease);
}

function activeWorkerLeases(state, workerId) {
  return state.leases.filter(
    (entry) =>
      entry.workerId === workerId &&
      ['active', 'cancelling', 'cleanup-required'].includes(entry.state)
  );
}

function activeLeaseSummary(state, workerId) {
  return activeWorkerLeases(state, workerId)
    .map(({ attempt, leaseId, taskId }) => ({ attempt, leaseId, taskId }))
    .toSorted((left, right) => compareText(left.leaseId, right.leaseId));
}

function exactArray(left, right) {
  return canonicalJsonSha256(left) === canonicalJsonSha256(right);
}

export function createBrokerLeaseState({
  binding: bindingValue,
  expectedTasks: taskValues,
  workerConfig: workerConfigValue,
}) {
  const binding = verifyBrokerBinding(bindingValue);
  const workerConfig = createBrokerWorkerConfig(workerConfigValue);
  if (workerConfig.controllerId !== binding.controllerId)
    throw new Error('Worker config and broker binding controllers must match');
  if (!Array.isArray(taskValues) || taskValues.length === 0)
    throw new Error('Broker state requires at least one expected task');
  const expectedTasks = taskValues.map(verifyBrokerTask);
  const applicationIsolationKeySha256 =
    brokerApplicationIsolationKeySha256(binding);
  if (
    expectedTasks.some(
      (task) =>
        task.applicationIsolationKeySha256 !==
        applicationIsolationKeySha256
    )
  )
    throw new Error(
      'Broker tasks must match their application submission isolation key'
    );
  const taskIds = expectedTasks.map((entry) => entry.taskId);
  if (new Set(taskIds).size !== taskIds.length)
    throw new Error('Broker state contains a duplicate expected task ID');
  return sealState({
    binding,
    workerConfig,
    expectedTasks,
    workers: [],
    leases: [],
    results: [],
  });
}

export function registerBrokerWorker(stateValue, messageValue) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'worker.register');
  const registration = message.body;
  const configured = state.workerConfig.workers.find(
    (entry) => entry.workerId === registration.workerId
  );
  if (!configured || !configured.enabled)
    throw new Error('Worker is not enabled in the controller configuration');
  if (configured.machineIdentitySha256 !== registration.machineIdentitySha256)
    throw new Error('Worker machine identity does not match its configuration');
  const existing = state.workers.find(
    (entry) => entry.workerId === registration.workerId
  );
  const registrationSha256 = canonicalJsonSha256(registration);
  if (
    existing?.registrationSha256 === registrationSha256 &&
    existing.sessionId === message.auth.sessionId
  )
    return state;
  if (existing && activeWorkerLeases(state, registration.workerId).length > 0)
    throw new Error('Cannot replace a worker registration with active leases');
  if (
    existing &&
    existing.registration.machineIdentitySha256 !==
      registration.machineIdentitySha256
  )
    throw new Error('Stable worker ID cannot change machine identity');
  const worker = {
    workerId: registration.workerId,
    sessionId: message.auth.sessionId,
    registeredAtMs: message.sentAtMs,
    registration,
    registrationSha256,
    capacity: null,
    capacitySha256: null,
    admission: null,
    heartbeat: null,
  };
  return sealState({
    ...state,
    workers: replaceWorker(state, worker),
  });
}

export function recordBrokerCapacity(stateValue, messageValue) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'worker.capacity');
  const capacity = message.body;
  const worker = state.workers.find(
    (entry) => entry.workerId === capacity.workerId
  );
  if (!worker)
    throw new Error('Capacity report requires a registered worker');
  assertWorkerMessageBinding(worker, message, capacity);
  if (
    capacity.observedAtMs < worker.registeredAtMs ||
    capacity.observedAtMs > message.sentAtMs ||
    message.sentAtMs < worker.registeredAtMs
  )
    throw new Error('Capacity timing is outside the registered worker session');
  const expectedLeases = activeWorkerLeases(state, capacity.workerId)
    .map((entry) => entry.leaseId)
    .toSorted(compareText);
  if (!exactArray(capacity.activeLeaseIds, expectedLeases))
    throw new Error(
      'Capacity report does not close the worker active lease set'
    );
  const capacitySha256 = canonicalJsonSha256(capacity);
  if (worker.capacity) {
    if (
      capacity.reportSequence === worker.capacity.reportSequence &&
      capacitySha256 === worker.capacitySha256
    )
      return state;
    if (capacity.reportSequence <= worker.capacity.reportSequence)
      throw new Error('Capacity report sequence must increase monotonically');
    if (capacity.observedAtMs < worker.capacity.observedAtMs)
      throw new Error('Capacity observation time cannot move backwards');
  }
  const admission = evaluateConfiguredWorkerAdmission(
    state.workerConfig,
    worker.registration,
    capacity
  );
  const updated = {
    ...worker,
    capacity,
    capacitySha256,
    admission,
    heartbeat: null,
  };
  return sealState({ ...state, workers: replaceWorker(state, updated) });
}

export function recordBrokerHeartbeat(stateValue, messageValue) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'worker.heartbeat');
  const heartbeat = message.body;
  const worker = state.workers.find(
    (entry) => entry.workerId === heartbeat.workerId
  );
  if (!worker?.capacity)
    throw new Error('Heartbeat requires a current worker capacity report');
  assertWorkerMessageBinding(worker, message, heartbeat);
  if (heartbeat.capacitySequence !== worker.capacity.reportSequence)
    throw new Error('Heartbeat is not bound to the current capacity report');
  if (heartbeat.observedAtMs > message.sentAtMs)
    throw new Error('Heartbeat observation cannot follow its send time');
  if (heartbeat.observedAtMs < worker.capacity.observedAtMs)
    throw new Error('Heartbeat cannot predate its bound capacity report');
  if (
    worker.heartbeat &&
    heartbeat.observedAtMs < worker.heartbeat.observedAtMs
  )
    throw new Error('Heartbeat observation time cannot move backwards');
  const expected = activeLeaseSummary(state, heartbeat.workerId);
  if (!exactArray(heartbeat.activeLeases, expected))
    throw new Error('Heartbeat does not close the worker active lease set');
  const updated = { ...worker, heartbeat };
  return sealState({ ...state, workers: replaceWorker(state, updated) });
}

function expectedTask(state, taskId) {
  const task = state.expectedTasks.find((entry) => entry.taskId === taskId);
  if (!task) throw new Error(`Lease references unknown task: ${taskId}`);
  return task;
}

function priorTaskLeases(state, taskId) {
  return state.leases
    .filter((entry) => entry.taskId === taskId)
    .toSorted((left, right) => left.attempt - right.attempt);
}

function assertFreshWorkerProof(
  state,
  workerIdentity,
  decisionAtMs,
  operation
) {
  const worker = state.workers.find(
    (entry) => entry.workerId === workerIdentity.workerId
  );
  if (!worker?.capacity || !worker.admission || !worker.heartbeat)
    throw new Error(
      `${operation} requires fresh capacity and heartbeat from an admitted worker`
    );
  if (
    worker.registration.instanceId !== workerIdentity.instanceId ||
    worker.sessionId !== workerIdentity.workerSessionId
  )
    throw new Error(`${operation} targets a stale worker instance or session`);
  if (
    worker.heartbeat.capacitySequence !== worker.capacity.reportSequence
  )
    throw new Error(
      `${operation} heartbeat is not bound to the current capacity report`
    );
  if (
    decisionAtMs - worker.capacity.observedAtMs >
      BROKER_WORKER_FRESHNESS_MS ||
    decisionAtMs - worker.heartbeat.observedAtMs >
      BROKER_WORKER_FRESHNESS_MS ||
    worker.capacity.observedAtMs > decisionAtMs ||
    worker.heartbeat.observedAtMs > decisionAtMs
  )
    throw new Error(`${operation} requires fresh worker capacity and heartbeat`);
  return worker;
}

export function grantBrokerLease(stateValue, messageValue) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'lease.grant');
  const grant = message.body;
  const task = expectedTask(state, grant.task.taskId);
  if (task.taskSha256 !== grant.task.taskSha256)
    throw new Error('Lease task does not match the immutable expected task');
  if (
    task.applicationIsolationKeySha256 !==
    state.applicationIsolationKeySha256
  )
    throw new Error('Lease task crossed an application isolation boundary');
  if (grant.maxAttempts !== task.maxAttempts)
    throw new Error('Lease retry limit does not match the immutable task');
  if (grant.attempt > grant.maxAttempts)
    throw new Error('Task attempt cannot exceed maximum attempts');
  if (state.leases.some((entry) => entry.leaseId === grant.leaseId))
    throw new Error('Lease ID has already been used');
  if (state.results.some((entry) => entry.submission.taskId === task.taskId))
    throw new Error('Completed task cannot receive another lease');
  const worker = assertFreshWorkerProof(
    state,
    grant,
    message.sentAtMs,
    'Lease'
  );
  if (!worker.registration.capabilities.adapterIds.includes(task.adapterId))
    throw new Error('Worker does not advertise the task native adapter');
  if (
    activeWorkerLeases(state, grant.workerId).length >=
    worker.admission.selectedN
  )
    throw new Error('Lease would exceed the admitted worker N');
  const previous = priorTaskLeases(state, task.taskId);
  if (grant.attempt !== previous.length + 1)
    throw new Error('Task attempt sequence is not contiguous');
  if (previous.length > 0) {
    const latest = previous.at(-1);
    if (grant.maxAttempts !== latest.maxAttempts)
      throw new Error('Task maximum attempts cannot change');
    const retryableCancellation =
      latest.state === 'cancelled' &&
      latest.cancellationMode === 'abort-attempt' &&
      latest.cleanupEvidence !== null &&
      latest.cleanupAcceptedAtMs !== null;
    if (!retryableCancellation)
      throw new Error(
        'Only an aborted attempt with accepted cleanup evidence can be retried'
      );
  }
  if (grant.expiresAtMs <= message.sentAtMs)
    throw new Error('Lease must expire after it is granted');
  if (grant.expiresAtMs > message.sentAtMs + task.timeoutMs)
    throw new Error('Lease cannot exceed the immutable task timeout');
  const lease = {
    applicationIsolationKeySha256: state.applicationIsolationKeySha256,
    leaseId: grant.leaseId,
    taskId: task.taskId,
    taskSha256: task.taskSha256,
    workerId: grant.workerId,
    workerInstanceId: grant.instanceId,
    workerSessionId: grant.workerSessionId,
    attempt: grant.attempt,
    maxAttempts: grant.maxAttempts,
    grantedAtMs: message.sentAtMs,
    expiresAtMs: grant.expiresAtMs,
    state: 'active',
    terminalAtMs: null,
    cancellationMode: null,
    cancellationReasonCode: null,
    cancellationRequestedAtMs: null,
    cleanupAcceptedAtMs: null,
    cleanupEvidence: null,
  };
  return sealState({ ...state, leases: state.leases.concat(lease) });
}

export function renewBrokerLease(stateValue, messageValue) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'lease.renew');
  const renewal = message.body;
  const lease = state.leases.find((entry) => entry.leaseId === renewal.leaseId);
  if (!lease || lease.state !== 'active')
    throw new Error('Lease renewal requires an active lease');
  if (
    lease.workerId !== renewal.workerId ||
    lease.workerInstanceId !== renewal.instanceId ||
    lease.workerSessionId !== renewal.workerSessionId ||
    lease.taskId !== renewal.taskId ||
    lease.attempt !== renewal.attempt
  )
    throw new Error('Lease renewal identity does not match the active lease');
  const worker = assertFreshWorkerProof(
    state,
    renewal,
    message.sentAtMs,
    'Lease renewal'
  );
  if (
    !exactArray(
      worker.heartbeat.activeLeases,
      activeLeaseSummary(state, renewal.workerId)
    )
  )
    throw new Error(
      'Lease renewal heartbeat does not close the worker active lease set'
    );
  if (
    activeWorkerLeases(state, renewal.workerId).length >
    worker.admission.selectedN
  )
    throw new Error('Lease renewal exceeds the current worker admission');
  if (
    message.sentAtMs < lease.grantedAtMs ||
    message.sentAtMs >= lease.expiresAtMs ||
    renewal.expiresAtMs <= lease.expiresAtMs
  )
    throw new Error('Lease renewal must extend an unexpired lease');
  const task = expectedTask(state, lease.taskId);
  if (renewal.expiresAtMs > lease.grantedAtMs + task.timeoutMs)
    throw new Error('Lease renewal cannot exceed the immutable task timeout');
  const updated = { ...lease, expiresAtMs: renewal.expiresAtMs };
  return sealState({ ...state, leases: replaceLease(state, updated) });
}

export function cancelBrokerLease(stateValue, messageValue) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'lease.cancel');
  const cancellation = message.body;
  const lease = state.leases.find(
    (entry) => entry.leaseId === cancellation.leaseId
  );
  if (!lease || lease.state !== 'active')
    throw new Error('Cancellation requires an active lease');
  if (
    lease.workerId !== cancellation.workerId ||
    lease.workerInstanceId !== cancellation.instanceId ||
    lease.workerSessionId !== cancellation.workerSessionId ||
    lease.taskId !== cancellation.taskId ||
    lease.attempt !== cancellation.attempt
  )
    throw new Error('Cancellation identity does not match the active lease');
  if (
    cancellation.requestedAtMs < lease.grantedAtMs ||
    cancellation.requestedAtMs >= lease.expiresAtMs ||
    message.sentAtMs >= lease.expiresAtMs ||
    cancellation.requestedAtMs > message.sentAtMs
  )
    throw new Error('Cancellation time is outside the active lease history');
  const updated = {
    ...lease,
    state: 'cancelling',
    cancellationMode: cancellation.mode,
    cancellationReasonCode: cancellation.reasonCode,
    cancellationRequestedAtMs: cancellation.requestedAtMs,
  };
  return sealState({ ...state, leases: replaceLease(state, updated) });
}

export function acknowledgeBrokerCancellation(
  stateValue,
  messageValue,
  { acceptedAtMs, verifyCleanupEvidence } = {}
) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(
    state,
    messageValue,
    'worker.cancelled'
  );
  const acknowledgement = message.body;
  const lease = state.leases.find(
    (entry) => entry.leaseId === acknowledgement.leaseId
  );
  if (
    !lease ||
    !['cancelling', 'cleanup-required', 'cancelled'].includes(lease.state)
  )
    throw new Error(
      'Cancellation acknowledgement requires a cleanup-pending lease'
    );
  if (
    lease.workerId !== acknowledgement.workerId ||
    lease.workerInstanceId !== acknowledgement.instanceId ||
    lease.workerSessionId !== acknowledgement.workerSessionId ||
    lease.taskId !== acknowledgement.taskId ||
    lease.attempt !== acknowledgement.attempt
  )
    throw new Error('Cancellation acknowledgement does not match its lease');
  const worker = state.workers.find(
    (entry) => entry.workerId === acknowledgement.workerId
  );
  if (!worker)
    throw new Error('Cancellation acknowledgement requires its registered worker');
  assertWorkerMessageBinding(worker, message, acknowledgement);
  if (
    acknowledgement.cleanupEvidence.applicationIsolationKeySha256 !==
      state.applicationIsolationKeySha256 ||
    lease.applicationIsolationKeySha256 !==
      acknowledgement.cleanupEvidence.applicationIsolationKeySha256
  )
    throw new Error('Cleanup evidence crossed an application isolation boundary');
  if (
    acknowledgement.cleanupEvidence.cancellationRequestedAtMs !==
    lease.cancellationRequestedAtMs
  )
    throw new Error('Cleanup evidence does not preserve the cancellation request');
  if (lease.state === 'cancelled') {
    if (
      lease.cleanupEvidence?.cleanupEvidenceSha256 ===
      acknowledgement.cleanupEvidence.cleanupEvidenceSha256
    )
      return state;
    throw new Error('Conflicting cleanup evidence reused a cancelled lease');
  }
  if (lease.state === 'cancelling' && message.sentAtMs >= lease.expiresAtMs)
    throw new Error(
      'Expired cancellation must enter cleanup-required state before acknowledgement'
    );
  safeInteger(acceptedAtMs, 'Cleanup evidence acceptance time');
  if (typeof verifyCleanupEvidence !== 'function')
    throw new Error('Cleanup evidence requires an independent verifier');
  if (
    acknowledgement.cancelledAtMs < lease.cancellationRequestedAtMs ||
    acknowledgement.cancelledAtMs > message.sentAtMs ||
    acceptedAtMs < message.sentAtMs
  )
    throw new Error('Cancellation cleanup timeline is not monotonic');
  const verified = verifyCleanupEvidence({
    binding: state.binding,
    cleanupEvidence: acknowledgement.cleanupEvidence,
    lease,
    message,
  });
  if (verified && typeof verified.then === 'function')
    throw new Error('Cleanup evidence verifier must be synchronous');
  if (verified !== true)
    throw new Error('Cleanup evidence was not independently accepted');
  const updated = {
    ...lease,
    state: 'cancelled',
    terminalAtMs: acknowledgement.cancelledAtMs,
    cleanupAcceptedAtMs: acceptedAtMs,
    cleanupEvidence: acknowledgement.cleanupEvidence,
  };
  return sealState({ ...state, leases: replaceLease(state, updated) });
}

export function expireBrokerLeases(stateValue, nowMs) {
  const state = assertState(stateValue);
  safeInteger(nowMs, 'Lease expiry clock');
  let changed = false;
  const leases = state.leases.map((lease) => {
    if (
      !['active', 'cancelling'].includes(lease.state) ||
      lease.expiresAtMs > nowMs
    )
      return lease;
    changed = true;
    return {
      ...lease,
      state: 'cleanup-required',
      terminalAtMs: null,
      cancellationMode: lease.cancellationMode ?? 'abort-attempt',
      cancellationReasonCode:
        lease.cancellationReasonCode ?? 'lease-expired',
      cancellationRequestedAtMs:
        lease.cancellationRequestedAtMs ?? lease.expiresAtMs,
    };
  });
  return changed ? sealState({ ...state, leases }) : state;
}

function assertResultEvidence(task, result) {
  const expected = new Map(
    task.expectedEvidence.map((entry) => [entry.evidenceId, entry])
  );
  for (const evidence of result.evidence) {
    const definition = expected.get(evidence.evidenceId);
    if (!definition)
      throw new Error(
        `Result contains unexpected evidence: ${evidence.evidenceId}`
      );
    if (
      evidence.schema !== definition.schema ||
      evidence.mediaType !== definition.mediaType
    )
      throw new Error(
        `Result evidence contract drifted: ${evidence.evidenceId}`
      );
  }
  if (
    result.outcome.status === 'passed' &&
    task.expectedEvidence.some(
      (definition) =>
        definition.required &&
        !result.evidence.some(
          (evidence) => evidence.evidenceId === definition.evidenceId
        )
    )
  )
    throw new Error('Passed result is missing required evidence');
}

export function acceptBrokerResult(
  stateValue,
  messageValue,
  { acceptedAtMs, verifyResultEvidence } = {}
) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'worker.result');
  safeInteger(acceptedAtMs, 'Result acceptance time');
  if (acceptedAtMs < message.sentAtMs)
    throw new Error('Result cannot be accepted before it was sent');
  const submission = message.body;
  const submissionSha256 = brokerSubmissionSha256(message);
  const existing = state.results.find(
    (entry) =>
      entry.submission.resultKeySha256 === submission.resultKeySha256
  );
  if (existing) {
    if (existing.submissionSha256 !== submissionSha256)
      throw new Error('Conflicting result reused an idempotency key');
    return { state, disposition: 'duplicate', result: existing };
  }
  const lease = state.leases.find(
    (entry) => entry.leaseId === submission.leaseId
  );
  if (!lease || lease.state !== 'active')
    throw new Error('Result requires its exact active lease');
  if (
    submission.applicationIsolationKeySha256 !==
      state.applicationIsolationKeySha256 ||
    lease.applicationIsolationKeySha256 !==
      submission.applicationIsolationKeySha256 ||
    lease.workerId !== submission.workerId ||
    lease.workerInstanceId !== submission.instanceId ||
    lease.workerSessionId !== submission.workerSessionId ||
    lease.taskId !== submission.taskId ||
    lease.taskSha256 !== submission.taskSha256 ||
    lease.attempt !== submission.attempt
  )
    throw new Error('Result identity does not match its active lease');
  const worker = state.workers.find(
    (entry) => entry.workerId === submission.workerId
  );
  if (!worker) throw new Error('Result requires its registered worker');
  assertWorkerMessageBinding(worker, message, submission);
  if (
    submission.completedAtMs < lease.grantedAtMs ||
    submission.completedAtMs > message.sentAtMs ||
    submission.completedAtMs >= lease.expiresAtMs ||
    message.sentAtMs >= lease.expiresAtMs
  )
    throw new Error('Result timing cannot satisfy its active lease');
  const task = expectedTask(state, submission.taskId);
  assertResultEvidence(task, submission);
  const acceptedEvidenceKeys = new Set(
    state.results.flatMap((entry) =>
      entry.submission.evidence.map((evidence) => evidence.evidenceKeySha256)
    )
  );
  if (
    submission.evidence.some((entry) =>
      acceptedEvidenceKeys.has(entry.evidenceKeySha256)
    )
  )
    throw new Error('Evidence identity has already been accepted');
  if (typeof verifyResultEvidence !== 'function')
    throw new Error('Result evidence requires an independent verifier');
  const verified = verifyResultEvidence({
    binding: state.binding,
    applicationIsolationKeySha256: state.applicationIsolationKeySha256,
    task,
    lease,
    message,
    submission,
    submissionSha256,
  });
  if (verified && typeof verified.then === 'function')
    throw new Error('Result evidence verifier must be synchronous');
  if (verified !== true)
    throw new Error('Result evidence was not independently accepted');
  const completedLease = {
    ...lease,
    state: 'completed',
    terminalAtMs: submission.completedAtMs,
  };
  const result = deepFreeze({
    acceptedAtMs,
    submissionSha256,
    submission,
  });
  const next = sealState({
    ...state,
    leases: replaceLease(state, completedLease),
    results: state.results.concat(result),
  });
  return { state: next, disposition: 'accepted', result };
}

export function createBrokerResultAcknowledgementBody(acceptance) {
  if (
    !acceptance ||
    !['accepted', 'duplicate'].includes(acceptance.disposition) ||
    !acceptance.result
  )
    throw new Error('A result acceptance is required for acknowledgement');
  const { acceptedAtMs, submission, submissionSha256 } = acceptance.result;
  return deepFreeze({
    applicationIsolationKeySha256:
      submission.applicationIsolationKeySha256,
    workerId: submission.workerId,
    instanceId: submission.instanceId,
    workerSessionId: submission.workerSessionId,
    taskId: submission.taskId,
    resultKeySha256: submission.resultKeySha256,
    submissionSha256,
    acceptedAtMs,
    disposition: acceptance.disposition,
  });
}

export function createBrokerReconciliationInput(stateValue, nowMs) {
  const state = expireBrokerLeases(stateValue, nowMs);
  const resultByTask = new Map(
    state.results.map((entry) => [entry.submission.taskId, entry])
  );
  const permanentlyCancelled = new Set(
    state.leases
      .filter(
        (entry) =>
          entry.cancellationMode === 'cancel-task'
      )
      .map((entry) => entry.taskId)
  );
  const exhausted = new Set(
    state.leases
      .filter(
        (entry) =>
          entry.state === 'cancelled' &&
          entry.attempt >= entry.maxAttempts
      )
      .map((entry) => entry.taskId)
  );
  const activeLeaseIds = state.leases
    .filter((entry) =>
      ['active', 'cancelling', 'cleanup-required'].includes(entry.state)
    )
    .map((entry) => entry.leaseId)
    .toSorted(compareText);
  const unresolvedTaskIds = state.expectedTasks
    .filter((task) => !resultByTask.has(task.taskId))
    .map((task) => task.taskId)
    .toSorted(compareText);
  const ready =
    activeLeaseIds.length === 0 &&
    unresolvedTaskIds.length === 0 &&
    permanentlyCancelled.size === 0 &&
    exhausted.size === 0;
  const successEligible =
    ready &&
    state.results.length === state.expectedTasks.length &&
    state.results.every(
      (entry) => entry.submission.outcome.status === 'passed'
    );
  const input = {
    schema: BROKER_RECONCILIATION_INPUT_SCHEMA,
    binding: state.binding,
    applicationIsolationKeySha256: state.applicationIsolationKeySha256,
    stateSha256: state.stateSha256,
    expectedTasks: state.expectedTasks.map(({
      applicationIsolationKeySha256,
      taskId,
      taskSha256,
    }) => ({
      applicationIsolationKeySha256,
      taskId,
      taskSha256,
    })),
    workerAdmissions: state.workers
      .filter((entry) => entry.admission)
      .map((entry) => entry.admission),
    leases: state.leases,
    results: state.results,
    activeLeaseIds,
    unresolvedTaskIds,
    permanentlyCancelledTaskIds: [...permanentlyCancelled].toSorted(
      compareText
    ),
    exhaustedTaskIds: [...exhausted].toSorted(compareText),
    ready,
    successEligible,
  };
  return deepFreeze({
    ...input,
    reconciliationInputSha256: canonicalJsonSha256(input),
  });
}
