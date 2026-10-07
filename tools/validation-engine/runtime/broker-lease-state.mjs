// Copyright (c) snapetech and SeerrNG contributors.
// Fail-closed lease and result accounting for one application submission.
// The controller queue serializes submissions; each state stays app-isolated.
import {
  assertAuthenticatedBrokerMessage,
  brokerApplicationIsolationKeySha256,
  brokerSubmissionSha256,
  createBrokerWorkerConfig,
  evaluateConfiguredWorkerAdmission,
  verifyBrokerBinding,
  verifyBrokerCleanupEvidence,
  verifyBrokerLogicalCommandIdentity,
  verifyBrokerTask,
} from './broker-protocol.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const BROKER_LEASE_STATE_SCHEMA =
  'seerrng-validation-broker-lease-state/v3';
export const BROKER_RECONCILIATION_INPUT_SCHEMA =
  'seerrng-validation-broker-reconciliation-input/v2';
export const BROKER_WORKER_FRESHNESS_MS = 30_000;

const STATE_KEYS = [
  'appliedCommands',
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
const APPLIED_COMMAND_KEYS = ['appliedAtMs', 'command'];
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
  'cleanupDisposition',
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
const RESULT_STATE_KEYS = ['acceptedAtMs', 'submission', 'submissionSha256'];
const BROKER_TRANSITION_INPUT_SCHEMA =
  'seerrng-validation-broker-transition-input/v1';
const BROKER_TRANSITION_KINDS = new Set([
  'genesis',
  'lease.cancel',
  'lease.cleanup-recover',
  'lease.expire',
  'lease.grant',
  'lease.renew',
  'worker.cancelled',
  'worker.capacity',
  'worker.heartbeat',
  'worker.register',
  'worker.result',
]);
const trustedStates = new WeakSet();
const trustedTransitions = new WeakMap();

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

function brokerTransitionInputSha256(kind, input) {
  if (!BROKER_TRANSITION_KINDS.has(kind))
    throw new Error('Unsupported broker transition kind');
  plainRecord(input, 'broker transition input');
  return canonicalJsonSha256({
    schema: BROKER_TRANSITION_INPUT_SCHEMA,
    kind,
    ...input,
  });
}

function createBrokerTransitionDescriptor(kind, inputSha256, occurredAtMs) {
  if (!BROKER_TRANSITION_KINDS.has(kind))
    throw new Error('Unsupported broker transition kind');
  exactDigest(inputSha256, 'broker transition input hash');
  if (occurredAtMs !== null)
    safeInteger(occurredAtMs, 'Broker transition time');
  return deepFreeze({ kind, inputSha256, occurredAtMs });
}

function brokerMessageTransition(message, occurredAtMs = message.sentAtMs) {
  return createBrokerTransitionDescriptor(
    message.kind,
    brokerTransitionInputSha256(message.kind, {
      messageSha256: canonicalJsonSha256(message),
    }),
    occurredAtMs
  );
}

function brokerAcceptedMessageTransition(message, acceptedAtMs) {
  return createBrokerTransitionDescriptor(
    message.kind,
    brokerTransitionInputSha256(message.kind, {
      messageSha256: canonicalJsonSha256(message),
      acceptedAtMs,
    }),
    acceptedAtMs
  );
}

function uniqueField(entries, field, label) {
  const values = entries.map((entry) => entry[field]);
  if (values.some((value) => typeof value !== 'string' || !value))
    throw new Error(`${label} requires exact ${field} values`);
  if (new Set(values).size !== values.length)
    throw new Error(`${label} contains duplicate ${field} values`);
}

function taskSlotKey(task) {
  return `${task.assignment.workerId}\u0000${task.assignment.slotId}`;
}

function validateExpectedTaskCatalog(expectedTasks, workerConfig) {
  const taskIds = expectedTasks.map((task) => task.taskId);
  if (new Set(taskIds).size !== taskIds.length)
    throw new Error('Broker state contains a duplicate expected task ID');
  const taskById = new Map(expectedTasks.map((task) => [task.taskId, task]));
  const configuredById = new Map(
    workerConfig.workers.map((worker) => [worker.workerId, worker])
  );
  const slotIdByWorkerIndex = new Map();
  const tasksBySlot = new Map();

  for (const task of expectedTasks) {
    const { workerId, slotId, slotIndex } = task.assignment;
    const configured = configuredById.get(workerId);
    if (!configured?.enabled)
      throw new Error(
        `Broker task assignment references an unavailable worker: ${workerId}`
      );
    const workerSlotKey = `${workerId}\u0000${slotIndex}`;
    const existingSlotId = slotIdByWorkerIndex.get(workerSlotKey);
    if (existingSlotId !== undefined && existingSlotId !== slotId)
      throw new Error('Broker task catalog aliases one logical worker slot');
    slotIdByWorkerIndex.set(workerSlotKey, slotId);
    const slotKey = taskSlotKey(task);
    const slotTasks = tasksBySlot.get(slotKey) ?? [];
    slotTasks.push(task);
    tasksBySlot.set(slotKey, slotTasks);

    for (const dependencyTaskId of task.dependencyTaskIds) {
      if (!taskById.has(dependencyTaskId))
        throw new Error(
          `Broker task ${task.taskId} has unknown dependency: ${dependencyTaskId}`
        );
    }
  }

  for (const slotTasks of tasksBySlot.values()) {
    const ordered = slotTasks.toSorted(
      (left, right) =>
        left.assignment.slotPosition - right.assignment.slotPosition
    );
    for (const [index, task] of ordered.entries())
      if (task.assignment.slotPosition !== index + 1)
        throw new Error(
          'Broker task catalog slot positions must be unique and contiguous'
        );
  }

  const prerequisites = new Map(
    expectedTasks.map((task) => {
      const taskPrerequisites = new Set(task.dependencyTaskIds);
      const prior = priorSlotTask(expectedTasks, task);
      if (prior) taskPrerequisites.add(prior.taskId);
      return [task.taskId, taskPrerequisites];
    })
  );
  const remainingDependencies = new Map(
    [...prerequisites].map(([taskId, taskPrerequisites]) => [
      taskId,
      taskPrerequisites.size,
    ])
  );
  const successors = new Map(expectedTasks.map((task) => [task.taskId, []]));
  for (const [taskId, taskPrerequisites] of prerequisites)
    for (const prerequisiteTaskId of taskPrerequisites)
      successors.get(prerequisiteTaskId).push(taskId);
  const ready = expectedTasks
    .filter((task) => prerequisites.get(task.taskId).size === 0)
    .map((task) => task.taskId)
    .toSorted(compareText);
  let visited = 0;
  while (ready.length) {
    const taskId = ready.shift();
    visited += 1;
    for (const successorId of successors.get(taskId).toSorted(compareText)) {
      const remaining = remainingDependencies.get(successorId) - 1;
      remainingDependencies.set(successorId, remaining);
      if (remaining === 0) {
        ready.push(successorId);
        ready.sort(compareText);
      }
    }
  }
  if (visited !== expectedTasks.length)
    throw new Error(
      'Broker task dependencies contain a cycle with slot ordering'
    );

  return { taskById };
}

function priorSlotTask(expectedTasks, task) {
  if (task.assignment.slotPosition === 1) return null;
  const priorPosition = task.assignment.slotPosition - 1;
  const prior = expectedTasks.find(
    (entry) =>
      taskSlotKey(entry) === taskSlotKey(task) &&
      entry.assignment.slotPosition === priorPosition
  );
  if (!prior)
    throw new Error('Broker task catalog is missing its prior slot task');
  return prior;
}

function acceptedTaskResult(results, taskId, noLaterThanMs = Infinity) {
  return results.find(
    (entry) =>
      entry.submission.taskId === taskId && entry.acceptedAtMs <= noLaterThanMs
  );
}

function validatePersistedAssignmentHistory(state, taskById) {
  const leasesBySlot = new Map();
  for (const lease of state.leases) {
    const task = taskById.get(lease.taskId);
    for (const dependencyTaskId of task.dependencyTaskIds) {
      const result = acceptedTaskResult(
        state.results,
        dependencyTaskId,
        lease.grantedAtMs
      );
      if (!result || result.submission.outcome?.status !== 'passed')
        throw new Error(
          'Persisted lease began before an accepted passing dependency result'
        );
    }
    const prior = priorSlotTask(state.expectedTasks, task);
    if (
      prior &&
      !acceptedTaskResult(state.results, prior.taskId, lease.grantedAtMs)
    )
      throw new Error(
        'Persisted lease began before its prior slot result was accepted'
      );
    const slotKey = taskSlotKey(task);
    const slotLeases = leasesBySlot.get(slotKey) ?? [];
    slotLeases.push(lease);
    leasesBySlot.set(slotKey, slotLeases);
  }

  for (const slotLeases of leasesBySlot.values()) {
    const ordered = slotLeases.toSorted(
      (left, right) =>
        left.grantedAtMs - right.grantedAtMs ||
        compareText(left.leaseId, right.leaseId)
    );
    let priorReleaseAtMs = null;
    for (const lease of ordered) {
      if (
        priorReleaseAtMs === Infinity ||
        (priorReleaseAtMs !== null && lease.grantedAtMs < priorReleaseAtMs)
      )
        throw new Error('Persisted leases overlap one logical worker slot');
      if (lease.state === 'completed') {
        const result = state.results.find(
          (entry) => entry.submission.leaseId === lease.leaseId
        );
        priorReleaseAtMs = result?.acceptedAtMs ?? Infinity;
      } else if (lease.state === 'cancelled') {
        priorReleaseAtMs = lease.cleanupAcceptedAtMs;
      } else {
        priorReleaseAtMs = Infinity;
      }
    }
  }
}

function sealState(value, previousStateValue, transitionDescriptor) {
  const previousState =
    previousStateValue === null ? null : assertState(previousStateValue);
  exactRecord(transitionDescriptor, 'broker transition descriptor', [
    'inputSha256',
    'kind',
    'occurredAtMs',
  ]);
  const descriptor = createBrokerTransitionDescriptor(
    transitionDescriptor.kind,
    transitionDescriptor.inputSha256,
    transitionDescriptor.occurredAtMs
  );
  if (
    (previousState === null && descriptor.kind !== 'genesis') ||
    (previousState !== null && descriptor.kind === 'genesis')
  )
    throw new Error('Broker transition provenance has an invalid predecessor');
  if (previousState !== null && value.stateSha256 !== previousState.stateSha256)
    throw new Error(
      'Broker transition was not built from its exact predecessor'
    );
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
    appliedCommands: [...value.appliedCommands].toSorted((left, right) =>
      compareText(left.command.commandId, right.command.commandId)
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
  trustedTransitions.set(
    sealed,
    deepFreeze({
      previousStateSha256: previousState?.stateSha256 ?? null,
      descriptor,
    })
  );
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
  const { taskById } = validateExpectedTaskCatalog(expectedTasks, workerConfig);

  if (!Array.isArray(value.appliedCommands))
    throw new Error('Persisted applied commands must be an array');
  const commandIds = new Set();
  const commandHashes = new Set();
  const semanticCommands = new Set();
  for (const application of value.appliedCommands) {
    exactRecord(application, 'persisted applied command', APPLIED_COMMAND_KEYS);
    safeInteger(application.appliedAtMs, 'Persisted command application time');
    const command = verifyBrokerLogicalCommandIdentity(application.command, {
      expectedBinding: binding,
    });
    if (application.appliedAtMs < command.issuedAtMs)
      throw new Error('Persisted command was applied before it was issued');
    const semanticKey = `${command.kind}\u0000${command.bodySha256}`;
    if (
      commandIds.has(command.commandId) ||
      commandHashes.has(command.commandSha256) ||
      semanticCommands.has(semanticKey)
    )
      throw new Error(
        'Persisted applied commands contain a duplicate identity'
      );
    commandIds.add(command.commandId);
    commandHashes.add(command.commandSha256);
    semanticCommands.add(semanticKey);
  }

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
    if (worker.registrationSha256 !== canonicalJsonSha256(worker.registration))
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
    if (lease.workerId !== task.assignment.workerId)
      throw new Error('Persisted lease violates its sealed worker assignment');
    if (
      lease.applicationIsolationKeySha256 !==
        value.applicationIsolationKeySha256 ||
      lease.applicationIsolationKeySha256 !== task.applicationIsolationKeySha256
    )
      throw new Error(
        'Persisted lease crossed an application isolation boundary'
      );
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
      ![
        'active',
        'cancelling',
        'cleanup-required',
        'cancelled',
        'completed',
      ].includes(lease.state)
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
        lease.cleanupDisposition !== null ||
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
        lease.cleanupDisposition !== null ||
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
      const cleanup = verifyBrokerCleanupEvidence(
        binding,
        lease.cleanupEvidence
      );
      if (
        !['abort-attempt', 'cancel-task'].includes(lease.cancellationMode) ||
        typeof lease.cancellationReasonCode !== 'string' ||
        !lease.cancellationReasonCode ||
        !['worker-ack', 'controller-recovery'].includes(
          lease.cleanupDisposition
        ) ||
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
        lease.cleanupDisposition !== null ||
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
  validatePersistedAssignmentHistory(value, taskById);

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

export function verifyBrokerLeaseStateTransition(
  previousStateValue,
  currentStateValue
) {
  describeBrokerLeaseStateTransition(previousStateValue, currentStateValue);
  return currentStateValue;
}

export function describeBrokerLeaseStateTransition(
  previousStateValue,
  currentStateValue
) {
  const current = assertState(currentStateValue);
  const provenance = trustedTransitions.get(current);
  if (!provenance)
    throw new Error('Broker state lacks trusted transition provenance');
  if (previousStateValue === null) {
    if (
      provenance.previousStateSha256 !== null ||
      provenance.descriptor.kind !== 'genesis'
    )
      throw new Error('Broker state is not a trusted genesis');
    const expected = createBrokerLeaseState({
      binding: current.binding,
      expectedTasks: current.expectedTasks,
      workerConfig: current.workerConfig,
    });
    if (expected.stateSha256 !== current.stateSha256)
      throw new Error('Broker genesis does not match its exact initial state');
    return provenance.descriptor;
  }
  const previous = assertState(previousStateValue);
  if (provenance.previousStateSha256 !== previous.stateSha256)
    throw new Error('Broker state is not linked to its persisted predecessor');
  return provenance.descriptor;
}

function assertWorkerMessageBinding(worker, message, body) {
  if (
    worker.registration.instanceId !== body.instanceId ||
    worker.sessionId !== body.workerSessionId ||
    worker.sessionId !== message.auth.sessionId
  )
    throw new Error(
      'Broker message belongs to a stale worker instance or session'
    );
}

function assertBoundMessage(state, message, kind) {
  assertAuthenticatedBrokerMessage(message, kind);
  if (
    canonicalJsonSha256(message.binding) !== canonicalJsonSha256(state.binding)
  )
    throw new Error(
      'Broker message belongs to a different application submission or execution'
    );
  return message;
}

function beginLogicalCommand(state, message) {
  if (!message.command)
    throw new Error('Controller state transition requires a logical command');
  const command = verifyBrokerLogicalCommandIdentity(message.command, {
    expectedBinding: state.binding,
  });
  const sameId = state.appliedCommands.find(
    (entry) => entry.command.commandId === command.commandId
  );
  if (sameId) {
    if (sameId.command.commandSha256 === command.commandSha256)
      return { command, duplicate: true };
    throw new Error('Logical command ID was reused with conflicting contents');
  }
  const sameSemanticCommand = state.appliedCommands.find(
    (entry) =>
      entry.command.kind === command.kind &&
      entry.command.bodySha256 === command.bodySha256
  );
  if (sameSemanticCommand)
    throw new Error('Logical command was reissued under another identity');
  return { command, duplicate: false };
}

function sealCommandApplication(
  state,
  changes,
  command,
  appliedAtMs,
  { inputSha256 = command.commandSha256, occurredAtMs = appliedAtMs } = {}
) {
  return sealState(
    {
      ...state,
      ...changes,
      appliedCommands: state.appliedCommands.concat({
        command,
        appliedAtMs,
      }),
    },
    state,
    createBrokerTransitionDescriptor(command.kind, inputSha256, occurredAtMs)
  );
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
        task.applicationIsolationKeySha256 !== applicationIsolationKeySha256
    )
  )
    throw new Error(
      'Broker tasks must match their application submission isolation key'
    );
  validateExpectedTaskCatalog(expectedTasks, workerConfig);
  return sealState(
    {
      binding,
      workerConfig,
      expectedTasks,
      appliedCommands: [],
      workers: [],
      leases: [],
      results: [],
    },
    null,
    createBrokerTransitionDescriptor(
      'genesis',
      brokerTransitionInputSha256('genesis', {
        binding,
        expectedTasks: [...expectedTasks].toSorted((left, right) =>
          compareText(left.taskId, right.taskId)
        ),
        workerConfig,
      }),
      null
    )
  );
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
  return sealState(
    {
      ...state,
      workers: replaceWorker(state, worker),
    },
    state,
    brokerMessageTransition(message)
  );
}

export function recordBrokerCapacity(stateValue, messageValue) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'worker.capacity');
  const capacity = message.body;
  const worker = state.workers.find(
    (entry) => entry.workerId === capacity.workerId
  );
  if (!worker) throw new Error('Capacity report requires a registered worker');
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
  return sealState(
    { ...state, workers: replaceWorker(state, updated) },
    state,
    brokerMessageTransition(message)
  );
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
  return sealState(
    { ...state, workers: replaceWorker(state, updated) },
    state,
    brokerMessageTransition(message)
  );
}

