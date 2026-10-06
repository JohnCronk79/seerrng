import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acknowledgeBrokerCancellation,
  acceptBrokerResult,
  cancelBrokerLease,
  createBrokerLeaseState,
  createBrokerReconciliationInput,
  createBrokerResultAcknowledgementBody,
  describeBrokerLeaseStateTransition,
  expireBrokerLeases,
  grantBrokerLease,
  recordBrokerCapacity,
  recordBrokerHeartbeat,
  recoverBrokerLeaseCleanup,
  registerBrokerWorker,
  rehydrateBrokerLeaseState,
  renewBrokerLease,
  verifyBrokerLeaseState,
  verifyBrokerLeaseStateTransition,
} from '../tools/validation-engine/runtime/broker-lease-state.mjs';
import {
  authenticateBrokerMessage,
  brokerApplicationIsolationKeySha256,
  brokerEvidenceKeySha256,
  brokerResultKeySha256,
  createBrokerMessage,
  sealBrokerCleanupEvidence,
  sealBrokerLogicalCommand,
  sealBrokerTask,
} from '../tools/validation-engine/runtime/broker-protocol.mjs';
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const h = (character) => character.repeat(64);
const controllerKinds = new Set([
  'lease.grant',
  'lease.renew',
  'lease.cancel',
  'lease.cleanup-recover',
  'result.ack',
]);

function binding(overrides = {}) {
  return {
    schema: 'seerrng-validation-broker-binding/v1',
    controllerId: 'controller-dev',
    applicationId: 'seerrng',
    submissionId: 'submission-1',
    submissionSequence: 1,
    executionId: 'validation-run-1',
    runAttempt: 1,
    repositoryIdentitySha256: h('9'),
    candidateSha256: h('a'),
    planSha256: h('b'),
    ...overrides,
  };
}

function task(taskId = 'task-1', overrides = {}) {
  const slotIndex = Number(taskId.match(/(\d+)$/)?.[1] ?? 1);
  return sealBrokerTask({
    applicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(binding()),
    taskId,
    unitId: 'unit-tests',
    caseId: taskId.replace('task', 'case'),
    adapterId: 'native-generic',
    assignment: {
      workerId: 'worker-east',
      slotId: `worker-east.slot-${slotIndex}`,
      slotIndex,
      slotPosition: 1,
    },
    dependencyTaskIds: [],
    timeoutMs: 10_000,
    maxAttempts: 2,
    payload: { selection: [taskId] },
    expectedEvidence: [
      {
        evidenceId: 'native-result',
        schema: 'native-result-v1',
        mediaType: 'application/json',
        required: true,
      },
      {
        evidenceId: 'native-log',
        schema: 'native-log-v1',
        mediaType: 'text/plain',
        required: false,
      },
    ],
    ...overrides,
  });
}

function workerConfig(configuredN = 2) {
  return {
    schema: 'seerrng-validation-broker-worker-config/v1',
    controllerId: 'controller-dev',
    workers: [
      {
        workerId: 'worker-east',
        machineIdentitySha256: h('c'),
        enabled: true,
        configuredN,
      },
    ],
  };
}

function registration() {
  return {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    machineIdentitySha256: h('c'),
    agentVersion: '1.0.0',
    capabilities: {
      platform: 'linux',
      architecture: 'x64',
      logicalCpuCapacity: 8,
      maxSafeN: 6,
      memoryMiB: 16_384,
      performanceProfileSha256: h('d'),
      adapterIds: ['native-generic'],
    },
  };
}

function capacity(activeLeaseIds = [], overrides = {}) {
  return {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'session-1',
    reportSequence: 1,
    observedAtMs: 2_000,
    safeAvailableN: 4,
    availableMemoryMiB: 12_000,
    loadPermille: 100,
    performanceProfileSha256: h('d'),
    performanceScorePermille: 1_500,
    activeLeaseIds,
    ...overrides,
  };
}

function auth(principalId, overrides = {}) {
  return {
    algorithm: 'hmac-sha256',
    sessionId: 'session-1',
    principalId,
    keyId: 'session-key-1',
    nonce: 'nonce-value-0001',
    issuedAtMs: 1_000,
    expiresAtMs: 50_000,
    proof: 'A'.repeat(43),
    ...overrides,
  };
}

let nextMessageId = 1;

function authenticated(
  kind,
  body,
  principalId,
  sentAtMs = 2_500,
  authOverrides = {}
) {
  const messageId = `message-${nextMessageId++}`;
  const value = {
    schema: 'seerrng-validation-broker-message/v2',
    protocolVersion: 2,
    messageId,
    kind,
    sentAtMs,
    binding: binding(),
    auth: auth(principalId, authOverrides),
    body,
    command: controllerKinds.has(kind)
      ? sealBrokerLogicalCommand({
          binding: binding(),
          kind,
          commandId: `command-${messageId}`,
          issuedAtMs: sentAtMs,
          body,
        })
      : null,
  };
  return authenticateBrokerMessage(value, {
    expectedBinding: binding(),
    nowMs: sentAtMs,
    verifyProof: () => true,
  });
}

function initialState(tasks = [task()]) {
  return createBrokerLeaseState({
    binding: binding(),
    expectedTasks: tasks,
    workerConfig: workerConfig(),
  });
}

function admittedState(tasks = [task()]) {
  let state = initialState(tasks);
  state = registerBrokerWorker(
    state,
    authenticated('worker.register', registration(), 'worker-east', 1_500)
  );
  state = recordBrokerCapacity(
    state,
    authenticated('worker.capacity', capacity(), 'worker-east')
  );
  state = recordBrokerHeartbeat(
    state,
    authenticated(
      'worker.heartbeat',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        observedAtMs: 2_200,
        capacitySequence: 1,
        activeLeases: [],
      },
      'worker-east',
      2_300
    )
  );
  return state;
}

test('broker transition provenance accepts only constructed genesis and exact legal predecessors', () => {
  const genesis = initialState();
  assert.equal(verifyBrokerLeaseStateTransition(null, genesis), genesis);
  const genesisDescription = describeBrokerLeaseStateTransition(null, genesis);
  assert.deepEqual(Reflect.ownKeys(genesisDescription).toSorted(), [
    'inputSha256',
    'kind',
    'occurredAtMs',
  ]);
  assert.equal(Object.isFrozen(genesisDescription), true);
  assert.equal(genesisDescription.kind, 'genesis');
  assert.match(genesisDescription.inputSha256, /^[a-f0-9]{64}$/);
  assert.equal(genesisDescription.occurredAtMs, null);
  assert.equal(
    describeBrokerLeaseStateTransition(null, initialState()).inputSha256,
    genesisDescription.inputSha256
  );

  const restoredGenesis = rehydrateBrokerLeaseState(genesis, {
    expectedBinding: binding(),
    expectedStateSha256: genesis.stateSha256,
  });
  assert.throws(
    () => verifyBrokerLeaseStateTransition(null, restoredGenesis),
    /lacks trusted transition provenance/
  );

  const registrationMessage = authenticated(
    'worker.register',
    registration(),
    'worker-east',
    1_500
  );
  const registered = registerBrokerWorker(genesis, registrationMessage);
  assert.equal(
    verifyBrokerLeaseStateTransition(genesis, registered),
    registered
  );
  const registeredDescription = describeBrokerLeaseStateTransition(
    genesis,
    registered
  );
  assert.deepEqual(registeredDescription, {
    kind: 'worker.register',
    inputSha256: registeredDescription.inputSha256,
    occurredAtMs: 1_500,
  });
  assert.match(registeredDescription.inputSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(registeredDescription), true);

  const restoredRegistered = rehydrateBrokerLeaseState(registered, {
    expectedBinding: binding(),
    expectedStateSha256: registered.stateSha256,
  });
  assert.throws(
    () => verifyBrokerLeaseStateTransition(genesis, restoredRegistered),
    /lacks trusted transition provenance/
  );
  assert.throws(
    () =>
      verifyBrokerLeaseStateTransition(
        initialState([task('task-2')]),
        registered
      ),
    /not linked to its persisted predecessor/
  );

  const plannedTask = task();
  const admitted = admittedState([plannedTask]);
  const grantMessage = authenticated(
    'lease.grant',
    grantBody(plannedTask),
    'controller-dev',
    3_000
  );
  const granted = grantBrokerLease(admitted, grantMessage);
  const grantDescription = describeBrokerLeaseStateTransition(
    admitted,
    granted
  );
  assert.deepEqual(grantDescription, {
    kind: 'lease.grant',
    inputSha256: grantMessage.command.commandSha256,
    occurredAtMs: 3_000,
  });
  assert.equal(Object.isFrozen(grantDescription), true);

  const expired = expireBrokerLeases(granted, 8_000);
  const expiryDescription = describeBrokerLeaseStateTransition(
    granted,
    expired
  );
  assert.equal(expiryDescription.kind, 'lease.expire');
  assert.match(expiryDescription.inputSha256, /^[a-f0-9]{64}$/);
  assert.equal(expiryDescription.occurredAtMs, 8_000);
  assert.equal(Object.isFrozen(expiryDescription), true);
});

