// Copyright (c) snapetech and SeerrNG contributors.
// Minimal live runtime for trusted developer-fleet validation workers.
import { randomUUID } from 'node:crypto';
import { arch, platform } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
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
  'seerrng-distributed-worker-report/v1';
export const DISTRIBUTED_TASK_RESULT_SCHEMA =
  'seerrng-distributed-task-result/v1';
export const DISTRIBUTED_TASK_FAILURE_SCHEMA =
  'seerrng-distributed-task-failure/v1';
export const DISTRIBUTED_TASK_FAILURE_RECEIPT_SCHEMA =
  'seerrng-distributed-task-failure-receipt/v1';
export const DISTRIBUTED_CONTROLLER_FAILURE_SCHEMA =
  'seerrng-distributed-controller-failure/v1';
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
    taskCount: catalog.tasks.length,
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
    ],
    'distributed worker application report'
  );
  if (
    application.applicationId !== applicationId ||
    application.candidateSha256 !== catalog.candidate.candidateSha256
  )
    throw new Error('Distributed worker candidate does not match controller');
  digest(application.catalogSha256, 'worker application catalog hash');
  digest(application.inventorySha256, 'worker application inventory hash');
  const taskCount = boundedInteger(
    application.taskCount,
    'Distributed worker executable task count',
    { minimum: 1, maximum: MAX_DISTRIBUTED_NATIVE_TASKS }
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
  const config = verifyDistributedWorkerConfig(configValue);
  const worker = configuredDistributedWorker(config, workerId);
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new Error('Distributed controller signal must be an AbortSignal');
  signal?.throwIfAborted();
  identifier(applicationId, 'controller application ID');
  identifier(runId, 'distributed run ID');
  const selectedTaskIds = normalizeAllowedTaskIds([taskId]);
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
  const report = verifyWorkerReport(
    await call(DISTRIBUTED_PROBE_KIND, {
      configSha256: config.configSha256,
      applicationIds: [applicationId],
    }),
    { config, worker, applicationId, catalog }
  );
  const request = requestFactory(catalog, taskId);
  const result = await call(DISTRIBUTED_TASK_KIND, {
    configSha256: config.configSha256,
    runId,
    applicationId,
    expectedCandidate: catalog.candidate,
    request,
  });
  return deepFreeze({
    report,
    result: verifyWorkerTaskResult(result, {
      worker,
      report,
      runId,
      applicationId,
      taskId,
      catalog,
    }),
  });
}