function expectedTask(state, taskId) {
  const task = state.expectedTasks.find((entry) => entry.taskId === taskId);
  if (!task) throw new Error(`Lease references unknown task: ${taskId}`);
  return task;
}

function terminalTaskSets(state) {
  const permanentlyCancelled = new Set(
    state.leases
      .filter(
        (entry) =>
          entry.state === 'cancelled' &&
          entry.cancellationMode === 'cancel-task'
      )
      .map((entry) => entry.taskId)
  );
  const exhausted = new Set(
    state.leases
      .filter(
        (entry) =>
          entry.state === 'cancelled' && entry.attempt >= entry.maxAttempts
      )
      .map((entry) => entry.taskId)
  );
  return { permanentlyCancelled, exhausted };
}

function blockedTaskIds(state) {
  const resultByTask = new Map(
    state.results.map((entry) => [entry.submission.taskId, entry])
  );
  const failed = new Set(
    state.results
      .filter((entry) => entry.submission.outcome.status === 'failed')
      .map((entry) => entry.submission.taskId)
  );
  const { permanentlyCancelled, exhausted } = terminalTaskSets(state);
  const terminalWithoutResult = new Set([
    ...permanentlyCancelled,
    ...exhausted,
  ]);
  const blocked = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of state.expectedTasks) {
      if (
        resultByTask.has(task.taskId) ||
        terminalWithoutResult.has(task.taskId) ||
        blocked.has(task.taskId)
      )
        continue;
      const dependencyBlocked = task.dependencyTaskIds.some(
        (taskId) =>
          failed.has(taskId) ||
          terminalWithoutResult.has(taskId) ||
          blocked.has(taskId)
      );
      const prior = priorSlotTask(state.expectedTasks, task);
      const priorBlocked =
        prior !== null &&
        (terminalWithoutResult.has(prior.taskId) || blocked.has(prior.taskId));
      if (dependencyBlocked || priorBlocked) {
        blocked.add(task.taskId);
        changed = true;
      }
    }
  }
  return blocked;
}

