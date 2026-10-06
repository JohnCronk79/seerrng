// Copyright (c) snapetech and SeerrNG contributors.
// Transport-neutral protocol contracts for distributed validation workers.
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const BROKER_PROTOCOL_VERSION = 2;
export const BROKER_MESSAGE_SCHEMA = 'seerrng-validation-broker-message/v2';
export const BROKER_LOGICAL_COMMAND_SCHEMA =
  'seerrng-validation-broker-logical-command/v1';
export const BROKER_BINDING_SCHEMA = 'seerrng-validation-broker-binding/v1';
export const BROKER_APPLICATION_ISOLATION_SCHEMA =
  'seerrng-validation-broker-application-isolation/v1';
export const BROKER_TASK_SCHEMA = 'seerrng-validation-broker-task/v2';
// V2 intentionally carries pre-message blob identity. V1's artifact seal could
// not be bound to the containing cancellation message without a hash cycle.
export const BROKER_CLEANUP_EVIDENCE_SCHEMA =
  'seerrng-validation-broker-cleanup-evidence/v2';
export const BROKER_CLEANUP_EVIDENCE_NAMESPACE_KIND = 'failure';
export const BROKER_WORKER_CONFIG_SCHEMA =
  'seerrng-validation-broker-worker-config/v1';
export const MAX_EVIDENCE_BLOB_BYTES = 512 * 1024 * 1024;

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const EVIDENCE_SCHEMA_TOKEN_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_EVIDENCE_SCHEMA_TOKEN_BYTES = 256;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const PROOF = /^[A-Za-z0-9_-]{16,8192}$/;
const MESSAGE_KEYS = [
  'auth',
  'binding',
  'body',
  'command',
  'kind',
  'messageId',
  'protocolVersion',
  'schema',
  'sentAtMs',
];
const LOGICAL_COMMAND_KEYS = [
  'applicationIsolationKeySha256',
  'bodySha256',
  'commandId',
  'commandSha256',
  'issuedAtMs',
  'kind',
  'schema',
];
const BINDING_KEYS = [
  'applicationId',
  'candidateSha256',
  'controllerId',
  'executionId',
  'planSha256',
  'repositoryIdentitySha256',
  'runAttempt',
  'schema',
  'submissionId',
  'submissionSequence',
];
const AUTH_KEYS = [
  'algorithm',
  'expiresAtMs',
  'issuedAtMs',
  'keyId',
  'nonce',
  'principalId',
  'proof',
  'sessionId',
];
const TASK_KEYS = [
  'adapterId',
  'applicationIsolationKeySha256',
  'assignment',
  'caseId',
  'dependencyTaskIds',
  'expectedEvidence',
  'maxAttempts',
  'payload',
  'payloadSha256',
  'schema',
  'taskId',
  'taskSha256',
  'timeoutMs',
  'unitId',
];
const TASK_INPUT_KEYS = [
  'adapterId',
  'applicationIsolationKeySha256',
  'assignment',
  'caseId',
  'dependencyTaskIds',
  'expectedEvidence',
  'maxAttempts',
  'payload',
  'taskId',
  'timeoutMs',
  'unitId',
];
const TASK_ASSIGNMENT_KEYS = [
  'slotId',
  'slotIndex',
  'slotPosition',
  'workerId',
];
const EXPECTED_EVIDENCE_KEYS = [
  'evidenceId',
  'mediaType',
  'required',
  'schema',
];
const EVIDENCE_KEYS = [
  'bytes',
  'evidenceId',
  'evidenceKeySha256',
  'mediaType',
  'schema',
  'sha256',
];
const CLEANUP_EVIDENCE_KEYS = [
  'applicationIsolationKeySha256',
  'attempt',
  'blobSha256',
  'bridgeSha256',
  'bytes',
  'cancellationRequestedAtMs',
  'cleanupEvidenceSha256',
  'cleanupKeySha256',
  'completedAtMs',
  'evidenceId',
  'evidenceSchema',
  'instanceId',
  'leaseId',
  'mediaType',
  'namespaceKind',
  'schema',
  'taskId',
  'taskSha256',
  'workerId',
  'workerSessionId',
];
const CLEANUP_EVIDENCE_INPUT_KEYS = [
  'attempt',
  'blobSha256',
  'bridgeSha256',
  'bytes',
  'cancellationRequestedAtMs',
  'completedAtMs',
  'evidenceId',
  'evidenceSchema',
  'instanceId',
  'leaseId',
  'mediaType',
  'taskId',
  'taskSha256',
  'workerId',
  'workerSessionId',
];
const CLEANUP_RECOVERY_KEYS = [
  'applicationIsolationKeySha256',
  'attempt',
  'cleanupEvidence',
  'instanceId',
  'leaseId',
  'recoveredAtMs',
  'taskId',
  'workerId',
  'workerSessionId',
];
const CAPABILITY_KEYS = [
  'adapterIds',
  'architecture',
  'logicalCpuCapacity',
  'maxSafeN',
  'memoryMiB',
  'performanceProfileSha256',
  'platform',
];
const WORKER_CONFIG_KEYS = ['controllerId', 'schema', 'workers'];
const CONFIGURED_WORKER_KEYS = [
  'configuredN',
  'enabled',
  'machineIdentitySha256',
  'workerId',
];
const WORKER_KINDS = new Set([
  'worker.register',
  'worker.capacity',
  'worker.cancelled',
  'worker.heartbeat',
  'worker.result',
]);
const CONTROLLER_KINDS = new Set([
  'lease.grant',
  'lease.renew',
  'lease.cancel',
  'lease.cleanup-recover',
  'result.ack',
]);
const MESSAGE_KINDS = new Set([...WORKER_KINDS, ...CONTROLLER_KINDS]);
const authenticatedMessages = new WeakSet();

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

