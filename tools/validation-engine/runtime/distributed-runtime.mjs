// Copyright (c) snapetech and SeerrNG contributors.
// Minimal live runtime for trusted developer-fleet validation workers.
import { randomUUID } from 'node:crypto';
import { arch, platform } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { coordinate, preparePlan } from './controller.mjs';
import { detectWorkerCapacity } from './cpu-capacity.mjs';
import {
  createDistributedNativeCatalog,
  createDistributedNativeTaskRequest,
  executeDistributedNativeTask,
  MAX_DISTRIBUTED_NATIVE_TASKS,
  verifyDistributedNativeTaskResult,
} from './distributed-native-adapter.mjs';
import {
  createDistributedTrustedReplayCache,
  DISTRIBUTED_TRUSTED_TRANSPORT_PATH,
  requestDistributedTrustedJson,
  startDistributedTrustedServer,
} from './distributed-trusted-transport.mjs';
import {
  configuredDistributedWorker,
  verifyDistributedWorkerConfig,
} from './distributed-worker-config.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_WORKER_REPORT_SCHEMA =
  'seerrng-distributed-worker-report/v2';
export const DISTRIBUTED_TASK_RESULT_SCHEMA =
  'seerrng-distributed-task-result/v1';
export const DISTRIBUTED_TASK_FAILURE_SCHEMA =
  'seerrng-distributed-task-failure/v1';
export const DISTRIBUTED_TASK_FAILURE_RECEIPT_SCHEMA =
  'seerrng-distributed-task-failure-receipt/v1';
export const DISTRIBUTED_CONTROLLER_FAILURE_SCHEMA =
  'seerrng-distributed-controller-failure/v1';
export const DISTRIBUTED_SCHEDULE_REPORT_SCHEMA =
  'seerrng-distributed-schedule-report/v1';
export const DISTRIBUTED_SCHEDULE_FAILURE_REPORT_SCHEMA =
  'seerrng-distributed-schedule-failure-report/v1';
export const MAX_DISTRIBUTED_SCHEDULE_REPORT_BYTES = 32 * 1024 * 1024;
export const DISTRIBUTED_PROBE_KIND = 'engine.probe.v1';
export const DISTRIBUTED_TASK_KIND = 'engine.task.v1';
export const DISTRIBUTED_TRANSPORT_PATH = DISTRIBUTED_TRUSTED_TRANSPORT_PATH;

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH64 = /^[a-f0-9]{64}$/;
const MAX_DISTRIBUTED_WORKERS = 256;
const DEFAULT_DISTRIBUTED_REQUEST_TIMEOUT_MS = 30_000;
const MAX_DISTRIBUTED_REQUEST_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_DISTRIBUTED_FAILURE_TAIL_CODE_POINTS = 4096;
const MAX_DISTRIBUTED_FAILURE_TAIL_BYTES =
  MAX_DISTRIBUTED_FAILURE_TAIL_CODE_POINTS * 4;
const SCHEDULE_OUTCOME_STATUSES = new Set([
  'passed',
  'failed',
  'unknown',
  'not-run',
]);
const DISTRIBUTED_TASK_FAILURE_REASONS = new Set([
  'aborted',
  'cleanup-unverified',
  'execution-error',
  'native-failed',
  'timed-out',
]);
const DISTRIBUTED_CONTROLLER_FAILURE_CODES = new Set([
  'controller-aborted',
  'controller-error',
  'transport-identity-rejected',
  'transport-rejected',
  'transport-timeout',
  'transport-unavailable',
  'worker-response-invalid',
]);
const DISTRIBUTED_SCHEDULE_OUTCOME_REASONS = new Set([
  ...DISTRIBUTED_TASK_FAILURE_REASONS,
  ...DISTRIBUTED_CONTROLLER_FAILURE_CODES,
  'worker-unavailable',
]);
const TASK_FAILURE_RECEIPT_KEYS = [
  'aborted',
  'exitCode',
  'lifecycle',
  'schema',
  'signal',
  'stderrBytes',
  'stderrSha256',
  'stderrTail',
  'stderrTailTruncated',
  'stdoutBytes',
  'stdoutSha256',
  'stdoutTail',
  'stdoutTailTruncated',
  'timedOut',
  'wallMs',
];
const TASK_FAILURE_LIFECYCLE_KEYS = [
  'cleanupErrorPresent',
  'cleanupVerified',
  'completed',
  'spawned',
];
const TASK_FAILURE_CORE_KEYS = ['reason', 'receipt', 'schema'];
const TASK_FAILURE_KEYS = [...TASK_FAILURE_CORE_KEYS, 'failureSha256'];
const CONTROLLER_FAILURE_CORE_KEYS = [
  'applicationId',
  'configSha256',
  'controllerId',
  'errorCode',
  'remoteOutcome',
  'runId',
  'schema',
  'startedAt',
  'status',
  'taskId',
  'wallMs',
  'workerId',
];
const CONTROLLER_FAILURE_KEYS = [
  ...CONTROLLER_FAILURE_CORE_KEYS,
  'failureSha256',
];
const SCHEDULE_FAILURE_REPORT_CORE_KEYS = [
  'applicationId',
  'configSha256',
  'controllerId',
  'enabledWorkerIds',
  'errorCode',
  'runId',
  'schema',
  'selectedTaskCount',
  'selectedTaskIdsSha256',
  'selectionManifestSha256',
  'startedAt',
  'status',
  'taskExecutionOutcome',
  'wallMs',
];
const SCHEDULE_FAILURE_REPORT_KEYS = [
  ...SCHEDULE_FAILURE_REPORT_CORE_KEYS,
  'reportSha256',
];
const SCHEDULE_FAILURE_TASK_EXECUTION_OUTCOMES = new Set([
  'not-started',
  'unknown',
]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function boundedInteger(value, label, { minimum = 0, maximum } = {}) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  )
    throw new Error(`${label} is outside its supported range`);
  return value;
}

function nonnegativeDuration(value, label) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_DISTRIBUTED_REQUEST_TIMEOUT_MS
  )
    throw new Error(`${label} must be a bounded nonnegative finite duration`);
  return value;
}