function assertTaskDispatchReady(state, task, decisionAtMs) {
  if (blockedTaskIds(state).has(task.taskId))
    throw new Error('Task is blocked by a terminal prerequisite');
  for (const dependencyTaskId of task.dependencyTaskIds) {
    const result = acceptedTaskResult(
      state.results,
      dependencyTaskId,
      decisionAtMs
    );
    if (!result) throw new Error('Task requires an accepted dependency result');
    if (result.submission.outcome.status !== 'passed')
      throw new Error('Task is blocked by a failed dependency');
  }
  const prior = priorSlotTask(state.expectedTasks, task);
  if (prior && !acceptedTaskResult(state.results, prior.taskId, decisionAtMs))
    throw new Error('Task requires its prior slot result to be accepted');
}

function liveSlotLeases(state, task) {
  const slotKey = taskSlotKey(task);
  return state.leases.filter(
    (lease) =>
      ['active', 'cancelling', 'cleanup-required'].includes(lease.state) &&
      taskSlotKey(expectedTask(state, lease.taskId)) === slotKey
  );
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
  if (worker.heartbeat.capacitySequence !== worker.capacity.reportSequence)
    throw new Error(
      `${operation} heartbeat is not bound to the current capacity report`
    );
  if (
    decisionAtMs - worker.capacity.observedAtMs > BROKER_WORKER_FRESHNESS_MS ||
    decisionAtMs - worker.heartbeat.observedAtMs > BROKER_WORKER_FRESHNESS_MS ||
    worker.capacity.observedAtMs > decisionAtMs ||
    worker.heartbeat.observedAtMs > decisionAtMs
  )
    throw new Error(
      `${operation} requires fresh worker capacity and heartbeat`
    );
  return worker;
}

