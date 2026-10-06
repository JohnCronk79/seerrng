import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_BROKER_MESSAGE_BYTES,
  authenticateBrokerMessage,
  brokerApplicationIsolationKeySha256,
  createBrokerMessage,
  sealBrokerLogicalCommand,
  sealBrokerTask,
} from '../tools/validation-engine/runtime/broker-protocol.mjs';
import {
  DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_SCHEMA,
  DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_HEADROOM_BYTES,
  MAX_DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_BYTES,
  createDistributedControllerDispatchIntent,
  distributedControllerDispatchIntentFromAuthenticatedMessage,
  verifyDistributedControllerDispatchIntent,
} from '../tools/validation-engine/runtime/distributed-controller-dispatch-intent.mjs';

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

function task({ taskBinding = binding(), payload = null } = {}) {
  return sealBrokerTask({
    applicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(taskBinding),
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
    payload: payload ?? { selection: { files: ['src/example.test.ts'] } },
    expectedEvidence: [
      {
        evidenceId: 'native-result',
        schema: 'native-result-v1',
        mediaType: 'application/json',
        required: true,
      },
    ],
  });
}

function bodyFor(kind) {
  const common = {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'worker-session-1',
  };
  if (kind === 'lease.grant')
    return {
      ...common,
      leaseId: 'lease-1',
      attempt: 1,
      maxAttempts: 2,
      expiresAtMs: 50_000,
      task: task(),
    };
  if (kind === 'lease.renew')
    return {
      ...common,
      leaseId: 'lease-1',
      taskId: 'unit-task-1',
      attempt: 1,
      expiresAtMs: 55_000,
    };
  if (kind === 'lease.cancel')
    return {
      ...common,
      leaseId: 'lease-1',
      taskId: 'unit-task-1',
      attempt: 1,
      requestedAtMs: 4_000,
      mode: 'abort-attempt',
      reasonCode: 'operator-cancelled',
    };
  if (kind === 'result.ack')
    return {
      applicationIsolationKeySha256:
        brokerApplicationIsolationKeySha256(binding()),
      ...common,
      taskId: 'unit-task-1',
      resultKeySha256: h('c'),
      submissionSha256: h('d'),
      acceptedAtMs: 4_000,
      disposition: 'accepted',
    };
  throw new Error(`Unsupported test kind: ${kind}`);
}

function sources(kind = 'lease.grant') {
  const exactBinding = binding();
  const body = bodyFor(kind);
  const command = sealBrokerLogicalCommand({
    binding: exactBinding,
    kind,
    commandId: `${kind.replaceAll('.', '-')}-command-1`,
    issuedAtMs: 2_000,
    body,
  });
  return { binding: exactBinding, kind, command, body };
}

function envelope(source, overrides = {}) {
  const sentAtMs = overrides.sentAtMs ?? 2_500;
  const message = createBrokerMessage({
    schema: 'seerrng-validation-broker-message/v2',
    protocolVersion: 2,
    messageId: overrides.messageId ?? 'lease-grant-envelope-1',
    kind: source.kind,
    sentAtMs,
    binding: source.binding,
    auth: {
      algorithm: 'hmac-sha256',
      sessionId: overrides.sessionId ?? 'controller-session-1',
      principalId: 'controller-dev',
      keyId: 'controller-key-1',
      nonce: overrides.nonce ?? 'controller-nonce-0001',
      issuedAtMs: overrides.issuedAtMs ?? 1_000,
      expiresAtMs: overrides.expiresAtMs ?? 20_000,
      proof: overrides.proof ?? 'A'.repeat(43),
    },
    command: source.command,
    body: source.body,
  });
  return authenticateBrokerMessage(message, {
    expectedBinding: source.binding,
    nowMs: sentAtMs,
    verifyProof: () => true,
  });
}

function expectations(intent) {
  return {
    expectedBinding: intent.binding,
    expectedCommandSha256: intent.command.commandSha256,
    expectedWorkerId: intent.targetWorkerId,
  };
}