function grantBody(plannedTask, overrides = {}) {
  return {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'session-1',
    leaseId: `lease-${plannedTask.taskId}-1`,
    attempt: 1,
    maxAttempts: 2,
    expiresAtMs: 8_000,
    task: plannedTask,
    ...overrides,
  };
}

function resultBody(plannedTask, overrides = {}) {
  const attempt = overrides.attempt ?? 1;
  const evidenceId = 'native-result';
  return {
    applicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(binding()),
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'session-1',
    leaseId: `lease-${plannedTask.taskId}-${attempt}`,
    taskId: plannedTask.taskId,
    taskSha256: plannedTask.taskSha256,
    attempt,
    completedAtMs: 5_000,
    resultKeySha256: brokerResultKeySha256(
      binding(),
      plannedTask.taskId,
      attempt
    ),
    outcome: {
      status: 'passed',
      exitCode: 0,
      completed: true,
      cancelled: false,
      timedOut: false,
      resultSha256: h('e'),
    },
    evidence: [
      {
        evidenceId,
        evidenceKeySha256: brokerEvidenceKeySha256(
          binding(),
          plannedTask.taskId,
          attempt,
          evidenceId
        ),
        schema: 'native-result-v1',
        mediaType: 'application/json',
        bytes: 128,
        sha256: h('f'),
      },
    ],
    ...overrides,
  };
}

function cancellationAcknowledgement(plannedTask, overrides = {}) {
  const attempt = overrides.attempt ?? 1;
  const leaseId = overrides.leaseId ?? `lease-${plannedTask.taskId}-${attempt}`;
  const cancellationRequestedAtMs =
    overrides.cancellationRequestedAtMs ?? 4_000;
  const cancelledAtMs = overrides.cancelledAtMs ?? 4_200;
  const cleanupEvidence = sealBrokerCleanupEvidence(binding(), {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'session-1',
    leaseId,
    taskId: plannedTask.taskId,
    taskSha256: overrides.taskSha256 ?? plannedTask.taskSha256,
    bridgeSha256: overrides.bridgeSha256 ?? h('6'),
    attempt,
    cancellationRequestedAtMs,
    completedAtMs: cancelledAtMs,
    evidenceId: overrides.evidenceId ?? 'native-cleanup',
    evidenceSchema: overrides.evidenceSchema ?? 'seerrng-native-cleanup-v1',
    mediaType: overrides.mediaType ?? 'application/json',
    bytes: overrides.bytes ?? 128,
    blobSha256: overrides.blobSha256 ?? h('7'),
  });
  return {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'session-1',
    leaseId,
    taskId: plannedTask.taskId,
    attempt,
    cancelledAtMs,
    cleanupEvidence,
  };
}

function cleanupRecovery(plannedTask, overrides = {}) {
  const acknowledgement = cancellationAcknowledgement(plannedTask, {
    cancellationRequestedAtMs: 8_000,
    cancelledAtMs: 8_300,
    ...overrides,
  });
  return {
    applicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(binding()),
    workerId: acknowledgement.workerId,
    instanceId: acknowledgement.instanceId,
    workerSessionId: acknowledgement.workerSessionId,
    leaseId: acknowledgement.leaseId,
    taskId: acknowledgement.taskId,
    attempt: acknowledgement.attempt,
    recoveredAtMs: overrides.recoveredAtMs ?? 8_400,
    cleanupEvidence: acknowledgement.cleanupEvidence,
  };
}

const cleanupAcceptance = (acceptedAtMs = 4_400) => ({
  acceptedAtMs,
  verifyCleanupEvidence: () => true,
});

const resultAcceptance = (acceptedAtMs) => ({
  acceptedAtMs,
  verifyResultEvidence: () => true,
});

test('unlisted, unauthenticated, or over-capacity workers fail closed', () => {
  let state = initialState();
  const forged = createBrokerMessage({
    schema: 'seerrng-validation-broker-message/v2',
    protocolVersion: 2,
    messageId: 'forged-registration',
    kind: 'worker.register',
    sentAtMs: 2_500,
    binding: binding(),
    auth: auth('worker-east'),
    command: null,
    body: registration(),
  });
  assert.throws(
    () => registerBrokerWorker(state, forged),
    /has not passed authentication/
  );
  assert.throws(
    () =>
      registerBrokerWorker(
        state,
        authenticated(
          'worker.register',
          {
            ...registration(),
            workerId: 'worker-west',
            instanceId: 'worker-west-boot-1',
            machineIdentitySha256: h('9'),
          },
          'worker-west'
        )
      ),
    /not enabled in the controller configuration/
  );

  state = registerBrokerWorker(
    state,
    authenticated('worker.register', registration(), 'worker-east', 1_500)
  );
  assert.throws(
    () =>
      recordBrokerCapacity(
        state,
        authenticated(
          'worker.capacity',
          capacity([], { safeAvailableN: 7 }),
          'worker-east'
        )
      ),
    /registered safe worker limit/
  );
});

test('registration and capacity admission preserve stable machine identity and N', () => {
  let state = admittedState();
  assert.equal(state.workers[0].admission.selectedN, 2);
  assert.equal(state.workers[0].registration.workerId, 'worker-east');

  const duplicate = recordBrokerCapacity(
    state,
    authenticated('worker.capacity', capacity(), 'worker-east')
  );
  assert.equal(duplicate, state);
  assert.throws(
    () =>
      recordBrokerCapacity(
        state,
        authenticated(
          'worker.capacity',
          capacity([], { reportSequence: 0 }),
          'worker-east'
        )
      ),
    /at least 1/
  );
});