function exactObject(value, label, expectedKeys) {
  plainObject(value, label);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const actual = keys.toSorted();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function exactText(value, label, maximum = 256) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > maximum ||
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- Cross-machine protocol text.
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

export function normalizeEvidenceSchemaToken(value, label = 'evidence schema') {
  if (
    typeof value !== 'string' ||
    value.normalize('NFC') !== value ||
    Buffer.byteLength(value, 'utf8') > MAX_EVIDENCE_SCHEMA_TOKEN_BYTES
  )
    throw new Error(`Exact ${label} token is required`);
  const segments = value.split('/');
  if (
    segments.length < 1 ||
    segments.length > 2 ||
    segments.some((segment) => !EVIDENCE_SCHEMA_TOKEN_SEGMENT.test(segment))
  )
    throw new Error(`Exact ${label} token is required`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function safeInteger(value, label, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${label} must be a safe integer of at least ${minimum}`);
  return value;
}

function evidenceBytes(value, label, { minimum = 0 } = {}) {
  const bytes = safeInteger(value, label, { minimum });
  if (bytes > MAX_EVIDENCE_BLOB_BYTES)
    throw new Error(
      `${label} must not exceed ${MAX_EVIDENCE_BLOB_BYTES} bytes`
    );
  return bytes;
}

function uniqueIdentifiers(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  const normalized = values.map((value) => identifier(value, label));
  if (new Set(normalized).size !== normalized.length)
    throw new Error(`${label} must not contain duplicates`);
  return normalized.toSorted();
}

function normalizeBinding(value) {
  exactObject(value, 'broker binding', BINDING_KEYS);
  if (value.schema !== BROKER_BINDING_SCHEMA)
    throw new Error('Unsupported broker binding schema');
  return {
    schema: BROKER_BINDING_SCHEMA,
    controllerId: identifier(value.controllerId, 'controller ID'),
    applicationId: identifier(value.applicationId, 'application ID'),
    submissionId: identifier(value.submissionId, 'submission ID'),
    submissionSequence: safeInteger(
      value.submissionSequence,
      'Submission sequence',
      { minimum: 1 }
    ),
    executionId: identifier(value.executionId, 'execution ID'),
    runAttempt: safeInteger(value.runAttempt, 'Run attempt', { minimum: 1 }),
    repositoryIdentitySha256: digest(
      value.repositoryIdentitySha256,
      'repository identity hash'
    ),
    candidateSha256: digest(value.candidateSha256, 'candidate hash'),
    planSha256: digest(value.planSha256, 'plan hash'),
  };
}

export function verifyBrokerBinding(value) {
  return deepFreeze(normalizeBinding(value));
}

export function brokerApplicationIsolationKeySha256(bindingValue) {
  return canonicalJsonSha256({
    schema: BROKER_APPLICATION_ISOLATION_SCHEMA,
    binding: normalizeBinding(bindingValue),
  });
}

function normalizeAuth(value) {
  exactObject(value, 'broker authentication', AUTH_KEYS);
  if (
    !['ed25519', 'hmac-sha256', 'mtls-exporter-sha256'].includes(
      value.algorithm
    )
  )
    throw new Error('Unsupported broker authentication algorithm');
  const auth = {
    algorithm: value.algorithm,
    sessionId: identifier(value.sessionId, 'authentication session ID'),
    principalId: identifier(value.principalId, 'authentication principal ID'),
    keyId: identifier(value.keyId, 'authentication key ID'),
    nonce: exactText(value.nonce, 'authentication nonce', 512),
    issuedAtMs: safeInteger(value.issuedAtMs, 'Authentication issue time'),
    expiresAtMs: safeInteger(value.expiresAtMs, 'Authentication expiry time'),
    proof: value.proof,
  };
  if (!PROOF.test(auth.proof ?? ''))
    throw new Error('Exact detached authentication proof is required');
  if (auth.expiresAtMs <= auth.issuedAtMs)
    throw new Error('Authentication expiry must follow its issue time');
  return auth;
}

function normalizeExpectedEvidence(value) {
  exactObject(value, 'expected evidence identity', EXPECTED_EVIDENCE_KEYS);
  if (typeof value.required !== 'boolean')
    throw new Error('Expected evidence required flag must be boolean');
  if (typeof value.mediaType !== 'string' || !MEDIA_TYPE.test(value.mediaType))
    throw new Error('Exact expected evidence media type is required');
  return {
    evidenceId: identifier(value.evidenceId, 'evidence ID'),
    schema: normalizeEvidenceSchemaToken(value.schema),
    mediaType: value.mediaType,
    required: value.required,
  };
}

function normalizeTaskAssignment(value) {
  exactObject(value, 'broker task assignment', TASK_ASSIGNMENT_KEYS);
  const workerId = identifier(value.workerId, 'assigned worker ID');
  const slotIndex = safeInteger(value.slotIndex, 'Assigned slot index', {
    minimum: 1,
  });
  const slotId = identifier(value.slotId, 'assigned slot ID');
  if (slotId !== `${workerId}.slot-${slotIndex}`)
    throw new Error('Broker task assignment requires its canonical slot ID');
  return {
    workerId,
    slotId,
    slotIndex,
    slotPosition: safeInteger(value.slotPosition, 'Assigned slot position', {
      minimum: 1,
    }),
  };
}

function normalizeTaskWithoutSeal(value) {
  exactObject(value, 'broker task input', TASK_INPUT_KEYS);
  if (!Array.isArray(value.expectedEvidence))
    throw new Error('Expected evidence identities must be an array');
  const expectedEvidence = value.expectedEvidence.map(
    normalizeExpectedEvidence
  );
  if (expectedEvidence.length === 0)
    throw new Error('Broker task requires at least one evidence identity');
  if (!expectedEvidence.some((entry) => entry.required))
    throw new Error('Broker task requires at least one required evidence item');
  const evidenceIds = expectedEvidence.map((entry) => entry.evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length)
    throw new Error('Expected evidence IDs must be unique');
  const taskId = identifier(value.taskId, 'task ID');
  const dependencyTaskIds = uniqueIdentifiers(
    value.dependencyTaskIds,
    'dependency task IDs'
  );
  if (dependencyTaskIds.includes(taskId))
    throw new Error('Broker task cannot depend on itself');
  const payloadSha256 = canonicalJsonSha256(value.payload);
  return {
    schema: BROKER_TASK_SCHEMA,
    applicationIsolationKeySha256: digest(
      value.applicationIsolationKeySha256,
      'application isolation key hash'
    ),
    taskId,
    unitId: identifier(value.unitId, 'unit ID'),
    caseId: identifier(value.caseId, 'case ID'),
    adapterId: identifier(value.adapterId, 'native adapter ID'),
    assignment: normalizeTaskAssignment(value.assignment),
    dependencyTaskIds,
    timeoutMs: safeInteger(value.timeoutMs, 'Task timeout', { minimum: 1 }),
    maxAttempts: safeInteger(value.maxAttempts, 'Maximum task attempts', {
      minimum: 1,
    }),
    payload: structuredClone(value.payload),
    payloadSha256,
    expectedEvidence: expectedEvidence.toSorted((left, right) =>
      compareText(left.evidenceId, right.evidenceId)
    ),
  };
}

function taskSeal(value) {
  const unsigned = { ...value };
  delete unsigned.taskSha256;
  return canonicalJsonSha256(unsigned);
}

export function sealBrokerTask(value) {
  const task = normalizeTaskWithoutSeal(value);
  return deepFreeze({ ...task, taskSha256: taskSeal(task) });
}

export function verifyBrokerTask(value) {
  exactObject(value, 'broker task', TASK_KEYS);
  if (value.schema !== BROKER_TASK_SCHEMA)
    throw new Error('Unsupported broker task schema');
  const task = normalizeTaskWithoutSeal({
    applicationIsolationKeySha256: value.applicationIsolationKeySha256,
    taskId: value.taskId,
    unitId: value.unitId,
    caseId: value.caseId,
    adapterId: value.adapterId,
    assignment: value.assignment,
    dependencyTaskIds: value.dependencyTaskIds,
    timeoutMs: value.timeoutMs,
    maxAttempts: value.maxAttempts,
    payload: value.payload,
    expectedEvidence: value.expectedEvidence,
  });
  if (value.payloadSha256 !== task.payloadSha256)
    throw new Error('Broker task payload hash does not match its payload');
  const sealed = { ...task, taskSha256: taskSeal(task) };
  if (value.taskSha256 !== sealed.taskSha256)
    throw new Error('Broker task seal does not match its contents');
  return deepFreeze(sealed);
}

function normalizeCapabilities(value) {
  exactObject(value, 'worker capabilities', CAPABILITY_KEYS);
  const logicalCpuCapacity = safeInteger(
    value.logicalCpuCapacity,
    'Logical CPU capacity',
    { minimum: 1 }
  );
  const maxSafeN = safeInteger(value.maxSafeN, 'Maximum safe N', {
    minimum: 1,
  });
  if (maxSafeN > logicalCpuCapacity)
    throw new Error('Maximum safe N cannot exceed logical CPU capacity');
  const adapterIds = uniqueIdentifiers(value.adapterIds, 'native adapter IDs');
  if (adapterIds.length === 0)
    throw new Error('Worker must advertise at least one native adapter');
  return {
    platform: identifier(value.platform, 'worker platform'),
    architecture: identifier(value.architecture, 'worker architecture'),
    logicalCpuCapacity,
    maxSafeN,
    memoryMiB: safeInteger(value.memoryMiB, 'Worker memory MiB', {
      minimum: 1,
    }),
    performanceProfileSha256: digest(
      value.performanceProfileSha256,
      'worker performance profile hash'
    ),
    adapterIds,
  };
}

function normalizeRegistration(value) {
  exactObject(value, 'worker registration', [
    'agentVersion',
    'capabilities',
    'instanceId',
    'machineIdentitySha256',
    'workerId',
  ]);
  if (
    typeof value.agentVersion !== 'string' ||
    !VERSION.test(value.agentVersion)
  )
    throw new Error('Exact worker agent version is required');
  return {
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    machineIdentitySha256: digest(
      value.machineIdentitySha256,
      'worker machine identity hash'
    ),
    agentVersion: value.agentVersion,
    capabilities: normalizeCapabilities(value.capabilities),
  };
}

function normalizeCapacity(value) {
  exactObject(value, 'worker capacity report', [
    'activeLeaseIds',
    'availableMemoryMiB',
    'instanceId',
    'loadPermille',
    'observedAtMs',
    'performanceProfileSha256',
    'performanceScorePermille',
    'reportSequence',
    'safeAvailableN',
    'workerId',
    'workerSessionId',
  ]);
  const loadPermille = safeInteger(value.loadPermille, 'Worker load permille');
  if (loadPermille > 1000)
    throw new Error('Worker load permille cannot exceed 1000');
  return {
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    reportSequence: safeInteger(
      value.reportSequence,
      'Capacity report sequence',
      { minimum: 1 }
    ),
    observedAtMs: safeInteger(value.observedAtMs, 'Capacity observation time'),
    safeAvailableN: safeInteger(value.safeAvailableN, 'Safe available N'),
    availableMemoryMiB: safeInteger(
      value.availableMemoryMiB,
      'Available worker memory MiB'
    ),
    loadPermille,
    performanceProfileSha256: digest(
      value.performanceProfileSha256,
      'capacity performance profile hash'
    ),
    performanceScorePermille: safeInteger(
      value.performanceScorePermille,
      'Worker performance score permille',
      { minimum: 1 }
    ),
    activeLeaseIds: uniqueIdentifiers(value.activeLeaseIds, 'active lease IDs'),
  };
}

function normalizeActiveLease(value) {
  exactObject(value, 'heartbeat active lease', [
    'attempt',
    'leaseId',
    'taskId',
  ]);
  return {
    leaseId: identifier(value.leaseId, 'lease ID'),
    taskId: identifier(value.taskId, 'task ID'),
    attempt: safeInteger(value.attempt, 'Task attempt', { minimum: 1 }),
  };
}

function normalizeHeartbeat(value) {
  exactObject(value, 'worker heartbeat', [
    'activeLeases',
    'capacitySequence',
    'instanceId',
    'observedAtMs',
    'workerId',
    'workerSessionId',
  ]);
  if (!Array.isArray(value.activeLeases))
    throw new Error('Heartbeat active leases must be an array');
  const activeLeases = value.activeLeases.map(normalizeActiveLease);
  const leaseIds = activeLeases.map((entry) => entry.leaseId);
  if (new Set(leaseIds).size !== leaseIds.length)
    throw new Error('Heartbeat active leases must not contain duplicates');
  return {
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    observedAtMs: safeInteger(value.observedAtMs, 'Heartbeat observation time'),
    capacitySequence: safeInteger(
      value.capacitySequence,
      'Heartbeat capacity sequence',
      { minimum: 1 }
    ),
    activeLeases: activeLeases.toSorted((left, right) =>
      compareText(left.leaseId, right.leaseId)
    ),
  };
}

function normalizeLeaseGrant(value) {
  exactObject(value, 'lease grant', [
    'attempt',
    'expiresAtMs',
    'instanceId',
    'leaseId',
    'maxAttempts',
    'task',
    'workerId',
    'workerSessionId',
  ]);
  const attempt = safeInteger(value.attempt, 'Task attempt', { minimum: 1 });
  const maxAttempts = safeInteger(value.maxAttempts, 'Maximum task attempts', {
    minimum: 1,
  });
  if (attempt > maxAttempts)
    throw new Error('Task attempt cannot exceed maximum attempts');
  const workerId = identifier(value.workerId, 'worker ID');
  const task = verifyBrokerTask(value.task);
  if (workerId !== task.assignment.workerId)
    throw new Error(
      'Lease grant worker does not match the sealed task assignment'
    );
  if (maxAttempts !== task.maxAttempts)
    throw new Error('Lease retry limit does not match the sealed task');
  return {
    workerId,
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    leaseId: identifier(value.leaseId, 'lease ID'),
    attempt,
    maxAttempts,
    expiresAtMs: safeInteger(value.expiresAtMs, 'Lease expiry time'),
    task,
  };
}

function normalizeLeaseRenewal(value) {
  exactObject(value, 'lease renewal', [
    'attempt',
    'expiresAtMs',
    'instanceId',
    'leaseId',
    'taskId',
    'workerId',
    'workerSessionId',
  ]);
  return {
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    leaseId: identifier(value.leaseId, 'lease ID'),
    taskId: identifier(value.taskId, 'task ID'),
    attempt: safeInteger(value.attempt, 'Task attempt', { minimum: 1 }),
    expiresAtMs: safeInteger(value.expiresAtMs, 'Lease expiry time'),
  };
}

function normalizeCancellation(value) {
  exactObject(value, 'lease cancellation', [
    'attempt',
    'instanceId',
    'leaseId',
    'mode',
    'reasonCode',
    'requestedAtMs',
    'taskId',
    'workerId',
    'workerSessionId',
  ]);
  if (!['abort-attempt', 'cancel-task'].includes(value.mode))
    throw new Error('Unsupported cancellation mode');
  return {
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    leaseId: identifier(value.leaseId, 'lease ID'),
    taskId: identifier(value.taskId, 'task ID'),
    attempt: safeInteger(value.attempt, 'Task attempt', { minimum: 1 }),
    requestedAtMs: safeInteger(
      value.requestedAtMs,
      'Cancellation request time'
    ),
    mode: value.mode,
    reasonCode: identifier(value.reasonCode, 'cancellation reason code'),
  };
}

export function brokerCleanupKeySha256(bindingValue, value) {
  plainObject(value, 'cleanup evidence identity');
  return canonicalJsonSha256({
    binding: normalizeBinding(bindingValue),
    bridgeSha256: digest(value.bridgeSha256, 'execution bridge hash'),
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    leaseId: identifier(value.leaseId, 'lease ID'),
    taskId: identifier(value.taskId, 'task ID'),
    taskSha256: digest(value.taskSha256, 'task hash'),
    attempt: safeInteger(value.attempt, 'Task attempt', { minimum: 1 }),
    cancellationRequestedAtMs: safeInteger(
      value.cancellationRequestedAtMs,
      'Cancellation request time'
    ),
  });
}

function cleanupEvidenceSeal(value) {
  const unsigned = { ...value };
  delete unsigned.cleanupEvidenceSha256;
  return canonicalJsonSha256(unsigned);
}

function normalizeCleanupEvidenceWithoutSeal(value, binding) {
  exactObject(value, 'cleanup evidence input', CLEANUP_EVIDENCE_INPUT_KEYS);
  if (typeof value.mediaType !== 'string' || !MEDIA_TYPE.test(value.mediaType))
    throw new Error('Exact cleanup evidence media type is required');
  const evidence = {
    schema: BROKER_CLEANUP_EVIDENCE_SCHEMA,
    applicationIsolationKeySha256: brokerApplicationIsolationKeySha256(binding),
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    leaseId: identifier(value.leaseId, 'lease ID'),
    taskId: identifier(value.taskId, 'task ID'),
    taskSha256: digest(value.taskSha256, 'task hash'),
    bridgeSha256: digest(value.bridgeSha256, 'execution bridge hash'),
    attempt: safeInteger(value.attempt, 'Task attempt', { minimum: 1 }),
    cancellationRequestedAtMs: safeInteger(
      value.cancellationRequestedAtMs,
      'Cancellation request time'
    ),
    completedAtMs: safeInteger(
      value.completedAtMs,
      'Cleanup evidence completion time'
    ),
    evidenceId: identifier(value.evidenceId, 'cleanup evidence ID'),
    evidenceSchema: normalizeEvidenceSchemaToken(
      value.evidenceSchema,
      'cleanup evidence content schema'
    ),
    mediaType: value.mediaType,
    bytes: evidenceBytes(value.bytes, 'Cleanup evidence byte count', {
      minimum: 1,
    }),
    blobSha256: digest(value.blobSha256, 'cleanup evidence blob hash'),
    namespaceKind: BROKER_CLEANUP_EVIDENCE_NAMESPACE_KIND,
  };
  if (evidence.completedAtMs < evidence.cancellationRequestedAtMs)
    throw new Error('Cleanup cannot complete before cancellation is requested');
  return {
    ...evidence,
    cleanupKeySha256: brokerCleanupKeySha256(binding, evidence),
  };
}

// Low-level protocol primitive. Runtime workers must seal cleanup from their
// trusted lifecycle state through the worker-attempt runtime authority.
export function sealBrokerCleanupEvidence(bindingValue, value) {
  const evidence = normalizeCleanupEvidenceWithoutSeal(
    value,
    normalizeBinding(bindingValue)
  );
  return deepFreeze({
    ...evidence,
    cleanupEvidenceSha256: cleanupEvidenceSeal(evidence),
  });
}

export function verifyBrokerCleanupEvidence(bindingValue, value) {
  exactObject(value, 'cleanup evidence', CLEANUP_EVIDENCE_KEYS);
  if (value.schema !== BROKER_CLEANUP_EVIDENCE_SCHEMA)
    throw new Error('Unsupported cleanup evidence schema');
  if (value.namespaceKind !== BROKER_CLEANUP_EVIDENCE_NAMESPACE_KIND)
    throw new Error('Cleanup evidence must use the failure namespace');
  const evidence = normalizeCleanupEvidenceWithoutSeal(
    {
      workerId: value.workerId,
      instanceId: value.instanceId,
      workerSessionId: value.workerSessionId,
      leaseId: value.leaseId,
      taskId: value.taskId,
      taskSha256: value.taskSha256,
      bridgeSha256: value.bridgeSha256,
      attempt: value.attempt,
      cancellationRequestedAtMs: value.cancellationRequestedAtMs,
      completedAtMs: value.completedAtMs,
      evidenceId: value.evidenceId,
      evidenceSchema: value.evidenceSchema,
      mediaType: value.mediaType,
      bytes: value.bytes,
      blobSha256: value.blobSha256,
    },
    normalizeBinding(bindingValue)
  );
  if (value.cleanupKeySha256 !== evidence.cleanupKeySha256)
    throw new Error('Cleanup evidence identity is not bound to its lease');
  if (
    value.applicationIsolationKeySha256 !==
    evidence.applicationIsolationKeySha256
  )
    throw new Error(
      'Cleanup evidence crossed an application isolation boundary'
    );
  const sealed = {
    ...evidence,
    cleanupEvidenceSha256: cleanupEvidenceSeal(evidence),
  };
  if (value.cleanupEvidenceSha256 !== sealed.cleanupEvidenceSha256)
    throw new Error('Cleanup evidence seal does not match its contents');
  return deepFreeze(sealed);
}

function normalizeCancellationAcknowledgement(value, binding) {
  exactObject(value, 'cancellation acknowledgement', [
    'attempt',
    'cancelledAtMs',
    'cleanupEvidence',
    'instanceId',
    'leaseId',
    'taskId',
    'workerId',
    'workerSessionId',
  ]);
  const acknowledgement = {
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    leaseId: identifier(value.leaseId, 'lease ID'),
    taskId: identifier(value.taskId, 'task ID'),
    attempt: safeInteger(value.attempt, 'Task attempt', { minimum: 1 }),
    cancelledAtMs: safeInteger(
      value.cancelledAtMs,
      'Cancellation completion time'
    ),
    cleanupEvidence: verifyBrokerCleanupEvidence(
      binding,
      value.cleanupEvidence
    ),
  };
  const cleanup = acknowledgement.cleanupEvidence;
  if (
    cleanup.workerId !== acknowledgement.workerId ||
    cleanup.instanceId !== acknowledgement.instanceId ||
    cleanup.workerSessionId !== acknowledgement.workerSessionId ||
    cleanup.leaseId !== acknowledgement.leaseId ||
    cleanup.taskId !== acknowledgement.taskId ||
    cleanup.attempt !== acknowledgement.attempt ||
    cleanup.completedAtMs !== acknowledgement.cancelledAtMs
  )
    throw new Error(
      'Cancellation acknowledgement is not bound to its cleanup evidence'
    );
  return acknowledgement;
}

function normalizeCleanupRecovery(value, binding) {
  exactObject(value, 'controller cleanup recovery', CLEANUP_RECOVERY_KEYS);
  const recovery = {
    applicationIsolationKeySha256: brokerApplicationIsolationKeySha256(binding),
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    leaseId: identifier(value.leaseId, 'lease ID'),
    taskId: identifier(value.taskId, 'task ID'),
    attempt: safeInteger(value.attempt, 'Task attempt', { minimum: 1 }),
    recoveredAtMs: safeInteger(
      value.recoveredAtMs,
      'Cleanup recovery observation time'
    ),
    cleanupEvidence: verifyBrokerCleanupEvidence(
      binding,
      value.cleanupEvidence
    ),
  };
  const cleanup = recovery.cleanupEvidence;
  if (
    value.applicationIsolationKeySha256 !==
      recovery.applicationIsolationKeySha256 ||
    cleanup.applicationIsolationKeySha256 !==
      recovery.applicationIsolationKeySha256
  )
    throw new Error(
      'Cleanup recovery crossed an application isolation boundary'
    );
  if (
    cleanup.workerId !== recovery.workerId ||
    cleanup.instanceId !== recovery.instanceId ||
    cleanup.workerSessionId !== recovery.workerSessionId ||
    cleanup.leaseId !== recovery.leaseId ||
    cleanup.taskId !== recovery.taskId ||
    cleanup.attempt !== recovery.attempt ||
    cleanup.completedAtMs > recovery.recoveredAtMs
  )
    throw new Error(
      'Cleanup recovery is not bound to its exact cleanup evidence'
    );
  return recovery;
}

export function brokerResultKeySha256(bindingValue, taskId, attempt) {
  return canonicalJsonSha256({
    binding: normalizeBinding(bindingValue),
    taskId: identifier(taskId, 'task ID'),
    attempt: safeInteger(attempt, 'Task attempt', { minimum: 1 }),
  });
}

export function brokerEvidenceKeySha256(
  bindingValue,
  taskId,
  attempt,
  evidenceId
) {
  return canonicalJsonSha256({
    binding: normalizeBinding(bindingValue),
    taskId: identifier(taskId, 'task ID'),
    attempt: safeInteger(attempt, 'Task attempt', { minimum: 1 }),
    evidenceId: identifier(evidenceId, 'evidence ID'),
  });
}

function normalizeEvidence(value, binding, taskId, attempt) {
  exactObject(value, 'result evidence', EVIDENCE_KEYS);
  if (typeof value.mediaType !== 'string' || !MEDIA_TYPE.test(value.mediaType))
    throw new Error('Exact result evidence media type is required');
  const evidenceId = identifier(value.evidenceId, 'evidence ID');
  const evidence = {
    evidenceId,
    evidenceKeySha256: brokerEvidenceKeySha256(
      binding,
      taskId,
      attempt,
      evidenceId
    ),
    schema: normalizeEvidenceSchemaToken(value.schema),
    mediaType: value.mediaType,
    bytes: evidenceBytes(value.bytes, 'Evidence byte count', { minimum: 1 }),
    sha256: digest(value.sha256, 'evidence hash'),
  };
  if (value.evidenceKeySha256 !== evidence.evidenceKeySha256)
    throw new Error('Evidence identity is not bound to its task attempt');
  return evidence;
}

function normalizeOutcome(value) {
  exactObject(value, 'worker result outcome', [
    'cancelled',
    'completed',
    'exitCode',
    'resultSha256',
    'status',
    'timedOut',
  ]);
  if (!['failed', 'passed'].includes(value.status))
    throw new Error('Worker result status must be passed or failed');
  if (value.completed !== true)
    throw new Error('Worker result must represent completed native work');
  if (
    typeof value.cancelled !== 'boolean' ||
    typeof value.timedOut !== 'boolean'
  )
    throw new Error('Worker result lifecycle flags must be boolean');
  if (
    (!Number.isSafeInteger(value.exitCode) && value.exitCode !== null) ||
    (Number.isSafeInteger(value.exitCode) && value.exitCode < 0)
  )
    throw new Error('Worker result exit code must be null or nonnegative');
  if (
    value.status === 'passed' &&
    (value.exitCode !== 0 || value.cancelled || value.timedOut)
  )
    throw new Error('A passed result requires clean native completion');
  if (
    value.status === 'failed' &&
    value.exitCode === 0 &&
    !value.cancelled &&
    !value.timedOut
  )
    throw new Error('A failed result requires native failure evidence');
  return {
    status: value.status,
    exitCode: value.exitCode,
    completed: true,
    cancelled: value.cancelled,
    timedOut: value.timedOut,
    resultSha256: digest(value.resultSha256, 'native result hash'),
  };
}

function normalizeResult(value, binding) {
  exactObject(value, 'worker result', [
    'attempt',
    'applicationIsolationKeySha256',
    'completedAtMs',
    'evidence',
    'instanceId',
    'leaseId',
    'outcome',
    'resultKeySha256',
    'taskId',
    'taskSha256',
    'workerId',
    'workerSessionId',
  ]);
  const taskId = identifier(value.taskId, 'task ID');
  const attempt = safeInteger(value.attempt, 'Task attempt', { minimum: 1 });
  if (!Array.isArray(value.evidence))
    throw new Error('Worker result evidence must be an array');
  const evidence = value.evidence.map((entry) =>
    normalizeEvidence(entry, binding, taskId, attempt)
  );
  const evidenceIds = evidence.map((entry) => entry.evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length)
    throw new Error('Worker result evidence IDs must be exact-once');
  const result = {
    applicationIsolationKeySha256: brokerApplicationIsolationKeySha256(binding),
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    leaseId: identifier(value.leaseId, 'lease ID'),
    taskId,
    taskSha256: digest(value.taskSha256, 'task hash'),
    attempt,
    completedAtMs: safeInteger(value.completedAtMs, 'Result completion time'),
    resultKeySha256: brokerResultKeySha256(binding, taskId, attempt),
    outcome: normalizeOutcome(value.outcome),
    evidence: evidence.toSorted((left, right) =>
      compareText(left.evidenceId, right.evidenceId)
    ),
  };
  if (value.resultKeySha256 !== result.resultKeySha256)
    throw new Error('Worker result identity is not bound to its task attempt');
  if (
    value.applicationIsolationKeySha256 !== result.applicationIsolationKeySha256
  )
    throw new Error('Worker result crossed an application isolation boundary');
  return result;
}

function normalizeAcknowledgement(value, binding) {
  exactObject(value, 'result acknowledgement', [
    'acceptedAtMs',
    'applicationIsolationKeySha256',
    'disposition',
    'instanceId',
    'resultKeySha256',
    'submissionSha256',
    'taskId',
    'workerId',
    'workerSessionId',
  ]);
  if (!['accepted', 'duplicate'].includes(value.disposition))
    throw new Error('Unsupported result acknowledgement disposition');
  const applicationIsolationKeySha256 =
    brokerApplicationIsolationKeySha256(binding);
  if (value.applicationIsolationKeySha256 !== applicationIsolationKeySha256)
    throw new Error(
      'Result acknowledgement crossed an application isolation boundary'
    );
  return {
    applicationIsolationKeySha256,
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    taskId: identifier(value.taskId, 'task ID'),
    resultKeySha256: digest(value.resultKeySha256, 'result key hash'),
    submissionSha256: digest(value.submissionSha256, 'result submission hash'),
    acceptedAtMs: safeInteger(value.acceptedAtMs, 'Result acceptance time'),
    disposition: value.disposition,
  };
}

function normalizeBody(kind, value, binding) {
  switch (kind) {
    case 'worker.register':
      return normalizeRegistration(value);
    case 'worker.capacity':
      return normalizeCapacity(value);
    case 'worker.cancelled':
      return normalizeCancellationAcknowledgement(value, binding);
    case 'worker.heartbeat':
      return normalizeHeartbeat(value);
    case 'lease.grant':
      return normalizeLeaseGrant(value);
    case 'lease.renew':
      return normalizeLeaseRenewal(value);
    case 'lease.cancel':
      return normalizeCancellation(value);
    case 'lease.cleanup-recover':
      return normalizeCleanupRecovery(value, binding);
    case 'worker.result':
      return normalizeResult(value, binding);
    case 'result.ack':
      return normalizeAcknowledgement(value, binding);
    default:
      throw new Error('Unsupported broker message kind');
  }
}

function logicalCommandSeal(value) {
  const unsigned = { ...value };
  delete unsigned.commandSha256;
  return canonicalJsonSha256(unsigned);
}

function normalizeLogicalCommandIdentity(value) {
  exactObject(value, 'broker logical command', LOGICAL_COMMAND_KEYS);
  if (value.schema !== BROKER_LOGICAL_COMMAND_SCHEMA)
    throw new Error('Unsupported broker logical command schema');
  if (!CONTROLLER_KINDS.has(value.kind))
    throw new Error('Unsupported broker logical command kind');
  const command = {
    schema: BROKER_LOGICAL_COMMAND_SCHEMA,
    applicationIsolationKeySha256: digest(
      value.applicationIsolationKeySha256,
      'logical command application isolation hash'
    ),
    commandId: identifier(value.commandId, 'logical command ID'),
    kind: value.kind,
    issuedAtMs: safeInteger(value.issuedAtMs, 'Logical command issue time'),
    bodySha256: digest(value.bodySha256, 'logical command body hash'),
  };
  const sealed = { ...command, commandSha256: logicalCommandSeal(command) };
  if (value.commandSha256 !== sealed.commandSha256)
    throw new Error('Logical command seal does not match its identity');
  return sealed;
}

function normalizeLogicalCommand(value, binding, kind, body) {
  const command = normalizeLogicalCommandIdentity(value);
  if (command.kind !== kind)
    throw new Error('Broker logical command kind does not match its message');
  if (
    command.applicationIsolationKeySha256 !==
    brokerApplicationIsolationKeySha256(binding)
  )
    throw new Error(
      'Logical command crossed an application isolation boundary'
    );
  if (command.bodySha256 !== canonicalJsonSha256(body))
    throw new Error(
      'Logical command body hash does not match its message body'
    );
  return command;
}

export function sealBrokerLogicalCommand({
  binding: bindingValue,
  kind,
  commandId,
  issuedAtMs,
  body: bodyValue,
}) {
  if (!CONTROLLER_KINDS.has(kind))
    throw new Error('Only controller messages may carry logical commands');
  const binding = normalizeBinding(bindingValue);
  const body = normalizeBody(kind, bodyValue, binding);
  const command = {
    schema: BROKER_LOGICAL_COMMAND_SCHEMA,
    applicationIsolationKeySha256: brokerApplicationIsolationKeySha256(binding),
    commandId: identifier(commandId, 'logical command ID'),
    kind,
    issuedAtMs: safeInteger(issuedAtMs, 'Logical command issue time'),
    bodySha256: canonicalJsonSha256(body),
  };
  return deepFreeze({
    ...command,
    commandSha256: logicalCommandSeal(command),
  });
}

export function verifyBrokerLogicalCommand(
  value,
  { expectedBinding, expectedKind, expectedBody } = {}
) {
  const binding = normalizeBinding(expectedBinding);
  if (expectedKind === undefined || expectedBody === undefined)
    throw new Error(
      'Logical command verification requires its expected kind and body'
    );
  const body = normalizeBody(expectedKind, expectedBody, binding);
  return deepFreeze(
    normalizeLogicalCommand(value, binding, expectedKind, body)
  );
}

export function verifyBrokerLogicalCommandIdentity(
  value,
  { expectedBinding } = {}
) {
  const command = deepFreeze(normalizeLogicalCommandIdentity(value));
  if (
    expectedBinding !== undefined &&
    command.applicationIsolationKeySha256 !==
      brokerApplicationIsolationKeySha256(expectedBinding)
  )
    throw new Error(
      'Logical command crossed an application isolation boundary'
    );
  return command;
}

function expectedPrincipal(message) {
  if (WORKER_KINDS.has(message.kind)) return message.body.workerId;
  if (CONTROLLER_KINDS.has(message.kind)) return message.binding.controllerId;
  throw new Error('Unsupported broker message principal');
}

function normalizeMessage(value) {
  exactObject(value, 'broker message', MESSAGE_KEYS);
  if (value.schema !== BROKER_MESSAGE_SCHEMA)
    throw new Error('Unsupported broker message schema');
  if (value.protocolVersion !== BROKER_PROTOCOL_VERSION)
    throw new Error('Unsupported broker protocol version');
  if (!MESSAGE_KINDS.has(value.kind))
    throw new Error('Unsupported broker message kind');
  const binding = normalizeBinding(value.binding);
  const body = normalizeBody(value.kind, value.body, binding);
  const command = CONTROLLER_KINDS.has(value.kind)
    ? normalizeLogicalCommand(value.command, binding, value.kind, body)
    : value.command === null
      ? null
      : (() => {
          throw new Error('Worker messages cannot carry logical commands');
        })();
  const message = {
    schema: BROKER_MESSAGE_SCHEMA,
    protocolVersion: BROKER_PROTOCOL_VERSION,
    messageId: identifier(value.messageId, 'message ID'),
    kind: value.kind,
    sentAtMs: safeInteger(value.sentAtMs, 'Message send time'),
    binding,
    auth: normalizeAuth(value.auth),
    command,
    body,
  };
  if (message.auth.principalId !== expectedPrincipal(message))
    throw new Error('Authenticated principal cannot send this message');
  if (
    WORKER_KINDS.has(message.kind) &&
    message.kind !== 'worker.register' &&
    message.body.workerSessionId !== message.auth.sessionId
  )
    throw new Error(
      'Worker message body is not bound to its authenticated session'
    );
  if (
    message.sentAtMs < message.auth.issuedAtMs ||
    message.sentAtMs > message.auth.expiresAtMs
  )
    throw new Error(
      'Broker message was sent outside its authenticated session'
    );
  if (message.command && message.command.issuedAtMs > message.sentAtMs)
    throw new Error(
      'Logical command cannot be issued after its envelope is sent'
    );
  return message;
}

export function createBrokerMessage(value) {
  return deepFreeze(normalizeMessage(value));
}

export function brokerMessageSigningSha256(value) {
  plainObject(value, 'broker message signing input');
  plainObject(value.auth, 'broker authentication signing input');
  const message = normalizeMessage({
    ...value,
    auth: { ...value.auth, proof: 'unsigned-proof-value' },
  });
  return canonicalJsonSha256({
    ...message,
    auth: { ...message.auth, proof: null },
  });
}

export function authenticateBrokerMessage(
  value,
  { expectedBinding, nowMs, verifyProof }
) {
  if (typeof verifyProof !== 'function')
    throw new Error(
      'Broker authentication requires an external proof verifier'
    );
  const message = deepFreeze(normalizeMessage(value));
  safeInteger(nowMs, 'Authentication clock');
  if (nowMs < message.auth.issuedAtMs || nowMs > message.auth.expiresAtMs)
    throw new Error('Broker authentication session is not currently valid');
  if (message.sentAtMs > nowMs)
    throw new Error('Broker message send time is in the future');
  if (
    expectedBinding !== undefined &&
    canonicalJsonSha256(message.binding) !==
      canonicalJsonSha256(normalizeBinding(expectedBinding))
  )
    throw new Error(
      'Broker message is not bound to the expected application submission and plan'
    );
  const signingSha256 = brokerMessageSigningSha256(message);
  // The transport adapter owns credentials, cryptographic verification, and
  // nonce replay protection. This protocol never receives or stores secrets.
  const verified = verifyProof({
    auth: message.auth,
    signingSha256,
    message,
  });
  if (verified && typeof verified.then === 'function')
    throw new Error('Broker proof verifier must be synchronous');
  if (verified !== true)
    throw new Error('Broker authentication proof was rejected');
  authenticatedMessages.add(message);
  return message;
}

export function assertAuthenticatedBrokerMessage(value, kind) {
  if (!authenticatedMessages.has(value))
    throw new Error('Broker message has not passed authentication');
  if (kind !== undefined && value.kind !== kind)
    throw new Error(`Expected broker message kind ${kind}`);
  return value;
}

function normalizeConfiguredWorker(value) {
  exactObject(value, 'configured broker worker', CONFIGURED_WORKER_KEYS);
  if (typeof value.enabled !== 'boolean')
    throw new Error('Configured worker enabled flag must be boolean');
  if (
    value.configuredN !== 'auto' &&
    (!Number.isSafeInteger(value.configuredN) || value.configuredN < 1)
  )
    throw new Error('Configured worker N must be auto or a positive integer');
  return {
    workerId: identifier(value.workerId, 'configured worker ID'),
    machineIdentitySha256: digest(
      value.machineIdentitySha256,
      'configured machine identity hash'
    ),
    enabled: value.enabled,
    configuredN: value.configuredN,
  };
}

export function createBrokerWorkerConfig(value) {
  exactObject(value, 'broker worker config', WORKER_CONFIG_KEYS);
  if (value.schema !== BROKER_WORKER_CONFIG_SCHEMA)
    throw new Error('Unsupported broker worker config schema');
  if (!Array.isArray(value.workers) || value.workers.length === 0)
    throw new Error('Broker worker config must list at least one worker');
  const workers = value.workers.map(normalizeConfiguredWorker);
  const workerIds = workers.map((entry) => entry.workerId);
  if (new Set(workerIds).size !== workerIds.length)
    throw new Error('Broker worker config contains a duplicate worker ID');
  return deepFreeze({
    schema: BROKER_WORKER_CONFIG_SCHEMA,
    controllerId: identifier(value.controllerId, 'configured controller ID'),
    workers: workers.toSorted((left, right) =>
      compareText(left.workerId, right.workerId)
    ),
  });
}

function configuredWorkerAdmissionEvaluation(
  configValue,
  registrationValue,
  capacityValue
) {
  const config = createBrokerWorkerConfig(configValue);
  const registration = normalizeRegistration(registrationValue);
  const capacity = normalizeCapacity(capacityValue);
  const configured = config.workers.find(
    (entry) => entry.workerId === registration.workerId
  );
  if (!configured || !configured.enabled)
    throw new Error('Worker is not enabled in the controller configuration');
  if (configured.machineIdentitySha256 !== registration.machineIdentitySha256)
    throw new Error('Worker machine identity does not match its configuration');
  if (
    capacity.workerId !== registration.workerId ||
    capacity.instanceId !== registration.instanceId
  )
    throw new Error('Capacity report does not belong to the registered worker');
  if (capacity.safeAvailableN > registration.capabilities.maxSafeN)
    throw new Error('Capacity report exceeds the registered safe worker limit');
  if (capacity.availableMemoryMiB > registration.capabilities.memoryMiB)
    throw new Error('Capacity report exceeds registered worker memory');
  if (
    capacity.performanceProfileSha256 !==
    registration.capabilities.performanceProfileSha256
  )
    throw new Error('Capacity report performance profile is not registered');
  const selectedN =
    configured.configuredN === 'auto'
      ? capacity.safeAvailableN
      : configured.configuredN;
  const unavailableReason =
    selectedN < 1
      ? 'no-safe-capacity'
      : selectedN > capacity.safeAvailableN
        ? 'configured-capacity-unavailable'
        : null;
  return {
    admission:
      unavailableReason === null
        ? deepFreeze({
            workerId: registration.workerId,
            instanceId: registration.instanceId,
            workerSessionId: capacity.workerSessionId,
            selectedN,
            configuredN: configured.configuredN,
            safeAvailableN: capacity.safeAvailableN,
            performanceProfileSha256: capacity.performanceProfileSha256,
            performanceScorePermille: capacity.performanceScorePermille,
            configSha256: canonicalJsonSha256(config),
            registrationSha256: canonicalJsonSha256(registration),
            capacitySha256: canonicalJsonSha256(capacity),
          })
        : null,
    unavailableReason,
  };
}

export function evaluateConfiguredWorkerAdmission(
  configValue,
  registrationValue,
  capacityValue
) {
  return configuredWorkerAdmissionEvaluation(
    configValue,
    registrationValue,
    capacityValue
  ).admission;
}

export function resolveConfiguredWorkerN(
  configValue,
  registrationValue,
  capacityValue
) {
  const evaluation = configuredWorkerAdmissionEvaluation(
    configValue,
    registrationValue,
    capacityValue
  );
  if (evaluation.unavailableReason === 'no-safe-capacity')
    throw new Error('Worker currently reports no safely available capacity');
  if (evaluation.unavailableReason === 'configured-capacity-unavailable')
    throw new Error('Configured worker N exceeds safely reported capacity');
  return evaluation.admission;
}

export function brokerSubmissionSha256(message) {
  assertAuthenticatedBrokerMessage(message, 'worker.result');
  return canonicalJsonSha256(message.body);
}