test('controller dispatch intents cover only worker-directed commands', () => {
  for (const kind of [
    'lease.grant',
    'lease.renew',
    'lease.cancel',
    'result.ack',
  ]) {
    const intent = createDistributedControllerDispatchIntent(sources(kind));
    assert.equal(intent.schema, DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_SCHEMA);
    assert.equal(intent.kind, kind);
    assert.equal(intent.targetWorkerId, 'worker-east');
    assert.equal(
      intent.applicationIsolationKeySha256,
      brokerApplicationIsolationKeySha256(binding())
    );
    assert.deepEqual(
      Object.keys(intent).toSorted(),
      [
        'applicationIsolationKeySha256',
        'binding',
        'body',
        'command',
        'intentSha256',
        'kind',
        'schema',
        'targetWorkerId',
      ].toSorted()
    );
    assert.deepEqual(
      verifyDistributedControllerDispatchIntent(intent, expectations(intent)),
      intent
    );
    assert.equal(Object.isFrozen(intent.body), true);
  }

  for (const kind of ['lease.cleanup-recover', 'worker.result'])
    assert.throws(
      () =>
        createDistributedControllerDispatchIntent({
          binding: binding(),
          kind,
          command: null,
          body: { workerId: 'worker-east' },
        }),
      /supported controller-to-worker command/
    );
});

test('dispatch intent is stable across fresh authenticated envelopes', () => {
  const source = sources();
  const first = envelope(source);
  const second = envelope(source, {
    messageId: 'lease-grant-envelope-2',
    sessionId: 'controller-session-2',
    nonce: 'controller-nonce-0002',
    issuedAtMs: 3_000,
    sentAtMs: 3_500,
    proof: 'B'.repeat(43),
  });
  const firstIntent =
    distributedControllerDispatchIntentFromAuthenticatedMessage(first);
  const secondIntent =
    distributedControllerDispatchIntentFromAuthenticatedMessage(second);
  assert.deepEqual(secondIntent, firstIntent);
  for (const forbidden of [
    'auth',
    'messageId',
    'protocolVersion',
    'sentAtMs',
  ])
    assert.equal(Object.hasOwn(firstIntent, forbidden), false);
});

test('authenticated conversion rejects untrusted and worker-originated messages', () => {
  const source = sources();
  const unsigned = createBrokerMessage({
    schema: 'seerrng-validation-broker-message/v2',
    protocolVersion: 2,
    messageId: 'lease-grant-envelope-untrusted',
    kind: source.kind,
    sentAtMs: 2_500,
    binding: source.binding,
    auth: {
      algorithm: 'hmac-sha256',
      sessionId: 'controller-session-1',
      principalId: 'controller-dev',
      keyId: 'controller-key-1',
      nonce: 'controller-nonce-0003',
      issuedAtMs: 1_000,
      expiresAtMs: 20_000,
      proof: 'A'.repeat(43),
    },
    command: source.command,
    body: source.body,
  });
  assert.throws(
    () => distributedControllerDispatchIntentFromAuthenticatedMessage(unsigned),
    /has not passed authentication/
  );

  const workerMessage = authenticateBrokerMessage(
    createBrokerMessage({
      schema: 'seerrng-validation-broker-message/v2',
      protocolVersion: 2,
      messageId: 'worker-heartbeat-1',
      kind: 'worker.heartbeat',
      sentAtMs: 2_500,
      binding: binding(),
      auth: {
        algorithm: 'hmac-sha256',
        sessionId: 'worker-session-1',
        principalId: 'worker-east',
        keyId: 'worker-key-1',
        nonce: 'worker-nonce-000001',
        issuedAtMs: 1_000,
        expiresAtMs: 20_000,
        proof: 'A'.repeat(43),
      },
      command: null,
      body: {
        workerId: 'worker-east',
        instanceId: 'worker-east-boot-1',
        workerSessionId: 'worker-session-1',
        observedAtMs: 2_000,
        capacitySequence: 1,
        activeLeases: [],
      },
    }),
    { expectedBinding: binding(), nowMs: 2_500, verifyProof: () => true }
  );
  assert.throws(
    () =>
      distributedControllerDispatchIntentFromAuthenticatedMessage(workerMessage),
    /supported controller-to-worker command/
  );
});

