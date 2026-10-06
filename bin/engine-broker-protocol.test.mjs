import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BROKER_CLEANUP_EVIDENCE_NAMESPACE_KIND,
  BROKER_CLEANUP_EVIDENCE_SCHEMA,
  BROKER_REPLAY_KEY_SCHEMA,
  MAX_BROKER_AUTH_WINDOW_MS,
  MAX_BROKER_MESSAGE_BYTES,
  MAX_EVIDENCE_BLOB_BYTES,
  authenticateBrokerMessage,
  brokerApplicationIsolationKeySha256,
  brokerEvidenceKeySha256,
  brokerMessageSigningSha256,
  brokerReplayKeySha256,
  brokerResultKeySha256,
  createBrokerMessage,
  createBrokerWorkerConfig,
  evaluateConfiguredWorkerAdmission,
  resolveConfiguredWorkerN,
  sealBrokerCleanupEvidence,
  sealBrokerLogicalCommand,
  sealBrokerTask,
  verifyBrokerCleanupEvidence,
  verifyBrokerTask,
} from '../tools/validation-engine/runtime/broker-protocol.mjs';
import {
  canonicalJsonSha256,
} from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

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

function taskInput(overrides = {}) {
  return {
    applicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(binding()),
    taskId: 'unit-task-1',
    unitId: 'unit-tests',
    caseId: 'unit-shard-1',
    adapterId: 'native-generic',
    assignment: {
      workerId: 'worker-east',
      slotId: 'worker-east.slot-1',
      slotIndex: 1,
      slotPosition: 1,
    },
    dependencyTaskIds: [],
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
  const value = {
    schema: 'seerrng-validation-broker-message/v2',
    protocolVersion: 2,
    messageId: `${kind.replaceAll('.', '-')}-1`,
    kind,
    sentAtMs: 2_500,
    binding: binding(),
    auth: auth(principalId),
    body,
    ...overrides,
  };
  return {
    ...value,
    command:
      overrides.command ??
      (controllerKinds.has(kind)
        ? sealBrokerLogicalCommand({
            binding: value.binding,
            kind,
            commandId: `${value.messageId}-command`,
            issuedAtMs: value.sentAtMs,
            body: value.body,
          })
        : null),
  };
}

test('runner-neutral tasks are canonically sealed against payload drift', () => {
  const sealed = sealBrokerTask(taskInput());
  assert.equal(sealed.schema, 'seerrng-validation-broker-task/v2');
  assert.equal(
    sealed.applicationIsolationKeySha256,
    brokerApplicationIsolationKeySha256(binding())
  );
  assert.equal(sealed.adapterId, 'native-generic');
  assert.deepEqual(sealed.assignment, {
    workerId: 'worker-east',
    slotId: 'worker-east.slot-1',
    slotIndex: 1,
    slotPosition: 1,
  });
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

test('task v2 seals canonical worker slots and dependency identities', () => {
  const sealed = sealBrokerTask(
    taskInput({ dependencyTaskIds: ['task-z', 'task-a'] })
  );
  assert.deepEqual(sealed.dependencyTaskIds, ['task-a', 'task-z']);

  assert.throws(
    () =>
      sealBrokerTask(
        taskInput({
          assignment: {
            workerId: 'worker-east',
            slotId: 'worker-east.slot-2',
            slotIndex: 1,
            slotPosition: 1,
          },
        })
      ),
    /canonical slot ID/
  );
  assert.throws(
    () =>
      sealBrokerTask(taskInput({ dependencyTaskIds: ['task-a', 'task-a'] })),
    /duplicates/
  );
  assert.throws(
    () => sealBrokerTask(taskInput({ dependencyTaskIds: ['unit-task-1'] })),
    /depend on itself/
  );

  const tampered = structuredClone(sealed);
  tampered.assignment.slotPosition = 2;
  assert.throws(() => verifyBrokerTask(tampered), /seal/);

  assert.throws(
    () =>
      createBrokerMessage(
        message(
          'lease.grant',
          {
            workerId: 'worker-west',
            instanceId: 'worker-west-boot-1',
            workerSessionId: 'session-1',
            leaseId: 'lease-1',
            attempt: 1,
            maxAttempts: sealed.maxAttempts,
            expiresAtMs: 10_000,
            task: sealed,
          },
          'controller-dev'
        )
      ),
    /worker does not match the sealed task assignment/
  );
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
  assert.equal(
    evaluateConfiguredWorkerAdmission(
      workerConfig('auto'),
      registration(),
      capacity({ safeAvailableN: 0 })
    ),
    null
  );
  assert.equal(
    evaluateConfiguredWorkerAdmission(
      workerConfig(11),
      registration(),
      capacity()
    ),
    null
  );
  assert.throws(
    () =>
      resolveConfiguredWorkerN(
        workerConfig('auto'),
        registration(),
        capacity({ safeAvailableN: 0 })
      ),
    /no safely available capacity/
  );
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
  assert.equal(registrationMessage.protocolVersion, 2);
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
          protocolVersion: 3,
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
  const exactReplayKeySha256 = canonicalJsonSha256({
    schema: BROKER_REPLAY_KEY_SCHEMA,
    principalId: 'worker-east',
    sessionId: 'session-1',
    nonce: 'nonce-value-0001',
  });
  assert.equal(observed.replayKeySha256, exactReplayKeySha256);
  assert.equal(brokerReplayKeySha256(authenticated), exactReplayKeySha256);
  const unsigned = structuredClone(input);
  delete unsigned.auth.proof;
  assert.equal(brokerMessageSigningSha256(unsigned), observed.signingSha256);

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
  let futureProofChecks = 0;
  assert.throws(
    () =>
      authenticateBrokerMessage(
        message('worker.register', registration(), 'worker-east', {
          sentAtMs: 2_601,
        }),
        {
          expectedBinding: binding(),
          nowMs: 2_600,
          verifyProof: () => {
            futureProofChecks += 1;
            return true;
          },
        }
      ),
    /send time is in the future/
  );
  assert.equal(futureProofChecks, 0);
  assert.throws(
    () =>
      authenticateBrokerMessage(input, {
        expectedBinding: binding(),
        nowMs: 2_600,
        verifyProof: async () => true,
      }),
    /proof verifier must be synchronous/
  );
  assert.doesNotThrow(() =>
    authenticateBrokerMessage(
      message('worker.register', registration(), 'worker-east', {
        sentAtMs: 2_600,
      }),
      {
        expectedBinding: binding(),
        nowMs: 2_600,
        verifyProof: () => true,
      }
    )
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

test('broker replay identity is broker-global to principal, session, and nonce', () => {
  const first = createBrokerMessage(
    message('worker.register', registration(), 'worker-east')
  );
  const changedContent = createBrokerMessage(
    message(
      'worker.register',
      registration({ instanceId: 'worker-east-boot-2' }),
      'worker-east',
      { messageId: 'worker-register-changed-content' }
    )
  );
  assert.equal(
    brokerReplayKeySha256(first),
    brokerReplayKeySha256(changedContent)
  );
  assert.equal(
    brokerReplayKeySha256(first),
    brokerReplayKeySha256({
      auth: auth('worker-east', {
        keyId: 'rotated-worker-key',
        proof: 'B'.repeat(43),
        issuedAtMs: 500,
        expiresAtMs: 10_000,
      }),
    })
  );

  for (const changedAuth of [
    auth('worker-east', { sessionId: 'session-2' }),
    auth('worker-east', { nonce: 'nonce-value-0002' }),
    auth('worker-west'),
  ])
    assert.notEqual(
      brokerReplayKeySha256(first),
      brokerReplayKeySha256({ auth: changedAuth })
    );
});

test('a verifier can reject changed-content replay before authority is granted', () => {
  const reservedReplayKeys = new Set();
  const verifyProof = ({ replayKeySha256 }) => {
    if (reservedReplayKeys.has(replayKeySha256)) return false;
    reservedReplayKeys.add(replayKeySha256);
    return true;
  };
  const first = message('worker.register', registration(), 'worker-east');
  assert.doesNotThrow(() =>
    authenticateBrokerMessage(first, {
      expectedBinding: binding(),
      nowMs: first.sentAtMs,
      verifyProof,
    })
  );
  const changedContent = message(
    'worker.register',
    registration({ instanceId: 'worker-east-boot-2' }),
    'worker-east',
    { messageId: 'worker-register-replayed-content' }
  );
  assert.throws(
    () =>
      authenticateBrokerMessage(changedContent, {
        expectedBinding: binding(),
        nowMs: changedContent.sentAtMs,
        verifyProof,
      }),
    /proof was rejected/
  );
  const freshNonce = message(
    'worker.register',
    registration({ instanceId: 'worker-east-boot-2' }),
    'worker-east',
    {
      auth: auth('worker-east', { nonce: 'nonce-value-0002' }),
      messageId: 'worker-register-fresh-envelope',
    }
  );
  assert.doesNotThrow(() =>
    authenticateBrokerMessage(freshNonce, {
      expectedBinding: binding(),
      nowMs: freshNonce.sentAtMs,
      verifyProof,
    })
  );
});

test('broker authentication bounds nonce and validity-window length', () => {
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.register', registration(), 'worker-east', {
          auth: auth('worker-east', { nonce: 'n'.repeat(15) }),
        })
      ),
    /Exact authentication nonce is required/
  );
  assert.doesNotThrow(() =>
    createBrokerMessage(
      message('worker.register', registration(), 'worker-east', {
        auth: auth('worker-east', {
          nonce: 'n'.repeat(16),
          issuedAtMs: 1_000,
          expiresAtMs: 1_000 + MAX_BROKER_AUTH_WINDOW_MS,
        }),
      })
    )
  );
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.register', registration(), 'worker-east', {
          auth: auth('worker-east', { nonce: 'n'.repeat(513) }),
        })
      ),
    /Exact authentication nonce is required/
  );
  for (const invalidNonce of [
    'nonce value 0001',
    'nonce.value.0001',
    'nonce-value-é001',
  ])
    assert.throws(
      () =>
        createBrokerMessage(
          message('worker.register', registration(), 'worker-east', {
            auth: auth('worker-east', { nonce: invalidNonce }),
          })
        ),
      /Exact authentication nonce is required/
    );
  assert.doesNotThrow(() =>
    createBrokerMessage(
      message('worker.register', registration(), 'worker-east', {
        auth: auth('worker-east', { nonce: 'n'.repeat(512) }),
      })
    )
  );
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.register', registration(), 'worker-east', {
          auth: auth('worker-east', {
            issuedAtMs: 1_000,
            expiresAtMs: 1_001 + MAX_BROKER_AUTH_WINDOW_MS,
          }),
        })
      ),
    /authentication window is too long/
  );
});