test('degraded capacity replaces stale admission without losing lease closure', () => {
  const tasks = [
    task('task-1', { timeoutMs: 120_000 }),
    task('task-2', { timeoutMs: 120_000 }),
  ];
  let state = admittedState(tasks);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(tasks[0], { expiresAtMs: 60_000 }),
      'controller-dev',
      3_000
    )
  );
  const admittedStateSha256 = state.stateSha256;
  state = recordBrokerCapacity(
    state,
    authenticated(
      'worker.capacity',
      capacity(['lease-task-1-1'], {
        reportSequence: 2,
        observedAtMs: 4_000,
        safeAvailableN: 1,
      }),
      'worker-east',
      4_100
    )
  );
  assert.notEqual(state.stateSha256, admittedStateSha256);
  assert.equal(state.workers[0].capacity.safeAvailableN, 1);
  assert.equal(state.workers[0].admission, null);
  assert.equal(state.workers[0].heartbeat, null);
  state = recordBrokerHeartbeat(
    state,
    authenticated(
      'worker.heartbeat',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        observedAtMs: 4_200,
        capacitySequence: 2,
        activeLeases: [
          { leaseId: 'lease-task-1-1', taskId: 'task-1', attempt: 1 },
        ],
      },
      'worker-east',
      4_300
    )
  );
  const degradedStateSha256 = state.stateSha256;
  assert.throws(
    () =>
      grantBrokerLease(
        state,
        authenticated(
          'lease.grant',
          grantBody(tasks[1], { leaseId: 'lease-task-2-1' }),
          'controller-dev',
          4_400
        )
      ),
    /admitted worker/
  );
  assert.throws(
    () =>
      renewBrokerLease(
        state,
        authenticated(
          'lease.renew',
          {
            workerId: 'worker-east',
            instanceId: 'worker-east-boot-1',
            workerSessionId: 'session-1',
            leaseId: 'lease-task-1-1',
            taskId: 'task-1',
            attempt: 1,
            expiresAtMs: 70_000,
          },
          'controller-dev',
          4_500
        )
      ),
    /admitted worker/
  );
  assert.equal(state.stateSha256, degradedStateSha256);

  state = recordBrokerCapacity(
    state,
    authenticated(
      'worker.capacity',
      capacity(['lease-task-1-1'], {
        reportSequence: 3,
        observedAtMs: 4_600,
        safeAvailableN: 0,
      }),
      'worker-east',
      4_700
    )
  );
  assert.equal(state.workers[0].admission, null);
  assert.equal(state.workers[0].heartbeat, null);
  state = recordBrokerHeartbeat(
    state,
    authenticated(
      'worker.heartbeat',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        observedAtMs: 4_800,
        capacitySequence: 3,
        activeLeases: [
          { leaseId: 'lease-task-1-1', taskId: 'task-1', attempt: 1 },
        ],
      },
      'worker-east',
      4_900
    )
  );
  state = recordBrokerCapacity(
    state,
    authenticated(
      'worker.capacity',
      capacity(['lease-task-1-1'], {
        reportSequence: 4,
        observedAtMs: 5_000,
      }),
      'worker-east',
      5_100
    )
  );
  assert.equal(state.workers[0].admission.selectedN, 2);
  assert.equal(state.workers[0].heartbeat, null);
  assert.throws(
    () =>
      renewBrokerLease(
        state,
        authenticated(
          'lease.renew',
          {
            workerId: 'worker-east',
            instanceId: 'worker-east-boot-1',
            workerSessionId: 'session-1',
            leaseId: 'lease-task-1-1',
            taskId: 'task-1',
            attempt: 1,
            expiresAtMs: 70_000,
          },
          'controller-dev',
          5_200
        )
      ),
    /fresh capacity and heartbeat/
  );
  state = recordBrokerHeartbeat(
    state,
    authenticated(
      'worker.heartbeat',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        observedAtMs: 5_300,
        capacitySequence: 4,
        activeLeases: [
          { leaseId: 'lease-task-1-1', taskId: 'task-1', attempt: 1 },
        ],
      },
      'worker-east',
      5_400
    )
  );
  state = renewBrokerLease(
    state,
    authenticated(
      'lease.renew',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        leaseId: 'lease-task-1-1',
        taskId: 'task-1',
        attempt: 1,
        expiresAtMs: 70_000,
      },
      'controller-dev',
      5_500
    )
  );
  assert.equal(state.leases[0].expiresAtMs, 70_000);
});

test('task inventory cannot cross an application submission boundary', () => {
  const alienTask = task('task-1', {
    applicationIsolationKeySha256: brokerApplicationIsolationKeySha256(
      binding({
        applicationId: 'another-app',
        submissionId: 'submission-2',
        submissionSequence: 2,
      })
    ),
  });
  assert.throws(
    () => initialState([alienTask]),
    /application submission isolation key/
  );
});

test('worker instance, session, and report freshness bind every lease admission', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  assert.throws(
    () =>
      grantBrokerLease(
        state,
        authenticated(
          'lease.grant',
          grantBody(plannedTask, { instanceId: 'worker-east-boot-2' }),
          'controller-dev',
          3_000
        )
      ),
    /stale worker instance or session/
  );
  assert.throws(
    () =>
      grantBrokerLease(
        state,
        authenticated(
          'lease.grant',
          grantBody(plannedTask, { expiresAtMs: 40_000 }),
          'controller-dev',
          32_201
        )
      ),
    /fresh worker capacity and heartbeat/
  );

  const staleCapacity = capacity([], {
    workerSessionId: 'session-2',
    reportSequence: 2,
    observedAtMs: 2_600,
  });
  assert.throws(
    () =>
      recordBrokerCapacity(
        state,
        authenticated('worker.capacity', staleCapacity, 'worker-east', 2_700, {
          sessionId: 'session-2',
        })
      ),
    /stale worker instance or session/
  );
});

test('leases require exact tasks, supported adapters, and admitted worker slots', () => {
  const tasks = [task('task-1'), task('task-2'), task('task-3')];
  let state = admittedState(tasks);
  state = grantBrokerLease(
    state,
    authenticated('lease.grant', grantBody(tasks[0]), 'controller-dev', 3_000)
  );
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(tasks[1], { leaseId: 'lease-task-2-1' }),
      'controller-dev',
      3_100
    )
  );
  assert.throws(
    () =>
      grantBrokerLease(
        state,
        authenticated(
          'lease.grant',
          grantBody(tasks[2], { leaseId: 'lease-task-3-1' }),
          'controller-dev',
          3_200
        )
      ),
    /exceeds? the admitted worker N/
  );

  const changed = structuredClone(tasks[2]);
  changed.taskSha256 = h('1');
  assert.throws(
    () =>
      grantBrokerLease(
        admittedState(tasks),
        authenticated(
          'lease.grant',
          grantBody(changed, { leaseId: 'changed-task' }),
          'controller-dev',
          3_000
        )
      ),
    /task seal/
  );
});

test('re-signed command envelopes are durable exact-once operations', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  const original = authenticated(
    'lease.grant',
    grantBody(plannedTask),
    'controller-dev',
    3_000,
    { expiresAtMs: 3_100, nonce: 'original-grant-envelope' }
  );
  state = grantBrokerLease(state, original);
  assert.equal(state.appliedCommands.length, 1);
  assert.equal(
    state.appliedCommands[0].command.commandSha256,
    original.command.commandSha256
  );

  const resignedValue = structuredClone(original);
  resignedValue.messageId = 'resigned-grant-envelope';
  resignedValue.sentAtMs = 9_000;
  resignedValue.auth = auth('controller-dev', {
    sessionId: 'controller-session-2',
    keyId: 'controller-key-2',
    nonce: 'resigned-grant-envelope',
    issuedAtMs: 8_500,
    expiresAtMs: 9_500,
  });
  const resigned = authenticateBrokerMessage(resignedValue, {
    expectedBinding: binding(),
    nowMs: 9_000,
    verifyProof: () => true,
  });
  const replayed = grantBrokerLease(state, resigned);
  assert.equal(replayed, state);
  assert.equal(replayed.appliedCommands.length, 1);

  const conflictingBody = {
    ...grantBody(plannedTask),
    leaseId: 'conflicting-lease-id',
  };
  const conflictingValue = {
    ...resignedValue,
    messageId: 'conflicting-grant-envelope',
    body: conflictingBody,
    command: sealBrokerLogicalCommand({
      binding: binding(),
      kind: 'lease.grant',
      commandId: original.command.commandId,
      issuedAtMs: original.command.issuedAtMs,
      body: conflictingBody,
    }),
    auth: auth('controller-dev', {
      sessionId: 'controller-session-2',
      keyId: 'controller-key-2',
      nonce: 'conflicting-grant-envelope',
      issuedAtMs: 8_500,
      expiresAtMs: 9_500,
    }),
  };
  const conflicting = authenticateBrokerMessage(conflictingValue, {
    expectedBinding: binding(),
    nowMs: 9_000,
    verifyProof: () => true,
  });
  assert.throws(
    () => grantBrokerLease(state, conflicting),
    /command ID was reused with conflicting contents/
  );

  const aliasedValue = {
    ...resignedValue,
    messageId: 'aliased-grant-envelope',
    command: sealBrokerLogicalCommand({
      binding: binding(),
      kind: 'lease.grant',
      commandId: 'aliased-grant-command',
      issuedAtMs: original.command.issuedAtMs,
      body: original.body,
    }),
    auth: auth('controller-dev', {
      sessionId: 'controller-session-2',
      keyId: 'controller-key-2',
      nonce: 'aliased-grant-envelope',
      issuedAtMs: 8_500,
      expiresAtMs: 9_500,
    }),
  };
  const aliased = authenticateBrokerMessage(aliasedValue, {
    expectedBinding: binding(),
    nowMs: 9_000,
    verifyProof: () => true,
  });
  assert.throws(
    () => grantBrokerLease(state, aliased),
    /reissued under another identity/
  );

  const duplicatedReceipt = JSON.parse(JSON.stringify(state));
  duplicatedReceipt.appliedCommands.push(
    structuredClone(duplicatedReceipt.appliedCommands[0])
  );
  delete duplicatedReceipt.stateSha256;
  duplicatedReceipt.stateSha256 = canonicalJsonSha256(duplicatedReceipt);
  assert.throws(
    () =>
      rehydrateBrokerLeaseState(duplicatedReceipt, {
        expectedBinding: binding(),
        expectedStateSha256: duplicatedReceipt.stateSha256,
      }),
    /duplicate identity/
  );
});