export function grantBrokerLease(stateValue, messageValue) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'lease.grant');
  const logicalCommand = beginLogicalCommand(state, message);
  if (logicalCommand.duplicate) return state;
  const grant = message.body;
  const task = expectedTask(state, grant.task.taskId);
  if (task.taskSha256 !== grant.task.taskSha256)
    throw new Error('Lease task does not match the immutable expected task');
  if (
    task.applicationIsolationKeySha256 !== state.applicationIsolationKeySha256
  )
    throw new Error('Lease task crossed an application isolation boundary');
  if (grant.maxAttempts !== task.maxAttempts)
    throw new Error('Lease retry limit does not match the immutable task');
  if (grant.attempt > grant.maxAttempts)
    throw new Error('Task attempt cannot exceed maximum attempts');
  if (grant.workerId !== task.assignment.workerId)
    throw new Error('Lease worker does not match the sealed task assignment');
  if (state.leases.some((entry) => entry.leaseId === grant.leaseId))
    throw new Error('Lease ID has already been used');
  if (state.results.some((entry) => entry.submission.taskId === task.taskId))
    throw new Error('Completed task cannot receive another lease');
  assertTaskDispatchReady(state, task, message.command.issuedAtMs);
  const worker = assertFreshWorkerProof(
    state,
    grant,
    message.sentAtMs,
    'Lease'
  );
  if (!worker.registration.capabilities.adapterIds.includes(task.adapterId))
    throw new Error('Worker does not advertise the task native adapter');
  if (task.assignment.slotIndex > worker.admission.selectedN)
    throw new Error('Assigned logical slot exceeds the admitted worker N');
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
  if (liveSlotLeases(state, task).length > 0)
    throw new Error('Assigned logical slot already has a live lease');
  if (
    grant.expiresAtMs <= message.command.issuedAtMs ||
    message.sentAtMs >= grant.expiresAtMs
  )
    throw new Error('Lease must remain live when its command is delivered');
  if (grant.expiresAtMs > message.command.issuedAtMs + task.timeoutMs)
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
    grantedAtMs: message.command.issuedAtMs,
    expiresAtMs: grant.expiresAtMs,
    state: 'active',
    terminalAtMs: null,
    cancellationMode: null,
    cancellationReasonCode: null,
    cancellationRequestedAtMs: null,
    cleanupDisposition: null,
    cleanupAcceptedAtMs: null,
    cleanupEvidence: null,
  };
  return sealCommandApplication(
    state,
    { leases: state.leases.concat(lease) },
    logicalCommand.command,
    message.sentAtMs
  );
}

