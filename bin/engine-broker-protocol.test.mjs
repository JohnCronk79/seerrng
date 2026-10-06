import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  authenticateBrokerMessage,
  brokerApplicationIsolationKeySha256,
  brokerEvidenceKeySha256,
  brokerMessageSigningSha256,
  brokerResultKeySha256,
  createBrokerMessage,
  createBrokerWorkerConfig,
  resolveConfiguredWorkerN,
  sealBrokerCleanupEvidence,
  sealBrokerTask,
  verifyBrokerCleanupEvidence,
  verifyBrokerTask,
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

function taskInput(overrides = {}) {
  return {
    applicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(binding()),
    taskId: 'unit-task-1',
    unitId: 'unit-tests',
    caseId: 'unit-shard-1',
    adapterId: 'native-generic',
    timeoutMs: 60_000,
    maxAttempts: 2,
    payload: {
      runner: 'repository-owned',
      selection: { files: ['src/example.test.ts'] },
    },
    expectedEvidence: [
      {
        evidenceId: 'native-result',
        schema: 'native-result-v1',
        mediaType: 'application/json',
        required: true,
      },
    ],
    ...overrides,
  };
}

function capabilities(overrides = {}) {
  return {
    platform: 'linux',
    architecture: 'x64',
    logicalCpuCapacity: 16,
    maxSafeN: 12,
    memoryMiB: 32_768,
    performanceProfileSha256: h('c'),
    adapterIds: ['native-generic'],
    ...overrides,
  };
}

function registration(overrides = {}) {
  return {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    machineIdentitySha256: h('d'),
    agentVersion: '1.0.0',
    capabilities: capabilities(),
    ...overrides,
  };
}

function capacity(overrides = {}) {
  return {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'session-1',
    reportSequence: 1,
    observedAtMs: 2_000,
    safeAvailableN: 10,
    availableMemoryMiB: 24_000,
    loadPermille: 125,
    performanceProfileSha256: h('c'),
    performanceScorePermille: 1_750,
    activeLeaseIds: [],
    ...overrides,
  };
}

function workerConfig(configuredN = 'auto') {
  return {
    schema: 'seerrng-validation-broker-worker-config/v1',
    controllerId: 'controller-dev',
    workers: [
      {
        workerId: 'worker-east',
        machineIdentitySha256: h('d'),
        enabled: true,
        configuredN,
      },
    ],
  };
}

function auth(principalId, overrides = {}) {
  return {
    algorithm: 'hmac-sha256',
    sessionId: 'session-1',
    principalId,
    keyId: 'worker-key-1',
    nonce: 'nonce-value-0001',
    issuedAtMs: 1_000,
    expiresAtMs: 20_000,
    proof: 'A'.repeat(43),
    ...overrides,
  };
}

function message(kind, body, principalId, overrides = {}) {
  return {
    schema: 'seerrng-validation-broker-message/v1',
    protocolVersion: 1,
    messageId: `${kind.replaceAll('.', '-')}-1`,
    kind,
    sentAtMs: 2_500,
    binding: binding(),
    auth: auth(principalId),
    body,
    ...overrides,
  };
}

test('runner-neutral tasks are canonically sealed against payload drift', () => {
  const sealed = sealBrokerTask(taskInput());
  assert.equal(sealed.schema, 'seerrng-validation-broker-task/v1');
  assert.equal(
    sealed.applicationIsolationKeySha256,
    brokerApplicationIsolationKeySha256(binding())
  );
  assert.equal(sealed.adapterId, 'native-generic');
  assert.deepEqual(verifyBrokerTask(sealed), sealed);
  assert.equal(Object.isFrozen(sealed.payload), true);

  const reordered = taskInput({
    payload: {
      selection: { files: ['src/example.test.ts'] },
      runner: 'repository-owned',
    },
  });
  assert.deepEqual(sealBrokerTask(reordered), sealed);

  const changed = structuredClone(sealed);
  changed.payload.selection.files.push('src/other.test.ts');
  assert.throws(() => verifyBrokerTask(changed), /payload hash/);
});

test('worker config is versioned, exact, secret-free, and supports different N values', () => {
  const config = createBrokerWorkerConfig({
    schema: 'seerrng-validation-broker-worker-config/v1',
    controllerId: 'controller-dev',
    workers: [
      workerConfig(6).workers[0],
      {
        workerId: 'worker-west',
        machineIdentitySha256: h('e'),
        enabled: false,
        configuredN: 'auto',
      },
    ],
  });
  assert.deepEqual(
    config.workers.map(({ configuredN, workerId }) => ({
      configuredN,
      workerId,
    })),
    [
      { workerId: 'worker-east', configuredN: 6 },
      { workerId: 'worker-west', configuredN: 'auto' },
    ]
  );
  const withSecret = structuredClone(workerConfig());
  withSecret.workers[0].secret = 'must-not-be-stored';
  assert.throws(() => createBrokerWorkerConfig(withSecret), /exact field set/);
});

