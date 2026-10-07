// Copyright (c) snapetech and SeerrNG contributors.
// Deterministic bridge from one active distributed app to broker execution.
import {
  BROKER_BINDING_SCHEMA,
  brokerApplicationIsolationKeySha256,
  sealBrokerTask,
  verifyBrokerBinding,
  verifyBrokerTask,
} from './broker-protocol.mjs';
import { verifyDistributedAdaptiveSchedule } from './distributed-adaptive-scheduler.mjs';
import { snapshotDistributedControllerQueue } from './distributed-controller-queue.mjs';
import { verifyDistributedBrokerHandoff } from './distributed-worker-config.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_TASK_CATALOG_SCHEMA =
  'seerrng-distributed-task-catalog/v1';
export const DISTRIBUTED_EXECUTION_BRIDGE_SCHEMA =
  'seerrng-distributed-execution-bridge/v1';
export const DISTRIBUTED_TASK_PAYLOAD_SCHEMA =
  'seerrng-distributed-task-payload/v1';
export const MAX_DISTRIBUTED_TASK_CATALOG_TASKS = 65_536;
export const MAX_DISTRIBUTED_TASK_CATALOG_BYTES = 16 * 1024 * 1024;

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const CATALOG_INPUT_KEYS = [
  'adapters',
  'applicationId',
  'repositoryIdentitySha256',
  'scheduleSha256',
  'schema',
  'tasks',
  'testInventorySha256',
];
const CATALOG_KEYS = [...CATALOG_INPUT_KEYS, 'catalogSha256'];
const CATALOG_TASK_KEYS = [
  'adapterPayload',
  'caseId',
  'expectedEvidence',
  'maxAttempts',
  'taskId',
  'testId',
  'timeoutMs',
  'unitId',
];
const ADAPTER_KEYS = ['adapterId', 'adapterIdentitySha256'];
const EXPECTED_EVIDENCE_KEYS = [
  'evidenceId',
  'mediaType',
  'required',
  'schema',
];
const CATALOG_EXPECTATION_KEYS = [
  'expectedAdapters',
  'expectedApplicationId',
  'expectedCatalogSha256',
  'expectedRepositoryIdentitySha256',
  'expectedScheduleSha256',
  'expectedTestInventorySha256',
];
const BRIDGE_KEYS = [
  'assignments',
  'bridgeSha256',
  'brokerApplicationIsolationKeySha256',
  'brokerWorkerConfig',
  'binding',
  'outputNamespaces',
  'queueApplicationIsolationKeySha256',
  'schema',
  'source',
  'tasks',
];
const BRIDGE_SOURCE_KEYS = [
  'brokerHandoffSha256',
  'brokerWorkerPolicySha256',
  'queueRevision',
  'queueSha256',
  'scheduleSha256',
  'sourceConfigSha256',
  'submissionSha256',
  'taskCatalogSha256',
  'workKeySha256',
];
const OUTPUT_NAMESPACE_KEYS = [
  'cacheIdentitySha256',
  'evidenceIdentitySha256',
  'failureIdentitySha256',
  'resultsIdentitySha256',
];
const ASSIGNMENT_CORE_KEYS = [
  'adapterId',
  'assignedSlotId',
  'assignedSlotIndex',
  'assignedSlotPosition',
  'assignedWorkerId',
  'caseId',
  'dependencyTaskIds',
  'fingerprint',
  'laneId',
  'predictedDurationMs',
  'predictedFinishOffsetMs',
  'predictedStartOffsetMs',
  'priorSlotTaskId',
  'sequence',
  'taskId',
  'testId',
  'unitId',
];
const ASSIGNMENT_KEYS = [
  ...ASSIGNMENT_CORE_KEYS,
  'assignmentSha256',
  'taskSha256',
];
const TASK_PAYLOAD_KEYS = [
  'adapterPayload',
  'assignment',
  'assignmentSha256',
  'outputNamespaces',
  'scheduleSha256',
  'schema',
  'submissionSha256',
  'taskCatalogSha256',
  'testSuiteId',
];
const BRIDGE_EXPECTATION_KEYS = [
  'brokerHandoff',
  'expectedBridgeSha256',
  'queue',
  'schedule',
  'taskCatalog',
];
const trustedExecutionBridges = new WeakSet();

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function plainObject(value, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object`);
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const sorted = actual.toSorted(compareText);
  const wanted = [...expected].toSorted(compareText);
  if (
    sorted.length !== wanted.length ||
    sorted.some((key, index) => key !== wanted[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function exactText(value, label, maximum = 32_768) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- Values cross machines.
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function sameCanonical(left, right) {
  return canonicalJsonSha256(left) === canonicalJsonSha256(right);
}

function normalizeAdapters(value, label = 'distributed adapter identities') {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${label} must be a nonempty array`);
  const adapters = value
    .map((entry, index) => {
      exactKeys(entry, ADAPTER_KEYS, `${label} entry ${index}`);
      return {
        adapterId: identifier(entry.adapterId, `${label} adapter ID`),
        adapterIdentitySha256: digest(
          entry.adapterIdentitySha256,
          `${label} adapter identity hash`
        ),
      };
    })
    .toSorted((left, right) => compareText(left.adapterId, right.adapterId));
  if (
    new Set(adapters.map((entry) => entry.adapterId)).size !== adapters.length
  )
    throw new Error(`${label} contains a duplicate adapter ID`);
  if (
    new Set(adapters.map((entry) => entry.adapterIdentitySha256)).size !==
    adapters.length
  )
    throw new Error(`${label} contains a duplicate adapter identity hash`);
  return adapters;
}

