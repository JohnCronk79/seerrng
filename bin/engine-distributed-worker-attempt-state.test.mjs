// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  BROKER_BINDING_SCHEMA,
  brokerApplicationIsolationKeySha256,
  sealBrokerTask,
} from '../tools/validation-engine/runtime/broker-protocol.mjs';
import {
  DISTRIBUTED_WORKER_ATTEMPT_STATE_SCHEMA,
  cleanDistributedWorkerAttempt,
  createDistributedWorkerAttemptState,
  distributedWorkerAttemptIdentitySha256,
  finishDistributedWorkerAttempt,
  rehydrateDistributedWorkerAttemptState,
  requireDistributedWorkerAttemptCleanup,
  snapshotDistributedWorkerAttemptState,
  startDistributedWorkerAttempt,
  verifyDistributedWorkerAttemptState,
  verifyDistributedWorkerAttemptTransition,
} from '../tools/validation-engine/runtime/distributed-worker-attempt-state.mjs';
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function binding(overrides = {}) {
  return {
    schema: BROKER_BINDING_SCHEMA,
    controllerId: 'controller-a',
    applicationId: 'application-a',
    submissionId: 'submission-a',
    submissionSequence: 1,
    executionId: 'execution-a-1',
    runAttempt: 1,
    repositoryIdentitySha256: hash('repository-a'),
    candidateSha256: hash('candidate-a'),
    planSha256: hash('plan-a'),
    ...overrides,
  };
}

function adapters() {
  return [
    {
      adapterId: 'vitest-native',
      adapterIdentitySha256: hash('vitest-native-adapter'),
    },
    {
      adapterId: 'node-native',
      adapterIdentitySha256: hash('node-native-adapter'),
    },
  ];
}

function task(bound = binding(), overrides = {}) {
  const applicationIsolationKeySha256 =
    brokerApplicationIsolationKeySha256(bound);
  return sealBrokerTask({
    applicationIsolationKeySha256,
    taskId: 'task-node-a',
    unitId: 'unit-node',
    caseId: 'case-node-a',
    adapterId: 'node-native',
    assignment: {
      workerId: 'worker-a',
      slotId: 'worker-a.slot-2',
      slotIndex: 2,
      slotPosition: 1,
    },
    dependencyTaskIds: [],
    timeoutMs: 1_000,
    maxAttempts: 2,
    payload: {
      argv: ['--test', 'bin/example.test.mjs'],
      schema: 'seerrng-distributed-task-payload/v1',
    },
    expectedEvidence: [
      {
        evidenceId: 'native-log',
        schema: 'seerrng-native-log-v1',
        mediaType: 'text/plain',
        required: true,
      },
      {
        evidenceId: 'native-summary',
        schema: 'seerrng-native-summary-v1',
        mediaType: 'application/json',
        required: false,
      },
    ],
    ...overrides,
  });
}

function lease(overrides = {}) {
  return {
    leaseId: 'lease-a-1',
    attempt: 1,
    workerId: 'worker-a',
    machineIdentitySha256: hash('worker-a-machine'),
    instanceId: 'worker-a-boot-1',
    workerSessionId: 'worker-a-session-1',
    grantedAtMs: 100,
    expiresAtMs: 1_100,
    ...overrides,
  };
}

function creationInput(overrides = {}) {
  const bound = overrides.binding ?? binding();
  return {
    binding: bound,
    bridgeSha256: hash('bridge-a'),
    applicationIsolationKeySha256: brokerApplicationIsolationKeySha256(bound),
    task: task(bound),
    lease: lease(),
    sourceWorkspaceIdentitySha256: hash('source-workspace-a'),
    adapters: adapters().toReversed(),
    createdAtMs: 110,
    ...overrides,
  };
}

function processInput(overrides = {}) {
  return {
    pid: 8_421,
    processStartIdentitySha256: hash('pid-8421-start-marker'),
    launchIdentitySha256: hash('native-launch-a'),
    ...overrides,
  };
}

function reference(referenceId, overrides = {}) {
  const defaults = {
    'native-log': {
      schema: 'seerrng-native-log-v1',
      mediaType: 'text/plain',
    },
    'native-summary': {
      schema: 'seerrng-native-summary-v1',
      mediaType: 'application/json',
    },
  };
  return {
    referenceId,
    schema: defaults[referenceId]?.schema ?? 'seerrng-artifact/v1',
    mediaType: defaults[referenceId]?.mediaType ?? 'application/json',
    bytes: 128,
    sha256: hash(`content-${referenceId}`),
    storageIdentitySha256: hash(`storage-${referenceId}`),
    ...overrides,
  };
}