test('heartbeats close the active lease set and renewals stay inside timeout', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask),
      'controller-dev',
      3_000
    )
  );
  assert.throws(
    () =>
      renewBrokerLease(
        state,
        authenticated(
          'lease.renew',
          {
            workerId: 'worker-east',
            instanceId: 'worker-east-boot-1',
            workerSessionId: 'session-1',
            leaseId: 'lease-task-1-1',
            taskId: 'task-1',
            attempt: 1,
            expiresAtMs: 9_000,
          },
          'controller-dev',
          3_400
        )
      ),
    /heartbeat does not close the worker active lease set/
  );
  state = recordBrokerHeartbeat(
    state,
    authenticated(
      'worker.heartbeat',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        observedAtMs: 3_500,
        capacitySequence: 1,
        activeLeases: [
          { leaseId: 'lease-task-1-1', taskId: 'task-1', attempt: 1 },
        ],
      },
      'worker-east',
      3_600
    )
  );
  assert.equal(state.workers[0].heartbeat.observedAtMs, 3_500);

  state = renewBrokerLease(
    state,
    authenticated(
      'lease.renew',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        leaseId: 'lease-task-1-1',
        taskId: 'task-1',
        attempt: 1,
        expiresAtMs: 9_000,
      },
      'controller-dev',
      4_000
    )
  );
  assert.equal(state.leases[0].expiresAtMs, 9_000);
  assert.throws(
    () =>
      renewBrokerLease(
        state,
        authenticated(
          'lease.renew',
          {
            workerId: 'worker-east',
            instanceId: 'worker-east-boot-1',
            workerSessionId: 'session-1',
            leaseId: 'lease-task-1-1',
            taskId: 'task-1',
            attempt: 1,
            expiresAtMs: 13_001,
          },
          'controller-dev',
          4_500
        )
      ),
    /immutable task timeout/
  );
});

test('renewals require fresh capacity and a heartbeat bound to that report', () => {
  const plannedTask = task('task-1', { timeoutMs: 120_000 });
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask, { expiresAtMs: 45_000 }),
      'controller-dev',
      3_000
    )
  );
  state = recordBrokerHeartbeat(
    state,
    authenticated(
      'worker.heartbeat',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        observedAtMs: 3_500,
        capacitySequence: 1,
        activeLeases: [
          { leaseId: 'lease-task-1-1', taskId: 'task-1', attempt: 1 },
        ],
      },
      'worker-east',
      3_600
    )
  );
  const staleProofStateSha256 = state.stateSha256;
  assert.throws(
    () =>
      renewBrokerLease(
        state,
        authenticated(
          'lease.renew',
          {
            workerId: 'worker-east',
            instanceId: 'worker-east-boot-1',
            workerSessionId: 'session-1',
            leaseId: 'lease-task-1-1',
            taskId: 'task-1',
            attempt: 1,
            expiresAtMs: 60_000,
          },
          'controller-dev',
          34_001
        )
      ),
    /fresh worker capacity and heartbeat/
  );
  assert.equal(state.stateSha256, staleProofStateSha256);

  state = recordBrokerCapacity(
    state,
    authenticated(
      'worker.capacity',
      capacity(['lease-task-1-1'], {
        reportSequence: 2,
        observedAtMs: 35_000,
      }),
      'worker-east',
      35_100
    )
  );
  assert.equal(state.workers[0].heartbeat, null);
  assert.throws(
    () =>
      renewBrokerLease(
        state,
        authenticated(
          'lease.renew',
          {
            workerId: 'worker-east',
            instanceId: 'worker-east-boot-1',
            workerSessionId: 'session-1',
            leaseId: 'lease-task-1-1',
            taskId: 'task-1',
            attempt: 1,
            expiresAtMs: 60_000,
          },
          'controller-dev',
          35_200
        )
      ),
    /fresh capacity and heartbeat/
  );
  state = recordBrokerHeartbeat(
    state,
    authenticated(
      'worker.heartbeat',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        observedAtMs: 35_300,
        capacitySequence: 2,
        activeLeases: [
          { leaseId: 'lease-task-1-1', taskId: 'task-1', attempt: 1 },
        ],
      },
      'worker-east',
      35_400
    )
  );
  state = renewBrokerLease(
    state,
    authenticated(
      'lease.renew',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        leaseId: 'lease-task-1-1',
        taskId: 'task-1',
        attempt: 1,
        expiresAtMs: 60_000,
      },
      'controller-dev',
      35_500
    )
  );
  assert.equal(state.leases[0].expiresAtMs, 60_000);
});

test('expired attempts require accepted cleanup before retry and completed work cannot retry', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask),
      'controller-dev',
      3_000
    )
  );
  state = expireBrokerLeases(state, 8_000);
  assert.equal(state.leases[0].state, 'cleanup-required');
  assert.equal(state.leases[0].cancellationRequestedAtMs, 8_000);
  assert.throws(
    () =>
      acceptBrokerResult(
        state,
        authenticated(
          'worker.result',
          resultBody(plannedTask),
          'worker-east',
          5_100
        ),
        resultAcceptance(8_100)
      ),
    /exact active lease/
  );

  assert.throws(
    () =>
      grantBrokerLease(
        state,
        authenticated(
          'lease.grant',
          grantBody(plannedTask, {
            leaseId: 'lease-task-1-2',
            attempt: 2,
            expiresAtMs: 16_000,
          }),
          'controller-dev',
          8_200
        )
      ),
    /accepted cleanup evidence/
  );
  state = acknowledgeBrokerCancellation(
    state,
    authenticated(
      'worker.cancelled',
      cancellationAcknowledgement(plannedTask, {
        cancellationRequestedAtMs: 8_000,
        cancelledAtMs: 8_300,
      }),
      'worker-east',
      8_400
    ),
    cleanupAcceptance(8_500)
  );

  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask, {
        leaseId: 'lease-task-1-2',
        attempt: 2,
        expiresAtMs: 16_000,
      }),
      'controller-dev',
      9_000
    )
  );
  const secondResult = resultBody(plannedTask, {
    leaseId: 'lease-task-1-2',
    attempt: 2,
    completedAtMs: 10_000,
    resultKeySha256: brokerResultKeySha256(binding(), 'task-1', 2),
    evidence: [
      {
        evidenceId: 'native-result',
        evidenceKeySha256: brokerEvidenceKeySha256(
          binding(),
          'task-1',
          2,
          'native-result'
        ),
        schema: 'native-result-v1',
        mediaType: 'application/json',
        bytes: 128,
        sha256: h('f'),
      },
    ],
  });
  const accepted = acceptBrokerResult(
    state,
    authenticated('worker.result', secondResult, 'worker-east', 10_100),
    resultAcceptance(10_200)
  );
  assert.equal(accepted.disposition, 'accepted');
  assert.throws(
    () =>
      grantBrokerLease(
        accepted.state,
        authenticated(
          'lease.grant',
          grantBody(plannedTask, {
            leaseId: 'lease-task-1-3',
            attempt: 2,
            expiresAtMs: 20_000,
          }),
          'controller-dev',
          11_000
        )
      ),
    /Completed task/
  );
});