test('controller host may register a separately authenticated local worker', () => {
  const config = createBrokerWorkerConfig({
    schema: 'seerrng-validation-broker-worker-config/v1',
    controllerId: 'controller-dev',
    workers: [
      {
        workerId: 'controller-local-worker',
        machineIdentitySha256: h('f'),
        enabled: true,
        configuredN: 'auto',
      },
    ],
  });
  assert.equal(config.workers[0].workerId, 'controller-local-worker');
});

test('controller resolves automatic or explicit worker N against safe live capacity', () => {
  const automatic = resolveConfiguredWorkerN(
    workerConfig('auto'),
    registration(),
    capacity()
  );
  assert.equal(automatic.selectedN, 10);
  assert.equal(automatic.performanceScorePermille, 1_750);

  const explicit = resolveConfiguredWorkerN(
    workerConfig(7),
    registration(),
    capacity()
  );
  assert.equal(explicit.selectedN, 7);
  assert.throws(
    () =>
      resolveConfiguredWorkerN(workerConfig(11), registration(), capacity()),
    /exceeds safely reported capacity/
  );
  assert.throws(
    () =>
      resolveConfiguredWorkerN(
        workerConfig(),
        registration({ machineIdentitySha256: h('e') }),
        capacity()
      ),
    /machine identity/
  );
  assert.throws(
    () =>
      resolveConfiguredWorkerN(
        workerConfig(),
        registration(),
        capacity({ safeAvailableN: 13 })
    ),
    /registered safe worker limit/
  );
  assert.throws(
    () =>
      resolveConfiguredWorkerN(
        workerConfig(),
        registration(),
        capacity({ performanceProfileSha256: h('9') })
      ),
    /performance profile is not registered/
  );
  assert.throws(
    () =>
      resolveConfiguredWorkerN(
        workerConfig(),
        registration(),
        capacity({ performanceScorePermille: 1_750.5 })
      ),
    /safe integer/
  );
});

test('messages require exact protocol versions, fields, and sending principals', () => {
  const registrationMessage = createBrokerMessage(
    message('worker.register', registration(), 'worker-east')
  );
  assert.equal(registrationMessage.protocolVersion, 1);
  assert.equal(Object.isFrozen(registrationMessage.body.capabilities), true);

  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.register', registration(), 'controller-dev')
      ),
    /principal cannot send/
  );
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.register', registration(), 'worker-east', {
          protocolVersion: 2,
        })
      ),
    /protocol version/
  );
  const unknown = message('worker.register', registration(), 'worker-east');
  unknown.body.secret = 'not-a-protocol-field';
  assert.throws(() => createBrokerMessage(unknown), /exact field set/);
});

test('detached session proof must be externally verified and time-valid', () => {
  const input = message('worker.register', registration(), 'worker-east');
  let observed;
  const authenticated = authenticateBrokerMessage(input, {
    expectedBinding: binding(),
    nowMs: 2_600,
    verifyProof(value) {
      observed = value;
      return true;
    },
  });
  assert.equal(authenticated.body.workerId, 'worker-east');
  assert.match(observed.signingSha256, /^[a-f0-9]{64}$/);
  assert.equal(observed.auth.keyId, 'worker-key-1');
  assert.equal(
    observed.signingSha256,
    brokerMessageSigningSha256(authenticated)
  );
  const unsigned = structuredClone(input);
  delete unsigned.auth.proof;
  assert.equal(
    brokerMessageSigningSha256(unsigned),
    observed.signingSha256
  );

  assert.throws(
    () =>
      authenticateBrokerMessage(input, {
        expectedBinding: binding(),
        nowMs: 2_600,
        verifyProof: () => false,
      }),
    /proof was rejected/
  );
  assert.throws(
    () =>
      authenticateBrokerMessage(input, {
        expectedBinding: binding(),
        nowMs: 20_001,
        verifyProof: () => true,
      }),
    /not currently valid/
  );
  assert.throws(
    () =>
      authenticateBrokerMessage(input, {
        expectedBinding: binding({ planSha256: h('f') }),
        nowMs: 2_600,
        verifyProof: () => true,
      }),
    /expected application submission and plan/
  );
});