function exactInstant(value, label) {
  if (
    typeof value !== 'string' ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function requestTimeout(value) {
  if (value === undefined) return DEFAULT_DISTRIBUTED_REQUEST_TIMEOUT_MS;
  return boundedInteger(value, 'Distributed request timeout', {
    minimum: 1,
    maximum: MAX_DISTRIBUTED_REQUEST_TIMEOUT_MS,
  });
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

function exactKeys(value, keys, label) {
  plainObject(value, label);
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function boundedFailureTail(value) {
  if (typeof value !== 'string') return '';
  const codePoints = Array.from(value);
  return codePoints.length <= MAX_DISTRIBUTED_FAILURE_TAIL_CODE_POINTS
    ? value
    : codePoints.slice(-MAX_DISTRIBUTED_FAILURE_TAIL_CODE_POINTS).join('');
}

function verifyFailureTail(value, label) {
  if (
    typeof value !== 'string' ||
    Array.from(value).length > MAX_DISTRIBUTED_FAILURE_TAIL_CODE_POINTS ||
    Buffer.byteLength(value, 'utf8') > MAX_DISTRIBUTED_FAILURE_TAIL_BYTES
  )
    throw new Error(`${label} exceeds its bounded text tail`);
  return value;
}

function optionalFailureInteger(
  value,
  label,
  maximum = Number.MAX_SAFE_INTEGER
) {
  if (value === null) return null;
  return boundedInteger(value, label, { maximum });
}

function optionalFailureDigest(value, label) {
  return value === null ? null : digest(value, label);
}

function optionalFailureSignal(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^SIG[A-Z0-9]{1,31}$/.test(value))
    throw new Error('Distributed failure receipt signal is invalid');
  return value;
}

function normalizedFailureStream(receipt, name) {
  const bytesValue = receipt?.[`${name}Bytes`];
  const hashValue = receipt?.[`${name}Sha256`];
  const bytes =
    Number.isSafeInteger(bytesValue) && bytesValue >= 0 ? bytesValue : null;
  const sha256 =
    typeof hashValue === 'string' && HASH64.test(hashValue) ? hashValue : null;
  if (bytes === null || sha256 === null)
    return {
      [`${name}Bytes`]: null,
      [`${name}Sha256`]: null,
      [`${name}Tail`]: '',
      [`${name}TailTruncated`]: false,
    };
  const source = typeof receipt?.[name] === 'string' ? receipt[name] : '';
  const tail = boundedFailureTail(source);
  return {
    [`${name}Bytes`]: bytes,
    [`${name}Sha256`]: sha256,
    [`${name}Tail`]: tail,
    [`${name}TailTruncated`]:
      receipt?.[`${name}Truncated`] === true ||
      Array.from(source).length > MAX_DISTRIBUTED_FAILURE_TAIL_CODE_POINTS ||
      bytes > Buffer.byteLength(tail, 'utf8'),
  };
}

function normalizeFailureReceipt(value) {
  const receipt =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const lifecycle =
    receipt.lifecycle &&
    typeof receipt.lifecycle === 'object' &&
    !Array.isArray(receipt.lifecycle)
      ? receipt.lifecycle
      : {};
  const exitCode =
    Number.isSafeInteger(receipt.exitCode) &&
    receipt.exitCode >= 0 &&
    receipt.exitCode <= 0x7fffffff
      ? receipt.exitCode
      : null;
  const signal =
    typeof receipt.signal === 'string' &&
    /^SIG[A-Z0-9]{1,31}$/.test(receipt.signal)
      ? receipt.signal
      : null;
  const wallMs =
    typeof receipt.wallMs === 'number' &&
    Number.isFinite(receipt.wallMs) &&
    receipt.wallMs >= 0 &&
    receipt.wallMs <= MAX_DISTRIBUTED_REQUEST_TIMEOUT_MS
      ? receipt.wallMs
      : null;
  return {
    schema: DISTRIBUTED_TASK_FAILURE_RECEIPT_SCHEMA,
    exitCode,
    signal,
    aborted: receipt.aborted === true,
    timedOut: receipt.timedOut === true,
    wallMs,
    ...normalizedFailureStream(receipt, 'stdout'),
    ...normalizedFailureStream(receipt, 'stderr'),
    lifecycle: {
      spawned: lifecycle.spawned === true,
      completed: lifecycle.completed === true,
      cleanupVerified: lifecycle.cleanupVerified === true,
      cleanupErrorPresent:
        lifecycle.cleanupError !== undefined &&
        lifecycle.cleanupError !== null &&
        lifecycle.cleanupError !== '',
    },
  };
}

function verifyFailureReceipt(value) {
  exactKeys(
    value,
    TASK_FAILURE_RECEIPT_KEYS,
    'distributed task failure receipt'
  );
  if (value.schema !== DISTRIBUTED_TASK_FAILURE_RECEIPT_SCHEMA)
    throw new Error('Unsupported distributed task failure receipt schema');
  if (typeof value.aborted !== 'boolean' || typeof value.timedOut !== 'boolean')
    throw new Error('Distributed task failure receipt flags must be boolean');
  const exitCode = optionalFailureInteger(
    value.exitCode,
    'Distributed failure receipt exit code',
    0x7fffffff
  );
  const signal = optionalFailureSignal(value.signal);
  const wallMs =
    value.wallMs === null
      ? null
      : nonnegativeDuration(
          value.wallMs,
          'Distributed failure receipt wall time'
        );
  const streams = {};
  for (const name of ['stdout', 'stderr']) {
    const bytes = optionalFailureInteger(
      value[`${name}Bytes`],
      `Distributed failure receipt ${name} bytes`
    );
    const sha256 = optionalFailureDigest(
      value[`${name}Sha256`],
      `distributed failure receipt ${name} hash`
    );
    const tail = verifyFailureTail(
      value[`${name}Tail`],
      `Distributed failure receipt ${name}`
    );
    const tailTruncated = value[`${name}TailTruncated`];
    if (typeof tailTruncated !== 'boolean')
      throw new Error(
        `Distributed failure receipt ${name} truncation flag must be boolean`
      );
    if ((bytes === null) !== (sha256 === null))
      throw new Error(
        `Distributed failure receipt ${name} byte/hash evidence is incomplete`
      );
    if (bytes === null && (tail !== '' || tailTruncated))
      throw new Error(
        `Distributed failure receipt ${name} tail lacks full-stream evidence`
      );
    streams[`${name}Bytes`] = bytes;
    streams[`${name}Sha256`] = sha256;
    streams[`${name}Tail`] = tail;
    streams[`${name}TailTruncated`] = tailTruncated;
  }
  exactKeys(
    value.lifecycle,
    TASK_FAILURE_LIFECYCLE_KEYS,
    'distributed task failure lifecycle'
  );
  for (const key of TASK_FAILURE_LIFECYCLE_KEYS)
    if (typeof value.lifecycle[key] !== 'boolean')
      throw new Error(
        'Distributed task failure lifecycle flags must be boolean'
      );
  return {
    schema: value.schema,
    exitCode,
    signal,
    aborted: value.aborted,
    timedOut: value.timedOut,
    wallMs,
    ...streams,
    lifecycle: {
      spawned: value.lifecycle.spawned,
      completed: value.lifecycle.completed,
      cleanupVerified: value.lifecycle.cleanupVerified,
      cleanupErrorPresent: value.lifecycle.cleanupErrorPresent,
    },
  };
}

function distributedTaskFailureReason(receipt) {
  if (!receipt) return 'execution-error';
  if (!receipt.lifecycle.cleanupVerified) return 'cleanup-unverified';
  if (receipt.timedOut) return 'timed-out';
  if (receipt.aborted) return 'aborted';
  return 'native-failed';
}

export function verifyDistributedTaskFailureEvidence(value) {
  exactKeys(value, TASK_FAILURE_KEYS, 'distributed task failure evidence');
  if (value.schema !== DISTRIBUTED_TASK_FAILURE_SCHEMA)
    throw new Error('Unsupported distributed task failure evidence schema');
  if (!DISTRIBUTED_TASK_FAILURE_REASONS.has(value.reason))
    throw new Error('Distributed task failure reason is not controlled');
  const receipt =
    value.receipt === null ? null : verifyFailureReceipt(value.receipt);
  if (value.reason !== distributedTaskFailureReason(receipt))
    throw new Error(
      'Distributed task failure reason contradicts its receipt evidence'
    );
  const core = {
    schema: value.schema,
    reason: value.reason,
    receipt,
  };
  const failureSha256 = digest(
    value.failureSha256,
    'distributed task failure evidence hash'
  );
  if (failureSha256 !== canonicalJsonSha256(core))
    throw new Error('Distributed task failure evidence hash is invalid');
  return deepFreeze({ ...core, failureSha256 });
}

export function createDistributedTaskFailureEvidence(error) {
  const hasReceipt =
    error !== null &&
    (typeof error === 'object' || typeof error === 'function') &&
    Object.prototype.hasOwnProperty.call(error, 'receipt');
  const receipt = hasReceipt ? normalizeFailureReceipt(error.receipt) : null;
  const core = {
    schema: DISTRIBUTED_TASK_FAILURE_SCHEMA,
    reason: distributedTaskFailureReason(receipt),
    receipt,
  };
  return verifyDistributedTaskFailureEvidence({
    ...core,
    failureSha256: canonicalJsonSha256(core),
  });
}

function distributedControllerFailureCode(error, controllerAborted) {
  if (controllerAborted) return 'controller-aborted';
  switch (error?.code) {
    case 'ERR_DISTRIBUTED_TRANSPORT_TIMEOUT':
    case 'ETIMEDOUT':
      return 'transport-timeout';
    case 'ERR_DISTRIBUTED_TRANSPORT_PIN':
      return 'transport-identity-rejected';
    case 'ERR_DISTRIBUTED_TRANSPORT_AUTH':
    case 'ERR_DISTRIBUTED_TRANSPORT_HTTP':
      return 'transport-rejected';
    case 'ECONNABORTED':
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'ENOTFOUND':
    case 'EPIPE':
      return 'transport-unavailable';
    case 'ERR_DISTRIBUTED_TRANSPORT_CONTENT_TYPE':
    case 'ERR_DISTRIBUTED_TRANSPORT_JSON':
    case 'ERR_DISTRIBUTED_TRANSPORT_LENGTH':
    case 'ERR_DISTRIBUTED_TRANSPORT_REPLAY':
    case 'ERR_DISTRIBUTED_TRANSPORT_SIZE':
      return 'worker-response-invalid';
    default:
      return 'controller-error';
  }
}

export function verifyDistributedControllerFailure(value) {
  exactKeys(value, CONTROLLER_FAILURE_KEYS, 'distributed controller failure');
  if (value.schema !== DISTRIBUTED_CONTROLLER_FAILURE_SCHEMA)
    throw new Error('Unsupported distributed controller failure schema');
  if (value.status !== 'failed' || value.remoteOutcome !== 'unknown')
    throw new Error('Distributed controller failure outcome is invalid');
  if (!DISTRIBUTED_CONTROLLER_FAILURE_CODES.has(value.errorCode))
    throw new Error('Distributed controller failure code is not controlled');
  const core = {
    schema: value.schema,
    controllerId: identifier(value.controllerId, 'failure controller ID'),
    workerId: identifier(value.workerId, 'failure worker ID'),
    configSha256: digest(value.configSha256, 'failure configuration hash'),
    runId: identifier(value.runId, 'failure run ID'),
    applicationId: identifier(value.applicationId, 'failure application ID'),
    taskId: digest(value.taskId, 'failure task ID'),
    status: value.status,
    errorCode: value.errorCode,
    remoteOutcome: value.remoteOutcome,
    startedAt: exactInstant(
      value.startedAt,
      'controller failure start instant'
    ),
    wallMs: nonnegativeDuration(
      value.wallMs,
      'Distributed controller failure wall time'
    ),
  };
  const failureSha256 = digest(
    value.failureSha256,
    'distributed controller failure hash'
  );
  if (failureSha256 !== canonicalJsonSha256(core))
    throw new Error('Distributed controller failure hash is invalid');
  return deepFreeze({ ...core, failureSha256 });
}

export function createDistributedControllerFailureReport({
  configSha256,
  controllerId,
  workerId,
  runId,
  applicationId,
  taskId,
  startedAt,
  wallMs,
  error,
  controllerAborted = false,
} = {}) {
  const core = {
    schema: DISTRIBUTED_CONTROLLER_FAILURE_SCHEMA,
    controllerId,
    workerId,
    configSha256,
    runId,
    applicationId,
    taskId,
    status: 'failed',
    errorCode: distributedControllerFailureCode(error, controllerAborted),
    remoteOutcome: 'unknown',
    startedAt,
    wallMs,
  };
  const controllerFailure = verifyDistributedControllerFailure({
    ...core,
    failureSha256: canonicalJsonSha256(core),
  });
  return deepFreeze({
    report: null,
    result: null,
    controllerFailure,
  });
}

export function parseDistributedApplicationBindings(values) {
  if (!Array.isArray(values) || values.length !== 1)
    throw new Error(
      'This distributed milestone requires exactly one --app ID=ROOT'
    );
  const bindings = values.map((value) => {
    if (typeof value !== 'string')
      throw new Error('Distributed application binding must be text');
    const separator = value.indexOf('=');
    if (separator < 1 || separator === value.length - 1)
      throw new Error('Distributed application binding must be ID=ROOT');
    const id = identifier(value.slice(0, separator), 'application ID');
    const root = value.slice(separator + 1);
    if (!isAbsolute(root) || resolve(root) !== root)
      throw new Error(`Distributed application root must be absolute: ${id}`);
    return { id, root };
  });
  if (new Set(bindings.map(({ id }) => id)).size !== bindings.length)
    throw new Error('Distributed application bindings repeat an ID');
  return deepFreeze(bindings);
}

function normalizeApplications(applications) {
  if (!Array.isArray(applications) || applications.length !== 1)
    throw new Error(
      'This distributed milestone requires exactly one application binding'
    );
  const result = new Map();
  for (const application of applications) {
    exactKeys(application, ['id', 'root'], 'distributed application binding');
    const id = identifier(application.id, 'application ID');
    if (
      !isAbsolute(application.root) ||
      resolve(application.root) !== application.root
    )
      throw new Error(`Distributed application root must be absolute: ${id}`);
    if (result.has(id))
      throw new Error(`Distributed application binding repeats ${id}`);
    result.set(id, application.root);
  }
  return result;
}

function normalizeAllowedTaskIds(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_DISTRIBUTED_NATIVE_TASKS ||
    value.some(
      (taskId) => typeof taskId !== 'string' || !HASH64.test(taskId)
    ) ||
    new Set(value).size !== value.length
  )
    throw new Error(
      'Distributed workers require a nonempty bounded set of unique hashed task IDs'
    );
  return [...value];
}

function canonicalTaskIds(value, label, { minimum = 1 } = {}) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > MAX_DISTRIBUTED_NATIVE_TASKS
  )
    throw new Error(`${label} must be a bounded task ID array`);
  const taskIds = value.map((taskId) => digest(taskId, `${label} task ID`));
  if (new Set(taskIds).size !== taskIds.length)
    throw new Error(`${label} must contain unique task IDs`);
  return taskIds.toSorted(compareText);
}