test('broker messages accept exactly 32 MiB of UTF-8 and reject the next byte', () => {
  const grantWithBlob = (blob) => {
    const plannedTask = sealBrokerTask(taskInput({ payload: { blob } }));
    return message(
      'lease.grant',
      {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        leaseId: 'lease-size-boundary',
        attempt: 1,
        maxAttempts: plannedTask.maxAttempts,
        expiresAtMs: 12_000,
        task: plannedTask,
      },
      'controller-dev',
      { messageId: 'grant-envelope-size-boundary' }
    );
  };
  const minimumProof = 'A'.repeat(16);
  const emptyInput = grantWithBlob('');
  emptyInput.auth.proof = minimumProof;
  const empty = createBrokerMessage(emptyInput);
  const exactBlobLength =
    MAX_BROKER_MESSAGE_BYTES - Buffer.byteLength(JSON.stringify(empty), 'utf8');
  const exactBlob =
    'é'.repeat(Math.floor(exactBlobLength / 2)) +
    'x'.repeat(exactBlobLength % 2);
  const exactInput = grantWithBlob(exactBlob);
  exactInput.auth.proof = minimumProof;
  const exact = createBrokerMessage(exactInput);
  assert.equal(
    Buffer.byteLength(JSON.stringify(exact), 'utf8'),
    MAX_BROKER_MESSAGE_BYTES
  );
  assert.doesNotThrow(() => brokerMessageSigningSha256(exact));
  let proofChecks = 0;
  assert.doesNotThrow(() =>
    authenticateBrokerMessage(exact, {
      expectedBinding: binding(),
      nowMs: exact.sentAtMs,
      verifyProof: () => {
        proofChecks += 1;
        return true;
      },
    })
  );
  assert.equal(proofChecks, 1);
  const oversizedInput = grantWithBlob(`${exactBlob}x`);
  oversizedInput.auth.proof = minimumProof;
  assert.throws(
    () => createBrokerMessage(oversizedInput),
    /Broker message exceeds 33554432 bytes/
  );
  assert.throws(
    () =>
      authenticateBrokerMessage(oversizedInput, {
        expectedBinding: binding(),
        nowMs: oversizedInput.sentAtMs,
        verifyProof: () => {
          proofChecks += 1;
          return true;
        },
      }),
    /Broker message exceeds 33554432 bytes/
  );
  assert.equal(proofChecks, 1);
});

