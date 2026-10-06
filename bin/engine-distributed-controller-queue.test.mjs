// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  DISTRIBUTED_APP_SUBMISSION_SCHEMA,
  DISTRIBUTED_CLEANUP_PROOF_SCHEMA,
  DISTRIBUTED_TERMINAL_RECONCILIATION_SCHEMA,
  advanceDistributedControllerQueue,
  createDistributedControllerQueue,
  distributedApplicationIsolationKeySha256,
  enqueueDistributedApp,
  recordDistributedCleanupProof,
  recordDistributedTerminalReconciliation,
  rehydrateDistributedControllerQueue,
  sealDistributedAppSubmission,
  sealDistributedCleanupProof,
  sealDistributedTerminalReconciliation,
  snapshotDistributedControllerQueue,
  startNextDistributedApp,
  verifyDistributedAppSubmission,
} from '../tools/validation-engine/runtime/distributed-controller-queue.mjs';

const controllerId = 'controller-a';
const acceptAuthentication = () => true;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function submissionInput(name) {
  return {
    schema: DISTRIBUTED_APP_SUBMISSION_SCHEMA,
    controllerId,
    submissionId: `submission-${name}`,
    applicationId: `application-${name}`,
    testSuiteId: `suite-${name}`,
    repositoryIdentitySha256: sha256(`repository-${name}`),
    revisionIdentitySha256: sha256(`revision-${name}`),
    inventoryIdentitySha256: sha256(`inventory-${name}`),
    adapterId: 'node-native',
    adapterIdentitySha256: sha256(`adapter-${name}`),
    profileIdentitySha256: sha256(`profile-${name}`),
    cacheIdentitySha256: sha256(`cache-${name}`),
    evidenceIdentitySha256: sha256(`evidence-${name}`),
    resultsIdentitySha256: sha256(`results-${name}`),
    failureIdentitySha256: sha256(`failure-${name}`),
    planSha256: sha256(`plan-${name}`),
  };
}

function authentication(label, issuedAtMs = 10, expiresAtMs = 10_000) {
  return {
    algorithm: 'ed25519',
    sessionId: `session-${label}`,
    principalId: controllerId,
    keyId: 'controller-key-1',
    nonce: `nonce-${label}-0000000000`,
    issuedAtMs,
    expiresAtMs,
    proof: `detached-proof-${label}-0000000000`,
  };
}

function activeRecord(queue) {
  return queue.submissions.find(
    (entry) => entry.submission.submissionId === queue.activeSubmissionId
  );
}

function terminalFor(queue, { status = 'passed', completedAtMs = 20 } = {}) {
  const active = activeRecord(queue);
  return sealDistributedTerminalReconciliation({
    schema: DISTRIBUTED_TERMINAL_RECONCILIATION_SCHEMA,
    controllerId,
    submissionId: active.submission.submissionId,
    submissionSha256: active.submission.submissionSha256,
    applicationIsolationKeySha256: active.applicationIsolationKeySha256,
    executionId: active.executionId,
    reconciliationInputSha256: sha256(
      `reconciliation-${active.submission.submissionId}`
    ),
    status,
    resultSha256: sha256(`result-${active.submission.submissionId}`),
    failureSha256:
      status === 'failed'
        ? sha256(`failure-result-${active.submission.submissionId}`)
        : null,
    completedAtMs,
    auth: authentication(`terminal-${active.submission.submissionId}`),
  });
}

function cleanupFor(queue, completedAtMs = 30) {
  const active = activeRecord(queue);
  return sealDistributedCleanupProof({
    schema: DISTRIBUTED_CLEANUP_PROOF_SCHEMA,
    controllerId,
    submissionId: active.submission.submissionId,
    submissionSha256: active.submission.submissionSha256,
    applicationIsolationKeySha256: active.applicationIsolationKeySha256,
    executionId: active.executionId,
    terminalReconciliationSha256:
      active.terminalReconciliation.terminalReconciliationSha256,
    cleanupInventorySha256: sha256(
      `cleanup-${active.submission.submissionId}`
    ),
    completedAtMs,
    auth: authentication(`cleanup-${active.submission.submissionId}`),
  });
}

function finishActive(queue, { status = 'passed', offset = 0 } = {}) {
  const terminal = terminalFor(queue, {
    status,
    completedAtMs: 20 + offset,
  });
  const reconciled = recordDistributedTerminalReconciliation(queue, terminal, {
    verifyAuthentication: acceptAuthentication,
  });
  const cleaned = recordDistributedCleanupProof(
    reconciled,
    cleanupFor(reconciled, 30 + offset),
    { verifyAuthentication: acceptAuthentication }
  );
  return advanceDistributedControllerQueue(cleaned, {
    finalizedAtMs: 40 + offset,
  });
}