function createSemaphore(limit) {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_DISTRIBUTED_WORKERS
  )
    throw new Error('Distributed worker concurrency must be 1..256');
  let active = 0;
  const waiting = [];
  const enter = async () => {
    if (active >= limit)
      await new Promise((resolveWait) => waiting.push(resolveWait));
    active += 1;
  };
  const leave = () => {
    active -= 1;
    waiting.shift()?.();
  };
  return { enter, leave, active: () => active };
}

function workerApplicationSummary(catalog) {
  const taskIds = canonicalTaskIds(
    catalog.tasks.map((task) => task.taskId),
    'worker application capabilities'
  );
  return {
    applicationId: catalog.applicationId,
    candidateSha256: digest(
      catalog.candidate.candidateSha256,
      'application candidate hash'
    ),
    catalogSha256: digest(catalog.catalogSha256, 'application catalog hash'),
    inventorySha256: digest(
      catalog.inventorySha256,
      'application inventory hash'
    ),
    taskCount: taskIds.length,
    taskIds,
  };
}

function verifyProbeBody(value, config) {
  exactKeys(
    value,
    ['applicationIds', 'configSha256'],
    'distributed probe request'
  );
  if (value.configSha256 !== config.configSha256)
    throw new Error('Distributed probe uses another worker configuration');
  if (
    !Array.isArray(value.applicationIds) ||
    !value.applicationIds.length ||
    value.applicationIds.some((id) => typeof id !== 'string') ||
    new Set(value.applicationIds).size !== value.applicationIds.length
  )
    throw new Error('Distributed probe requires unique application IDs');
  return value.applicationIds.map((id) =>
    identifier(id, 'probe application ID')
  );
}

function verifyTaskBody(value, config) {
  exactKeys(
    value,
    ['applicationId', 'configSha256', 'expectedCandidate', 'request', 'runId'],
    'distributed task body'
  );
  if (value.configSha256 !== config.configSha256)
    throw new Error('Distributed task uses another worker configuration');
  identifier(value.applicationId, 'task application ID');
  identifier(value.runId, 'distributed run ID');
  plainObject(value.expectedCandidate, 'expected task candidate');
  plainObject(value.request, 'distributed native task request');
  return value;
}