function start(state = createDistributedWorkerAttemptState(creationInput())) {
  return startDistributedWorkerAttempt(state, {
    startedAtMs: 120,
    nativeProcess: processInput(),
  });
}

function pass(state = start()) {
  return finishDistributedWorkerAttempt(state, {
    finishedAtMs: 200,
    outcome: {
      status: 'passed',
      exitCode: 0,
      completed: true,
      cancelled: false,
      timedOut: false,
    },
    evidenceReferences: [reference('native-log')],
    resultReference: reference('result'),
    failureReference: null,
  });
}

function fail(state = start()) {
  return finishDistributedWorkerAttempt(state, {
    finishedAtMs: 200,
    outcome: {
      status: 'failed',
      exitCode: 1,
      completed: true,
      cancelled: false,
      timedOut: false,
    },
    evidenceReferences: [reference('native-log')],
    resultReference: reference('result'),
    failureReference: reference('failure'),
  });
}

function reseal(value) {
  const unsigned = structuredClone(value);
  delete unsigned.stateSha256;
  return {
    ...unsigned,
    stateSha256: canonicalJsonSha256(unsigned),
  };
}

test('pending attempt identity is canonical, deterministic, sealed, and frozen', () => {
  const input = creationInput();
  const first = createDistributedWorkerAttemptState(input);
  const reordered = createDistributedWorkerAttemptState({
    ...Object.fromEntries(Object.entries(input).reverse()),
    adapters: adapters(),
  });

  assert.deepEqual(first, reordered);
  assert.equal(first.schema, DISTRIBUTED_WORKER_ATTEMPT_STATE_SCHEMA);
  assert.equal(first.status, 'pending');
  assert.equal(first.revision, 1);
  assert.equal(first.previousStateSha256, null);
  assert.deepEqual(
    first.adapters.map((entry) => entry.adapterId),
    ['node-native', 'vitest-native']
  );
  assert.equal(
    first.attemptIdentitySha256,
    distributedWorkerAttemptIdentitySha256(first)
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.task.assignment), true);
  assert.throws(() => {
    first.status = 'running';
  }, TypeError);
});

test('start and successful finish preserve identities and form a revision hash chain', () => {
  const pending = createDistributedWorkerAttemptState(creationInput());
  const running = start(pending);
  const finished = pass(running);

  assert.equal(running.status, 'running');
  assert.equal(running.revision, 2);
  assert.equal(running.previousStateSha256, pending.stateSha256);
  assert.equal(running.nativeProcess.pid, 8_421);
  assert.match(running.nativeProcess.processIdentitySha256, /^[a-f0-9]{64}$/);
  assert.equal(finished.status, 'finished');
  assert.equal(finished.revision, 3);
  assert.equal(finished.previousStateSha256, running.stateSha256);
  assert.equal(finished.attemptIdentitySha256, pending.attemptIdentitySha256);
  assert.equal(finished.nativeProcess, running.nativeProcess);
  assert.equal(finished.outcome.status, 'passed');
  assert.equal(finished.evidenceReferences[0].referenceId, 'native-log');
  assert.equal(finished.failureReference, null);
});

test('failed finish and post-finish cleanup retain result and failure evidence', () => {
  const finished = fail();
  const cleanupRequired = requireDistributedWorkerAttemptCleanup(finished, {
    requiredAtMs: 220,
    reasonCode: 'release-attempt-workspace',
    failureReference: null,
  });
  const cleaned = cleanDistributedWorkerAttempt(cleanupRequired, {
    cleanedAtMs: 240,
    evidenceReference: reference('cleanup'),
  });

  assert.equal(cleanupRequired.status, 'cleanup-required');
  assert.equal(cleanupRequired.cleanup.originStatus, 'finished');
  assert.equal(cleanupRequired.failureReference.referenceId, 'failure');
  assert.equal(cleaned.status, 'cleaned');
  assert.equal(cleaned.revision, 5);
  assert.equal(cleaned.previousStateSha256, cleanupRequired.stateSha256);
  assert.equal(cleaned.cleanup.evidenceReference.referenceId, 'cleanup');
  assert.equal(cleaned.resultReference.referenceId, 'result');
});