test('retry ceiling rejects a cleaned next attempt without changing history', () => {
  const plannedTask = task('task-1', { maxAttempts: 1 });
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask, { maxAttempts: 1 }),
      'controller-dev',
      3_000
    )
  );
  state = cancelBrokerLease(
    state,
    authenticated(
      'lease.cancel',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        leaseId: 'lease-task-1-1',
        taskId: 'task-1',
        attempt: 1,
        requestedAtMs: 4_000,
        mode: 'abort-attempt',
        reasonCode: 'worker-drain',
      },
      'controller-dev',
      4_100
    )
  );
  state = acknowledgeBrokerCancellation(
    state,
    authenticated(
      'worker.cancelled',
      cancellationAcknowledgement(plannedTask),
      'worker-east',
      4_300
    ),
    cleanupAcceptance()
  );
  assert.equal(state.leases[0].state, 'cancelled');
  assert.equal(state.leases[0].cleanupAcceptedAtMs, 4_400);

  const stateBeforeRejectedGrant = structuredClone(state);
  assert.throws(
    () =>
      grantBrokerLease(
        state,
        authenticated(
          'lease.grant',
          grantBody(plannedTask, {
            leaseId: 'lease-task-1-2',
            attempt: 2,
            maxAttempts: 1,
            expiresAtMs: 14_000,
          }),
          'controller-dev',
          5_000
        )
      ),
    /Task attempt cannot exceed maximum attempts/
  );
  assert.equal(state.stateSha256, stateBeforeRejectedGrant.stateSha256);
  assert.deepEqual(state.leases, stateBeforeRejectedGrant.leases);
  assert.deepEqual(state.results, stateBeforeRejectedGrant.results);
});

test('result submission is idempotent and conflicting reuse fails closed', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask),
      'controller-dev',
      3_000
    )
  );
  const resultMessage = authenticated(
    'worker.result',
    resultBody(plannedTask),
    'worker-east',
    5_100
  );
  const first = acceptBrokerResult(
    state,
    resultMessage,
    resultAcceptance(5_200)
  );
  const duplicate = acceptBrokerResult(first.state, resultMessage, {
    acceptedAtMs: 5_300,
  });
  assert.equal(duplicate.disposition, 'duplicate');
  assert.equal(duplicate.state, first.state);
  const acknowledgement = createBrokerResultAcknowledgementBody(duplicate);
  assert.equal(acknowledgement.disposition, 'duplicate');
  assert.equal(acknowledgement.taskId, plannedTask.taskId);
  assert.equal(
    acknowledgement.applicationIsolationKeySha256,
    state.applicationIsolationKeySha256
  );

  const conflict = resultBody(plannedTask);
  conflict.outcome.resultSha256 = h('1');
  assert.throws(
    () =>
      acceptBrokerResult(
        first.state,
        authenticated('worker.result', conflict, 'worker-east', 5_100),
        { acceptedAtMs: 5_400 }
      ),
    /Conflicting result reused an idempotency key/
  );
});

test('passed results require their declared evidence contract', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask),
      'controller-dev',
      3_000
    )
  );
  const missing = resultBody(plannedTask, { evidence: [] });
  assert.throws(
    () =>
      acceptBrokerResult(
        state,
        authenticated('worker.result', missing, 'worker-east', 5_100),
        resultAcceptance(5_200)
      ),
    /missing required evidence/
  );
  const drifted = resultBody(plannedTask);
  drifted.evidence[0].mediaType = 'text/plain';
  assert.throws(
    () =>
      acceptBrokerResult(
        state,
        authenticated('worker.result', drifted, 'worker-east', 5_100),
        resultAcceptance(5_200)
      ),
    /contract drifted/
  );
});

test('result acceptance requires synchronous independent evidence verification', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask),
      'controller-dev',
      3_000
    )
  );
  const resultMessage = authenticated(
    'worker.result',
    resultBody(plannedTask),
    'worker-east',
    5_100
  );
  const stateBeforeVerification = structuredClone(state);
  assert.throws(
    () =>
      acceptBrokerResult(state, resultMessage, {
        acceptedAtMs: 5_200,
      }),
    /requires an independent verifier/
  );
  assert.throws(
    () =>
      acceptBrokerResult(state, resultMessage, {
        acceptedAtMs: 5_200,
        verifyResultEvidence: () => false,
      }),
    /not independently accepted/
  );
  assert.throws(
    () =>
      acceptBrokerResult(state, resultMessage, {
        acceptedAtMs: 5_200,
        verifyResultEvidence: () => Promise.resolve(true),
      }),
    /must be synchronous/
  );
  assert.throws(
    () =>
      acceptBrokerResult(state, resultMessage, {
        acceptedAtMs: 5_200,
        verifyResultEvidence: () => {
          throw new Error('artifact verification failed');
        },
      }),
    /artifact verification failed/
  );
  assert.equal(state.stateSha256, stateBeforeVerification.stateSha256);
  assert.deepEqual(state.leases, stateBeforeVerification.leases);
  assert.deepEqual(state.results, stateBeforeVerification.results);

  let observed;
  const accepted = acceptBrokerResult(state, resultMessage, {
    acceptedAtMs: 5_200,
    verifyResultEvidence(value) {
      observed = value;
      return true;
    },
  });
  assert.equal(
    observed.applicationIsolationKeySha256,
    state.applicationIsolationKeySha256
  );
  assert.equal(observed.task.taskId, plannedTask.taskId);
  assert.equal(observed.lease.leaseId, 'lease-task-1-1');
  assert.equal(observed.submissionSha256, accepted.result.submissionSha256);
  assert.equal(accepted.state.leases[0].state, 'completed');
});

test('cancellation distinguishes retryable attempt abort from terminal task cancel', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask),
      'controller-dev',
      3_000
    )
  );
  state = cancelBrokerLease(
    state,
    authenticated(
      'lease.cancel',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        leaseId: 'lease-task-1-1',
        taskId: 'task-1',
        attempt: 1,
        requestedAtMs: 4_000,
        mode: 'abort-attempt',
        reasonCode: 'worker-drain',
      },
      'controller-dev',
      4_100
    )
  );
  assert.equal(state.leases[0].state, 'cancelling');
  assert.equal(state.leases[0].cancellationRequestedAtMs, 4_000);
  assert.throws(
    () =>
      grantBrokerLease(
        state,
        authenticated(
          'lease.grant',
          grantBody(plannedTask, {
            leaseId: 'lease-task-1-2',
            attempt: 2,
            expiresAtMs: 14_000,
          }),
          'controller-dev',
          4_150
        )
      ),
    /accepted cleanup evidence/
  );
  assert.throws(
    () =>
      acknowledgeBrokerCancellation(
        state,
        authenticated(
          'worker.cancelled',
          cancellationAcknowledgement(plannedTask, {
            cancellationRequestedAtMs: 3_999,
          }),
          'worker-east',
          4_300
        ),
        cleanupAcceptance()
      ),
    /does not preserve the cancellation request/
  );
  assert.throws(
    () =>
      acknowledgeBrokerCancellation(
        state,
        authenticated(
          'worker.cancelled',
          cancellationAcknowledgement(plannedTask, {
            taskSha256: h('8'),
          }),
          'worker-east',
          4_300
        ),
        cleanupAcceptance()
      ),
    /does not match its lease/
  );
  assert.throws(
    () =>
      acknowledgeBrokerCancellation(
        state,
        authenticated(
          'worker.cancelled',
          cancellationAcknowledgement(plannedTask),
          'worker-east',
          4_300
        ),
        {
          acceptedAtMs: 4_400,
          verifyCleanupEvidence: () => false,
        }
      ),
    /not independently accepted/
  );
  state = acknowledgeBrokerCancellation(
    state,
    authenticated(
      'worker.cancelled',
      cancellationAcknowledgement(plannedTask),
      'worker-east',
      4_300
    ),
    cleanupAcceptance()
  );
  const duplicateCleanup = acknowledgeBrokerCancellation(
    state,
    authenticated(
      'worker.cancelled',
      cancellationAcknowledgement(plannedTask),
      'worker-east',
      4_300
    )
  );
  assert.equal(duplicateCleanup, state);
  assert.throws(
    () =>
      acknowledgeBrokerCancellation(
        state,
        authenticated(
          'worker.cancelled',
          cancellationAcknowledgement(plannedTask, {
            blobSha256: h('8'),
          }),
          'worker-east',
          4_300
        ),
        cleanupAcceptance()
      ),
    /Conflicting cleanup evidence/
  );
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask, {
        leaseId: 'lease-task-1-2',
        attempt: 2,
        expiresAtMs: 14_000,
      }),
      'controller-dev',
      5_000
    )
  );
  assert.equal(state.leases.at(-1).attempt, 2);

  let terminal = admittedState([plannedTask]);
  terminal = grantBrokerLease(
    terminal,
    authenticated(
      'lease.grant',
      grantBody(plannedTask),
      'controller-dev',
      3_000
    )
  );
  terminal = cancelBrokerLease(
    terminal,
    authenticated(
      'lease.cancel',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        leaseId: 'lease-task-1-1',
        taskId: 'task-1',
        attempt: 1,
        requestedAtMs: 4_000,
        mode: 'cancel-task',
        reasonCode: 'controller-stop',
      },
      'controller-dev',
      4_100
    )
  );
  terminal = acknowledgeBrokerCancellation(
    terminal,
    authenticated(
      'worker.cancelled',
      cancellationAcknowledgement(plannedTask),
      'worker-east',
      4_300
    ),
    cleanupAcceptance()
  );
  assert.throws(
    () =>
      grantBrokerLease(
        terminal,
        authenticated(
          'lease.grant',
          grantBody(plannedTask, {
            leaseId: 'lease-task-1-2',
            attempt: 2,
            expiresAtMs: 14_000,
          }),
          'controller-dev',
          5_000
        )
      ),
    /accepted cleanup evidence/
  );
  const terminalInput = createBrokerReconciliationInput(terminal, 6_000);
  assert.deepEqual(terminalInput.permanentlyCancelledTaskIds, ['task-1']);
  assert.equal(terminalInput.successEligible, false);
});