export function createDistributedWorkerRuntime({
  config: configValue,
  workerId,
  applications,
  allowedTaskIds,
  catalogFactory = createDistributedNativeCatalog,
  taskExecutor = executeDistributedNativeTask,
  capacityDetector = detectWorkerCapacity,
  instanceId = randomUUID(),
} = {}) {
  const config = verifyDistributedWorkerConfig(configValue);
  const worker = configuredDistributedWorker(config, workerId);
  identifier(instanceId, 'worker instance ID');
  const roots = normalizeApplications(applications);
  const allowed = normalizeAllowedTaskIds(allowedTaskIds);
  const catalogs = new Map(
    [...roots].map(([applicationId, root]) => [
      applicationId,
      catalogFactory(root, { applicationId, allowedTaskIds: allowed }),
    ])
  );
  const firstRoot = roots.values().next().value;
  const detected = capacityDetector({
    sourceRoot: firstRoot,
    override: worker.n === 'auto' ? null : worker.n,
  });
  const concurrency = detected.configuredWorkers;
  const semaphore = createSemaphore(concurrency);
  const executions = new Map();
  const inFlight = new Set();
  const shutdown = new AbortController();
  let accepting = true;

  const report = (applicationIds = [...catalogs.keys()]) => {
    const selected = applicationIds.map((applicationId) => {
      const catalog = catalogs.get(applicationId);
      if (!catalog)
        throw new Error(
          `Worker does not register application: ${applicationId}`
        );
      return workerApplicationSummary(catalog);
    });
    return deepFreeze({
      schema: DISTRIBUTED_WORKER_REPORT_SCHEMA,
      workerId: worker.id,
      instanceId,
      configSha256: config.configSha256,
      environment: `${platform()}-${arch()}`,
      capacity: {
        effectiveLogicalCpus: detected.effectiveLogicalCpus,
        configuredWorkers: concurrency,
        policy: detected.policy,
      },
      activeTasks: semaphore.active(),
      applications: selected,
    });
  };

  const execute = async (body, signal) => {
    if (!accepting) throw new Error('Distributed worker runtime is draining');
    verifyTaskBody(body, config);
    const root = roots.get(body.applicationId);
    const catalog = catalogs.get(body.applicationId);
    if (!root || !catalog)
      throw new Error(
        `Worker does not register application: ${body.applicationId}`
      );
    if (
      body.expectedCandidate.candidateSha256 !==
      catalog.candidate.candidateSha256
    )
      throw new Error(
        'Distributed task candidate does not match worker source'
      );
    const key = `${body.runId}\0${body.applicationId}\0${body.request.taskId}`;
    if (executions.has(key)) return executions.get(key);
    if (signal !== undefined && !(signal instanceof AbortSignal))
      throw new Error('Distributed worker task signal must be an AbortSignal');
    const executionSignal = signal
      ? AbortSignal.any([signal, shutdown.signal])
      : shutdown.signal;
    const execution = (async () => {
      await semaphore.enter();
      const startedAt = new Date().toISOString();
      const started = performance.now();
      try {
        try {
          const result = await taskExecutor({
            root,
            applicationId: body.applicationId,
            expectedCandidate: body.expectedCandidate,
            request: body.request,
            allowedTaskIds: allowed,
            signal: executionSignal,
          });
          return deepFreeze({
            schema: DISTRIBUTED_TASK_RESULT_SCHEMA,
            workerId: worker.id,
            instanceId,
            runId: body.runId,
            applicationId: body.applicationId,
            taskId: body.request.taskId,
            status: 'passed',
            startedAt,
            wallMs: performance.now() - started,
            result,
          });
        } catch (error) {
          return deepFreeze({
            schema: DISTRIBUTED_TASK_RESULT_SCHEMA,
            workerId: worker.id,
            instanceId,
            runId: body.runId,
            applicationId: body.applicationId,
            taskId: body.request.taskId,
            status: 'failed',
            startedAt,
            wallMs: performance.now() - started,
            failure: createDistributedTaskFailureEvidence(error),
          });
        }
      } finally {
        semaphore.leave();
      }
    })();
    executions.set(key, execution);
    inFlight.add(execution);
    void execution.then(
      () => {
        if (executions.get(key) === execution) executions.delete(key);
        inFlight.delete(execution);
      },
      () => {
        if (executions.get(key) === execution) executions.delete(key);
        inFlight.delete(execution);
      }
    );
    return execution;
  };

  const handle = async ({ kind, body, signal }) => {
    if (kind === DISTRIBUTED_PROBE_KIND) {
      const applicationIds = verifyProbeBody(body, config);
      return report(applicationIds);
    }
    if (kind === DISTRIBUTED_TASK_KIND) return execute(body, signal);
    throw new Error(`Unsupported distributed worker request: ${kind}`);
  };

  let drainPromise;
  const drain = () => {
    if (drainPromise) return drainPromise;
    accepting = false;
    shutdown.abort();
    drainPromise = Promise.allSettled([...inFlight]).then(() => undefined);
    return drainPromise;
  };

  return deepFreeze({
    workerId: worker.id,
    instanceId,
    concurrency,
    report,
    handle,
    drain,
  });
}

export async function startDistributedWorkerServer({
  config,
  workerId,
  applications,
  allowedTaskIds,
  key,
  certificate,
  secret,
  allowedSourceAddresses,
  host,
  port,
  runtimeFactory = createDistributedWorkerRuntime,
  serverFactory = startDistributedTrustedServer,
} = {}) {
  const sealedConfig = verifyDistributedWorkerConfig(config);
  const worker = configuredDistributedWorker(sealedConfig, workerId);
  const runtime = runtimeFactory({
    config: sealedConfig,
    workerId: worker.id,
    applications,
    allowedTaskIds,
  });
  const server = await serverFactory({
    key,
    certificate,
    secret,
    serverId: worker.id,
    allowedClientIds: [sealedConfig.controllerId],
    allowedSourceAddresses,
    allowedKinds: [DISTRIBUTED_PROBE_KIND, DISTRIBUTED_TASK_KIND],
    handler: runtime.handle,
    host,
    port,
    path: DISTRIBUTED_TRANSPORT_PATH,
  });
  if (server.certificateSha256 !== worker.identitySha256) {
    await server.close();
    await runtime.drain();
    throw new Error(
      'Worker TLS certificate does not match configured identity'
    );
  }
  let closePromise;
  const close = () => {
    if (closePromise) return closePromise;
    const serverClose = server.close();
    const runtimeDrain = runtime.drain();
    closePromise = Promise.all([serverClose, runtimeDrain]).then(
      () => undefined
    );
    return closePromise;
  };
  return deepFreeze({ runtime, server, close });
}

function verifyWorkerReport(
  report,
  { config, worker, applicationId, catalog }
) {
  exactKeys(
    report,
    [
      'activeTasks',
      'applications',
      'capacity',
      'configSha256',
      'environment',
      'instanceId',
      'schema',
      'workerId',
    ],
    'distributed worker report'
  );
  if (
    report.schema !== DISTRIBUTED_WORKER_REPORT_SCHEMA ||
    report.workerId !== worker.id ||
    report.configSha256 !== config.configSha256
  )
    throw new Error('Distributed worker report has another identity');
  const instanceId = identifier(report.instanceId, 'worker report instance ID');
  const environment = identifier(
    report.environment,
    'worker report environment'
  );
  exactKeys(
    report.capacity,
    ['configuredWorkers', 'effectiveLogicalCpus', 'policy'],
    'distributed worker capacity'
  );
  const effectiveLogicalCpus = boundedInteger(
    report.capacity.effectiveLogicalCpus,
    'Distributed worker effective logical CPUs',
    { minimum: 1, maximum: 65_536 }
  );
  const configuredWorkers = boundedInteger(
    report.capacity.configuredWorkers,
    'Distributed configured workers',
    { minimum: 1, maximum: MAX_DISTRIBUTED_WORKERS }
  );
  if (worker.n !== 'auto' && configuredWorkers !== worker.n)
    throw new Error(
      'Distributed worker capacity contradicts its configuration'
    );
  const policy = identifier(report.capacity.policy, 'worker capacity policy');
  const activeTasks = boundedInteger(
    report.activeTasks,
    'Distributed active task count',
    { maximum: configuredWorkers }
  );
  if (!Array.isArray(report.applications) || report.applications.length !== 1)
    throw new Error('Distributed worker report must bind the requested app');
  const application = report.applications[0];
  exactKeys(
    application,
    [
      'applicationId',
      'candidateSha256',
      'catalogSha256',
      'inventorySha256',
      'taskCount',
      'taskIds',
    ],
    'distributed worker application report'
  );
  if (
    application.applicationId !== applicationId ||
    application.candidateSha256 !== catalog.candidate.candidateSha256
  )
    throw new Error('Distributed worker candidate does not match controller');
  const workerCatalogSha256 = digest(
    application.catalogSha256,
    'worker application catalog hash'
  );
  const workerInventorySha256 = digest(
    application.inventorySha256,
    'worker application inventory hash'
  );
  const controllerCatalogSha256 = digest(
    catalog.catalogSha256,
    'controller application catalog hash'
  );
  const controllerInventorySha256 = digest(
    catalog.inventorySha256,
    'controller application inventory hash'
  );
  if (workerCatalogSha256 !== controllerCatalogSha256)
    throw new Error('Distributed worker catalog does not match controller');
  if (workerInventorySha256 !== controllerInventorySha256)
    throw new Error('Distributed worker inventory does not match controller');
  const taskCount = boundedInteger(
    application.taskCount,
    'Distributed worker executable task count',
    { minimum: 1, maximum: MAX_DISTRIBUTED_NATIVE_TASKS }
  );
  const taskIds = canonicalTaskIds(
    application.taskIds,
    'distributed worker application capabilities'
  );
  if (
    taskIds.length !== application.taskIds.length ||
    taskIds.some((taskId, index) => taskId !== application.taskIds[index])
  )
    throw new Error(
      'Distributed worker application task IDs must use canonical order'
    );
  if (taskCount !== taskIds.length)
    throw new Error(
      'Distributed worker application task count does not match its task IDs'
    );
  return deepFreeze({
    schema: report.schema,
    workerId: report.workerId,
    instanceId,
    configSha256: report.configSha256,
    environment,
    capacity: {
      effectiveLogicalCpus,
      configuredWorkers,
      policy,
    },
    activeTasks,
    applications: [
      {
        applicationId: application.applicationId,
        candidateSha256: application.candidateSha256,
        catalogSha256: application.catalogSha256,
        inventorySha256: application.inventorySha256,
        taskCount,
        taskIds,
      },
    ],
  });
}