function normalizeExpectedEvidence(value, taskId) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`Task ${taskId} requires expected evidence`);
  const evidence = value
    .map((entry, index) => {
      exactKeys(
        entry,
        EXPECTED_EVIDENCE_KEYS,
        `task ${taskId} evidence ${index}`
      );
      if (typeof entry.required !== 'boolean')
        throw new Error(
          `Task ${taskId} evidence required flag must be boolean`
        );
      if (
        typeof entry.mediaType !== 'string' ||
        !MEDIA_TYPE.test(entry.mediaType)
      )
        throw new Error(`Task ${taskId} evidence media type is invalid`);
      return {
        evidenceId: identifier(entry.evidenceId, 'evidence ID'),
        schema: identifier(entry.schema, 'evidence schema'),
        mediaType: entry.mediaType,
        required: entry.required,
      };
    })
    .toSorted((left, right) => compareText(left.evidenceId, right.evidenceId));
  if (
    new Set(evidence.map((entry) => entry.evidenceId)).size !== evidence.length
  )
    throw new Error(`Task ${taskId} contains duplicate evidence IDs`);
  if (!evidence.some((entry) => entry.required))
    throw new Error(
      `Task ${taskId} requires at least one required evidence item`
    );
  return evidence;
}

function normalizeCatalogTask(value, index) {
  const label = `distributed task catalog entry ${index}`;
  exactKeys(value, CATALOG_TASK_KEYS, label);
  const taskId = identifier(value.taskId, `${label} task ID`);
  const adapterPayload = structuredClone(value.adapterPayload);
  canonicalJsonSha256(adapterPayload);
  return {
    testId: exactText(value.testId, `${label} test ID`),
    taskId,
    unitId: identifier(value.unitId, `${label} unit ID`),
    caseId: identifier(value.caseId, `${label} case ID`),
    timeoutMs: positiveInteger(value.timeoutMs, `${label} timeout`),
    maxAttempts: positiveInteger(
      value.maxAttempts,
      `${label} maximum attempts`
    ),
    adapterPayload,
    expectedEvidence: normalizeExpectedEvidence(value.expectedEvidence, taskId),
  };
}

function normalizeCatalogInput(value) {
  exactKeys(value, CATALOG_INPUT_KEYS, 'distributed task catalog input');
  if (value.schema !== DISTRIBUTED_TASK_CATALOG_SCHEMA)
    throw new Error('Unsupported distributed task catalog schema');
  if (!Array.isArray(value.tasks) || value.tasks.length === 0)
    throw new Error('Distributed task catalog requires tasks');
  if (value.tasks.length > MAX_DISTRIBUTED_TASK_CATALOG_TASKS)
    throw new Error('Distributed task catalog exceeds its task limit');
  const tasks = value.tasks
    .map(normalizeCatalogTask)
    .toSorted((left, right) => compareText(left.testId, right.testId));
  for (const [label, values] of [
    ['test ID', tasks.map((entry) => entry.testId)],
    ['task ID', tasks.map((entry) => entry.taskId)],
  ])
    if (new Set(values).size !== values.length)
      throw new Error(`Distributed task catalog contains a duplicate ${label}`);
  return {
    schema: DISTRIBUTED_TASK_CATALOG_SCHEMA,
    applicationId: identifier(value.applicationId, 'catalog application ID'),
    repositoryIdentitySha256: digest(
      value.repositoryIdentitySha256,
      'catalog repository identity hash'
    ),
    testInventorySha256: digest(
      value.testInventorySha256,
      'catalog test inventory hash'
    ),
    scheduleSha256: digest(value.scheduleSha256, 'catalog schedule hash'),
    adapters: normalizeAdapters(value.adapters, 'catalog adapter identities'),
    tasks,
  };
}

