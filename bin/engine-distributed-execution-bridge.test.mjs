// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createBrokerLeaseState } from '../tools/validation-engine/runtime/broker-lease-state.mjs';
import { brokerApplicationIsolationKeySha256 } from '../tools/validation-engine/runtime/broker-protocol.mjs';
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
  DISTRIBUTED_EXECUTION_BRIDGE_SCHEMA,
  DISTRIBUTED_TASK_CATALOG_SCHEMA,
  DISTRIBUTED_TASK_PAYLOAD_SCHEMA,
  createDistributedExecutionBridge,
  createDistributedTaskCatalog,
  verifyDistributedExecutionBridge,
  verifyDistributedTaskCatalog,
} from '../tools/validation-engine/runtime/distributed-execution-bridge.mjs';
import {
  DISTRIBUTED_WORKER_CONFIG_SCHEMA,
  createDistributedBrokerHandoff,
  createDistributedWorkerConfig,
  distributedWorkerConcurrency,
  distributedWorkerRole,
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

function schedulingWorker(config, id, threads, score) {
  return {
    id,
    scope: {
      environment: 'linux-x64',
      workerClass: id === 'worker-local' ? 'local-standard' : 'remote-standard',
    },
    adapterIds: adapters().map((entry) => entry.adapterId),
    effectiveLogicalThreads: threads,
    concurrency: distributedWorkerConcurrency(config, id),
    role: distributedWorkerRole(config, id),
    runsOnControllerHost: distributedWorkerRunsOnControllerHost(config, id),
    currentLoadPermille: 0,
    benchmark: {
      valid: true,
      performanceScorePermille: score,
    },
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
    workers: [
      schedulingWorker(config, 'worker-local', 4, 1_000),
      schedulingWorker(config, 'worker-remote', 2, 800),
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
  const { bridgeSha256: _bridgeSha256, ...unsigned } = value;
  value.bridgeSha256 = canonicalJsonSha256(unsigned);
  return value;
}

function rehashAssignment(value) {
  const {
    assignmentSha256: _assignmentSha256,
    taskSha256: _taskSha256,
    ...core
  } = value;
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
  assert.deepEqual(verifyBridge(bridge, selected), bridge);
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
  assert.equal(dependent.assignedSlotPosition, 2);
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