test('logical command identity survives a fresh authenticated envelope but rejects semantic drift', () => {
  const plannedTask = sealBrokerTask(taskInput());
  const body = {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'session-1',
    leaseId: 'lease-1',
    attempt: 1,
    maxAttempts: plannedTask.maxAttempts,
    expiresAtMs: 12_000,
    task: plannedTask,
  };
  const command = sealBrokerLogicalCommand({
    binding: binding(),
    kind: 'lease.grant',
    commandId: 'grant-unit-task-1-attempt-1',
    issuedAtMs: 2_500,
    body,
  });
  const first = createBrokerMessage(
    message('lease.grant', body, 'controller-dev', {
      messageId: 'grant-envelope-1',
      command,
      sentAtMs: 2_600,
      auth: auth('controller-dev', {
        expiresAtMs: 3_000,
        nonce: 'grant-envelope-nonce-1',
      }),
    })
  );
  const resigned = createBrokerMessage(
    message('lease.grant', body, 'controller-dev', {
      messageId: 'grant-envelope-2',
      command,
      sentAtMs: 5_000,
      auth: auth('controller-dev', {
        sessionId: 'controller-session-2',
        keyId: 'controller-key-2',
        nonce: 'grant-envelope-nonce-2',
        issuedAtMs: 4_500,
        expiresAtMs: 6_000,
      }),
    })
  );
  assert.equal(first.command.commandSha256, resigned.command.commandSha256);
  assert.notEqual(
    brokerMessageSigningSha256(first),
    brokerMessageSigningSha256(resigned)
  );

  const changedBody = { ...body, leaseId: 'lease-2' };
  assert.throws(
    () =>
      createBrokerMessage(
        message('lease.grant', changedBody, 'controller-dev', {
          messageId: 'grant-envelope-3',
          command,
          sentAtMs: 5_100,
          auth: auth('controller-dev', {
            nonce: 'grant-envelope-nonce-3',
            issuedAtMs: 4_500,
            expiresAtMs: 6_000,
          }),
        })
      ),
    /body hash does not match/
  );
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.register', registration(), 'worker-east', {
          command,
        })
      ),
    /Worker messages cannot carry logical commands/
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

  const empty = structuredClone(body);
  empty.evidence[0].bytes = 0;
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.result', empty, 'worker-east', {
          sentAtMs: 4_100,
        })
      ),
    /Evidence byte count must be a safe integer of at least 1/
  );
  const boundary = structuredClone(body);
  boundary.evidence[0].bytes = MAX_EVIDENCE_BLOB_BYTES;
  assert.equal(
    createBrokerMessage(
      message('worker.result', boundary, 'worker-east', {
        sentAtMs: 4_100,
      })
    ).body.evidence[0].bytes,
    MAX_EVIDENCE_BLOB_BYTES
  );
  const overflow = structuredClone(body);
  overflow.evidence[0].bytes = MAX_EVIDENCE_BLOB_BYTES + 1;
  assert.throws(
    () =>
      createBrokerMessage(
        message('worker.result', overflow, 'worker-east', {
          sentAtMs: 4_100,
        })
      ),
    /Evidence byte count must not exceed/
  );

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
    resultKeySha256: brokerResultKeySha256(binding(), plannedTask.taskId, 1),
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