function sealCatalog(value) {
  const normalized = normalizeCatalogInput(value);
  if (
    Buffer.byteLength(JSON.stringify(normalized), 'utf8') >
    MAX_DISTRIBUTED_TASK_CATALOG_BYTES
  )
    throw new Error('Distributed task catalog exceeds its byte limit');
  return deepFreeze({
    ...normalized,
    catalogSha256: canonicalJsonSha256(normalized),
  });
}

export function createDistributedTaskCatalog(value) {
  return sealCatalog(value);
}

export function verifyDistributedTaskCatalog(value, expectations) {
  exactKeys(value, CATALOG_KEYS, 'sealed distributed task catalog');
  exactKeys(
    expectations,
    CATALOG_EXPECTATION_KEYS,
    'distributed task catalog expectations'
  );
  const { catalogSha256, ...input } = value;
  const catalog = sealCatalog(input);
  const expectedCatalogSha256 = digest(
    expectations.expectedCatalogSha256,
    'expected task catalog hash'
  );
  if (
    catalogSha256 !== catalog.catalogSha256 ||
    catalog.catalogSha256 !== expectedCatalogSha256
  )
    throw new Error('Distributed task catalog does not match its trusted hash');
  if (
    catalog.applicationId !==
    identifier(expectations.expectedApplicationId, 'expected application ID')
  )
    throw new Error('Distributed task catalog belongs to another application');
  if (
    catalog.repositoryIdentitySha256 !==
    digest(
      expectations.expectedRepositoryIdentitySha256,
      'expected repository identity hash'
    )
  )
    throw new Error('Distributed task catalog belongs to another repository');
  if (
    catalog.testInventorySha256 !==
    digest(
      expectations.expectedTestInventorySha256,
      'expected test inventory hash'
    )
  )
    throw new Error('Distributed task catalog has another test inventory');
  if (
    catalog.scheduleSha256 !==
    digest(expectations.expectedScheduleSha256, 'expected schedule hash')
  )
    throw new Error('Distributed task catalog has another schedule');
  const expectedAdapters = normalizeAdapters(
    expectations.expectedAdapters,
    'expected adapter identities'
  );
  if (!sameCanonical(catalog.adapters, expectedAdapters))
    throw new Error('Distributed task catalog has another adapter set');
  return catalog;
}

function activeQueueRecord(queueValue) {
  const queue = snapshotDistributedControllerQueue(queueValue);
  if (queue.activeSubmissionId === null)
    throw new Error('Execution bridge requires an active distributed app');
  const active = queue.submissions.find(
    (entry) => entry.submission.submissionId === queue.activeSubmissionId
  );
  if (!active || active.status !== 'running')
    throw new Error(
      'Execution bridge requires an actively running queue record'
    );
  if (active.executionId === null || active.runAttempt !== 1)
    throw new Error(
      'Execution bridge requires exact first-run execution identity'
    );
  return { queue, active };
}

function scheduleTests(schedule) {
  return schedule.threadSlots
    .flatMap((slot) =>
      slot.tests.map((test, index) => ({
        slot,
        test,
        slotPosition: index + 1,
        priorTest: index === 0 ? null : slot.tests[index - 1],
      }))
    )
    .toSorted((left, right) => left.test.sequence - right.test.sequence);
}