test('submission identities are exact, deterministic, sealed, and isolated', () => {
  const input = submissionInput('alpha');
  const first = sealDistributedAppSubmission(input);
  const reordered = sealDistributedAppSubmission(
    Object.fromEntries(Object.entries(input).reverse())
  );

  assert.deepEqual(first, reordered);
  assert.deepEqual(verifyDistributedAppSubmission(first), first);
  assert.match(first.workKeySha256, /^[a-f0-9]{64}$/);
  assert.match(first.submissionSha256, /^[a-f0-9]{64}$/);
  assert.match(
    distributedApplicationIsolationKeySha256(first),
    /^[a-f0-9]{64}$/
  );

  assert.throws(
    () => sealDistributedAppSubmission({ ...input, unexpected: true }),
    /exact field set/
  );
  assert.throws(
    () =>
      sealDistributedAppSubmission({
        ...input,
        failureIdentitySha256: input.resultsIdentitySha256,
      }),
    /namespaces must be distinct/
  );

  const tampered = structuredClone(first);
  tampered.planSha256 = sha256('different-plan');
  assert.throws(
    () => verifyDistributedAppSubmission(tampered),
    /work identity|seal/
  );
});

test('queue is bounded, rejects semantic duplicates, and starts one app only', () => {
  const alpha = sealDistributedAppSubmission(submissionInput('alpha'));
  const beta = sealDistributedAppSubmission(submissionInput('beta'));
  let queue = createDistributedControllerQueue({
    controllerId,
    maxSubmissions: 2,
  });
  queue = enqueueDistributedApp(queue, alpha);

  assert.throws(
    () => enqueueDistributedApp(queue, alpha),
    /Duplicate distributed app submission/
  );
  const alias = sealDistributedAppSubmission({
    ...submissionInput('alpha'),
    submissionId: 'submission-alpha-alias',
  });
  assert.throws(
    () => enqueueDistributedApp(queue, alias),
    /Duplicate distributed app submission/
  );

  queue = enqueueDistributedApp(queue, beta);
  assert.throws(
    () =>
      enqueueDistributedApp(
        queue,
        sealDistributedAppSubmission(submissionInput('gamma'))
      ),
    /queue is full/
  );

  queue = startNextDistributedApp(queue, {
    executionId: 'execution-alpha',
    startedAtMs: 11,
  });
  assert.equal(queue.activeSubmissionId, alpha.submissionId);
  assert.equal(queue.submissions[0].status, 'running');
  assert.equal(queue.submissions[1].status, 'queued');
  assert.throws(
    () =>
      startNextDistributedApp(queue, {
        executionId: 'execution-beta',
        startedAtMs: 12,
      }),
    /interleaving is forbidden/
  );
});

test('queue advances serially only after authenticated terminal and cleanup proofs', () => {
  const alpha = sealDistributedAppSubmission(submissionInput('alpha'));
  const beta = sealDistributedAppSubmission(submissionInput('beta'));
  let queue = createDistributedControllerQueue({ controllerId });
  queue = enqueueDistributedApp(queue, alpha);
  queue = enqueueDistributedApp(queue, beta);
  queue = startNextDistributedApp(queue, {
    executionId: 'execution-alpha',
    startedAtMs: 11,
  });
  const terminal = terminalFor(queue);

  assert.throws(
    () =>
      recordDistributedTerminalReconciliation(queue, terminal, {
        verifyAuthentication: () => false,
      }),
    /authentication proof was rejected/
  );
  queue = recordDistributedTerminalReconciliation(queue, terminal, {
    verifyAuthentication: acceptAuthentication,
  });
  assert.equal(activeRecord(queue).status, 'awaiting-cleanup');
  assert.throws(
    () => advanceDistributedControllerQueue(queue, { finalizedAtMs: 30 }),
    /before terminal reconciliation and cleanup proof/
  );

  queue = recordDistributedCleanupProof(queue, cleanupFor(queue), {
    verifyAuthentication: acceptAuthentication,
  });
  assert.equal(activeRecord(queue).status, 'ready-to-advance');
  queue = advanceDistributedControllerQueue(queue, { finalizedAtMs: 40 });
  assert.equal(queue.activeSubmissionId, null);
  assert.equal(queue.submissions[0].status, 'passed');
  assert.ok(queue.submissions[0].terminalReconciliation);
  assert.ok(queue.submissions[0].cleanupProof);

  queue = startNextDistributedApp(queue, {
    executionId: 'execution-beta',
    startedAtMs: 41,
  });
  assert.equal(queue.activeSubmissionId, beta.submissionId);
  assert.equal(queue.submissions[0].status, 'passed');
  assert.equal(queue.submissions[1].status, 'running');
});