export function renewBrokerLease(stateValue, messageValue) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'lease.renew');
  const logicalCommand = beginLogicalCommand(state, message);
  if (logicalCommand.duplicate) return state;
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
  const task = expectedTask(state, lease.taskId);
  if (
    task.assignment.workerId !== renewal.workerId ||
    task.assignment.slotIndex > worker.admission.selectedN
  )
    throw new Error('Lease renewal exceeds its assigned live worker slot');
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
    message.command.issuedAtMs < lease.grantedAtMs ||
    message.command.issuedAtMs >= lease.expiresAtMs ||
    message.sentAtMs >= lease.expiresAtMs ||
    renewal.expiresAtMs <= lease.expiresAtMs
  )
    throw new Error('Lease renewal must extend an unexpired lease');
  if (renewal.expiresAtMs > lease.grantedAtMs + task.timeoutMs)
    throw new Error('Lease renewal cannot exceed the immutable task timeout');
  const updated = { ...lease, expiresAtMs: renewal.expiresAtMs };
  return sealCommandApplication(
    state,
    { leases: replaceLease(state, updated) },
    logicalCommand.command,
    message.sentAtMs
  );
}

export function cancelBrokerLease(stateValue, messageValue) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'lease.cancel');
  const logicalCommand = beginLogicalCommand(state, message);
  if (logicalCommand.duplicate) return state;
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
    message.command.issuedAtMs < cancellation.requestedAtMs ||
    message.command.issuedAtMs >= lease.expiresAtMs ||
    message.sentAtMs >= lease.expiresAtMs ||
    message.command.issuedAtMs > message.sentAtMs
  )
    throw new Error('Cancellation time is outside the active lease history');
  const updated = {
    ...lease,
    state: 'cancelling',
    cancellationMode: cancellation.mode,
    cancellationReasonCode: cancellation.reasonCode,
    cancellationRequestedAtMs: cancellation.requestedAtMs,
  };
  return sealCommandApplication(
    state,
    { leases: replaceLease(state, updated) },
    logicalCommand.command,
    message.sentAtMs
  );
}