function verifyScheduleWorkers(schedule, brokerHandoff) {
  const config = brokerHandoff.sourceConfig;
  const enabled = config.workers
    .filter((worker) => worker.enabled)
    .toSorted((left, right) => compareText(left.id, right.id));
  const scheduled = [...schedule.nodes].toSorted((left, right) =>
    compareText(left.nodeId, right.nodeId)
  );
  if (
    enabled.length !== scheduled.length ||
    enabled.some((worker, index) => worker.id !== scheduled[index]?.nodeId)
  )
    throw new Error(
      'Distributed schedule worker inventory does not match enabled configuration'
    );
  for (const [index, worker] of enabled.entries()) {
    const capacity = scheduled[index];
    const runsOnControllerHost = config.controllerWorkerId === worker.id;
    if (capacity.runsOnControllerHost !== runsOnControllerHost)
      throw new Error('Distributed schedule controller-host placement drifted');
    if (worker.n === 'auto') {
      if (capacity.concurrencyPolicy !== 'auto')
        throw new Error(
          'Distributed schedule changed automatic worker N policy'
        );
    } else if (
      capacity.concurrencyPolicy !== 'explicit' ||
      capacity.configuredThreadBudget !== worker.n
    ) {
      throw new Error('Distributed schedule changed explicit worker N policy');
    }
  }
}

function outputNamespaces(submission) {
  return Object.fromEntries(
    OUTPUT_NAMESPACE_KEYS.map((key) => [key, digest(submission[key], key)])
  );
}

function bridgeHash(value) {
  const unsigned = { ...value };
  delete unsigned.bridgeSha256;
  return canonicalJsonSha256(unsigned);
}

function assignmentCore({
  catalogTask,
  dependencyTaskIds,
  priorSlotTaskId,
  slot,
  slotPosition,
  test,
}) {
  return {
    sequence: test.sequence,
    testId: test.id,
    fingerprint: test.fingerprint,
    laneId: test.laneId,
    adapterId: test.adapterId,
    taskId: catalogTask.taskId,
    unitId: catalogTask.unitId,
    caseId: catalogTask.caseId,
    assignedWorkerId: slot.nodeId,
    assignedSlotId: `${slot.nodeId}.slot-${slot.threadSlotIndex}`,
    assignedSlotIndex: slot.threadSlotIndex,
    assignedSlotPosition: slotPosition,
    dependencyTaskIds: dependencyTaskIds.toSorted(compareText),
    priorSlotTaskId,
    predictedStartOffsetMs: test.predictedStartOffsetMs,
    predictedDurationMs: test.predictedDurationMs,
    predictedFinishOffsetMs: test.predictedFinishOffsetMs,
  };
}