test('proofs cannot cross an app or execution isolation boundary', () => {
  const alpha = sealDistributedAppSubmission(submissionInput('alpha'));
  const beta = sealDistributedAppSubmission(submissionInput('beta'));
  let queue = createDistributedControllerQueue({ controllerId });
  queue = enqueueDistributedApp(queue, alpha);
  queue = enqueueDistributedApp(queue, beta);
  queue = startNextDistributedApp(queue, {
    executionId: 'execution-alpha',
    startedAtMs: 11,
  });

  const terminalInput = terminalFor(queue);
  const crossed = sealDistributedTerminalReconciliation({
    ...Object.fromEntries(
      Object.entries(terminalInput).filter(
        ([key]) => key !== 'terminalReconciliationSha256'
      )
    ),
    submissionId: beta.submissionId,
    submissionSha256: beta.submissionSha256,
    applicationIsolationKeySha256:
      distributedApplicationIsolationKeySha256(beta),
  });
  assert.throws(
    () =>
      recordDistributedTerminalReconciliation(queue, crossed, {
        verifyAuthentication: acceptAuthentication,
      }),
    /not bound to the active app/
  );
});

test('failed result is retained and default policy stops pending work', () => {
  let queue = createDistributedControllerQueue({ controllerId });
  queue = enqueueDistributedApp(
    queue,
    sealDistributedAppSubmission(submissionInput('alpha'))
  );
  queue = enqueueDistributedApp(
    queue,
    sealDistributedAppSubmission(submissionInput('beta'))
  );
  queue = startNextDistributedApp(queue, {
    executionId: 'execution-alpha',
    startedAtMs: 11,
  });
  queue = finishActive(queue, { status: 'failed' });

  assert.equal(queue.failurePolicy, 'stop-on-failure');
  assert.equal(queue.haltedBySubmissionId, 'submission-alpha');
  assert.equal(queue.submissions[0].status, 'failed');
  assert.match(
    queue.submissions[0].terminalReconciliation.failureSha256,
    /^[a-f0-9]{64}$/
  );
  assert.equal(queue.submissions[1].status, 'queued');
  assert.throws(
    () =>
      startNextDistributedApp(queue, {
        executionId: 'execution-beta',
        startedAtMs: 50,
      }),
    /stopped by a retained failed app result/
  );
});

test('continue-on-failure must be selected explicitly', () => {
  let queue = createDistributedControllerQueue({
    controllerId,
    failurePolicy: 'continue-on-failure',
  });
  queue = enqueueDistributedApp(
    queue,
    sealDistributedAppSubmission(submissionInput('alpha'))
  );
  queue = enqueueDistributedApp(
    queue,
    sealDistributedAppSubmission(submissionInput('beta'))
  );
  queue = startNextDistributedApp(queue, {
    executionId: 'execution-alpha',
    startedAtMs: 11,
  });
  queue = finishActive(queue, { status: 'failed' });
  assert.equal(queue.haltedBySubmissionId, null);

  queue = startNextDistributedApp(queue, {
    executionId: 'execution-beta',
    startedAtMs: 50,
  });
  assert.equal(queue.activeSubmissionId, 'submission-beta');
});

test('sealed snapshot supports verified rehydration but performs no persistence', () => {
  let queue = createDistributedControllerQueue({ controllerId });
  queue = enqueueDistributedApp(
    queue,
    sealDistributedAppSubmission(submissionInput('alpha'))
  );
  queue = startNextDistributedApp(queue, {
    executionId: 'execution-alpha',
    startedAtMs: 11,
  });
  queue = finishActive(queue);
  const snapshot = snapshotDistributedControllerQueue(queue);
  const restored = rehydrateDistributedControllerQueue(snapshot, {
    expectedControllerId: controllerId,
    expectedQueueSha256: queue.queueSha256,
    verifyAuthentication: acceptAuthentication,
  });

  assert.deepEqual(restored, queue);
  assert.notEqual(restored, snapshot);

  const tampered = structuredClone(snapshot);
  tampered.submissions[0].finalizedAtMs += 1;
  assert.throws(
    () =>
      rehydrateDistributedControllerQueue(tampered, {
        expectedControllerId: controllerId,
        expectedQueueSha256: queue.queueSha256,
        verifyAuthentication: acceptAuthentication,
      }),
    /seal does not match|trusted hash/
  );
  assert.throws(
    () =>
      rehydrateDistributedControllerQueue(snapshot, {
        expectedControllerId: controllerId,
        expectedQueueSha256: queue.queueSha256,
        verifyAuthentication: () => false,
      }),
    /authentication proof was rejected/
  );
});
