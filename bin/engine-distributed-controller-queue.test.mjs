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
  describeDistributedControllerQueueTransition,
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
  verifyDistributedControllerQueueTransition,
} from '../tools/validation-engine/runtime/distributed-controller-queue.mjs';
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const controllerId = 'controller-a';
const acceptAuthentication = () => true;

function assertTransitionDescription(actual, expected) {
  assert.deepEqual(Reflect.ownKeys(actual), [
    'kind',
    'inputSha256',
    'occurredAtMs',
  ]);
  assert.deepEqual(actual, expected);
  assert.equal(Object.isFrozen(actual), true);
}

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
    taskCatalogIdentitySha256: sha256(`task-catalog-${name}`),
    adapters: [
      {
        adapterId: 'vitest',
        adapterIdentitySha256: sha256(`adapter-vitest-${name}`),
      },
      {
        adapterId: 'node-native',
        adapterIdentitySha256: sha256(`adapter-node-native-${name}`),
      },
    ],
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
    cleanupInventorySha256: sha256(`cleanup-${active.submission.submissionId}`),
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
  const reordered = sealDistributedAppSubmission({
    ...Object.fromEntries(Object.entries(input).reverse()),
    adapters: [...input.adapters].reverse(),
  });

  assert.deepEqual(first, reordered);
  assert.deepEqual(
    first.adapters.map((entry) => entry.adapterId),
    ['node-native', 'vitest']
  );
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
        schema: 'seerrng-distributed-app-submission/v1',
      }),
    /Unsupported distributed app submission schema/
  );
  assert.throws(
    () => sealDistributedAppSubmission({ ...input, adapters: [] }),
    /at least one adapter/
  );
  assert.throws(
    () =>
      sealDistributedAppSubmission({
        ...input,
        adapters: [{ ...input.adapters[0], unexpected: true }],
      }),
    /exact field set/
  );
  assert.throws(
    () =>
      sealDistributedAppSubmission({
        ...input,
        adapters: [
          input.adapters[0],
          { ...input.adapters[1], adapterId: 'vitest' },
        ],
      }),
    /adapter IDs must be unique/
  );
  assert.throws(
    () =>
      sealDistributedAppSubmission({
        ...input,
        adapters: [
          input.adapters[0],
          {
            ...input.adapters[1],
            adapterIdentitySha256: input.adapters[0].adapterIdentitySha256,
          },
        ],
      }),
    /adapter identity hashes must be unique/
  );
  const missingTaskCatalog = { ...input };
  delete missingTaskCatalog.taskCatalogIdentitySha256;
  assert.throws(
    () => sealDistributedAppSubmission(missingTaskCatalog),
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
  tampered.adapters[0].adapterIdentitySha256 = sha256('different-adapter');
  assert.throws(
    () => verifyDistributedAppSubmission(tampered),
    /work identity|seal/
  );
  const tamperedCatalog = structuredClone(first);
  tamperedCatalog.taskCatalogIdentitySha256 = sha256('different-task-catalog');
  assert.throws(
    () => verifyDistributedAppSubmission(tamperedCatalog),
    /work identity|seal/
  );
});