function verifyWorkerTaskResult(
  value,
  { worker, report, runId, applicationId, taskId, catalog }
) {
  plainObject(value, 'distributed worker task result');
  if (!['passed', 'failed'].includes(value.status))
    throw new Error('Distributed worker returned an invalid task status');
  const payloadKey = value.status === 'passed' ? 'result' : 'failure';
  exactKeys(
    value,
    [
      'applicationId',
      'instanceId',
      payloadKey,
      'runId',
      'schema',
      'startedAt',
      'status',
      'taskId',
      'wallMs',
      'workerId',
    ],
    'distributed worker task result'
  );
  if (
    value.schema !== DISTRIBUTED_TASK_RESULT_SCHEMA ||
    value.workerId !== worker.id ||
    value.instanceId !== report.instanceId ||
    value.runId !== runId ||
    value.applicationId !== applicationId ||
    value.taskId !== taskId
  )
    throw new Error('Distributed worker returned an invalid task result');
  const common = {
    schema: value.schema,
    workerId: value.workerId,
    instanceId: value.instanceId,
    runId: value.runId,
    applicationId: value.applicationId,
    taskId: value.taskId,
    status: value.status,
    startedAt: exactInstant(value.startedAt, 'distributed task start instant'),
    wallMs: nonnegativeDuration(value.wallMs, 'Distributed task wall time'),
  };
  if (value.status === 'failed')
    return deepFreeze({
      ...common,
      failure: verifyDistributedTaskFailureEvidence(value.failure),
    });
  return deepFreeze({
    ...common,
    result: verifyDistributedNativeTaskResult(value.result, {
      catalog,
      expectedCatalogSha256: report.applications[0].catalogSha256,
      taskId,
    }),
  });
}

function controllerCatalogTasks(catalog, applicationId, selectedTaskIds) {
  plainObject(catalog, 'distributed controller catalog');
  if (catalog.applicationId !== applicationId)
    throw new Error('Distributed controller catalog belongs to another app');
  plainObject(catalog.candidate, 'distributed controller catalog candidate');
  digest(
    catalog.candidate.candidateSha256,
    'distributed controller candidate hash'
  );
  digest(catalog.catalogSha256, 'distributed controller catalog hash');
  if (!Array.isArray(catalog.tasks))
    throw new Error('Distributed controller catalog requires tasks');
  const tasks = catalog.tasks
    .map((task) => {
      plainObject(task, 'distributed controller catalog task');
      const taskId = digest(task.taskId, 'distributed controller task ID');
      if (
        !Array.isArray(task.files) ||
        task.files.length === 0 ||
        task.files.some((file) => typeof file !== 'string')
      )
        throw new Error('Distributed controller task requires files');
      return { taskId, files: [...task.files] };
    })
    .toSorted((left, right) => compareText(left.taskId, right.taskId));
  const actualTaskIds = canonicalTaskIds(
    tasks.map((task) => task.taskId),
    'distributed controller catalog'
  );
  if (
    actualTaskIds.length !== selectedTaskIds.length ||
    actualTaskIds.some((taskId, index) => taskId !== selectedTaskIds[index])
  )
    throw new Error(
      'Distributed controller catalog changed its selected tasks'
    );
  return tasks;
}

function createDistributedControllerSession({
  config: configValue,
  applications,
  workerId,
  applicationId,
  taskIds,
  secret,
  timeoutMs,
  localRuntime = null,
  catalog: suppliedCatalog,
  catalogFactory = createDistributedNativeCatalog,
  requestFactory = createDistributedNativeTaskRequest,
  requestJson = requestDistributedTrustedJson,
  replayCache = createDistributedTrustedReplayCache(),
  signal,
} = {}) {
  const config = verifyDistributedWorkerConfig(configValue);
  const worker = configuredDistributedWorker(config, workerId);
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new Error('Distributed controller signal must be an AbortSignal');
  signal?.throwIfAborted();
  applicationId = identifier(applicationId, 'controller application ID');
  const selectedTaskIds = canonicalTaskIds(
    taskIds,
    'distributed controller selection'
  );
  const roots = normalizeApplications(applications);
  const root = roots.get(applicationId);
  if (!root)
    throw new Error(
      `Controller does not register application: ${applicationId}`
    );
  const catalog =
    suppliedCatalog ??
    catalogFactory(root, {
      applicationId,
      allowedTaskIds: selectedTaskIds,
    });
  controllerCatalogTasks(catalog, applicationId, selectedTaskIds);
  const timeout = requestTimeout(timeoutMs);
  const call = async (kind, body) => {
    if (localRuntime) {
      if (localRuntime.workerId !== worker.id)
        throw new Error('Controller-local runtime has another worker identity');
      const timeoutSignal = AbortSignal.timeout(timeout);
      const localSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;
      return localRuntime.handle({ kind, body, signal: localSignal });
    }
    return (
      await requestJson({
        origin: worker.address,
        path: DISTRIBUTED_TRANSPORT_PATH,
        secret,
        expectedCertificateSha256: worker.identitySha256,
        clientId: config.controllerId,
        serverId: worker.id,
        kind,
        body,
        timeoutMs: timeout,
        signal,
        replayCache,
      })
    ).body;
  };
  let reportPromise;
  const probe = () => {
    reportPromise ??= call(DISTRIBUTED_PROBE_KIND, {
      configSha256: config.configSha256,
      applicationIds: [applicationId],
    }).then((report) =>
      verifyWorkerReport(report, { config, worker, applicationId, catalog })
    );
    return reportPromise;
  };
  const execute = async (taskId, runId) => {
    taskId = digest(taskId, 'controller task ID');
    runId = identifier(runId, 'distributed run ID');
    if (!selectedTaskIds.includes(taskId))
      throw new Error('Controller task is outside the selected catalog');
    const report = await probe();
    if (!report.applications[0].taskIds.includes(taskId))
      throw new Error(
        'Distributed worker does not advertise the selected task'
      );
    const request = requestFactory(catalog, taskId);
    const result = await call(DISTRIBUTED_TASK_KIND, {
      configSha256: config.configSha256,
      runId,
      applicationId,
      expectedCandidate: catalog.candidate,
      request,
    });
    return verifyWorkerTaskResult(result, {
      worker,
      report,
      runId,
      applicationId,
      taskId,
      catalog,
    });
  };
  return deepFreeze({
    workerId: worker.id,
    catalog,
    probe,
    execute,
  });
}

export async function runDistributedControllerTask({
  config: configValue,
  applications,
  workerId,
  applicationId,
  taskId,
  runId = randomUUID(),
  secret,
  timeoutMs,
  localRuntime = null,
  catalogFactory = createDistributedNativeCatalog,
  requestFactory = createDistributedNativeTaskRequest,
  requestJson = requestDistributedTrustedJson,
  replayCache = createDistributedTrustedReplayCache(),
  signal,
} = {}) {
  taskId = digest(taskId, 'controller task ID');
  runId = identifier(runId, 'distributed run ID');
  const session = createDistributedControllerSession({
    config: configValue,
    applications,
    workerId,
    applicationId,
    taskIds: [taskId],
    secret,
    timeoutMs,
    localRuntime,
    catalogFactory,
    requestFactory,
    requestJson,
    replayCache,
    signal,
  });
  const report = await session.probe();
  const result = await session.execute(taskId, runId);
  return deepFreeze({
    report,
    result,
  });
}

function canonicalWorkerIds(value) {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > MAX_DISTRIBUTED_WORKERS
  )
    throw new Error('Distributed schedule requires 2..256 worker IDs');
  const workerIds = value.map((workerId) =>
    identifier(workerId, 'distributed schedule worker ID')
  );
  if (new Set(workerIds).size !== workerIds.length)
    throw new Error('Distributed schedule worker IDs must be unique');
  return workerIds.toSorted(compareText);
}