test('cleanup evidence v2 seals pre-message content and rejects v1', () => {
  const cleanupInput = {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'session-1',
    leaseId: 'lease-1',
    taskId: 'unit-task-1',
    taskSha256: sealBrokerTask(taskInput()).taskSha256,
    bridgeSha256: h('4'),
    attempt: 1,
    cancellationRequestedAtMs: 4_000,
    completedAtMs: 4_200,
    evidenceId: 'native-cleanup',
    evidenceSchema: 'seerrng-artifact/v1',
    mediaType: 'application/json',
    bytes: 128,
    blobSha256: h('5'),
  };
  const cleanup = sealBrokerCleanupEvidence(binding(), cleanupInput);
  assert.deepEqual(verifyBrokerCleanupEvidence(binding(), cleanup), cleanup);
  assert.equal(cleanup.schema, BROKER_CLEANUP_EVIDENCE_SCHEMA);
  assert.equal(cleanup.namespaceKind, BROKER_CLEANUP_EVIDENCE_NAMESPACE_KIND);
  assert.equal(
    cleanup.applicationIsolationKeySha256,
    brokerApplicationIsolationKeySha256(binding())
  );
  const legacySchemaToken = sealBrokerCleanupEvidence(binding(), {
    ...cleanupInput,
    evidenceSchema: 'seerrng-native-cleanup-v1',
  });
  assert.equal(
    verifyBrokerCleanupEvidence(binding(), legacySchemaToken).evidenceSchema,
    'seerrng-native-cleanup-v1'
  );
  assert.throws(
    () =>
      sealBrokerCleanupEvidence(binding(), {
        ...cleanupInput,
        bytes: 0,
      }),
    /Cleanup evidence byte count must be a safe integer of at least 1/
  );
  assert.equal(
    sealBrokerCleanupEvidence(binding(), {
      ...cleanupInput,
      bytes: MAX_EVIDENCE_BLOB_BYTES,
    }).bytes,
    MAX_EVIDENCE_BLOB_BYTES
  );
  assert.throws(
    () =>
      sealBrokerCleanupEvidence(binding(), {
        ...cleanupInput,
        bytes: MAX_EVIDENCE_BLOB_BYTES + 1,
      }),
    /Cleanup evidence byte count must not exceed/
  );
  for (const evidenceSchema of [
    '/seerrng-artifact/v1',
    'seerrng-artifact/',
    'seerrng-artifact//v1',
    'seerrng-artifact/v1/extra',
    'seerrng artifact/v1',
    'seerrng-artifact/ v1',
    'seerrng-artifact/v1\n',
    'seerrng-artifact/v1\u0000',
    `${'a'.repeat(128)}/${'b'.repeat(128)}`,
  ])
    assert.throws(
      () =>
        sealBrokerCleanupEvidence(binding(), {
          ...cleanupInput,
          evidenceSchema,
        }),
      /Exact cleanup evidence content schema token is required/
    );

  const changedBlob = structuredClone(cleanup);
  changedBlob.blobSha256 = h('6');
  assert.throws(
    () => verifyBrokerCleanupEvidence(binding(), changedBlob),
    /seal does not match/
  );
  for (const [field, value] of [
    ['taskSha256', h('6')],
    ['bridgeSha256', h('7')],
  ]) {
    const changed = structuredClone(cleanup);
    changed[field] = value;
    assert.throws(
      () => verifyBrokerCleanupEvidence(binding(), changed),
      /identity is not bound|seal does not match/
    );
  }
  const changedNamespace = structuredClone(cleanup);
  changedNamespace.namespaceKind = 'evidence';
  assert.throws(
    () => verifyBrokerCleanupEvidence(binding(), changedNamespace),
    /failure namespace/
  );
  const legacy = structuredClone(cleanup);
  legacy.schema = 'seerrng-validation-broker-cleanup-evidence/v1';
  assert.throws(
    () => verifyBrokerCleanupEvidence(binding(), legacy),
    /Unsupported cleanup evidence schema/
  );
  assert.throws(
    () =>
      sealBrokerCleanupEvidence(binding(), {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'session-1',
        leaseId: 'lease-1',
        taskId: 'unit-task-1',
        taskSha256: sealBrokerTask(taskInput()).taskSha256,
        bridgeSha256: h('4'),
        attempt: 1,
        cancellationRequestedAtMs: 4_000,
        completedAtMs: 4_200,
        artifactSha256: h('5'),
      }),
    /exact field set/
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