export function acknowledgeBrokerCancellation(
  stateValue,
  messageValue,
  { acceptedAtMs, verifyCleanupEvidence } = {}
) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(state, messageValue, 'worker.cancelled');
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
    lease.taskSha256 !== acknowledgement.cleanupEvidence.taskSha256 ||
    lease.attempt !== acknowledgement.attempt
  )
    throw new Error('Cancellation acknowledgement does not match its lease');
  const worker = state.workers.find(
    (entry) => entry.workerId === acknowledgement.workerId
  );
  if (!worker)
    throw new Error(
      'Cancellation acknowledgement requires its registered worker'
    );
  assertWorkerMessageBinding(worker, message, acknowledgement);
  if (
    acknowledgement.cleanupEvidence.applicationIsolationKeySha256 !==
      state.applicationIsolationKeySha256 ||
    lease.applicationIsolationKeySha256 !==
      acknowledgement.cleanupEvidence.applicationIsolationKeySha256
  )
    throw new Error(
      'Cleanup evidence crossed an application isolation boundary'
    );
  if (
    acknowledgement.cleanupEvidence.cancellationRequestedAtMs !==
    lease.cancellationRequestedAtMs
  )
    throw new Error(
      'Cleanup evidence does not preserve the cancellation request'
    );
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
    cleanupDisposition: 'worker-ack',
    cleanupAcceptedAtMs: acceptedAtMs,
    cleanupEvidence: acknowledgement.cleanupEvidence,
  };
  return sealState(
    { ...state, leases: replaceLease(state, updated) },
    state,
    brokerAcceptedMessageTransition(message, acceptedAtMs)
  );
}