function normalizeLocalRuntimes(value, workerIds) {
  if (value === undefined || value === null) return new Map();
  if (!(value instanceof Map))
    throw new Error('Distributed schedule local runtimes must be a Map');
  const normalized = new Map();
  for (const [workerId, runtime] of value) {
    const id = identifier(workerId, 'local runtime worker ID');
    if (!workerIds.includes(id))
      throw new Error('Distributed schedule has an unselected local runtime');
    if (
      !runtime ||
      runtime.workerId !== id ||
      typeof runtime.handle !== 'function'
    )
      throw new Error('Distributed schedule local runtime identity is invalid');
    normalized.set(id, runtime);
  }
  return normalized;
}

function interleavedWorkerSlots(workers, reports) {
  const capacity = new Map(
    reports.map((report) => [
      report.workerId,
      report.capacity.configuredWorkers,
    ])
  );
  const total = [...capacity.values()].reduce((sum, value) => sum + value, 0);
  if (total < 1 || total > MAX_DISTRIBUTED_WORKERS)
    throw new Error('Distributed schedule aggregate capacity must be 1..256');
  const slots = [];
  const maximum = Math.max(...capacity.values());
  for (let round = 0; round < maximum; round += 1)
    for (const worker of workers)
      if (round < capacity.get(worker.id)) slots.push(worker.id);
  return slots;
}

function assignDistributedTasks(tasks, slots, reports) {
  const capabilities = new Map(
    reports.map((report) => [
      report.workerId,
      new Set(report.applications[0].taskIds),
    ])
  );
  for (const task of tasks)
    if (![...capabilities.values()].some((taskIds) => taskIds.has(task.taskId)))
      throw new Error(
        `No distributed worker advertises selected task: ${task.taskId}`
      );
  const assignments = new Map();
  const completionOrder = new Map();
  const previousTaskBySlot = new Array(slots.length).fill(null);
  let cursor = 0;
  for (const task of tasks) {
    let assigned;
    let assignedSlotIndex;
    for (let offset = 0; offset < slots.length; offset += 1) {
      const slotIndex = (cursor + offset) % slots.length;
      const workerId = slots[slotIndex];
      if (!capabilities.get(workerId).has(task.taskId)) continue;
      assigned = workerId;
      assignedSlotIndex = slotIndex;
      cursor = (slotIndex + 1) % slots.length;
      break;
    }
    if (!assigned)
      throw new Error(
        `No distributed worker slot can execute selected task: ${task.taskId}`
      );
    assignments.set(task.taskId, assigned);
    const previousTaskId = previousTaskBySlot[assignedSlotIndex];
    completionOrder.set(task.taskId, previousTaskId ? [previousTaskId] : []);
    previousTaskBySlot[assignedSlotIndex] = task.taskId;
  }
  return { assignments, completionOrder };
}

export function verifyDistributedScheduleOutcome(
  value,
  { controllerId, configSha256, runId, applicationId } = {}
) {
  exactKeys(
    value,
    [
      'controllerFailure',
      'evidenceSha256',
      'failure',
      'instanceId',
      'reason',
      'status',
      'taskId',
      'wallMs',
      'workerId',
    ],
    'distributed schedule outcome'
  );
  controllerId = identifier(controllerId, 'schedule controller ID');
  configSha256 = digest(configSha256, 'schedule configuration hash');
  runId = identifier(runId, 'schedule run ID');
  applicationId = identifier(applicationId, 'schedule application ID');
  let {
    taskId,
    workerId,
    instanceId,
    status,
    reason,
    wallMs,
    evidenceSha256,
    failure,
    controllerFailure,
  } = value;
  taskId = digest(taskId, 'schedule outcome task ID');
  workerId = identifier(workerId, 'schedule outcome worker ID');
  instanceId = identifier(instanceId, 'schedule outcome instance ID');
  if (!SCHEDULE_OUTCOME_STATUSES.has(status))
    throw new Error('Distributed schedule outcome status is invalid');
  if (reason !== null && !DISTRIBUTED_SCHEDULE_OUTCOME_REASONS.has(reason))
    throw new Error('Distributed schedule outcome reason is invalid');
  if (status === 'passed' && reason !== null)
    throw new Error('Passed distributed schedule outcome cannot have a reason');
  if (status !== 'passed' && reason === null)
    throw new Error('Non-passing distributed schedule outcome needs a reason');
  if (status === 'not-run') {
    if (wallMs !== null || evidenceSha256 !== null)
      throw new Error('Not-run distributed schedule outcome has no evidence');
  } else {
    wallMs = nonnegativeDuration(
      wallMs,
      'Distributed schedule outcome wall time'
    );
    evidenceSha256 = digest(
      evidenceSha256,
      'distributed schedule outcome evidence hash'
    );
  }
  if (status === 'failed') {
    failure = verifyDistributedTaskFailureEvidence(failure);
    if (reason !== failure.reason || evidenceSha256 !== failure.failureSha256)
      throw new Error(
        'Distributed schedule outcome contradicts its failure evidence'
      );
    if (controllerFailure !== null)
      throw new Error(
        'Distributed schedule failure evidence must be mutually exclusive'
      );
  } else if (status === 'unknown') {
    if (failure !== null)
      throw new Error(
        'Distributed schedule failure evidence must be mutually exclusive'
      );
    controllerFailure = verifyDistributedControllerFailure(controllerFailure);
    if (
      reason !== controllerFailure.errorCode ||
      evidenceSha256 !== controllerFailure.failureSha256 ||
      wallMs !== controllerFailure.wallMs
    )
      throw new Error(
        'Distributed schedule outcome contradicts its controller failure evidence'
      );
    if (
      controllerFailure.taskId !== taskId ||
      controllerFailure.workerId !== workerId ||
      controllerFailure.runId !== runId ||
      controllerFailure.applicationId !== applicationId ||
      controllerFailure.controllerId !== controllerId ||
      controllerFailure.configSha256 !== configSha256
    )
      throw new Error(
        'Distributed schedule controller failure identity does not match its outcome'
      );
  } else if (failure !== null || controllerFailure !== null) {
    throw new Error(
      'Only failed or unknown distributed schedule outcomes carry failure evidence'
    );
  }
  return deepFreeze({
    taskId,
    workerId,
    instanceId,
    status,
    reason,
    wallMs,
    evidenceSha256,
    failure,
    controllerFailure,
  });
}

function scheduleOutcome(
  {
    taskId,
    workerId,
    instanceId,
    status,
    reason,
    wallMs,
    evidenceSha256,
    failure = null,
    controllerFailure = null,
  },
  context
) {
  return verifyDistributedScheduleOutcome(
    {
      taskId,
      workerId,
      instanceId,
      status,
      reason,
      wallMs,
      evidenceSha256,
      failure,
      controllerFailure,
    },
    context
  );
}

function scheduleReceipt(outcome, context) {
  const passed = outcome.status === 'passed';
  return {
    ...context,
    status: passed ? 'passed' : 'failed',
    reason: outcome.reason,
    cases: passed
      ? { passed: 1, failed: 0, skipped: 0 }
      : outcome.status === 'not-run'
        ? { passed: 0, failed: 0, skipped: 1 }
        : { passed: 0, failed: 1, skipped: 0 },
    ...(outcome.evidenceSha256
      ? { evidenceSha256: outcome.evidenceSha256 }
      : {}),
    cpuMs: null,
  };
}

export function encodeBoundedDistributedReport(value) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string')
    throw new Error('Distributed report must encode as JSON');
  const encoded = `${json}\n`;
  if (
    Buffer.byteLength(encoded, 'utf8') > MAX_DISTRIBUTED_SCHEDULE_REPORT_BYTES
  )
    throw new Error('Distributed schedule report exceeds its 32 MiB limit');
  return encoded;
}