test('pending and running attempts can require cleanup without inventing completion', () => {
  const pending = createDistributedWorkerAttemptState(creationInput());
  const pendingCleanup = requireDistributedWorkerAttemptCleanup(pending, {
    requiredAtMs: 130,
    reasonCode: 'lease-revoked-before-launch',
    failureReference: reference('failure-pending'),
  });
  const pendingCleaned = cleanDistributedWorkerAttempt(pendingCleanup, {
    cleanedAtMs: 140,
    evidenceReference: reference('cleanup-pending'),
  });
  assert.equal(pendingCleaned.cleanup.originStatus, 'pending');
  assert.equal(pendingCleaned.nativeProcess, null);
  assert.equal(pendingCleaned.outcome, null);
  assert.equal(pendingCleaned.failureReference.referenceId, 'failure-pending');

  const running = start();
  const runningCleanup = requireDistributedWorkerAttemptCleanup(running, {
    requiredAtMs: 180,
    reasonCode: 'native-process-aborted',
    failureReference: reference('failure-running'),
  });
  assert.equal(runningCleanup.cleanup.originStatus, 'running');
  assert.equal(
    runningCleanup.nativeProcess.processIdentitySha256,
    running.nativeProcess.processIdentitySha256
  );
  assert.equal(runningCleanup.finishedAtMs, null);
});

test('rehydration requires the trusted hash and can bind every external identity', () => {
  const finished = pass();
  const persisted = JSON.parse(
    JSON.stringify(snapshotDistributedWorkerAttemptState(finished))
  );
  const restored = rehydrateDistributedWorkerAttemptState(persisted, {
    expectedStateSha256: finished.stateSha256,
    expectedAttemptIdentitySha256: finished.attemptIdentitySha256,
    expectedBridgeSha256: finished.bridgeSha256,
    expectedBinding: finished.binding,
    expectedApplicationIsolationKeySha256:
      finished.applicationIsolationKeySha256,
    expectedTaskSha256: finished.task.taskSha256,
    expectedLeaseId: finished.lease.leaseId,
    expectedMachineIdentitySha256: finished.lease.machineIdentitySha256,
    expectedAttempt: finished.lease.attempt,
    expectedWorkerId: finished.lease.workerId,
    expectedInstanceId: finished.lease.instanceId,
    expectedWorkerSessionId: finished.lease.workerSessionId,
    expectedSlotId: finished.task.assignment.slotId,
    expectedSourceWorkspaceIdentitySha256:
      finished.sourceWorkspaceIdentitySha256,
  });

  assert.deepEqual(restored, finished);
  assert.equal(Object.isFrozen(restored), true);
  assert.throws(
    () =>
      rehydrateDistributedWorkerAttemptState(persisted, {
        expectedStateSha256: hash('wrong-trusted-state'),
      }),
    /trusted hash/
  );
  assert.throws(
    () => verifyDistributedWorkerAttemptState(persisted),
    /expected worker attempt state hash/
  );
  assert.throws(
    () =>
      rehydrateDistributedWorkerAttemptState(persisted, {
        expectedStateSha256: finished.stateSha256,
        expectedWorkerId: 'worker-b',
      }),
    /expected worker ID/
  );
  assert.throws(
    () =>
      rehydrateDistributedWorkerAttemptState(persisted, {
        expectedStateSha256: finished.stateSha256,
        unexpectedExpectation: true,
      }),
    /unknown field/
  );
});

test('persisted revisions verify their exact predecessor and legal transition', () => {
  const pending = createDistributedWorkerAttemptState(creationInput());
  const running = start(pending);
  const restoredPending = rehydrateDistributedWorkerAttemptState(
    JSON.parse(JSON.stringify(pending)),
    { expectedStateSha256: pending.stateSha256 }
  );
  const restoredRunning = verifyDistributedWorkerAttemptTransition(
    restoredPending,
    JSON.parse(JSON.stringify(running)),
    { expectedStateSha256: running.stateSha256 }
  );
  assert.deepEqual(restoredRunning, running);

  const alternateRunning = startDistributedWorkerAttempt(pending, {
    startedAtMs: 120,
    nativeProcess: processInput({
      pid: 8_422,
      processStartIdentitySha256: hash('pid-8422-start-marker'),
    }),
  });
  const alternateCleanup = requireDistributedWorkerAttemptCleanup(
    alternateRunning,
    {
      requiredAtMs: 180,
      reasonCode: 'native-process-aborted',
      failureReference: null,
    }
  );
  const forgedPredecessor = structuredClone(alternateCleanup);
  forgedPredecessor.previousStateSha256 = running.stateSha256;
  const resealedForgedPredecessor = reseal(forgedPredecessor);
  assert.doesNotThrow(() =>
    rehydrateDistributedWorkerAttemptState(resealedForgedPredecessor, {
      expectedStateSha256: resealedForgedPredecessor.stateSha256,
    })
  );
  assert.throws(
    () =>
      verifyDistributedWorkerAttemptTransition(
        running,
        resealedForgedPredecessor,
        { expectedStateSha256: resealedForgedPredecessor.stateSha256 }
      ),
    /does not match its legal transition/
  );
});

