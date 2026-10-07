// Copyright (c) snapetech and SeerrNG contributors.
/* eslint-disable no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createBrokerLeaseState } from '../tools/validation-engine/runtime/broker-lease-state.mjs';
import {
  BROKER_MESSAGE_SCHEMA,
  BROKER_PROTOCOL_VERSION,
  authenticateBrokerMessage,
  brokerApplicationIsolationKeySha256,
  createBrokerMessage,
  sealBrokerCleanupEvidence,
} from '../tools/validation-engine/runtime/broker-protocol.mjs';
import {
  DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA,
  createAdaptiveTimingProfile,
  createDistributedAdaptiveSchedule,
} from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
import {
  DISTRIBUTED_APP_SUBMISSION_SCHEMA,
  createDistributedControllerQueue,
  distributedApplicationIsolationKeySha256,
  enqueueDistributedApp,
  sealDistributedAppSubmission,
  startNextDistributedApp,
} from '../tools/validation-engine/runtime/distributed-controller-queue.mjs';
import {
  DISTRIBUTED_EVIDENCE_MANIFEST_SCHEMA,
  createDistributedEvidenceManifest,
  verifyAuthenticatedDistributedCleanupEvidenceManifest,
} from '../tools/validation-engine/runtime/distributed-evidence-artifact.mjs';
import {
  DISTRIBUTED_EXECUTION_BRIDGE_SCHEMA,
  DISTRIBUTED_TASK_CATALOG_SCHEMA,
  DISTRIBUTED_TASK_PAYLOAD_SCHEMA,
  assertTrustedDistributedExecutionBridge,
  createDistributedExecutionBridge,
  createDistributedTaskCatalog,
  verifyDistributedExecutionBridge,
  verifyDistributedTaskCatalog,
} from '../tools/validation-engine/runtime/distributed-execution-bridge.mjs';
import {
  cleanDistributedWorkerAttempt,
  createDistributedWorkerAttemptState,
  distributedWorkerCleanupEvidenceContent,
  requireDistributedWorkerAttemptCleanup,
  sealTrustedDistributedWorkerCleanupEvidence,
} from '../tools/validation-engine/runtime/distributed-worker-attempt-state.mjs';
import {
  DISTRIBUTED_WORKER_CONFIG_SCHEMA,
  createDistributedBrokerHandoff,
  createDistributedWorkerConfig,
  distributedWorkerConcurrency,
  distributedWorkerRunsOnControllerHost,
} from '../tools/validation-engine/runtime/distributed-worker-config.mjs';
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const controllerId = 'controller-a';
const repositoryIdentitySha256 = hash('repository');

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

const adapters = () => [
  {
    adapterId: 'cypress-native',
    adapterIdentitySha256: hash('adapter-cypress-native'),
  },
  {
    adapterId: 'node-native',
    adapterIdentitySha256: hash('adapter-node-native'),
  },
];

function workerConfig({ localN = 2, remoteEnabled = true, revision = 1 } = {}) {
  return createDistributedWorkerConfig({
    schema: DISTRIBUTED_WORKER_CONFIG_SCHEMA,
    revision,
    controllerId,
    controllerWorkerId: 'worker-local',
    workers: [
      {
        id: 'worker-local',
        address: 'https://worker-local.example.test',
        enabled: true,
        identitySha256: hash('worker-local-identity'),
        n: localN,
      },
      {
        id: 'worker-remote',
        address: 'https://worker-remote.example.test',
        enabled: remoteEnabled,
        identitySha256: hash('worker-remote-identity'),
        n: 'auto',
      },
    ],
  });
}

function schedulingNode(config, id, threads) {
  return {
    id,
    scope: {
      environment: 'linux-x64',
      nodeId: id,
    },
    adapterIds: adapters().map((entry) => entry.adapterId),
    effectiveLogicalThreads: threads,
    concurrency: distributedWorkerConcurrency(config, id),
    runsOnControllerHost: distributedWorkerRunsOnControllerHost(config, id),
    currentLoadPermille: 0,
  };
}

function scheduledTests() {
  return [
    {
      id: 'unit/a.test.ts',
      fingerprint: 'unit-a-v1',
      applicationId: 'seerrng',
      laneId: 'unit',
      adapterId: 'node-native',
      repositoryIdentitySha256,
      dependencies: [],
    },
    {
      id: 'e2e/b.cy.ts',
      fingerprint: 'e2e-b-v1',
      applicationId: 'seerrng',
      laneId: 'cypress',
      adapterId: 'cypress-native',
      repositoryIdentitySha256,
      dependencies: ['unit/a.test.ts'],
    },
  ];
}

function catalogTasks() {
  return [
    {
      testId: 'e2e/b.cy.ts',
      taskId: 'task-e2e-b',
      unitId: 'browser-tests',
      caseId: 'e2e-b',
      timeoutMs: 120_000,
      maxAttempts: 2,
      adapterPayload: {
        command: 'cypress-run',
        specs: ['e2e/b.cy.ts'],
      },
      expectedEvidence: [
        {
          evidenceId: 'cypress-result',
          schema: 'cypress-result-v1',
          mediaType: 'application/json',
          required: true,
        },
      ],
    },
    {
      testId: 'unit/a.test.ts',
      taskId: 'task-unit-a',
      unitId: 'unit-tests',
      caseId: 'unit-a',
      timeoutMs: 60_000,
      maxAttempts: 2,
      adapterPayload: {
        command: 'node-test',
        files: ['unit/a.test.ts'],
      },
      expectedEvidence: [
        {
          evidenceId: 'node-result',
          schema: 'node-result-v1',
          mediaType: 'application/json',
          required: true,
        },
      ],
    },
  ];
}

function fixture({
  selectedAdapters = adapters(),
  selectedCatalogTasks = catalogTasks(),
  start = true,
} = {}) {
  const config = workerConfig();
  const brokerHandoff = createDistributedBrokerHandoff(config);
  const profile = createAdaptiveTimingProfile();
  assert.equal(profile.schema, DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA);
  const schedule = createDistributedAdaptiveSchedule({
    tests: scheduledTests(),
    nodes: [
      schedulingNode(config, 'worker-local', 4),
      schedulingNode(config, 'worker-remote', 2),
    ],
    profile,
  });
  const taskCatalog = createDistributedTaskCatalog({
    schema: DISTRIBUTED_TASK_CATALOG_SCHEMA,
    applicationId: schedule.applicationId,
    repositoryIdentitySha256: schedule.repositoryIdentitySha256,
    testInventorySha256: schedule.testInventorySha256,
    scheduleSha256: schedule.scheduleSha256,
    adapters: selectedAdapters,
    tasks: selectedCatalogTasks,
  });
  const submission = sealDistributedAppSubmission({
    schema: DISTRIBUTED_APP_SUBMISSION_SCHEMA,
    controllerId,
    submissionId: 'submission-seerrng-1',
    applicationId: schedule.applicationId,
    testSuiteId: 'full-suite',
    repositoryIdentitySha256: schedule.repositoryIdentitySha256,
    revisionIdentitySha256: hash('candidate-revision'),
    inventoryIdentitySha256: schedule.testInventorySha256,
    taskCatalogIdentitySha256: taskCatalog.catalogSha256,
    adapters: selectedAdapters,
    profileIdentitySha256: schedule.profileSha256,
    cacheIdentitySha256: hash('cache-namespace'),
    evidenceIdentitySha256: hash('evidence-namespace'),
    resultsIdentitySha256: hash('results-namespace'),
    failureIdentitySha256: hash('failure-namespace'),
    planSha256: schedule.scheduleSha256,
  });
  let queue = createDistributedControllerQueue({ controllerId });
  queue = enqueueDistributedApp(queue, submission);
  if (start)
    queue = startNextDistributedApp(queue, {
      executionId: 'execution-seerrng-1',
      startedAtMs: 1_000,
    });
  return { brokerHandoff, config, queue, schedule, submission, taskCatalog };
}

function createBridge(selected = fixture()) {
  return createDistributedExecutionBridge({
    queue: selected.queue,
    schedule: selected.schedule,
    taskCatalog: selected.taskCatalog,
    brokerHandoff: selected.brokerHandoff,
  });
}

function verifyBridge(
  bridge,
  selected,
  expectedBridgeSha256 = bridge.bridgeSha256
) {
  return verifyDistributedExecutionBridge(bridge, {
    expectedBridgeSha256,
    queue: selected.queue,
    schedule: selected.schedule,
    taskCatalog: selected.taskCatalog,
    brokerHandoff: selected.brokerHandoff,
  });
}

function rehashBridge(value) {
  const unsigned = { ...value };
  delete unsigned.bridgeSha256;
  value.bridgeSha256 = canonicalJsonSha256(unsigned);
  return value;
}

function rehashAssignment(value) {
  const core = { ...value };
  delete core.assignmentSha256;
  delete core.taskSha256;
  value.assignmentSha256 = canonicalJsonSha256(core);
  return value;
}

test('bridge maps one active queue record exactly into broker binding, tasks and namespaces', () => {
  const selected = fixture();
  const bridge = createBridge(selected);
  const active = selected.queue.submissions.find(
    (entry) =>
      entry.submission.submissionId === selected.queue.activeSubmissionId
  );

  assert.equal(bridge.schema, DISTRIBUTED_EXECUTION_BRIDGE_SCHEMA);
  assert.deepEqual(bridge.binding, {
    schema: 'seerrng-validation-broker-binding/v1',
    controllerId,
    applicationId: selected.submission.applicationId,
    submissionId: selected.submission.submissionId,
    submissionSequence: active.sequence,
    executionId: active.executionId,
    runAttempt: 1,
    repositoryIdentitySha256: selected.submission.repositoryIdentitySha256,
    candidateSha256: selected.submission.revisionIdentitySha256,
    planSha256: selected.schedule.scheduleSha256,
  });
  assert.equal(
    bridge.queueApplicationIsolationKeySha256,
    distributedApplicationIsolationKeySha256(selected.submission)
  );
  assert.equal(
    bridge.brokerApplicationIsolationKeySha256,
    brokerApplicationIsolationKeySha256(bridge.binding)
  );
  assert.notEqual(
    bridge.queueApplicationIsolationKeySha256,
    bridge.brokerApplicationIsolationKeySha256
  );
  assert.deepEqual(bridge.outputNamespaces, {
    cacheIdentitySha256: selected.submission.cacheIdentitySha256,
    evidenceIdentitySha256: selected.submission.evidenceIdentitySha256,
    failureIdentitySha256: selected.submission.failureIdentitySha256,
    resultsIdentitySha256: selected.submission.resultsIdentitySha256,
  });
  assert.equal(bridge.tasks.length, 2);
  assert.equal(bridge.assignments.length, 2);
  assert.ok(
    bridge.tasks.every(
      (task) =>
        task.applicationIsolationKeySha256 ===
        brokerApplicationIsolationKeySha256(bridge.binding)
    )
  );
  assert.ok(Object.isFrozen(bridge));
  assert.ok(Object.isFrozen(bridge.tasks[0].payload.assignment));
  assert.equal(assertTrustedDistributedExecutionBridge(bridge), bridge);
  assert.throws(
    () => assertTrustedDistributedExecutionBridge(structuredClone(bridge)),
    /not trusted controller runtime state/
  );
  assert.deepEqual(verifyBridge(bridge, selected), bridge);
});

test('controller accepts cleanup manifests only from its exact runtime bridge', () => {
  const selected = fixture();
  const bridge = createBridge(selected);
  const task = bridge.tasks.find((entry) => entry.taskId === 'task-unit-a');
  assert.ok(task);
  const lease = {
    leaseId: 'lease-unit-a-1',
    attempt: 1,
    workerId: task.assignment.workerId,
    machineIdentitySha256: hash(`${task.assignment.workerId}-machine`),
    instanceId: `${task.assignment.workerId}-boot-1`,
    workerSessionId: `${task.assignment.workerId}-session-1`,
    grantedAtMs: 100,
    expiresAtMs: 1_100,
  };
  const pending = createDistributedWorkerAttemptState({
    binding: bridge.binding,
    bridgeSha256: bridge.bridgeSha256,
    applicationIsolationKeySha256: bridge.brokerApplicationIsolationKeySha256,
    task,
    lease,
    sourceWorkspaceIdentitySha256: hash('source-workspace-unit-a'),
    adapters: selected.taskCatalog.adapters,
    createdAtMs: 110,
  });
  const cleanupRequired = requireDistributedWorkerAttemptCleanup(pending, {
    requiredAtMs: 120,
    reasonCode: 'lease-revoked-before-launch',
    failureReference: {
      referenceId: 'failure-unit-a',
      schema: 'seerrng-worker-failure/v1',
      mediaType: 'application/json',
      bytes: 96,
      sha256: hash('failure-unit-a-content'),
      storageIdentitySha256: hash('failure-unit-a-storage'),
    },
  });
  const cleaned = cleanDistributedWorkerAttempt(cleanupRequired, {
    cleanedAtMs: 140,
    evidenceReference: {
      referenceId: 'cleanup-unit-a',
      schema: 'seerrng-worker-cleanup/v1',
      mediaType: 'application/json',
      bytes: 128,
      sha256: hash('cleanup-unit-a-content'),
      storageIdentitySha256: hash('cleanup-unit-a-storage'),
    },
  });
  const cleanupEvidence = sealTrustedDistributedWorkerCleanupEvidence(cleaned);

  function authenticateCancellation(evidence, messageId) {
    const sealed = createBrokerMessage({
      schema: BROKER_MESSAGE_SCHEMA,
      protocolVersion: BROKER_PROTOCOL_VERSION,
      messageId,
      kind: 'worker.cancelled',
      sentAtMs: 150,
      binding: bridge.binding,
      auth: {
        algorithm: 'hmac-sha256',
        sessionId: lease.workerSessionId,
        principalId: lease.workerId,
        keyId: 'worker-cleanup-key-1',
        nonce: `${messageId}-nonce`,
        issuedAtMs: 100,
        expiresAtMs: 1_000,
        proof: 'A'.repeat(43),
      },
      command: null,
      body: {
        workerId: lease.workerId,
        instanceId: lease.instanceId,
        workerSessionId: lease.workerSessionId,
        leaseId: lease.leaseId,
        taskId: task.taskId,
        attempt: lease.attempt,
        cancelledAtMs: cleaned.cleanup.completedAtMs,
        cleanupEvidence: evidence,
      },
    });
    return {
      sealed,
      authenticated: authenticateBrokerMessage(sealed, {
        expectedBinding: bridge.binding,
        nowMs: sealed.sentAtMs,
        verifyProof: () => true,
      }),
    };
  }

  function manifestFor(message, overrides = {}) {
    const outputNamespaces =
      overrides.outputNamespaces ?? bridge.outputNamespaces;
    const content = distributedWorkerCleanupEvidenceContent(cleaned);
    return createDistributedEvidenceManifest({
      schema: DISTRIBUTED_EVIDENCE_MANIFEST_SCHEMA,
      bridgeSha256: overrides.bridgeSha256 ?? bridge.bridgeSha256,
      binding: bridge.binding,
      executionId: bridge.binding.executionId,
      queueApplicationIsolationKeySha256:
        overrides.queueApplicationIsolationKeySha256 ??
        bridge.queueApplicationIsolationKeySha256,
      brokerApplicationIsolationKeySha256:
        bridge.brokerApplicationIsolationKeySha256,
      outputNamespaces,
      workerId: lease.workerId,
      instanceId: lease.instanceId,
      workerSessionId: lease.workerSessionId,
      taskId: task.taskId,
      taskSha256: overrides.taskSha256 ?? task.taskSha256,
      leaseId: lease.leaseId,
      attempt: lease.attempt,
      sourceSubmissionSha256: canonicalJsonSha256(message.body),
      sourceCompletedAtMs: message.body.cancelledAtMs,
      sourceMessageSha256: canonicalJsonSha256(message),
      sourceMessageSentAtMs: message.sentAtMs,
      artifacts: [
        {
          ...content,
          namespaceKind: 'failure',
          relativePath:
            `failure/${outputNamespaces.failureIdentitySha256}/` +
            `${content.blobSha256.slice(0, 2)}/${content.blobSha256}`,
        },
      ],
    });
  }

  const cancellation = authenticateCancellation(
    cleanupEvidence,
    'worker-cleanup-cancelled-1'
  );
  const manifest = manifestFor(cancellation.authenticated);
  assert.deepEqual(
    verifyAuthenticatedDistributedCleanupEvidenceManifest({
      cancelledMessage: cancellation.authenticated,
      executionBridge: bridge,
      manifest,
    }),
    manifest
  );
  assert.throws(
    () =>
      verifyAuthenticatedDistributedCleanupEvidenceManifest({
        cancelledMessage: cancellation.sealed,
        executionBridge: bridge,
        manifest,
      }),
    /has not passed authentication/
  );
  assert.throws(
    () =>
      verifyAuthenticatedDistributedCleanupEvidenceManifest({
        cancelledMessage: cancellation.authenticated,
        executionBridge: structuredClone(bridge),
        manifest,
      }),
    /not trusted controller runtime state/
  );

  for (const drifted of [
    manifestFor(cancellation.authenticated, {
      bridgeSha256: hash('other-execution-bridge'),
    }),
    manifestFor(cancellation.authenticated, {
      queueApplicationIsolationKeySha256: hash('other-queue-isolation'),
    }),
    manifestFor(cancellation.authenticated, {
      outputNamespaces: {
        cacheIdentitySha256: hash('other-cache-namespace'),
        evidenceIdentitySha256: hash('other-evidence-namespace'),
        failureIdentitySha256: hash('other-failure-namespace'),
        resultsIdentitySha256: hash('other-results-namespace'),
      },
    }),
  ])
    assert.throws(
      () =>
        verifyAuthenticatedDistributedCleanupEvidenceManifest({
          cancelledMessage: cancellation.authenticated,
          executionBridge: bridge,
          manifest: drifted,
        }),
      /does not match its controller execution authority/
    );

  const substitutedTaskEvidence = sealBrokerCleanupEvidence(bridge.binding, {
    workerId: lease.workerId,
    instanceId: lease.instanceId,
    workerSessionId: lease.workerSessionId,
    leaseId: lease.leaseId,
    taskId: task.taskId,
    taskSha256: hash('same-id-different-task'),
    bridgeSha256: bridge.bridgeSha256,
    attempt: lease.attempt,
    cancellationRequestedAtMs: cleaned.cleanup.requiredAtMs,
    completedAtMs: cleaned.cleanup.completedAtMs,
    evidenceId: cleanupEvidence.evidenceId,
    evidenceSchema: cleanupEvidence.evidenceSchema,
    mediaType: cleanupEvidence.mediaType,
    bytes: cleanupEvidence.bytes,
    blobSha256: cleanupEvidence.blobSha256,
  });
  const substitutedTaskCancellation = authenticateCancellation(
    substitutedTaskEvidence,
    'worker-cleanup-cancelled-substituted-task'
  );
  assert.throws(
    () =>
      verifyAuthenticatedDistributedCleanupEvidenceManifest({
        cancelledMessage: substitutedTaskCancellation.authenticated,
        executionBridge: bridge,
        manifest: manifestFor(substitutedTaskCancellation.authenticated, {
          taskSha256: substitutedTaskEvidence.taskSha256,
        }),
      }),
    /does not match its controller execution bridge/
  );
});

test('catalog preserves explicit path-to-broker-ID mapping and binds every execution field', () => {
  const selected = fixture();
  const catalog = selected.taskCatalog;
  assert.deepEqual(
    catalog.tasks.map((entry) => entry.testId),
    ['e2e/b.cy.ts', 'unit/a.test.ts']
  );
  assert.equal(catalog.tasks[0].taskId, 'task-e2e-b');
  assert.notEqual(catalog.tasks[0].testId, catalog.tasks[0].taskId);
  assert.deepEqual(
    verifyDistributedTaskCatalog(catalog, {
      expectedCatalogSha256: catalog.catalogSha256,
      expectedScheduleSha256: selected.schedule.scheduleSha256,
      expectedApplicationId: selected.schedule.applicationId,
      expectedRepositoryIdentitySha256:
        selected.schedule.repositoryIdentitySha256,
      expectedTestInventorySha256: selected.schedule.testInventorySha256,
      expectedAdapters: adapters().toReversed(),
    }),
    catalog
  );
  const changed = structuredClone(catalog);
  changed.tasks[0].timeoutMs += 1;
  assert.throws(
    () =>
      verifyDistributedTaskCatalog(changed, {
        expectedCatalogSha256: catalog.catalogSha256,
        expectedScheduleSha256: selected.schedule.scheduleSha256,
        expectedApplicationId: selected.schedule.applicationId,
        expectedRepositoryIdentitySha256:
          selected.schedule.repositoryIdentitySha256,
        expectedTestInventorySha256: selected.schedule.testInventorySha256,
        expectedAdapters: adapters(),
      }),
    /trusted hash/
  );
});

test('catalog rejects duplicate identities, duplicate mappings and undeclared fields', () => {
  const selected = fixture();
  const duplicateAdapterIdentity = adapters();
  duplicateAdapterIdentity[1].adapterIdentitySha256 =
    duplicateAdapterIdentity[0].adapterIdentitySha256;
  assert.throws(
    () =>
      createDistributedTaskCatalog({
        schema: DISTRIBUTED_TASK_CATALOG_SCHEMA,
        applicationId: selected.schedule.applicationId,
        repositoryIdentitySha256: selected.schedule.repositoryIdentitySha256,
        testInventorySha256: selected.schedule.testInventorySha256,
        scheduleSha256: selected.schedule.scheduleSha256,
        adapters: duplicateAdapterIdentity,
        tasks: catalogTasks(),
      }),
    /duplicate adapter identity hash/
  );

  const duplicateTasks = catalogTasks();
  duplicateTasks[1].taskId = duplicateTasks[0].taskId;
  assert.throws(
    () =>
      createDistributedTaskCatalog({
        schema: DISTRIBUTED_TASK_CATALOG_SCHEMA,
        applicationId: selected.schedule.applicationId,
        repositoryIdentitySha256: selected.schedule.repositoryIdentitySha256,
        testInventorySha256: selected.schedule.testInventorySha256,
        scheduleSha256: selected.schedule.scheduleSha256,
        adapters: adapters(),
        tasks: duplicateTasks,
      }),
    /duplicate task ID/
  );

  const extraField = catalogTasks();
  extraField[0].command = 'unsealed-command';
  assert.throws(
    () =>
      createDistributedTaskCatalog({
        schema: DISTRIBUTED_TASK_CATALOG_SCHEMA,
        applicationId: selected.schedule.applicationId,
        repositoryIdentitySha256: selected.schedule.repositoryIdentitySha256,
        testInventorySha256: selected.schedule.testInventorySha256,
        scheduleSha256: selected.schedule.scheduleSha256,
        adapters: adapters(),
        tasks: extraField,
      }),
    /exact field set/
  );
});

test('bridge seals the exact broker-enforced worker assignment and dependency gate', () => {
  const selected = fixture();
  const bridge = createBridge(selected);
  const dependent = bridge.assignments.find(
    (entry) => entry.taskId === 'task-e2e-b'
  );
  const task = bridge.tasks.find((entry) => entry.taskId === dependent.taskId);

  assert.deepEqual(dependent.dependencyTaskIds, ['task-unit-a']);
  assert.equal(task.payload.schema, DISTRIBUTED_TASK_PAYLOAD_SCHEMA);
  assert.equal(
    task.payload.assignment.assignedWorkerId,
    dependent.assignedWorkerId
  );
  assert.deepEqual(
    task.payload.assignment.dependencyTaskIds,
    dependent.dependencyTaskIds
  );
  assert.equal(task.payload.assignmentSha256, dependent.assignmentSha256);
  assert.deepEqual(task.assignment, {
    workerId: dependent.assignedWorkerId,
    slotId: dependent.assignedSlotId,
    slotIndex: dependent.assignedSlotIndex,
    slotPosition: dependent.assignedSlotPosition,
  });
  const scheduledSlot = selected.schedule.threadSlots.find((slot) =>
    slot.tests.some((entry) => entry.id === dependent.testId)
  );
  assert.ok(scheduledSlot);
  assert.equal(
    dependent.assignedSlotPosition,
    scheduledSlot.tests.findIndex((entry) => entry.id === dependent.testId) + 1
  );
  assert.deepEqual(task.dependencyTaskIds, dependent.dependencyTaskIds);

  // Broker state consumes these immutable task-v2 fields and therefore receives
  // the same assignment and dependency gates as the bridge/controller.
  const brokerState = createBrokerLeaseState({
    binding: bridge.binding,
    expectedTasks: bridge.tasks,
    workerConfig: bridge.brokerWorkerConfig,
  });
  assert.equal(brokerState.expectedTasks.length, bridge.tasks.length);
  assert.deepEqual(
    brokerState.expectedTasks.map((entry) => entry.taskSha256),
    bridge.tasks.map((entry) => entry.taskSha256)
  );
});

test('bridge rejects queues without an actively running first attempt', () => {
  const selected = fixture({ start: false });
  assert.throws(
    () => createBridge(selected),
    /requires an active distributed app/
  );
});

test('bridge rejects incomplete catalogs and adapter-set drift even when each source is sealed', () => {
  const incomplete = fixture({
    selectedCatalogTasks: catalogTasks().slice(0, 1),
  });
  assert.throws(() => createBridge(incomplete), /does not exactly cover/);

  const missingAdapter = fixture({ selectedAdapters: adapters().slice(0, 1) });
  assert.throws(
    () => createBridge(missingAdapter),
    /does not use the exact submitted adapters/
  );
});

test('bridge rejects worker policy and controller-host placement drift', () => {
  const selected = fixture();
  const changedN = workerConfig({ localN: 1, revision: 2 });
  assert.throws(
    () =>
      createDistributedExecutionBridge({
        queue: selected.queue,
        schedule: selected.schedule,
        taskCatalog: selected.taskCatalog,
        brokerHandoff: createDistributedBrokerHandoff(changedN),
      }),
    /changed explicit worker N policy/
  );

  const disabled = workerConfig({ remoteEnabled: false, revision: 2 });
  assert.throws(
    () =>
      createDistributedExecutionBridge({
        queue: selected.queue,
        schedule: selected.schedule,
        taskCatalog: selected.taskCatalog,
        brokerHandoff: createDistributedBrokerHandoff(disabled),
      }),
    /worker inventory does not match enabled configuration/
  );
});

test('source reconstruction rejects a rehashed isolation swap and assignment tamper', () => {
  const selected = fixture();
  const bridge = createBridge(selected);

  const swapped = structuredClone(bridge);
  [
    swapped.queueApplicationIsolationKeySha256,
    swapped.brokerApplicationIsolationKeySha256,
  ] = [
    swapped.brokerApplicationIsolationKeySha256,
    swapped.queueApplicationIsolationKeySha256,
  ];
  rehashBridge(swapped);
  assert.throws(
    () => verifyBridge(swapped, selected, swapped.bridgeSha256),
    /verified sources/
  );

  const reassigned = structuredClone(bridge);
  reassigned.assignments[0].assignedWorkerId =
    reassigned.assignments[0].assignedWorkerId === 'worker-local'
      ? 'worker-remote'
      : 'worker-local';
  rehashAssignment(reassigned.assignments[0]);
  rehashBridge(reassigned);
  assert.throws(
    () => verifyBridge(reassigned, selected, reassigned.bridgeSha256),
    /verified sources/
  );

  const remappedCandidate = structuredClone(bridge);
  remappedCandidate.binding.candidateSha256 = hash('another-candidate');
  rehashBridge(remappedCandidate);
  assert.throws(
    () =>
      verifyBridge(remappedCandidate, selected, remappedCandidate.bridgeSha256),
    /verified sources/
  );
});

test('bridge rejects a sealed catalog changed after queue admission', () => {
  const selected = fixture();
  const changedTasks = catalogTasks();
  changedTasks[0].maxAttempts = 3;
  const changedCatalog = createDistributedTaskCatalog({
    schema: DISTRIBUTED_TASK_CATALOG_SCHEMA,
    applicationId: selected.schedule.applicationId,
    repositoryIdentitySha256: selected.schedule.repositoryIdentitySha256,
    testInventorySha256: selected.schedule.testInventorySha256,
    scheduleSha256: selected.schedule.scheduleSha256,
    adapters: adapters(),
    tasks: changedTasks,
  });
  assert.throws(
    () =>
      createDistributedExecutionBridge({
        queue: selected.queue,
        schedule: selected.schedule,
        taskCatalog: changedCatalog,
        brokerHandoff: selected.brokerHandoff,
      }),
    /trusted hash/
  );
});