export function verifyDistributedScheduleFailureReport(value) {
  exactKeys(
    value,
    SCHEDULE_FAILURE_REPORT_KEYS,
    'distributed schedule failure report'
  );
  if (value.schema !== DISTRIBUTED_SCHEDULE_FAILURE_REPORT_SCHEMA)
    throw new Error('Unsupported distributed schedule failure report schema');
  if (value.status !== 'failed')
    throw new Error('Distributed schedule failure report status is invalid');
  if (!DISTRIBUTED_CONTROLLER_FAILURE_CODES.has(value.errorCode))
    throw new Error('Distributed schedule failure code is not controlled');
  if (!SCHEDULE_FAILURE_TASK_EXECUTION_OUTCOMES.has(value.taskExecutionOutcome))
    throw new Error(
      'Distributed schedule failure task execution outcome is invalid'
    );
  const enabledWorkerIds = canonicalWorkerIds(value.enabledWorkerIds);
  if (
    enabledWorkerIds.some(
      (workerId, index) => workerId !== value.enabledWorkerIds[index]
    )
  )
    throw new Error(
      'Distributed schedule failure worker IDs must be canonical'
    );
  const core = {
    schema: value.schema,
    runId: identifier(value.runId, 'schedule failure run ID'),
    controllerId: identifier(
      value.controllerId,
      'schedule failure controller ID'
    ),
    configSha256: digest(
      value.configSha256,
      'schedule failure configuration hash'
    ),
    applicationId: identifier(
      value.applicationId,
      'schedule failure application ID'
    ),
    selectedTaskCount: boundedInteger(
      value.selectedTaskCount,
      'Distributed schedule failure selected task count',
      { minimum: 2, maximum: MAX_DISTRIBUTED_NATIVE_TASKS }
    ),
    selectedTaskIdsSha256: digest(
      value.selectedTaskIdsSha256,
      'schedule failure task selection hash'
    ),
    enabledWorkerIds,
    selectionManifestSha256:
      value.selectionManifestSha256 === null
        ? null
        : digest(
            value.selectionManifestSha256,
            'schedule failure selection manifest hash'
          ),
    status: value.status,
    errorCode: value.errorCode,
    taskExecutionOutcome: value.taskExecutionOutcome,
    startedAt: exactInstant(value.startedAt, 'schedule failure start instant'),
    wallMs: nonnegativeDuration(
      value.wallMs,
      'Distributed schedule failure wall time'
    ),
  };
  const reportSha256 = digest(
    value.reportSha256,
    'distributed schedule failure report hash'
  );
  if (reportSha256 !== canonicalJsonSha256(core))
    throw new Error('Distributed schedule failure report hash is invalid');
  const report = deepFreeze({ ...core, reportSha256 });
  encodeBoundedDistributedReport(report);
  return report;
}

export function createDistributedScheduleFailureReport({
  configSha256,
  controllerId,
  enabledWorkerIds: workerIdValues,
  runId,
  applicationId,
  taskIds: taskIdValues,
  selectionManifestSha256 = null,
  startedAt,
  wallMs,
  error,
  controllerAborted = false,
  taskExecutionOutcome = 'unknown',
} = {}) {
  if (typeof controllerAborted !== 'boolean')
    throw new Error('Distributed schedule failure abort state must be boolean');
  const taskIds = canonicalTaskIds(
    taskIdValues,
    'distributed schedule failure selection',
    { minimum: 2 }
  );
  const core = {
    schema: DISTRIBUTED_SCHEDULE_FAILURE_REPORT_SCHEMA,
    runId,
    controllerId,
    configSha256,
    applicationId,
    selectedTaskCount: taskIds.length,
    selectedTaskIdsSha256: canonicalJsonSha256(taskIds),
    enabledWorkerIds: canonicalWorkerIds(workerIdValues),
    selectionManifestSha256,
    status: 'failed',
    errorCode: distributedControllerFailureCode(error, controllerAborted),
    taskExecutionOutcome,
    startedAt,
    wallMs,
  };
  return verifyDistributedScheduleFailureReport({
    ...core,
    reportSha256: canonicalJsonSha256(core),
  });
}

function sealDistributedScheduleReport(core) {
  const report = {
    ...core,
    reportSha256: canonicalJsonSha256(core),
  };
  encodeBoundedDistributedReport(report);
  return deepFreeze(report);
}

function prospectiveScheduleReport(core, tasks, assignments, reports) {
  const instances = new Map(
    reports.map((report) => [report.workerId, report.instanceId])
  );
  for (const task of tasks) {
    const workerId = assignments.get(task.taskId);
    if (!instances.has(workerId))
      throw new Error('Distributed schedule task assignment is invalid');
  }
  const envelope = {
    ...core,
    status: 'failed',
    outcomes: [],
    reportSha256: 'f'.repeat(64),
  };
  // Native failure evidence contains two bounded text tails. Size a single
  // worst-case outcome and multiply instead of allocating a potentially huge
  // prospective report. NUL has the largest JSON escape expansion permitted by
  // the tail validator; the extra margin covers numeric serialization.
  const maximumTail = '\0'.repeat(MAX_DISTRIBUTED_FAILURE_TAIL_CODE_POINTS);
  const maximumFailure = {
    schema: DISTRIBUTED_TASK_FAILURE_SCHEMA,
    reason: 'cleanup-unverified',
    receipt: {
      schema: DISTRIBUTED_TASK_FAILURE_RECEIPT_SCHEMA,
      exitCode: Number.MAX_SAFE_INTEGER,
      signal: `SIG${'A'.repeat(31)}`,
      aborted: false,
      timedOut: false,
      wallMs: 0.0000000000000001,
      stdoutBytes: Number.MAX_SAFE_INTEGER,
      stdoutSha256: 'f'.repeat(64),
      stdoutTail: maximumTail,
      stdoutTailTruncated: false,
      stderrBytes: Number.MAX_SAFE_INTEGER,
      stderrSha256: 'f'.repeat(64),
      stderrTail: maximumTail,
      stderrTailTruncated: false,
      lifecycle: {
        spawned: false,
        completed: false,
        cleanupVerified: false,
        cleanupErrorPresent: false,
      },
    },
    failureSha256: 'f'.repeat(64),
  };
  const maximumOutcome = {
    taskId: 'f'.repeat(64),
    workerId: 'w'.repeat(128),
    instanceId: 'i'.repeat(128),
    status: 'failed',
    reason: maximumFailure.reason,
    wallMs: 0.0000000000000001,
    evidenceSha256: 'f'.repeat(64),
    failure: maximumFailure,
    controllerFailure: null,
  };
  const maximumControllerFailure = {
    schema: DISTRIBUTED_CONTROLLER_FAILURE_SCHEMA,
    controllerId: 'c'.repeat(128),
    workerId: 'w'.repeat(128),
    configSha256: 'f'.repeat(64),
    runId: 'r'.repeat(128),
    applicationId: 'a'.repeat(128),
    taskId: 'f'.repeat(64),
    status: 'failed',
    errorCode: 'transport-identity-rejected',
    remoteOutcome: 'unknown',
    startedAt: '9999-12-31T23:59:59.999Z',
    wallMs: 0.0000000000000001,
    failureSha256: 'f'.repeat(64),
  };
  const maximumUnknownOutcome = {
    taskId: 'f'.repeat(64),
    workerId: 'w'.repeat(128),
    instanceId: 'i'.repeat(128),
    status: 'unknown',
    reason: maximumControllerFailure.errorCode,
    wallMs: 0.0000000000000001,
    evidenceSha256: 'f'.repeat(64),
    failure: null,
    controllerFailure: maximumControllerFailure,
  };
  const envelopeBytes = Buffer.byteLength(
    `${JSON.stringify(envelope)}\n`,
    'utf8'
  );
  const maximumOutcomeBytes =
    Math.max(
      Buffer.byteLength(JSON.stringify(maximumOutcome), 'utf8'),
      Buffer.byteLength(JSON.stringify(maximumUnknownOutcome), 'utf8')
    ) + 1024;
  const prospectiveBytes =
    envelopeBytes +
    tasks.length * maximumOutcomeBytes +
    Math.max(0, tasks.length - 1);
  if (prospectiveBytes > MAX_DISTRIBUTED_SCHEDULE_REPORT_BYTES)
    throw new Error('Distributed schedule report exceeds its 32 MiB limit');
}