export function recoverBrokerLeaseCleanup(
  stateValue,
  messageValue,
  { acceptedAtMs, verifyCleanupEvidence } = {}
) {
  const state = assertState(stateValue);
  const message = assertBoundMessage(
    state,
    messageValue,
    'lease.cleanup-recover'
  );
  const logicalCommand = beginLogicalCommand(state, message);
  if (logicalCommand.duplicate) return state;
  const recovery = message.body;
  const lease = state.leases.find(
    (entry) => entry.leaseId === recovery.leaseId
  );
  if (!lease || lease.state !== 'cleanup-required')
    throw new Error(
      'Controller cleanup recovery requires an expired cleanup-required lease'
    );
  if (
    lease.workerId !== recovery.workerId ||
    lease.workerInstanceId !== recovery.instanceId ||
    lease.workerSessionId !== recovery.workerSessionId ||
    lease.taskId !== recovery.taskId ||
    lease.taskSha256 !== recovery.cleanupEvidence.taskSha256 ||
    lease.attempt !== recovery.attempt
  )
    throw new Error(
      'Controller cleanup recovery does not match its exact lease'
    );
  const cleanup = recovery.cleanupEvidence;
  if (
    recovery.applicationIsolationKeySha256 !==
      state.applicationIsolationKeySha256 ||
    cleanup.applicationIsolationKeySha256 !==
      state.applicationIsolationKeySha256 ||
    cleanup.cancellationRequestedAtMs !== lease.cancellationRequestedAtMs
  )
    throw new Error(
      'Controller cleanup recovery crossed or changed its lease boundary'
    );
  safeInteger(acceptedAtMs, 'Cleanup recovery acceptance time');
  if (typeof verifyCleanupEvidence !== 'function')
    throw new Error('Cleanup recovery requires an independent verifier');
  if (
    recovery.recoveredAtMs < lease.expiresAtMs ||
    recovery.recoveredAtMs > message.command.issuedAtMs ||
    message.command.issuedAtMs > message.sentAtMs ||
    acceptedAtMs < message.sentAtMs
  )
    throw new Error('Controller cleanup recovery timeline is not monotonic');
  const verified = verifyCleanupEvidence({
    binding: state.binding,
    cleanupEvidence: cleanup,
    lease,
    message,
    recovery,
  });
  if (verified && typeof verified.then === 'function')
    throw new Error('Cleanup recovery verifier must be synchronous');
  if (verified !== true)
    throw new Error('Cleanup recovery evidence was not independently accepted');
  const updated = {
    ...lease,
    state: 'cancelled',
    terminalAtMs: cleanup.completedAtMs,
    cleanupDisposition: 'controller-recovery',
    cleanupAcceptedAtMs: acceptedAtMs,
    cleanupEvidence: cleanup,
  };
  return sealCommandApplication(
    state,
    { leases: replaceLease(state, updated) },
    logicalCommand.command,
    message.sentAtMs,
    {
      inputSha256: brokerTransitionInputSha256(message.kind, {
        commandSha256: logicalCommand.command.commandSha256,
        messageSha256: canonicalJsonSha256(message),
        acceptedAtMs,
      }),
      occurredAtMs: acceptedAtMs,
    }
  );
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
      cancellationReasonCode: lease.cancellationReasonCode ?? 'lease-expired',
      cancellationRequestedAtMs:
        lease.cancellationRequestedAtMs ?? lease.expiresAtMs,
    };
  });
  return changed
    ? sealState(
        { ...state, leases },
        state,
        createBrokerTransitionDescriptor(
          'lease.expire',
          brokerTransitionInputSha256('lease.expire', { nowMs }),
          nowMs
        )
      )
    : state;
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
    (entry) => entry.submission.resultKeySha256 === submission.resultKeySha256
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
  const next = sealState(
    {
      ...state,
      leases: replaceLease(state, completedLease),
      results: state.results.concat(result),
    },
    state,
    brokerAcceptedMessageTransition(message, acceptedAtMs)
  );
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
    applicationIsolationKeySha256: submission.applicationIsolationKeySha256,
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
  const { permanentlyCancelled, exhausted } = terminalTaskSets(state);
  const blocked = blockedTaskIds(state);
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
  const terminalTaskIds = new Set([
    ...resultByTask.keys(),
    ...permanentlyCancelled,
    ...exhausted,
    ...blocked,
  ]);
  const ready =
    activeLeaseIds.length === 0 &&
    state.expectedTasks.every((task) => terminalTaskIds.has(task.taskId));
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
    expectedTasks: state.expectedTasks.map(
      ({ applicationIsolationKeySha256, taskId, taskSha256 }) => ({
        applicationIsolationKeySha256,
        taskId,
        taskSha256,
      })
    ),
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
    blockedTaskIds: [...blocked].toSorted(compareText),
    ready,
    successEligible,
  };
  return deepFreeze({
    ...input,
    reconciliationInputSha256: canonicalJsonSha256(input),
  });
}