test('trusted hash and internal seals reject outer and nested tampering', () => {
  const running = start();
  const outerTamper = structuredClone(running);
  outerTamper.status = 'finished';
  assert.throws(
    () =>
      rehydrateDistributedWorkerAttemptState(outerTamper, {
        expectedStateSha256: running.stateSha256,
      }),
    /seal does not match/
  );

  const forgedOuterSeal = reseal(outerTamper);
  assert.throws(
    () =>
      rehydrateDistributedWorkerAttemptState(forgedOuterSeal, {
        expectedStateSha256: running.stateSha256,
      }),
    /trusted hash/
  );

  const processTamper = structuredClone(running);
  processTamper.nativeProcess.pid += 1;
  const resealedProcessTamper = reseal(processTamper);
  assert.throws(
    () =>
      rehydrateDistributedWorkerAttemptState(resealedProcessTamper, {
        expectedStateSha256: resealedProcessTamper.stateSha256,
      }),
    /Native process identity seal/
  );

  const taskTamper = structuredClone(running);
  taskTamper.task.payload.argv.push('--forged');
  const resealedTaskTamper = reseal(taskTamper);
  assert.throws(
    () =>
      rehydrateDistributedWorkerAttemptState(resealedTaskTamper, {
        expectedStateSha256: resealedTaskTamper.stateSha256,
      }),
    /task payload hash/
  );

  const extraField = structuredClone(running);
  extraField.untrusted = true;
  const resealedExtraField = reseal(extraField);
  assert.throws(
    () =>
      rehydrateDistributedWorkerAttemptState(resealedExtraField, {
        expectedStateSha256: resealedExtraField.stateSha256,
      }),
    /exact field set/
  );

  const revisionTamper = structuredClone(running);
  revisionTamper.revision = 9;
  revisionTamper.previousStateSha256 = hash('forged-previous-state');
  const resealedRevisionTamper = reseal(revisionTamper);
  assert.throws(
    () =>
      rehydrateDistributedWorkerAttemptState(resealedRevisionTamper, {
        expectedStateSha256: resealedRevisionTamper.stateSha256,
      }),
    /revision contradicts its lifecycle/
  );
});

test('illegal lifecycle transitions and nonmonotonic times fail closed', () => {
  const pending = createDistributedWorkerAttemptState(creationInput());
  const running = start(pending);
  const finished = pass(running);
  const cleanupRequired = requireDistributedWorkerAttemptCleanup(running, {
    requiredAtMs: 180,
    reasonCode: 'cancelled',
    failureReference: null,
  });

  assert.throws(() => start(running), /Only a pending/);
  assert.throws(() => pass(pending), /Only a running/);
  assert.throws(
    () =>
      startDistributedWorkerAttempt(pending, {
        startedAtMs: 1_100,
        nativeProcess: processInput(),
      }),
    /outside its active lease/
  );
  assert.throws(
    () =>
      finishDistributedWorkerAttempt(running, {
        finishedAtMs: 119,
        outcome: {
          status: 'passed',
          exitCode: 0,
          completed: true,
          cancelled: false,
          timedOut: false,
        },
        evidenceReferences: [reference('native-log')],
        resultReference: reference('result'),
        failureReference: null,
      }),
    /outside its active lease/
  );
  assert.throws(
    () =>
      requireDistributedWorkerAttemptCleanup(finished, {
        requiredAtMs: 199,
        reasonCode: 'too-early',
        failureReference: null,
      }),
    /before the current attempt state/
  );
  assert.throws(
    () =>
      cleanDistributedWorkerAttempt(cleanupRequired, {
        cleanedAtMs: 179,
        evidenceReference: reference('cleanup'),
      }),
    /before it was required/
  );
  assert.throws(
    () =>
      requireDistributedWorkerAttemptCleanup(cleanupRequired, {
        requiredAtMs: 190,
        reasonCode: 'again',
        failureReference: null,
      }),
    /Only a pending, running, or finished/
  );
  assert.throws(
    () =>
      cleanDistributedWorkerAttempt(finished, {
        cleanedAtMs: 220,
        evidenceReference: reference('cleanup'),
      }),
    /Only a cleanup-required/
  );
});