export async function runDistributedControllerSchedule({
  config: configValue,
  applications,
  workerIds: workerIdValues,
  applicationId,
  taskIds: taskIdValues,
  selectionManifestSha256 = null,
  runId = randomUUID(),
  secret,
  timeoutMs,
  localRuntimes,
  catalogFactory = createDistributedNativeCatalog,
  requestFactory = createDistributedNativeTaskRequest,
  requestJson = requestDistributedTrustedJson,
  replayCache = createDistributedTrustedReplayCache(),
  sessionFactory = createDistributedControllerSession,
  signal,
} = {}) {
  const config = verifyDistributedWorkerConfig(configValue);
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new Error('Distributed controller signal must be an AbortSignal');
  signal?.throwIfAborted();
  runId = identifier(runId, 'distributed run ID');
  applicationId = identifier(applicationId, 'controller application ID');
  const selectedTaskIds = canonicalTaskIds(
    taskIdValues,
    'distributed schedule selection',
    { minimum: 2 }
  );
  selectionManifestSha256 =
    selectionManifestSha256 === null
      ? null
      : digest(
          selectionManifestSha256,
          'distributed schedule selection manifest hash'
        );
  const selectedWorkerIds = canonicalWorkerIds(workerIdValues);
  const workers = selectedWorkerIds.map((workerId) =>
    configuredDistributedWorker(config, workerId)
  );
  const roots = normalizeApplications(applications);
  const root = roots.get(applicationId);
  if (!root)
    throw new Error(
      `Controller does not register application: ${applicationId}`
    );
  const catalog = catalogFactory(root, {
    applicationId,
    allowedTaskIds: selectedTaskIds,
  });
  const tasks = controllerCatalogTasks(catalog, applicationId, selectedTaskIds);
  const runtimes = normalizeLocalRuntimes(localRuntimes, selectedWorkerIds);
  const probeAbort = new AbortController();
  const scheduleSignal = signal
    ? AbortSignal.any([signal, probeAbort.signal])
    : probeAbort.signal;
  if (typeof sessionFactory !== 'function')
    throw new Error('Distributed schedule requires a session factory');
  const sessions = new Map(
    workers.map((worker) => {
      const session = sessionFactory({
        config,
        applications,
        workerId: worker.id,
        applicationId,
        taskIds: selectedTaskIds,
        secret,
        timeoutMs,
        localRuntime: runtimes.get(worker.id) ?? null,
        catalog,
        catalogFactory,
        requestFactory,
        requestJson,
        replayCache,
        signal: scheduleSignal,
      });
      if (
        !session ||
        session.workerId !== worker.id ||
        typeof session.probe !== 'function' ||
        typeof session.execute !== 'function'
      )
        throw new Error('Distributed schedule worker session is invalid');
      return [worker.id, session];
    })
  );

  // Fleet admission is a barrier: every selected worker must authenticate and
  // prove an idle, candidate-matched capability report before any task starts.
  let firstProbeError;
  const probedReports = await Promise.allSettled(
    workers.map(async (worker) => {
      try {
        const report = await sessions.get(worker.id).probe();
        return verifyWorkerReport(report, {
          config,
          worker,
          applicationId,
          catalog,
        });
      } catch (error) {
        if (firstProbeError === undefined) {
          firstProbeError =
            error instanceof Error
              ? error
              : new Error('Distributed worker probe failed');
          probeAbort.abort(firstProbeError);
        }
        throw error;
      }
    })
  );
  if (firstProbeError !== undefined) throw firstProbeError;
  const workerReports = probedReports
    .map((result) => result.value)
    .toSorted((left, right) => compareText(left.workerId, right.workerId));
  if (workerReports.some((report) => report.activeTasks !== 0))
    throw new Error('Distributed schedule requires idle workers');
  const slots = interleavedWorkerSlots(workers, workerReports);
  const { assignments, completionOrder } = assignDistributedTasks(
    tasks,
    slots,
    workerReports
  );
  const reportCore = {
    schema: DISTRIBUTED_SCHEDULE_REPORT_SCHEMA,
    runId,
    applicationId,
    configSha256: config.configSha256,
    candidateSha256: digest(
      catalog.candidate.candidateSha256,
      'distributed schedule candidate hash'
    ),
    catalogSha256: digest(
      catalog.catalogSha256,
      'distributed schedule catalog hash'
    ),
    selectionManifestSha256,
    workerReports,
  };
  prospectiveScheduleReport(reportCore, tasks, assignments, workerReports);

  const reportsByWorker = new Map(
    workerReports.map((report) => [report.workerId, report])
  );
  const outcomeContext = {
    controllerId: config.controllerId,
    configSha256: config.configSha256,
    runId,
    applicationId,
  };
  const workerState = new Map(
    workerReports.map((report) => [
      report.workerId,
      {
        available: true,
        semaphore: createSemaphore(report.capacity.configuredWorkers),
      },
    ])
  );
  const outcomes = new Map();
  const plan = preparePlan({
    runId,
    candidate: {
      repository: applicationId,
      commit: catalog.candidate.commitSha,
      tree: catalog.candidate.treeSha,
      lockSha256: catalog.candidate.lockfileSha256,
    },
    maxSlots: slots.length,
    lanes: [
      {
        id: 'distributed-native',
        kind: 'check',
        required: true,
        dependsOn: [],
        after: [],
        prerequisites: [],
      },
    ],
    units: tasks.map((task) => ({
      id: task.taskId,
      lane: 'distributed-native',
      slots: 1,
      dependsOn: [],
      // A completion-only edge per deterministic virtual worker slot keeps
      // coordinate from reserving global capacity for semaphore waiters. A
      // failed task still releases its slot for the next independent task.
      after: completionOrder.get(task.taskId),
      reads: [],
      writes: [],
      files: [...task.files],
    })),
  });
  const coordinated = await coordinate(plan, {
    execute: true,
    signal: scheduleSignal,
    executor: async (unit, context) => {
      const workerId = assignments.get(unit.id);
      const report = reportsByWorker.get(workerId);
      const state = workerState.get(workerId);
      await state.semaphore.enter();
      try {
        let outcome;
        if (scheduleSignal.aborted) {
          outcome = scheduleOutcome(
            {
              taskId: unit.id,
              workerId,
              instanceId: report.instanceId,
              status: 'not-run',
              reason: 'controller-aborted',
              wallMs: null,
              evidenceSha256: null,
            },
            outcomeContext
          );
        } else if (!state.available) {
          outcome = scheduleOutcome(
            {
              taskId: unit.id,
              workerId,
              instanceId: report.instanceId,
              status: 'not-run',
              reason: 'worker-unavailable',
              wallMs: null,
              evidenceSha256: null,
            },
            outcomeContext
          );
        } else {
          const startedAt = new Date().toISOString();
          const started = performance.now();
          try {
            const result = await sessions.get(workerId).execute(unit.id, runId);
            outcome =
              result.status === 'passed'
                ? scheduleOutcome(
                    {
                      taskId: unit.id,
                      workerId,
                      instanceId: result.instanceId,
                      status: 'passed',
                      reason: null,
                      wallMs: result.wallMs,
                      evidenceSha256: result.result.resultSha256,
                    },
                    outcomeContext
                  )
                : scheduleOutcome(
                    {
                      taskId: unit.id,
                      workerId,
                      instanceId: result.instanceId,
                      status: 'failed',
                      reason: result.failure.reason,
                      wallMs: result.wallMs,
                      evidenceSha256: result.failure.failureSha256,
                      failure: result.failure,
                    },
                    outcomeContext
                  );
          } catch (error) {
            state.available = false;
            const failure = createDistributedControllerFailureReport({
              configSha256: config.configSha256,
              controllerId: config.controllerId,
              workerId,
              runId,
              applicationId,
              taskId: unit.id,
              startedAt,
              wallMs: performance.now() - started,
              error,
              controllerAborted: scheduleSignal.aborted,
            }).controllerFailure;
            outcome = scheduleOutcome(
              {
                taskId: unit.id,
                workerId,
                instanceId: report.instanceId,
                status: 'unknown',
                reason: failure.errorCode,
                wallMs: failure.wallMs,
                evidenceSha256: failure.failureSha256,
                controllerFailure: failure,
              },
              outcomeContext
            );
          }
        }
        outcomes.set(unit.id, outcome);
        return scheduleReceipt(outcome, context);
      } finally {
        state.semaphore.leave();
      }
    },
  });

  for (const task of tasks) {
    if (outcomes.has(task.taskId)) continue;
    const workerId = assignments.get(task.taskId);
    outcomes.set(
      task.taskId,
      scheduleOutcome(
        {
          taskId: task.taskId,
          workerId,
          instanceId: reportsByWorker.get(workerId).instanceId,
          status: 'not-run',
          reason: scheduleSignal.aborted
            ? 'controller-aborted'
            : 'worker-unavailable',
          wallMs: null,
          evidenceSha256: null,
        },
        outcomeContext
      )
    );
  }
  const orderedOutcomes = tasks.map((task) => outcomes.get(task.taskId));
  const passed =
    coordinated.ok &&
    !scheduleSignal.aborted &&
    orderedOutcomes.every((outcome) => outcome.status === 'passed');
  return sealDistributedScheduleReport({
    ...reportCore,
    status: passed ? 'passed' : 'failed',
    outcomes: orderedOutcomes,
  });
}