test('completed native failure is closed but never success-eligible', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask),
      'controller-dev',
      3_000
    )
  );
  const failure = resultBody(plannedTask);
  failure.outcome = {
    ...failure.outcome,
    status: 'failed',
    exitCode: 1,
    resultSha256: h('1'),
  };
  state = acceptBrokerResult(
    state,
    authenticated('worker.result', failure, 'worker-east', 5_100),
    resultAcceptance(5_200)
  ).state;
  const input = createBrokerReconciliationInput(state, 6_000);
  assert.equal(input.ready, true);
  assert.equal(input.successEligible, false);
  assert.deepEqual(input.unresolvedTaskIds, []);
});

test('reconciliation input cannot claim eligibility until every task closes once', () => {
  const tasks = [task('task-1'), task('task-2')];
  let state = admittedState(tasks);
  state = grantBrokerLease(
    state,
    authenticated('lease.grant', grantBody(tasks[0]), 'controller-dev', 3_000)
  );
  let input = createBrokerReconciliationInput(state, 4_000);
  assert.equal(input.ready, false);
  assert.equal(input.successEligible, false);
  assert.deepEqual(input.unresolvedTaskIds, ['task-1', 'task-2']);

  state = acceptBrokerResult(
    state,
    authenticated('worker.result', resultBody(tasks[0]), 'worker-east', 5_100),
    resultAcceptance(5_200)
  ).state;
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(tasks[1], { leaseId: 'lease-task-2-1' }),
      'controller-dev',
      5_300
    )
  );
  state = acceptBrokerResult(
    state,
    authenticated(
      'worker.result',
      resultBody(tasks[1], {
        leaseId: 'lease-task-2-1',
        completedAtMs: 5_350,
      }),
      'worker-east',
      5_400
    ),
    resultAcceptance(5_500)
  ).state;
  input = createBrokerReconciliationInput(state, 6_000);
  assert.equal(input.ready, true);
  assert.equal(input.successEligible, true);
  assert.deepEqual(input.unresolvedTaskIds, []);
  assert.match(input.reconciliationInputSha256, /^[a-f0-9]{64}$/);
});

test('persisted hashed state verifies and rehydrates without process-local trust', () => {
  const state = admittedState();
  assert.match(state.applicationIsolationKeySha256, /^[a-f0-9]{64}$/);
  const snapshot = JSON.parse(JSON.stringify(state));
  const verified = verifyBrokerLeaseState(snapshot, {
    expectedBinding: binding(),
    expectedStateSha256: state.stateSha256,
  });
  assert.notEqual(verified, state);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(
    createBrokerReconciliationInput(verified, 3_000).stateSha256,
    state.stateSha256
  );
  assert.equal(
    createBrokerReconciliationInput(verified, 3_000)
      .applicationIsolationKeySha256,
    state.applicationIsolationKeySha256
  );

  const restored = rehydrateBrokerLeaseState(
    JSON.parse(JSON.stringify(state)),
    {
      expectedBinding: binding(),
      expectedStateSha256: state.stateSha256,
    }
  );
  assert.equal(restored.stateSha256, state.stateSha256);

  const tampered = JSON.parse(JSON.stringify(state));
  tampered.workers[0].sessionId = 'attacker-session';
  assert.throws(
    () =>
      rehydrateBrokerLeaseState(tampered, {
        expectedBinding: binding(),
        expectedStateSha256: state.stateSha256,
      }),
    /seal does not match/
  );
});

test('rehydrated cleanup-required work stays blocked until exact cleanup is proven', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask),
      'controller-dev',
      3_000
    )
  );
  state = expireBrokerLeases(state, 8_000);
  const restored = rehydrateBrokerLeaseState(
    JSON.parse(JSON.stringify(state)),
    {
      expectedBinding: binding(),
      expectedStateSha256: state.stateSha256,
    }
  );
  const pending = createBrokerReconciliationInput(restored, 8_100);
  assert.equal(pending.ready, false);
  assert.deepEqual(pending.activeLeaseIds, ['lease-task-1-1']);
  const pendingStateSha256 = restored.stateSha256;

  assert.throws(
    () =>
      registerBrokerWorker(
        restored,
        authenticated(
          'worker.register',
          { ...registration(), instanceId: 'worker-east-boot-2' },
          'worker-east',
          8_200,
          { sessionId: 'session-2' }
        )
      ),
    /Cannot replace a worker registration with active leases/
  );
  assert.throws(
    () =>
      grantBrokerLease(
        restored,
        authenticated(
          'lease.grant',
          grantBody(plannedTask, {
            leaseId: 'lease-task-1-2',
            attempt: 2,
            expiresAtMs: 16_000,
          }),
          'controller-dev',
          8_250
        )
      ),
    /accepted cleanup evidence/
  );
  assert.equal(restored.stateSha256, pendingStateSha256);

  const closed = acknowledgeBrokerCancellation(
    restored,
    authenticated(
      'worker.cancelled',
      cancellationAcknowledgement(plannedTask, {
        cancellationRequestedAtMs: 8_000,
        cancelledAtMs: 8_300,
      }),
      'worker-east',
      8_400
    ),
    cleanupAcceptance(8_500)
  );
  assert.equal(closed.leases[0].state, 'cancelled');
  assert.deepEqual(
    createBrokerReconciliationInput(closed, 8_600).activeLeaseIds,
    []
  );

  const legacyCleanup = structuredClone(closed);
  legacyCleanup.leases[0].cleanupEvidence.schema =
    'seerrng-validation-broker-cleanup-evidence/v1';
  delete legacyCleanup.stateSha256;
  legacyCleanup.stateSha256 = canonicalJsonSha256(legacyCleanup);
  assert.throws(
    () =>
      rehydrateBrokerLeaseState(legacyCleanup, {
        expectedBinding: binding(),
        expectedStateSha256: legacyCleanup.stateSha256,
      }),
    /Unsupported cleanup evidence schema/
  );
});