function deriveBridge({
  queue: queueValue,
  schedule: scheduleValue,
  taskCatalog: catalogValue,
  brokerHandoff: handoffValue,
}) {
  const { queue, active } = activeQueueRecord(queueValue);
  const { submission } = active;
  const schedule = verifyDistributedAdaptiveSchedule(scheduleValue, {
    expectedScheduleSha256: submission.planSha256,
    expectedApplicationId: submission.applicationId,
    expectedRepositoryIdentitySha256: submission.repositoryIdentitySha256,
    expectedTestInventorySha256: submission.inventoryIdentitySha256,
    expectedProfileSha256: submission.profileIdentitySha256,
  });
  const handoff = verifyDistributedBrokerHandoff(handoffValue);
  if (
    handoff.sourceConfig.controllerId !== queue.controllerId ||
    handoff.brokerWorkerConfig.controllerId !== queue.controllerId
  )
    throw new Error('Distributed broker handoff belongs to another controller');
  const catalog = verifyDistributedTaskCatalog(catalogValue, {
    expectedCatalogSha256: submission.taskCatalogIdentitySha256,
    expectedScheduleSha256: schedule.scheduleSha256,
    expectedApplicationId: submission.applicationId,
    expectedRepositoryIdentitySha256: submission.repositoryIdentitySha256,
    expectedTestInventorySha256: submission.inventoryIdentitySha256,
    expectedAdapters: submission.adapters,
  });
  const usedAdapterIds = [
    ...new Set(
      schedule.threadSlots.flatMap((slot) =>
        slot.tests.map((test) => test.adapterId)
      )
    ),
  ].toSorted(compareText);
  const submittedAdapterIds = submission.adapters.map(
    (adapter) => adapter.adapterId
  );
  if (!sameCanonical(usedAdapterIds, submittedAdapterIds))
    throw new Error(
      'Distributed schedule does not use the exact submitted adapters'
    );
  verifyScheduleWorkers(schedule, handoff);

  const binding = verifyBrokerBinding({
    schema: BROKER_BINDING_SCHEMA,
    controllerId: queue.controllerId,
    applicationId: submission.applicationId,
    submissionId: submission.submissionId,
    submissionSequence: active.sequence,
    executionId: active.executionId,
    runAttempt: active.runAttempt,
    repositoryIdentitySha256: submission.repositoryIdentitySha256,
    candidateSha256: submission.revisionIdentitySha256,
    planSha256: schedule.scheduleSha256,
  });
  const brokerIsolation = brokerApplicationIsolationKeySha256(binding);
  const namespaces = outputNamespaces(submission);
  const scheduled = scheduleTests(schedule);
  const catalogByTestId = new Map(
    catalog.tasks.map((task) => [task.testId, task])
  );
  if (catalog.tasks.length !== scheduled.length)
    throw new Error(
      'Task catalog does not exactly cover the distributed schedule'
    );
  const taskIdByTestId = new Map(
    catalog.tasks.map((task) => [task.testId, task.taskId])
  );
  const tasks = [];
  const assignments = [];
  for (const { slot, test, slotPosition, priorTest } of scheduled) {
    const catalogTask = catalogByTestId.get(test.id);
    if (!catalogTask)
      throw new Error(`Task catalog is missing scheduled test: ${test.id}`);
    const dependencyTaskIds = test.dependencies.map((dependency) => {
      const taskId = taskIdByTestId.get(dependency);
      if (!taskId)
        throw new Error(`Task catalog is missing dependency: ${dependency}`);
      return taskId;
    });
    const priorSlotTaskId =
      priorTest === null ? null : taskIdByTestId.get(priorTest.id);
    if (priorTest !== null && !priorSlotTaskId)
      throw new Error(
        `Task catalog is missing prior slot test: ${priorTest.id}`
      );
    const core = assignmentCore({
      catalogTask,
      dependencyTaskIds,
      priorSlotTaskId,
      slot,
      slotPosition,
      test,
    });
    const assignmentSha256 = canonicalJsonSha256(core);
    // Broker task v2 independently seals the worker/slot assignment and
    // dependency gate. The richer bridge assignment stays in the payload so
    // adapters can also reconcile the exact planned test identity and timing.
    const task = sealBrokerTask({
      applicationIsolationKeySha256: brokerIsolation,
      taskId: catalogTask.taskId,
      unitId: catalogTask.unitId,
      caseId: catalogTask.caseId,
      adapterId: test.adapterId,
      assignment: {
        workerId: core.assignedWorkerId,
        slotId: core.assignedSlotId,
        slotIndex: core.assignedSlotIndex,
        slotPosition: core.assignedSlotPosition,
      },
      dependencyTaskIds: core.dependencyTaskIds,
      timeoutMs: catalogTask.timeoutMs,
      maxAttempts: catalogTask.maxAttempts,
      payload: {
        schema: DISTRIBUTED_TASK_PAYLOAD_SCHEMA,
        submissionSha256: submission.submissionSha256,
        scheduleSha256: schedule.scheduleSha256,
        taskCatalogSha256: catalog.catalogSha256,
        testSuiteId: submission.testSuiteId,
        outputNamespaces: namespaces,
        assignment: core,
        assignmentSha256,
        adapterPayload: catalogTask.adapterPayload,
      },
      expectedEvidence: catalogTask.expectedEvidence,
    });
    tasks.push(task);
    assignments.push({
      ...core,
      assignmentSha256,
      taskSha256: task.taskSha256,
    });
  }

  const source = {
    queueSha256: queue.queueSha256,
    queueRevision: queue.revision,
    submissionSha256: submission.submissionSha256,
    workKeySha256: submission.workKeySha256,
    scheduleSha256: schedule.scheduleSha256,
    taskCatalogSha256: catalog.catalogSha256,
    sourceConfigSha256: handoff.sourceConfig.configSha256,
    brokerWorkerPolicySha256: handoff.brokerWorkerPolicySha256,
    brokerHandoffSha256: handoff.handoffSha256,
  };
  const bridge = {
    schema: DISTRIBUTED_EXECUTION_BRIDGE_SCHEMA,
    source,
    binding,
    queueApplicationIsolationKeySha256: active.applicationIsolationKeySha256,
    brokerApplicationIsolationKeySha256: brokerIsolation,
    outputNamespaces: namespaces,
    brokerWorkerConfig: handoff.brokerWorkerConfig,
    tasks: tasks.toSorted((left, right) =>
      compareText(left.taskId, right.taskId)
    ),
    assignments: assignments.toSorted(
      (left, right) => left.sequence - right.sequence
    ),
  };
  return deepFreeze({ ...bridge, bridgeSha256: bridgeHash(bridge) });
}