test('dispatch-intent verification rejects identity and content drift', () => {
  const intent = createDistributedControllerDispatchIntent(sources());
  const verify = (value, expected = expectations(intent)) =>
    verifyDistributedControllerDispatchIntent(value, expected);

  for (const mutate of [
    (value) => {
      value.applicationIsolationKeySha256 = h('f');
    },
    (value) => {
      value.targetWorkerId = 'worker-west';
    },
    (value) => {
      value.body.expiresAtMs += 1;
    },
    (value) => {
      value.command.commandSha256 = h('f');
    },
    (value) => {
      value.binding.candidateSha256 = h('f');
    },
    (value) => {
      value.intentSha256 = h('f');
    },
    (value) => {
      value.auth = {};
    },
  ]) {
    const changed = structuredClone(intent);
    mutate(changed);
    assert.throws(() => verify(changed));
  }

  assert.throws(
    () =>
      verify(intent, {
        ...expectations(intent),
        expectedBinding: binding({ executionId: 'other-execution' }),
      }),
    /unexpected binding/
  );
  assert.throws(
    () =>
      verify(intent, {
        ...expectations(intent),
        expectedCommandSha256: h('f'),
      }),
    /unexpected command/
  );
  assert.throws(
    () =>
      verify(intent, {
        ...expectations(intent),
        expectedWorkerId: 'worker-west',
      }),
    /unexpected target worker/
  );
});

test('lease-grant task cannot cross the dispatch-intent binding', () => {
  const exactBinding = binding();
  const body = {
    workerId: 'worker-east',
    instanceId: 'worker-east-boot-1',
    workerSessionId: 'worker-session-1',
    leaseId: 'lease-foreign-task',
    attempt: 1,
    maxAttempts: 2,
    expiresAtMs: 50_000,
    task: task({
      taskBinding: binding({ executionId: 'other-validation-run' }),
    }),
  };
  const command = sealBrokerLogicalCommand({
    binding: exactBinding,
    kind: 'lease.grant',
    commandId: 'lease-grant-foreign-task-command',
    issuedAtMs: 2_000,
    body,
  });
  assert.throws(
    () =>
      createDistributedControllerDispatchIntent({
        binding: exactBinding,
        kind: 'lease.grant',
        command,
        body,
      }),
    /lease task crossed an application isolation boundary/
  );
});

test('dispatch-intent byte cap reserves exact multibyte envelope headroom', () => {
  assert.equal(
    MAX_BROKER_MESSAGE_BYTES -
      MAX_DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_BYTES,
    DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_HEADROOM_BYTES
  );
  assert.equal(
    DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_HEADROOM_BYTES,
    64 * 1024
  );

  const sourcesWithBlob = (blob) => {
    const exactBinding = binding();
    const plannedTask = task({ payload: { blob } });
    const body = {
      workerId: 'worker-east',
      instanceId: 'worker-east-boot-1',
      workerSessionId: 'worker-session-1',
      leaseId: 'lease-size-boundary',
      attempt: 1,
      maxAttempts: plannedTask.maxAttempts,
      expiresAtMs: 50_000,
      task: plannedTask,
    };
    return {
      binding: exactBinding,
      kind: 'lease.grant',
      command: sealBrokerLogicalCommand({
        binding: exactBinding,
        kind: 'lease.grant',
        commandId: 'lease-grant-size-boundary-command',
        issuedAtMs: 2_000,
        body,
      }),
      body,
    };
  };

  const empty = createDistributedControllerDispatchIntent(sourcesWithBlob(''));
  const remainingBytes =
    MAX_DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_BYTES -
    Buffer.byteLength(JSON.stringify(empty), 'utf8');
  assert.ok(remainingBytes > 2);
  const exactBlob =
    'é'.repeat(Math.floor(remainingBytes / 2)) +
    (remainingBytes % 2 === 0 ? '' : 'x');
  const exact = createDistributedControllerDispatchIntent(
    sourcesWithBlob(exactBlob)
  );
  assert.equal(
    Buffer.byteLength(JSON.stringify(exact), 'utf8'),
    MAX_DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_BYTES
  );
  assert.throws(
    () =>
      createDistributedControllerDispatchIntent(
        sourcesWithBlob(`${exactBlob}x`)
      ),
    new RegExp(
      `Sealed controller dispatch intent exceeds ${MAX_DISTRIBUTED_CONTROLLER_DISPATCH_INTENT_BYTES} bytes`
    )
  );
});