test('controller recovery clears only expired cleanup with independently verified exact evidence', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask),
      'controller-dev',
      3_000
    )
  );
  state = expireBrokerLeases(state, 8_000);
  const recoveryMessage = authenticated(
    'lease.cleanup-recover',
    cleanupRecovery(plannedTask),
    'controller-dev',
    8_600
  );
  const blockedStateSha256 = state.stateSha256;
  const substitutedTaskRecovery = authenticated(
    'lease.cleanup-recover',
    cleanupRecovery(plannedTask, { taskSha256: h('8') }),
    'controller-dev',
    8_600
  );
  assert.throws(
    () =>
      recoverBrokerLeaseCleanup(state, substitutedTaskRecovery, {
        acceptedAtMs: 8_700,
        verifyCleanupEvidence: () => true,
      }),
    /does not match its exact lease/
  );
  assert.throws(
    () =>
      recoverBrokerLeaseCleanup(state, recoveryMessage, {
        acceptedAtMs: 8_700,
      }),
    /requires an independent verifier/
  );
  assert.throws(
    () =>
      recoverBrokerLeaseCleanup(state, recoveryMessage, {
        acceptedAtMs: 8_700,
        verifyCleanupEvidence: () => false,
      }),
    /not independently accepted/
  );
  assert.throws(
    () =>
      recoverBrokerLeaseCleanup(state, recoveryMessage, {
        acceptedAtMs: 8_700,
        verifyCleanupEvidence: () => Promise.resolve(true),
      }),
    /must be synchronous/
  );
  assert.equal(state.stateSha256, blockedStateSha256);
  assert.equal(state.leases[0].state, 'cleanup-required');

  const delayedEnvelopeValue = structuredClone(recoveryMessage);
  delayedEnvelopeValue.sentAtMs = 8_601;
  const delayedEnvelope = authenticateBrokerMessage(delayedEnvelopeValue, {
    expectedBinding: binding(),
    nowMs: 8_601,
    verifyProof: () => true,
  });
  assert.equal(
    delayedEnvelope.command.commandSha256,
    recoveryMessage.command.commandSha256
  );

  let observed;
  const recovered = recoverBrokerLeaseCleanup(state, recoveryMessage, {
    acceptedAtMs: 8_700,
    verifyCleanupEvidence(value) {
      observed = value;
      return true;
    },
  });
  const delayedRecovery = recoverBrokerLeaseCleanup(state, delayedEnvelope, {
    acceptedAtMs: 8_700,
    verifyCleanupEvidence: () => true,
  });
  const recoveryProvenance = describeBrokerLeaseStateTransition(
    state,
    recovered
  );
  const delayedProvenance = describeBrokerLeaseStateTransition(
    state,
    delayedRecovery
  );
  assert.equal(recoveryProvenance.kind, 'lease.cleanup-recover');
  assert.equal(delayedProvenance.kind, recoveryProvenance.kind);
  assert.equal(delayedProvenance.occurredAtMs, 8_700);
  assert.notEqual(
    delayedProvenance.inputSha256,
    recoveryProvenance.inputSha256
  );
  assert.equal(recovered.appliedCommands.at(-1).appliedAtMs, 8_600);
  assert.equal(delayedRecovery.appliedCommands.at(-1).appliedAtMs, 8_601);
  state = recovered;
  assert.equal(observed.lease.leaseId, 'lease-task-1-1');
  assert.equal(
    observed.cleanupEvidence.cleanupEvidenceSha256,
    recoveryMessage.body.cleanupEvidence.cleanupEvidenceSha256
  );
  assert.equal(state.leases[0].state, 'cancelled');
  assert.equal(state.leases[0].cleanupDisposition, 'controller-recovery');
  assert.equal(state.appliedCommands.length, 2);

  const restored = rehydrateBrokerLeaseState(
    JSON.parse(JSON.stringify(state)),
    {
      expectedBinding: binding(),
      expectedStateSha256: state.stateSha256,
    }
  );
  assert.equal(restored.leases[0].cleanupDisposition, 'controller-recovery');

  const resignedValue = structuredClone(recoveryMessage);
  resignedValue.messageId = 'resigned-cleanup-recovery-envelope';
  resignedValue.sentAtMs = 60_000;
  resignedValue.auth = auth('controller-dev', {
    sessionId: 'controller-session-3',
    keyId: 'controller-key-3',
    nonce: 'resigned-cleanup-recovery-envelope',
    issuedAtMs: 59_500,
    expiresAtMs: 60_500,
  });
  const resigned = authenticateBrokerMessage(resignedValue, {
    expectedBinding: binding(),
    nowMs: 60_000,
    verifyProof: () => true,
  });
  assert.equal(recoverBrokerLeaseCleanup(restored, resigned), restored);
});

test('task catalog rejects unknown, cyclic, unavailable, or discontinuous assignments', () => {
  assert.throws(
    () =>
      initialState([task('task-1', { dependencyTaskIds: ['missing-task'] })]),
    /unknown dependency/
  );
  assert.throws(
    () =>
      initialState([
        task('task-1', { dependencyTaskIds: ['task-2'] }),
        task('task-2', { dependencyTaskIds: ['task-1'] }),
      ]),
    /dependencies contain a cycle/
  );
  assert.throws(
    () =>
      initialState([
        task('task-1', { dependencyTaskIds: ['task-2'] }),
        task('task-2', {
          assignment: {
            workerId: 'worker-east',
            slotId: 'worker-east.slot-1',
            slotIndex: 1,
            slotPosition: 2,
          },
        }),
      ]),
    /cycle with slot ordering/
  );
  assert.throws(
    () =>
      initialState([
        task('task-1', {
          assignment: {
            workerId: 'worker-east',
            slotId: 'worker-east.slot-1',
            slotIndex: 1,
            slotPosition: 2,
          },
        }),
      ]),
    /positions must be unique and contiguous/
  );
  assert.throws(
    () =>
      initialState([
        task('task-1'),
        task('task-2', {
          assignment: {
            workerId: 'worker-east',
            slotId: 'worker-east.slot-1',
            slotIndex: 1,
            slotPosition: 1,
          },
        }),
      ]),
    /positions must be unique and contiguous/
  );
  assert.throws(
    () =>
      initialState([
        task('task-1', {
          assignment: {
            workerId: 'worker-west',
            slotId: 'worker-west.slot-1',
            slotIndex: 1,
            slotPosition: 1,
          },
        }),
      ]),
    /unavailable worker/
  );
});

test('logical slots permit parallel slots but enforce each prior slot result', () => {
  const first = task('task-1');
  const next = task('task-2', {
    assignment: {
      workerId: 'worker-east',
      slotId: 'worker-east.slot-1',
      slotIndex: 1,
      slotPosition: 2,
    },
  });
  const parallel = task('task-3', {
    assignment: {
      workerId: 'worker-east',
      slotId: 'worker-east.slot-2',
      slotIndex: 2,
      slotPosition: 1,
    },
  });
  let state = admittedState([first, next, parallel]);
  assert.equal(state.schema, 'seerrng-validation-broker-lease-state/v3');
  state = grantBrokerLease(
    state,
    authenticated('lease.grant', grantBody(first), 'controller-dev', 3_000)
  );
  assert.throws(
    () =>
      grantBrokerLease(
        state,
        authenticated(
          'lease.grant',
          grantBody(next, { leaseId: 'lease-task-2-1' }),
          'controller-dev',
          3_100
        )
      ),
    /prior slot result/
  );
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(parallel, { leaseId: 'lease-task-3-1' }),
      'controller-dev',
      3_100
    )
  );
  assert.deepEqual(state.leases.map((lease) => lease.taskId).toSorted(), [
    'task-1',
    'task-3',
  ]);

  const reassigned = task('task-1', {
    assignment: {
      workerId: 'worker-east',
      slotId: 'worker-east.slot-2',
      slotIndex: 2,
      slotPosition: 1,
    },
  });
  assert.throws(
    () =>
      grantBrokerLease(
        admittedState([first]),
        authenticated(
          'lease.grant',
          grantBody(reassigned, { leaseId: 'reassigned-task' }),
          'controller-dev',
          3_000
        )
      ),
    /immutable expected task/
  );
});

