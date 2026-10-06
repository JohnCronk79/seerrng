import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acknowledgeBrokerCancellation,
  acceptBrokerResult,
  cancelBrokerLease,
  createBrokerLeaseState,
  createBrokerReconciliationInput,
  createBrokerResultAcknowledgementBody,
  expireBrokerLeases,
  grantBrokerLease,
  recordBrokerCapacity,
  recordBrokerHeartbeat,
  registerBrokerWorker,
  rehydrateBrokerLeaseState,
  renewBrokerLease,
  verifyBrokerLeaseState,
} from '../tools/validation-engine/runtime/broker-lease-state.mjs';
import {
  authenticateBrokerMessage,
  brokerApplicationIsolationKeySha256,
  brokerEvidenceKeySha256,
  brokerResultKeySha256,
  createBrokerMessage,
  sealBrokerCleanupEvidence,
  sealBrokerTask,
} from '../tools/validation-engine/runtime/broker-protocol.mjs';

const h = (character) => character.repeat(64);

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
  return sealBrokerTask({
    applicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(binding()),
    taskId,
    unitId: 'unit-tests',
    caseId: taskId.replace('task', 'case'),
    adapterId: 'native-generic',
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
  const value = {
    schema: 'seerrng-validation-broker-message/v1',
    protocolVersion: 1,
    messageId: `message-${nextMessageId++}`,
    kind,
    sentAtMs,
    binding: binding(),
    auth: auth(principalId, authOverrides),
    body,
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
  const leaseId =
    overrides.leaseId ?? `lease-${plannedTask.taskId}-${attempt}`;
  const cancellationRequestedAtMs =
    overrides.cancellationRequestedAtMs ?? 4_000;
  const cancelledAtMs = overrides.cancelledAtMs ?? 4_200;
  const cleanupEvidence = sealBrokerCleanupEvidence(binding(), {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'session-1',
    leaseId,
    taskId: plannedTask.taskId,
    attempt,
    cancellationRequestedAtMs,
    completedAtMs: cancelledAtMs,
    artifactSha256: overrides.artifactSha256 ?? h('7'),
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

const cleanupAcceptance = (acceptedAtMs = 4_400) => ({
  acceptedAtMs,
  verifyCleanupEvidence: () => true,
});

test('unlisted, unauthenticated, or over-capacity workers fail closed', () => {
  let state = initialState();
  const forged = createBrokerMessage({
    schema: 'seerrng-validation-broker-message/v1',
    protocolVersion: 1,
    messageId: 'forged-registration',
    kind: 'worker.register',
    sentAtMs: 2_500,
    binding: binding(),
    auth: auth('worker-east'),
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
          capacity([], { safeAvailableN: 1 }),
          'worker-east'
        )
      ),
    /Configured worker N exceeds safely reported capacity/
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

test('task inventory cannot cross an application submission boundary', () => {
  const alienTask = task('task-1', {
    applicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(
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
        authenticated(
          'worker.capacity',
          staleCapacity,
          'worker-east',
          2_700,
          { sessionId: 'session-2' }
        )
      ),
    /stale worker instance or session/
  );
});

test('leases require exact tasks, supported adapters, and admitted worker slots', () => {
  const tasks = [task('task-1'), task('task-2'), task('task-3')];
  let state = admittedState(tasks);
  state = grantBrokerLease(
    state,
    authenticated(
      'lease.grant',
      grantBody(tasks[0]),
      'controller-dev',
      3_000
    )
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
    /exceed the admitted worker N/
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
        8_100
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
    10_200
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
  const first = acceptBrokerResult(state, resultMessage, 5_200);
  const duplicate = acceptBrokerResult(first.state, resultMessage, 5_300);
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
        5_400
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
        5_200
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
        5_200
      ),
    /contract drifted/
  );
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
            artifactSha256: h('8'),
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
    5_200
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
    authenticated(
      'lease.grant',
      grantBody(tasks[0]),
      'controller-dev',
      3_000
    )
  );
  let input = createBrokerReconciliationInput(state, 4_000);
  assert.equal(input.ready, false);
  assert.equal(input.successEligible, false);
  assert.deepEqual(input.unresolvedTaskIds, ['task-1', 'task-2']);

  state = acceptBrokerResult(
    state,
    authenticated(
      'worker.result',
      resultBody(tasks[0]),
      'worker-east',
      5_100
    ),
    5_200
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
    5_500
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