export function createDistributedExecutionBridge(value) {
  exactKeys(
    value,
    ['brokerHandoff', 'queue', 'schedule', 'taskCatalog'],
    'distributed execution bridge sources'
  );
  const bridge = deriveBridge(value);
  trustedExecutionBridges.add(bridge);
  return bridge;
}

function validateAssignmentShape(value, index) {
  const label = `distributed execution assignment ${index}`;
  exactKeys(value, ASSIGNMENT_KEYS, label);
  const core = Object.fromEntries(
    ASSIGNMENT_CORE_KEYS.map((key) => [key, value[key]])
  );
  if (value.assignmentSha256 !== canonicalJsonSha256(core))
    throw new Error(`${label} hash does not match its contents`);
  digest(value.taskSha256, `${label} task hash`);
}

function validateBridgeShape(value) {
  exactKeys(value, BRIDGE_KEYS, 'sealed distributed execution bridge');
  if (value.schema !== DISTRIBUTED_EXECUTION_BRIDGE_SCHEMA)
    throw new Error('Unsupported distributed execution bridge schema');
  exactKeys(
    value.source,
    BRIDGE_SOURCE_KEYS,
    'execution bridge source identities'
  );
  exactKeys(value.outputNamespaces, OUTPUT_NAMESPACE_KEYS, 'output namespaces');
  verifyBrokerBinding(value.binding);
  digest(
    value.queueApplicationIsolationKeySha256,
    'queue application isolation hash'
  );
  digest(
    value.brokerApplicationIsolationKeySha256,
    'broker application isolation hash'
  );
  if (!Array.isArray(value.tasks) || value.tasks.length === 0)
    throw new Error('Execution bridge requires broker tasks');
  value.tasks.forEach(verifyBrokerTask);
  if (!Array.isArray(value.assignments) || value.assignments.length === 0)
    throw new Error('Execution bridge requires assignments');
  value.assignments.forEach(validateAssignmentShape);
  const taskById = new Map(value.tasks.map((task) => [task.taskId, task]));
  if (taskById.size !== value.tasks.length)
    throw new Error('Execution bridge contains duplicate task IDs');
  if (
    value.assignments.length !== value.tasks.length ||
    value.assignments.some(
      (assignment) =>
        taskById.get(assignment.taskId)?.taskSha256 !== assignment.taskSha256
    )
  )
    throw new Error(
      'Execution bridge assignments do not exactly cover its tasks'
    );
  const sequences = value.assignments.map((entry) => entry.sequence);
  if (sequences.some((sequence, index) => sequence !== index + 1))
    throw new Error('Execution bridge assignment sequence is not contiguous');
  for (const task of value.tasks) {
    exactKeys(task.payload, TASK_PAYLOAD_KEYS, `task ${task.taskId} payload`);
    if (task.payload.schema !== DISTRIBUTED_TASK_PAYLOAD_SCHEMA)
      throw new Error('Execution bridge task payload schema is unsupported');
  }
  digest(value.bridgeSha256, 'execution bridge hash');
  if (value.bridgeSha256 !== bridgeHash(value))
    throw new Error('Execution bridge hash does not match its contents');
}

export function assertTrustedDistributedExecutionBridge(value) {
  if (!trustedExecutionBridges.has(value))
    throw new Error(
      'Distributed execution bridge is not trusted controller runtime state'
    );
  validateBridgeShape(value);
  return value;
}

export function verifyDistributedExecutionBridge(value, expectations) {
  exactKeys(
    expectations,
    BRIDGE_EXPECTATION_KEYS,
    'distributed execution bridge expectations'
  );
  validateBridgeShape(value);
  const expectedBridgeSha256 = digest(
    expectations.expectedBridgeSha256,
    'expected execution bridge hash'
  );
  if (value.bridgeSha256 !== expectedBridgeSha256)
    throw new Error('Execution bridge does not match its trusted hash');
  const expected = deriveBridge({
    queue: expectations.queue,
    schedule: expectations.schedule,
    taskCatalog: expectations.taskCatalog,
    brokerHandoff: expectations.brokerHandoff,
  });
  if (!sameCanonical(value, expected))
    throw new Error('Execution bridge does not match its verified sources');
  trustedExecutionBridges.add(expected);
  return expected;
}