test('dependencies require accepted passing results while failed slot predecessors do not', () => {
  const prerequisite = task('task-1');
  const dependent = task('task-2', { dependencyTaskIds: ['task-1'] });
  let state = admittedState([prerequisite, dependent]);
  assert.throws(
    () =>
      grantBrokerLease(
        state,
        authenticated(
          'lease.grant',
          grantBody(dependent, { leaseId: 'lease-task-2-1' }),
          'controller-dev',
          3_000
        )
      ),
    /accepted dependency result/
  );
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(prerequisite),
      'controller-dev',
      3_000
    )
  );
  state = acceptBrokerResult(
    state,
    authenticated(
      'worker.result',
      resultBody(prerequisite),
      'worker-east',
      5_100
    ),
    resultAcceptance(5_200)
  ).state;
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(dependent, { leaseId: 'lease-task-2-1' }),
      'controller-dev',
      5_300
    )
  );
  assert.equal(state.leases.at(-1).taskId, dependent.taskId);

  let failed = admittedState([prerequisite, dependent]);
  failed = grantBrokerLease(
    failed,
    authenticated(
      'lease.grant',
      grantBody(prerequisite),
      'controller-dev',
      3_000
    )
  );
  const failedResult = resultBody(prerequisite);
  failedResult.outcome = {
    ...failedResult.outcome,
    status: 'failed',
    exitCode: 1,
    resultSha256: h('1'),
  };
  failed = acceptBrokerResult(
    failed,
    authenticated('worker.result', failedResult, 'worker-east', 5_100),
    resultAcceptance(5_200)
  ).state;
  assert.throws(
    () =>
      grantBrokerLease(
        failed,
        authenticated(
          'lease.grant',
          grantBody(dependent, { leaseId: 'lease-task-2-1' }),
          'controller-dev',
          5_300
        )
      ),
    /terminal prerequisite|failed dependency/
  );
  const failedInput = createBrokerReconciliationInput(failed, 6_000);
  assert.equal(
    failedInput.schema,
    'seerrng-validation-broker-reconciliation-input/v2'
  );
  assert.deepEqual(failedInput.blockedTaskIds, ['task-2']);
  assert.deepEqual(failedInput.unresolvedTaskIds, ['task-2']);
  assert.equal(failedInput.ready, true);
  assert.equal(failedInput.successEligible, false);

  const first = task('task-1');
  const independentNext = task('task-2', {
    assignment: {
      workerId: 'worker-east',
      slotId: 'worker-east.slot-1',
      slotIndex: 1,
      slotPosition: 2,
    },
  });
  let diagnostic = admittedState([first, independentNext]);
  diagnostic = grantBrokerLease(
    diagnostic,
    authenticated('lease.grant', grantBody(first), 'controller-dev', 3_000)
  );
  const diagnosticFailure = resultBody(first);
  diagnosticFailure.outcome = {
    ...diagnosticFailure.outcome,
    status: 'failed',
    exitCode: 1,
    resultSha256: h('2'),
  };
  diagnostic = acceptBrokerResult(
    diagnostic,
    authenticated('worker.result', diagnosticFailure, 'worker-east', 5_100),
    resultAcceptance(5_200)
  ).state;
  diagnostic = grantBrokerLease(
    diagnostic,
    authenticated(
      'lease.grant',
      grantBody(independentNext, { leaseId: 'lease-task-2-1' }),
      'controller-dev',
      5_300
    )
  );
  assert.equal(diagnostic.leases.at(-1).taskId, independentNext.taskId);
});

test('renewal rejects a slot outside newly admitted live capacity', () => {
  const plannedTask = task('task-2');
  let state = createBrokerLeaseState({
    binding: binding(),
    expectedTasks: [plannedTask],
    workerConfig: workerConfig('auto'),
  });
  state = registerBrokerWorker(
    state,
    authenticated('worker.register', registration(), 'worker-east', 1_500)
  );
  state = recordBrokerCapacity(
    state,
    authenticated('worker.capacity', capacity(), 'worker-east')
  );
  state = recordBrokerHeartbeat(
    state,
    authenticated(
      'worker.heartbeat',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        observedAtMs: 2_200,
        capacitySequence: 1,
        activeLeases: [],
      },
      'worker-east',
      2_300
    )
  );
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask, { leaseId: 'lease-task-2-1' }),
      'controller-dev',
      3_000
    )
  );
  state = recordBrokerCapacity(
    state,
    authenticated(
      'worker.capacity',
      capacity(['lease-task-2-1'], {
        reportSequence: 2,
        observedAtMs: 4_000,
        safeAvailableN: 1,
      }),
      'worker-east',
      4_100
    )
  );
  state = recordBrokerHeartbeat(
    state,
    authenticated(
      'worker.heartbeat',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        observedAtMs: 4_200,
        capacitySequence: 2,
        activeLeases: [
          { leaseId: 'lease-task-2-1', taskId: 'task-2', attempt: 1 },
        ],
      },
      'worker-east',
      4_300
    )
  );
  assert.throws(
    () =>
      renewBrokerLease(
        state,
        authenticated(
          'lease.renew',
          {
            workerId: 'worker-east',
            instanceId: 'worker-east-boot-1',
            workerSessionId: 'session-1',
            leaseId: 'lease-task-2-1',
            taskId: 'task-2',
            attempt: 1,
            expiresAtMs: 9_000,
          },
          'controller-dev',
          4_500
        )
      ),
    /assigned live worker slot/
  );
});

test('rehydration rejects rehashed history that violates dependency admission', () => {
  const prerequisite = task('task-1');
  const dependent = task('task-2', { dependencyTaskIds: ['task-1'] });
  let state = admittedState([prerequisite, dependent]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(prerequisite),
      'controller-dev',
      3_000
    )
  );
  state = acceptBrokerResult(
    state,
    authenticated(
      'worker.result',
      resultBody(prerequisite),
      'worker-east',
      5_100
    ),
    resultAcceptance(5_200)
  ).state;
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(dependent, { leaseId: 'lease-task-2-1' }),
      'controller-dev',
      5_300
    )
  );

  const tampered = structuredClone(state);
  const dependentLease = tampered.leases.find(
    (lease) => lease.taskId === dependent.taskId
  );
  dependentLease.grantedAtMs = 5_100;
  delete tampered.stateSha256;
  tampered.stateSha256 = canonicalJsonSha256(tampered);
  assert.throws(
    () =>
      rehydrateBrokerLeaseState(tampered, {
        expectedBinding: binding(),
        expectedStateSha256: tampered.stateSha256,
      }),
    /accepted passing dependency result/
  );
});

test('rehydration rejects a rehashed retry that overlaps cleanup on its slot', () => {
  const plannedTask = task();
  let state = admittedState([plannedTask]);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask),
      'controller-dev',
      3_000
    )
  );
  state = cancelBrokerLease(
    state,
    authenticated(
      'lease.cancel',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        leaseId: 'lease-task-1-1',
        taskId: 'task-1',
        attempt: 1,
        requestedAtMs: 4_000,
        mode: 'abort-attempt',
        reasonCode: 'worker-drain',
      },
      'controller-dev',
      4_100
    )
  );
  state = acknowledgeBrokerCancellation(
    state,
    authenticated(
      'worker.cancelled',
      cancellationAcknowledgement(plannedTask),
      'worker-east',
      4_300
    ),
    cleanupAcceptance(4_400)
  );
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(plannedTask, {
        leaseId: 'lease-task-1-2',
        attempt: 2,
        expiresAtMs: 14_000,
      }),
      'controller-dev',
      5_000
    )
  );

  const tampered = structuredClone(state);
  tampered.leases.find((lease) => lease.attempt === 2).grantedAtMs = 4_300;
  delete tampered.stateSha256;
  tampered.stateSha256 = canonicalJsonSha256(tampered);
  assert.throws(
    () =>
      rehydrateBrokerLeaseState(tampered, {
        expectedBinding: binding(),
        expectedStateSha256: tampered.stateSha256,
      }),
    /overlap one logical worker slot/
  );
});