test('queue rejects same-type and cross-type output namespace reuse', () => {
  const alpha = sealDistributedAppSubmission(submissionInput('alpha'));
  let queue = createDistributedControllerQueue({
    controllerId,
    maxSubmissions: 4,
  });
  queue = enqueueDistributedApp(queue, alpha);
  const queueBeforeRejectedSubmissions = structuredClone(queue);

  const sameTypeInput = submissionInput('beta-same-type');
  const sameType = sealDistributedAppSubmission({
    ...sameTypeInput,
    cacheIdentitySha256: alpha.cacheIdentitySha256,
  });
  assert.throws(
    () => enqueueDistributedApp(queue, sameType),
    /output namespace is already retained/
  );

  const crossTypeInput = submissionInput('beta-cross-type');
  const crossType = sealDistributedAppSubmission({
    ...crossTypeInput,
    failureIdentitySha256: alpha.evidenceIdentitySha256,
  });
  assert.throws(
    () => enqueueDistributedApp(queue, crossType),
    /output namespace is already retained/
  );
  assert.equal(queue.queueSha256, queueBeforeRejectedSubmissions.queueSha256);
  assert.deepEqual(queue, queueBeforeRejectedSubmissions);

  const beta = sealDistributedAppSubmission(submissionInput('beta-distinct'));
  queue = enqueueDistributedApp(queue, beta);
  assert.equal(queue.submissions.length, 2);
  assert.equal(queue.submissions[1].submission.submissionId, beta.submissionId);
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
  assert.equal(queue.submissions[0].runAttempt, null);
  assert.equal(queue.submissions[1].runAttempt, null);
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
  assert.equal(queue.submissions[0].runAttempt, 1);
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
  assert.equal(activeRecord(queue).runAttempt, 1);
  assert.throws(
    () => advanceDistributedControllerQueue(queue, { finalizedAtMs: 30 }),
    /before terminal reconciliation and cleanup proof/
  );

  queue = recordDistributedCleanupProof(queue, cleanupFor(queue), {
    verifyAuthentication: acceptAuthentication,
  });
  assert.equal(activeRecord(queue).status, 'ready-to-advance');
  assert.equal(activeRecord(queue).runAttempt, 1);
  queue = advanceDistributedControllerQueue(queue, { finalizedAtMs: 40 });
  assert.equal(queue.activeSubmissionId, null);
  assert.equal(queue.submissions[0].status, 'passed');
  assert.equal(queue.submissions[0].runAttempt, 1);
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
  assert.equal(restored.submissions[0].runAttempt, 1);

  const invalidRunAttempt = structuredClone(snapshot);
  invalidRunAttempt.submissions[0].runAttempt = 2;
  delete invalidRunAttempt.queueSha256;
  invalidRunAttempt.queueSha256 = canonicalJsonSha256(invalidRunAttempt);
  assert.throws(
    () =>
      rehydrateDistributedControllerQueue(invalidRunAttempt, {
        expectedControllerId: controllerId,
        expectedQueueSha256: invalidRunAttempt.queueSha256,
        verifyAuthentication: acceptAuthentication,
      }),
    /first run attempt/
  );

  const obsoleteQueueSchema = structuredClone(snapshot);
  obsoleteQueueSchema.schema = 'seerrng-distributed-controller-queue/v1';
  delete obsoleteQueueSchema.queueSha256;
  obsoleteQueueSchema.queueSha256 = canonicalJsonSha256(obsoleteQueueSchema);
  assert.throws(
    () =>
      rehydrateDistributedControllerQueue(obsoleteQueueSchema, {
        expectedControllerId: controllerId,
        expectedQueueSha256: obsoleteQueueSchema.queueSha256,
        verifyAuthentication: acceptAuthentication,
      }),
    /Unsupported distributed controller queue schema/
  );

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

test('queue transition provenance accepts only fresh genesis and exact legal lineage', () => {
  const genesis = createDistributedControllerQueue({ controllerId });
  assert.equal(
    verifyDistributedControllerQueueTransition(null, genesis),
    genesis
  );
  assertTransitionDescription(
    describeDistributedControllerQueueTransition(null, genesis),
    {
      kind: 'genesis',
      inputSha256: canonicalJsonSha256({
        controllerId,
        failurePolicy: 'stop-on-failure',
        maxSubmissions: 64,
      }),
      occurredAtMs: null,
    }
  );

  const genesisSnapshot = snapshotDistributedControllerQueue(genesis);
  const restoredGenesis = rehydrateDistributedControllerQueue(genesisSnapshot, {
    expectedControllerId: controllerId,
    expectedQueueSha256: genesis.queueSha256,
    verifyAuthentication: acceptAuthentication,
  });
  assert.throws(
    () => verifyDistributedControllerQueueTransition(null, restoredGenesis),
    /lacks runtime transition provenance/
  );
  assert.throws(
    () => describeDistributedControllerQueueTransition(null, restoredGenesis),
    /lacks runtime transition provenance/
  );
  assert.throws(
    () =>
      verifyDistributedControllerQueueTransition(
        null,
        structuredClone(genesis)
      ),
    /not trusted runtime state/
  );

  const lineageSubmission = sealDistributedAppSubmission(
    submissionInput('lineage-alpha')
  );
  const queued = enqueueDistributedApp(restoredGenesis, lineageSubmission);
  assert.equal(queued.revision, restoredGenesis.revision + 1);
  assert.equal(
    verifyDistributedControllerQueueTransition(restoredGenesis, queued),
    queued
  );
  assertTransitionDescription(
    describeDistributedControllerQueueTransition(restoredGenesis, queued),
    {
      kind: 'enqueue',
      inputSha256: lineageSubmission.submissionSha256,
      occurredAtMs: null,
    }
  );
  assert.throws(
    () => verifyDistributedControllerQueueTransition(null, queued),
    /not an exact initial queue/
  );

  const running = startNextDistributedApp(queued, {
    executionId: 'execution-lineage-alpha',
    startedAtMs: 11,
  });
  assert.equal(
    verifyDistributedControllerQueueTransition(queued, running),
    running
  );
  assertTransitionDescription(
    describeDistributedControllerQueueTransition(queued, running),
    {
      kind: 'start',
      inputSha256: canonicalJsonSha256({
        executionId: 'execution-lineage-alpha',
        startedAtMs: 11,
      }),
      occurredAtMs: 11,
    }
  );
  const terminalReconciliation = terminalFor(running);
  const reconciled = recordDistributedTerminalReconciliation(
    running,
    terminalReconciliation,
    { verifyAuthentication: acceptAuthentication }
  );
  assert.equal(
    verifyDistributedControllerQueueTransition(running, reconciled),
    reconciled
  );
  assertTransitionDescription(
    describeDistributedControllerQueueTransition(running, reconciled),
    {
      kind: 'terminal-reconciliation',
      inputSha256: terminalReconciliation.terminalReconciliationSha256,
      occurredAtMs: terminalReconciliation.completedAtMs,
    }
  );
  const cleanupProof = cleanupFor(reconciled);
  const cleaned = recordDistributedCleanupProof(reconciled, cleanupProof, {
    verifyAuthentication: acceptAuthentication,
  });
  assert.equal(
    verifyDistributedControllerQueueTransition(reconciled, cleaned),
    cleaned
  );
  assertTransitionDescription(
    describeDistributedControllerQueueTransition(reconciled, cleaned),
    {
      kind: 'cleanup-proof',
      inputSha256: cleanupProof.cleanupProofSha256,
      occurredAtMs: cleanupProof.completedAtMs,
    }
  );
  const finalized = advanceDistributedControllerQueue(cleaned, {
    finalizedAtMs: 40,
  });
  assert.equal(
    verifyDistributedControllerQueueTransition(cleaned, finalized),
    finalized
  );
  assertTransitionDescription(
    describeDistributedControllerQueueTransition(cleaned, finalized),
    {
      kind: 'advance',
      inputSha256: canonicalJsonSha256({ finalizedAtMs: 40 }),
      occurredAtMs: 40,
    }
  );

  const unrelatedPrevious = createDistributedControllerQueue({
    controllerId,
    maxSubmissions: 63,
  });
  assert.throws(
    () => verifyDistributedControllerQueueTransition(unrelatedPrevious, queued),
    /does not match its exact previous queue/
  );
  assert.throws(
    () =>
      verifyDistributedControllerQueueTransition(
        structuredClone(restoredGenesis),
        queued
      ),
    /not trusted runtime state/
  );

  const queuedSnapshot = snapshotDistributedControllerQueue(queued);
  const restoredQueued = rehydrateDistributedControllerQueue(queuedSnapshot, {
    expectedControllerId: controllerId,
    expectedQueueSha256: queued.queueSha256,
    verifyAuthentication: acceptAuthentication,
  });
  assert.throws(
    () =>
      verifyDistributedControllerQueueTransition(
        restoredGenesis,
        restoredQueued
      ),
    /lacks runtime transition provenance/
  );
  assert.throws(
    () =>
      verifyDistributedControllerQueueTransition(
        restoredGenesis,
        structuredClone(queued)
      ),
    /not trusted runtime state/
  );
  assert.throws(
    () =>
      describeDistributedControllerQueueTransition(
        restoredGenesis,
        structuredClone(queued)
      ),
    /not trusted runtime state/
  );
});