test('creation rejects crossed application, worker, adapter, attempt, and lease identities', () => {
  const input = creationInput();
  assert.throws(
    () =>
      createDistributedWorkerAttemptState({
        ...input,
        applicationIsolationKeySha256: hash('another-application'),
      }),
    /isolation boundary/
  );
  assert.throws(
    () =>
      createDistributedWorkerAttemptState({
        ...input,
        lease: lease({ workerId: 'worker-b' }),
      }),
    /task and lease identities/
  );
  assert.throws(
    () =>
      createDistributedWorkerAttemptState({
        ...input,
        adapters: [adapters()[0]],
      }),
    /lacks its task native adapter/
  );
  assert.throws(
    () =>
      createDistributedWorkerAttemptState({
        ...input,
        lease: lease({ attempt: 3 }),
      }),
    /task and lease identities/
  );
  assert.throws(
    () =>
      createDistributedWorkerAttemptState({
        ...input,
        lease: lease({ expiresAtMs: 1_101 }),
      }),
    /task and lease identities/
  );
  assert.throws(
    () =>
      createDistributedWorkerAttemptState({
        ...input,
        unexpected: true,
      }),
    /exact field set/
  );
});

test('finish rejects incomplete, contradictory, aliased, or drifted evidence', () => {
  const running = start();
  const passedOutcome = {
    status: 'passed',
    exitCode: 0,
    completed: true,
    cancelled: false,
    timedOut: false,
  };
  assert.throws(
    () =>
      finishDistributedWorkerAttempt(running, {
        finishedAtMs: 200,
        outcome: passedOutcome,
        evidenceReferences: [],
        resultReference: reference('result'),
        failureReference: null,
      }),
    /missing required evidence/
  );
  assert.throws(
    () =>
      finishDistributedWorkerAttempt(running, {
        finishedAtMs: 200,
        outcome: passedOutcome,
        evidenceReferences: [
          reference('native-log', { schema: 'wrong-schema/v1' }),
        ],
        resultReference: reference('result'),
        failureReference: null,
      }),
    /evidence contract drifted/
  );
  assert.throws(
    () =>
      finishDistributedWorkerAttempt(running, {
        finishedAtMs: 200,
        outcome: passedOutcome,
        evidenceReferences: [reference('native-log')],
        resultReference: reference('result'),
        failureReference: reference('failure'),
      }),
    /contradicts its outcome/
  );
  assert.throws(
    () =>
      finishDistributedWorkerAttempt(running, {
        finishedAtMs: 200,
        outcome: {
          status: 'failed',
          exitCode: 1,
          completed: true,
          cancelled: false,
          timedOut: false,
        },
        evidenceReferences: [reference('native-log')],
        resultReference: reference('result'),
        failureReference: null,
      }),
    /contradicts its outcome/
  );
  assert.throws(
    () =>
      finishDistributedWorkerAttempt(running, {
        finishedAtMs: 200,
        outcome: passedOutcome,
        evidenceReferences: [reference('native-log')],
        resultReference: reference('result', {
          storageIdentitySha256: hash('storage-native-log'),
        }),
        failureReference: null,
      }),
    /must not alias storage/
  );
  assert.throws(
    () =>
      finishDistributedWorkerAttempt(running, {
        finishedAtMs: 200,
        outcome: passedOutcome,
        evidenceReferences: [reference('native-log')],
        resultReference: reference('native-log', {
          storageIdentitySha256: hash('storage-result-distinct'),
        }),
        failureReference: null,
      }),
    /reference IDs must be exact-once/
  );
  assert.throws(
    () =>
      finishDistributedWorkerAttempt(running, {
        finishedAtMs: 200,
        outcome: passedOutcome,
        evidenceReferences: [reference('native-log', { bytes: 0 })],
        resultReference: reference('result'),
        failureReference: null,
      }),
    /byte count must be a safe integer from 1/
  );
});

test('untrusted lookalike states cannot enter the transition API', () => {
  const pending = createDistributedWorkerAttemptState(creationInput());
  const lookalike = structuredClone(pending);
  assert.throws(
    () =>
      startDistributedWorkerAttempt(lookalike, {
        startedAtMs: 120,
        nativeProcess: processInput(),
      }),
    /not created or rehydrated/
  );
});