test('result and evidence identities bind execution, task, and attempt', () => {
  const firstResult = brokerResultKeySha256(binding(), 'unit-task-1', 1);
  const secondAttempt = brokerResultKeySha256(binding(), 'unit-task-1', 2);
  const changedPlan = brokerResultKeySha256(
    binding({ planSha256: h('f') }),
    'unit-task-1',
    1
  );
  const changedApplication = brokerResultKeySha256(
    binding({
      applicationId: 'another-app',
      repositoryIdentitySha256: h('8'),
      submissionId: 'submission-2',
      submissionSequence: 2,
    }),
    'unit-task-1',
    1
  );
  assert.notEqual(firstResult, secondAttempt);
  assert.notEqual(firstResult, changedPlan);
  assert.notEqual(firstResult, changedApplication);
  assert.notEqual(
    brokerApplicationIsolationKeySha256(binding()),
    brokerApplicationIsolationKeySha256(
      binding({ applicationId: 'another-app' })
    )
  );

  const firstEvidence = brokerEvidenceKeySha256(
    binding(),
    'unit-task-1',
    1,
    'native-result'
  );
  const otherEvidence = brokerEvidenceKeySha256(
    binding(),
    'unit-task-1',
    1,
    'native-log'
  );
  const otherApplicationEvidence = brokerEvidenceKeySha256(
    binding({
      applicationId: 'another-app',
      submissionId: 'submission-2',
      submissionSequence: 2,
    }),
    'unit-task-1',
    1,
    'native-result'
  );
  assert.notEqual(firstEvidence, otherEvidence);
  assert.notEqual(firstEvidence, otherApplicationEvidence);
});

test('worker result messages reject duplicate or unbound evidence', () => {
  const task = sealBrokerTask(taskInput());
  const evidenceKeySha256 = brokerEvidenceKeySha256(
    binding(),
    task.taskId,
    1,
    'native-result'
  );
  const body = {
    applicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(binding()),
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'session-1',
    leaseId: 'lease-1',
    taskId: task.taskId,
    taskSha256: task.taskSha256,
    attempt: 1,
    completedAtMs: 4_000,
    resultKeySha256: brokerResultKeySha256(binding(), task.taskId, 1),
    outcome: {
      status: 'passed',
      exitCode: 0,
      completed: true,
      cancelled: false,
      timedOut: false,
      resultSha256: h('1'),
    },
    evidence: [
      {
        evidenceId: 'native-result',
        evidenceKeySha256,
        schema: 'native-result-v1',
        mediaType: 'application/json',
        bytes: 100,
        sha256: h('2'),
      },
    ],
  };
  const accepted = createBrokerMessage(
    message('worker.result', body, 'worker-east', { sentAtMs: 4_100 })
  );
  assert.equal(
    accepted.body.applicationIsolationKeySha256,
    brokerApplicationIsolationKeySha256(binding())
  );
  assert.equal(accepted.body.evidence[0].evidenceKeySha256, evidenceKeySha256);

  const duplicate = structuredClone(body);
  duplicate.evidence.push(duplicate.evidence[0]);
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.result', duplicate, 'worker-east', {
          sentAtMs: 4_100,
        })
      ),
    /evidence IDs must be exact-once/
  );
  const unbound = structuredClone(body);
  unbound.evidence[0].evidenceKeySha256 = h('3');
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.result', unbound, 'worker-east', {
          sentAtMs: 4_100,
        })
      ),
    /not bound to its task attempt/
  );
  const crossApplication = structuredClone(body);
  crossApplication.applicationIsolationKeySha256 = h('4');
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.result', crossApplication, 'worker-east', {
          sentAtMs: 4_100,
        })
      ),
    /application isolation boundary/
  );
});

test('worker reports and results are bound to their authenticated session', () => {
  const staleCapacity = capacity({ workerSessionId: 'stale-session' });
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.capacity', staleCapacity, 'worker-east')
      ),
    /not bound to its authenticated session/
  );

  const plannedTask = sealBrokerTask(taskInput());
  const staleResult = {
    applicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(binding()),
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'stale-session',
    leaseId: 'lease-1',
    taskId: plannedTask.taskId,
    taskSha256: plannedTask.taskSha256,
    attempt: 1,
    completedAtMs: 4_000,
    resultKeySha256: brokerResultKeySha256(
      binding(),
      plannedTask.taskId,
      1
    ),
    outcome: {
      status: 'failed',
      exitCode: 1,
      completed: true,
      cancelled: false,
      timedOut: false,
      resultSha256: h('4'),
    },
    evidence: [],
  };
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.result', staleResult, 'worker-east', {
          sentAtMs: 4_100,
        })
      ),
    /not bound to its authenticated session/
  );
});

test('cleanup proof is sealed and bound to execution, lease, instance, and session', () => {
  const cleanup = sealBrokerCleanupEvidence(binding(), {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'session-1',
    leaseId: 'lease-1',
    taskId: 'unit-task-1',
    attempt: 1,
    cancellationRequestedAtMs: 4_000,
    completedAtMs: 4_200,
    artifactSha256: h('5'),
  });
  assert.deepEqual(verifyBrokerCleanupEvidence(binding(), cleanup), cleanup);
  assert.equal(
    cleanup.applicationIsolationKeySha256,
    brokerApplicationIsolationKeySha256(binding())
  );

  const changedArtifact = structuredClone(cleanup);
  changedArtifact.artifactSha256 = h('6');
  assert.throws(
    () => verifyBrokerCleanupEvidence(binding(), changedArtifact),
    /seal does not match/
  );
  assert.throws(
    () =>
      verifyBrokerCleanupEvidence(
        binding({ executionId: 'validation-run-2' }),
        cleanup
      ),
    /not bound to its lease/
  );
});
