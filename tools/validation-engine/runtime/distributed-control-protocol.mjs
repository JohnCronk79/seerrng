// Copyright (c) snapetech and SeerrNG contributors.
// Transport-neutral authenticated control contracts for distributed validation.
import { verifyDistributedExecutionBridge } from './distributed-execution-bridge.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_FLEET_PROBE_SCHEMA =
  'seerrng-distributed-fleet-probe/v1';
export const DISTRIBUTED_FLEET_REPORT_SCHEMA =
  'seerrng-distributed-fleet-report/v1';
export const DISTRIBUTED_EXECUTION_OPEN_MANIFEST_SCHEMA =
  'seerrng-distributed-execution-open-manifest/v1';
export const DISTRIBUTED_EXECUTION_OPEN_ACK_SCHEMA =
  'seerrng-distributed-execution-open-ack/v1';
export const DISTRIBUTED_CONTROL_REPLAY_KEY_SCHEMA =
  'seerrng-distributed-control-replay-key/v1';
export const MAX_DISTRIBUTED_CONTROL_AUTH_WINDOW_MS = 60_000;
export const MAX_DISTRIBUTED_CONTROL_ADAPTERS = 256;
export const MAX_DISTRIBUTED_EXECUTION_OPEN_TASKS = 65_536;
export const MAX_DISTRIBUTED_FLEET_MESSAGE_BYTES = 256 * 1024;
export const MAX_DISTRIBUTED_EXECUTION_OPEN_BYTES = 16 * 1024 * 1024;

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/;
const NONCE = /^[A-Za-z0-9_-]{16,512}$/;
const PROOF = /^[A-Za-z0-9_-]{16,8192}$/;
const AUTH_ALGORITHMS = new Set([
  'ed25519',
  'hmac-sha256',
  'mtls-exporter-sha256',
]);
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
const ADAPTER_KEYS = ['adapterId', 'adapterIdentitySha256'];
const PROBE_INPUT_KEYS = [
  'auth',
  'challengeNonce',
  'configRevision',
  'configSha256',
  'controllerId',
  'expiresAtMs',
  'issuedAtMs',
  'schema',
];
const PROBE_KEYS = [...PROBE_INPUT_KEYS, 'probeSha256'];
const REPORT_INPUT_KEYS = [
  'adapters',
  'agentVersion',
  'architecture',
  'auth',
  'availableMemoryMiB',
  'challengeNonce',
  'configRevision',
  'configSha256',
  'controllerId',
  'instanceId',
  'loadPermille',
  'logicalCpuCapacity',
  'machineIdentitySha256',
  'maxSafeN',
  'observedAtMs',
  'performanceProfileSha256',
  'performanceScorePermille',
  'platform',
  'probeSha256',
  'safeAvailableN',
  'schema',
  'sentAtMs',
  'totalMemoryMiB',
  'workerId',
];
const REPORT_KEYS = [...REPORT_INPUT_KEYS, 'reportSha256'];
const MANIFEST_INPUT_KEYS = [
  'adapters',
  'assignments',
  'auth',
  'binding',
  'bridgeSha256',
  'brokerApplicationIsolationKeySha256',
  'candidate',
  'expiresAtMs',
  'issuedAtMs',
  'outputNamespaces',
  'queueApplicationIsolationKeySha256',
  'schema',
  'source',
  'sourceWorkspaceIdentitySha256',
  'tasks',
  'workerId',
  'workerPolicy',
];
const MANIFEST_KEYS = [...MANIFEST_INPUT_KEYS, 'manifestSha256'];
const ACK_INPUT_KEYS = [
  'acceptedAtMs',
  'adapterSetSha256',
  'agentVersion',
  'assignmentSetSha256',
  'auth',
  'bindingSha256',
  'bridgeSha256',
  'controllerId',
  'instanceId',
  'machineIdentitySha256',
  'manifestSha256',
  'schema',
  'sourceWorkspaceIdentitySha256',
  'status',
  'taskSetSha256',
  'workerId',
];
const ACK_KEYS = [...ACK_INPUT_KEYS, 'ackSha256'];

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

function version(value, label) {
  if (typeof value !== 'string' || !VERSION.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function nonce(value, label) {
  if (typeof value !== 'string' || !NONCE.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function integer(
  value,
  label,
  { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${label} must be a safe integer from ${minimum} through ${maximum}`
    );
  return value;
}

function sameCanonical(left, right) {
  return canonicalJsonSha256(left) === canonicalJsonSha256(right);
}

function assertBytes(value, maximum, label) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must contain JSON values only`);
  }
  if (Buffer.byteLength(encoded, 'utf8') > maximum)
    throw new Error(`${label} exceeds ${maximum} bytes`);
}

function normalizeAuth(value, { principalId, issuedAtMs, expiresAtMs }) {
  exactKeys(value, AUTH_KEYS, 'distributed control authentication');
  if (!AUTH_ALGORITHMS.has(value.algorithm))
    throw new Error('Unsupported distributed control authentication algorithm');
  const auth = {
    algorithm: value.algorithm,
    sessionId: identifier(value.sessionId, 'authentication session ID'),
    principalId: identifier(value.principalId, 'authentication principal ID'),
    keyId: identifier(value.keyId, 'authentication key ID'),
    nonce: nonce(value.nonce, 'authentication nonce'),
    issuedAtMs: integer(value.issuedAtMs, 'Authentication issue time'),
    expiresAtMs: integer(value.expiresAtMs, 'Authentication expiry time'),
    proof: value.proof,
  };
  if (!PROOF.test(auth.proof ?? ''))
    throw new Error('Exact detached authentication proof is required');
  if (auth.expiresAtMs <= auth.issuedAtMs)
    throw new Error('Authentication expiry must follow its issue time');
  if (
    auth.expiresAtMs - auth.issuedAtMs >
    MAX_DISTRIBUTED_CONTROL_AUTH_WINDOW_MS
  )
    throw new Error('Distributed control authentication window is too long');
  if (principalId !== undefined && auth.principalId !== principalId)
    throw new Error('Distributed control principal does not match its message');
  if (
    issuedAtMs !== undefined &&
    (auth.issuedAtMs !== issuedAtMs || auth.expiresAtMs !== expiresAtMs)
  )
    throw new Error('Distributed control authentication window drifted');
  return auth;
}

function normalizeAdapters(value, label) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${label} must be a nonempty array`);
  if (value.length > MAX_DISTRIBUTED_CONTROL_ADAPTERS)
    throw new Error(
      `${label} exceeds ${MAX_DISTRIBUTED_CONTROL_ADAPTERS} adapters`
    );
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
    throw new Error(`${label} contains a duplicate adapter identity`);
  return adapters;
}

function seal(value, sealKey, maximumBytes, label) {
  const sealed = deepFreeze({
    ...value,
    [sealKey]: canonicalJsonSha256(value),
  });
  assertBytes(sealed, maximumBytes, label);
  return sealed;
}

function assertLiveWindow({ auth, eventAtMs, nowMs, label }) {
  integer(nowMs, `${label} verification time`);
  if (eventAtMs < auth.issuedAtMs || eventAtMs > auth.expiresAtMs)
    throw new Error(`${label} is outside its authenticated session`);
  if (auth.issuedAtMs > nowMs || eventAtMs > nowMs)
    throw new Error(`${label} is in the future`);
  if (nowMs > auth.expiresAtMs)
    throw new Error(`${label} authentication has expired`);
}

function authenticate(
  value,
  { kind, nowMs, eventAtMs, signingSha256, verifyProof }
) {
  if (typeof verifyProof !== 'function')
    throw new Error(
      `${kind} authentication requires an external proof verifier`
    );
  assertLiveWindow({ auth: value.auth, eventAtMs, nowMs, label: kind });
  const replayKeySha256 = distributedControlReplayKeySha256(value);
  const verified = verifyProof({
    auth: value.auth,
    kind,
    message: value,
    replayKeySha256,
    signingSha256,
  });
  if (verified && typeof verified.then === 'function')
    throw new Error(`${kind} proof verifier must be synchronous`);
  if (verified !== true)
    throw new Error(`${kind} authentication proof was rejected`);
  return value;
}

function signingSha256(value, keys, sealKey, label) {
  exactKeys(value, keys, label);
  plainObject(value.auth, `${label} authentication`);
  const unsigned = { ...value };
  delete unsigned[sealKey];
  return canonicalJsonSha256({
    ...unsigned,
    auth: { ...unsigned.auth, proof: null },
  });
}

export function distributedControlReplayKeySha256(value) {
  plainObject(value, 'distributed control message');
  const auth = normalizeAuth(value.auth, {});
  return canonicalJsonSha256({
    schema: DISTRIBUTED_CONTROL_REPLAY_KEY_SCHEMA,
    sessionId: auth.sessionId,
    principalId: auth.principalId,
    nonce: auth.nonce,
  });
}

function normalizeProbeInput(value) {
  exactKeys(value, PROBE_INPUT_KEYS, 'distributed fleet probe input');
  if (value.schema !== DISTRIBUTED_FLEET_PROBE_SCHEMA)
    throw new Error('Unsupported distributed fleet probe schema');
  const controllerId = identifier(value.controllerId, 'controller ID');
  const issuedAtMs = integer(value.issuedAtMs, 'Probe issue time');
  const expiresAtMs = integer(value.expiresAtMs, 'Probe expiry time');
  if (
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > MAX_DISTRIBUTED_CONTROL_AUTH_WINDOW_MS
  )
    throw new Error('Distributed fleet probe has an invalid time window');
  return {
    schema: DISTRIBUTED_FLEET_PROBE_SCHEMA,
    controllerId,
    configRevision: integer(value.configRevision, 'Worker config revision', {
      minimum: 1,
    }),
    configSha256: digest(value.configSha256, 'worker config hash'),
    challengeNonce: nonce(value.challengeNonce, 'fleet challenge nonce'),
    issuedAtMs,
    expiresAtMs,
    auth: normalizeAuth(value.auth, {
      principalId: controllerId,
      issuedAtMs,
      expiresAtMs,
    }),
  };
}

export function sealDistributedFleetProbe(value) {
  return seal(
    normalizeProbeInput(value),
    'probeSha256',
    MAX_DISTRIBUTED_FLEET_MESSAGE_BYTES,
    'Distributed fleet probe'
  );
}

export function verifyDistributedFleetProbe(value, expectedProbeSha256) {
  exactKeys(value, PROBE_KEYS, 'sealed distributed fleet probe');
  const expected = digest(expectedProbeSha256, 'expected fleet probe hash');
  const probe = sealDistributedFleetProbe(
    Object.fromEntries(PROBE_INPUT_KEYS.map((key) => [key, value[key]]))
  );
  if (value.probeSha256 !== probe.probeSha256 || probe.probeSha256 !== expected)
    throw new Error('Distributed fleet probe does not match its trusted hash');
  return probe;
}

export function distributedFleetProbeSigningSha256(value) {
  return signingSha256(
    value,
    PROBE_KEYS,
    'probeSha256',
    'sealed distributed fleet probe'
  );
}

export function authenticateDistributedFleetProbe(
  value,
  {
    expectedProbeSha256,
    expectedControllerId,
    expectedConfigRevision,
    expectedConfigSha256,
    nowMs,
    verifyProof,
  }
) {
  const probe = verifyDistributedFleetProbe(value, expectedProbeSha256);
  if (
    probe.controllerId !==
      identifier(expectedControllerId, 'expected controller ID') ||
    probe.configRevision !==
      integer(expectedConfigRevision, 'Expected worker config revision', {
        minimum: 1,
      }) ||
    probe.configSha256 !==
      digest(expectedConfigSha256, 'expected worker config hash')
  )
    throw new Error(
      'Distributed fleet probe belongs to another controller config'
    );
  return authenticate(probe, {
    kind: 'Distributed fleet probe',
    nowMs,
    eventAtMs: probe.issuedAtMs,
    signingSha256: distributedFleetProbeSigningSha256(probe),
    verifyProof,
  });
}

function normalizeReportInput(value) {
  exactKeys(value, REPORT_INPUT_KEYS, 'distributed fleet report input');
  if (value.schema !== DISTRIBUTED_FLEET_REPORT_SCHEMA)
    throw new Error('Unsupported distributed fleet report schema');
  const controllerId = identifier(value.controllerId, 'report controller ID');
  const workerId = identifier(value.workerId, 'worker ID');
  const logicalCpuCapacity = integer(
    value.logicalCpuCapacity,
    'Logical CPU capacity',
    { minimum: 1, maximum: 256 }
  );
  const maxSafeN = integer(value.maxSafeN, 'Maximum safe N', {
    minimum: 1,
    maximum: logicalCpuCapacity,
  });
  const safeAvailableN = integer(value.safeAvailableN, 'Safe available N', {
    maximum: maxSafeN,
  });
  const totalMemoryMiB = integer(value.totalMemoryMiB, 'Total memory MiB', {
    minimum: 1,
  });
  const availableMemoryMiB = integer(
    value.availableMemoryMiB,
    'Available memory MiB',
    { maximum: totalMemoryMiB }
  );
  const loadPermille = integer(value.loadPermille, 'Worker load permille', {
    maximum: 1_000,
  });
  const observedAtMs = integer(value.observedAtMs, 'Capacity observation time');
  const sentAtMs = integer(value.sentAtMs, 'Fleet report send time');
  if (observedAtMs > sentAtMs)
    throw new Error('Fleet capacity observation cannot follow its send time');
  const auth = normalizeAuth(value.auth, { principalId: workerId });
  if (observedAtMs < auth.issuedAtMs || sentAtMs > auth.expiresAtMs)
    throw new Error(
      'Distributed fleet report is outside its authenticated session'
    );
  return {
    schema: DISTRIBUTED_FLEET_REPORT_SCHEMA,
    probeSha256: digest(value.probeSha256, 'fleet probe hash'),
    controllerId,
    configRevision: integer(value.configRevision, 'Worker config revision', {
      minimum: 1,
    }),
    configSha256: digest(value.configSha256, 'worker config hash'),
    challengeNonce: nonce(value.challengeNonce, 'fleet challenge nonce'),
    workerId,
    machineIdentitySha256: digest(
      value.machineIdentitySha256,
      'worker machine identity hash'
    ),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    agentVersion: version(value.agentVersion, 'worker agent version'),
    platform: identifier(value.platform, 'worker platform'),
    architecture: identifier(value.architecture, 'worker architecture'),
    logicalCpuCapacity,
    maxSafeN,
    safeAvailableN,
    totalMemoryMiB,
    availableMemoryMiB,
    loadPermille,
    performanceProfileSha256: digest(
      value.performanceProfileSha256,
      'worker performance profile hash'
    ),
    performanceScorePermille: integer(
      value.performanceScorePermille,
      'Worker performance score permille',
      { minimum: 1, maximum: 1_000_000 }
    ),
    adapters: normalizeAdapters(value.adapters, 'worker adapter identities'),
    observedAtMs,
    sentAtMs,
    auth,
  };
}

export function sealDistributedFleetReport(value) {
  return seal(
    normalizeReportInput(value),
    'reportSha256',
    MAX_DISTRIBUTED_FLEET_MESSAGE_BYTES,
    'Distributed fleet report'
  );
}

export function distributedFleetReportSigningSha256(value) {
  return signingSha256(
    value,
    REPORT_KEYS,
    'reportSha256',
    'sealed distributed fleet report'
  );
}

function verifyFleetReportAgainstProbe(
  value,
  {
    expectedProbe,
    expectedProbeSha256,
    expectedWorkerId,
    expectedMachineIdentitySha256,
    expectedAgentVersion,
    expectedAdapters,
    expectedPerformanceProfileSha256,
    expectedPerformanceScorePermille,
  }
) {
  exactKeys(value, REPORT_KEYS, 'sealed distributed fleet report');
  const report = sealDistributedFleetReport(
    Object.fromEntries(REPORT_INPUT_KEYS.map((key) => [key, value[key]]))
  );
  if (value.reportSha256 !== report.reportSha256)
    throw new Error(
      'Distributed fleet report seal does not match its contents'
    );
  const probe = verifyDistributedFleetProbe(expectedProbe, expectedProbeSha256);
  if (
    report.probeSha256 !== probe.probeSha256 ||
    report.controllerId !== probe.controllerId ||
    report.configRevision !== probe.configRevision ||
    report.configSha256 !== probe.configSha256 ||
    report.challengeNonce !== probe.challengeNonce ||
    report.observedAtMs < probe.issuedAtMs ||
    report.sentAtMs > probe.expiresAtMs
  )
    throw new Error('Distributed fleet report is not bound to its exact probe');
  if (
    report.workerId !== identifier(expectedWorkerId, 'expected worker ID') ||
    report.machineIdentitySha256 !==
      digest(
        expectedMachineIdentitySha256,
        'expected worker machine identity hash'
      ) ||
    report.agentVersion !==
      version(expectedAgentVersion, 'expected worker agent version')
  )
    throw new Error(
      'Distributed fleet report belongs to another worker identity'
    );
  const adapters = normalizeAdapters(
    expectedAdapters,
    'expected worker adapters'
  );
  if (!sameCanonical(report.adapters, adapters))
    throw new Error('Distributed fleet report adapter identities drifted');
  if (
    report.performanceProfileSha256 !==
      digest(
        expectedPerformanceProfileSha256,
        'expected worker performance profile hash'
      ) ||
    report.performanceScorePermille !==
      integer(
        expectedPerformanceScorePermille,
        'Expected worker performance score permille',
        { minimum: 1, maximum: 1_000_000 }
      )
  )
    throw new Error(
      'Distributed fleet report performance calibration is not trusted'
    );
  return report;
}

export function verifyDistributedFleetReport(value, expectations) {
  return verifyFleetReportAgainstProbe(value, expectations);
}

export function authenticateDistributedFleetReport(
  value,
  { nowMs, verifyProof, ...expectations }
) {
  const report = verifyFleetReportAgainstProbe(value, expectations);
  return authenticate(report, {
    kind: 'Distributed fleet report',
    nowMs,
    eventAtMs: report.sentAtMs,
    signingSha256: distributedFleetReportSigningSha256(report),
    verifyProof,
  });
}

function cloneObject(value) {
  return structuredClone(value);
}

function manifestTaskReference(task) {
  return {
    taskId: task.taskId,
    taskSha256: task.taskSha256,
    unitId: task.unitId,
    caseId: task.caseId,
    adapterId: task.adapterId,
    assignment: cloneObject(task.assignment),
    dependencyTaskIds: [...task.dependencyTaskIds],
  };
}

function deriveExecutionOpenManifest({
  bridge: bridgeValue,
  bridgeExpectations,
  workerId: workerIdValue,
  sourceWorkspaceIdentitySha256: workspaceValue,
  issuedAtMs: issuedValue,
  expiresAtMs: expiresValue,
  auth: authValue,
}) {
  const bridge = verifyDistributedExecutionBridge(
    bridgeValue,
    bridgeExpectations
  );
  const workerId = identifier(workerIdValue, 'execution-open worker ID');
  const workerPolicy = bridge.brokerWorkerConfig.workers.find(
    (entry) => entry.workerId === workerId
  );
  if (!workerPolicy?.enabled)
    throw new Error('Execution-open worker is not enabled by the bridge');
  const assignments = bridge.assignments
    .filter((entry) => entry.assignedWorkerId === workerId)
    .map(cloneObject)
    .toSorted((left, right) => left.sequence - right.sequence);
  if (assignments.length === 0)
    throw new Error('Execution-open worker has no assigned tasks');
  if (assignments.length > MAX_DISTRIBUTED_EXECUTION_OPEN_TASKS)
    throw new Error('Execution-open manifest exceeds its task limit');
  const assignmentByTask = new Map(
    assignments.map((entry) => [entry.taskId, entry])
  );
  const tasks = bridge.tasks
    .filter((task) => task.assignment.workerId === workerId)
    .map(manifestTaskReference)
    .toSorted((left, right) => compareText(left.taskId, right.taskId));
  if (
    tasks.length !== assignments.length ||
    tasks.some(
      (task) =>
        assignmentByTask.get(task.taskId)?.taskSha256 !== task.taskSha256
    )
  )
    throw new Error(
      'Execution-open tasks do not match their bridge assignments'
    );
  const usedAdapterIds = [
    ...new Set(tasks.map((task) => task.adapterId)),
  ].toSorted(compareText);
  const catalogAdapters = normalizeAdapters(
    bridgeExpectations.taskCatalog.adapters,
    'verified task-catalog adapters'
  );
  const adapterById = new Map(
    catalogAdapters.map((entry) => [entry.adapterId, entry])
  );
  const adapters = usedAdapterIds.map((adapterId) => {
    const adapter = adapterById.get(adapterId);
    if (!adapter)
      throw new Error(
        `Execution-open adapter identity is missing: ${adapterId}`
      );
    return adapter;
  });
  const issuedAtMs = integer(issuedValue, 'Execution-open issue time');
  const expiresAtMs = integer(expiresValue, 'Execution-open expiry time');
  if (
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > MAX_DISTRIBUTED_CONTROL_AUTH_WINDOW_MS
  )
    throw new Error('Execution-open manifest has an invalid time window');
  const input = {
    schema: DISTRIBUTED_EXECUTION_OPEN_MANIFEST_SCHEMA,
    bridgeSha256: bridge.bridgeSha256,
    workerId,
    workerPolicy: cloneObject(workerPolicy),
    binding: cloneObject(bridge.binding),
    candidate: {
      applicationId: bridge.binding.applicationId,
      repositoryIdentitySha256: bridge.binding.repositoryIdentitySha256,
      candidateSha256: bridge.binding.candidateSha256,
      planSha256: bridge.binding.planSha256,
    },
    source: cloneObject(bridge.source),
    sourceWorkspaceIdentitySha256: digest(
      workspaceValue,
      'source workspace identity hash'
    ),
    queueApplicationIsolationKeySha256:
      bridge.queueApplicationIsolationKeySha256,
    brokerApplicationIsolationKeySha256:
      bridge.brokerApplicationIsolationKeySha256,
    outputNamespaces: cloneObject(bridge.outputNamespaces),
    adapters,
    tasks,
    assignments,
    issuedAtMs,
    expiresAtMs,
    auth: normalizeAuth(authValue, {
      principalId: bridge.binding.controllerId,
      issuedAtMs,
      expiresAtMs,
    }),
  };
  return seal(
    input,
    'manifestSha256',
    MAX_DISTRIBUTED_EXECUTION_OPEN_BYTES,
    'Distributed execution-open manifest'
  );
}

export function createDistributedExecutionOpenManifest(value) {
  exactKeys(
    value,
    [
      'auth',
      'bridge',
      'bridgeExpectations',
      'expiresAtMs',
      'issuedAtMs',
      'sourceWorkspaceIdentitySha256',
      'workerId',
    ],
    'execution-open manifest sources'
  );
  return deriveExecutionOpenManifest(value);
}

export function distributedExecutionOpenManifestSigningSha256(value) {
  return signingSha256(
    value,
    MANIFEST_KEYS,
    'manifestSha256',
    'sealed distributed execution-open manifest'
  );
}

function verifyManifest(value, expectations) {
  exactKeys(value, MANIFEST_KEYS, 'sealed distributed execution-open manifest');
  exactKeys(
    expectations,
    [
      'bridge',
      'bridgeExpectations',
      'expectedManifestSha256',
      'expectedSourceWorkspaceIdentitySha256',
      'expectedWorkerId',
    ],
    'execution-open manifest expectations'
  );
  assertBytes(
    value,
    MAX_DISTRIBUTED_EXECUTION_OPEN_BYTES,
    'Distributed execution-open manifest'
  );
  const expectedManifestSha256 = digest(
    expectations.expectedManifestSha256,
    'expected execution-open manifest hash'
  );
  if (value.manifestSha256 !== expectedManifestSha256)
    throw new Error('Execution-open manifest does not match its trusted hash');
  const expected = deriveExecutionOpenManifest({
    bridge: expectations.bridge,
    bridgeExpectations: expectations.bridgeExpectations,
    workerId: expectations.expectedWorkerId,
    sourceWorkspaceIdentitySha256:
      expectations.expectedSourceWorkspaceIdentitySha256,
    issuedAtMs: value.issuedAtMs,
    expiresAtMs: value.expiresAtMs,
    auth: value.auth,
  });
  if (!sameCanonical(value, expected))
    throw new Error(
      'Execution-open manifest does not match its verified bridge'
    );
  return expected;
}

export function verifyDistributedExecutionOpenManifest(value, expectations) {
  return verifyManifest(value, expectations);
}

export function authenticateDistributedExecutionOpenManifest(
  value,
  { nowMs, verifyProof, ...expectations }
) {
  const manifest = verifyManifest(value, expectations);
  return authenticate(manifest, {
    kind: 'Distributed execution-open manifest',
    nowMs,
    eventAtMs: manifest.issuedAtMs,
    signingSha256: distributedExecutionOpenManifestSigningSha256(manifest),
    verifyProof,
  });
}

function deriveExecutionOpenAck({
  manifest,
  manifestExpectations,
  machineIdentitySha256,
  instanceId,
  agentVersion,
  acceptedAtMs,
  auth,
}) {
  const verifiedManifest = verifyManifest(manifest, manifestExpectations);
  const machineIdentity = digest(
    machineIdentitySha256,
    'acknowledging worker machine identity hash'
  );
  if (machineIdentity !== verifiedManifest.workerPolicy.machineIdentitySha256)
    throw new Error('Execution-open acknowledgement machine identity drifted');
  const accepted = integer(acceptedAtMs, 'Execution-open acceptance time');
  if (
    accepted < verifiedManifest.issuedAtMs ||
    accepted > verifiedManifest.expiresAtMs
  )
    throw new Error(
      'Execution-open acknowledgement is outside the manifest window'
    );
  const normalizedAuth = normalizeAuth(auth, {
    principalId: verifiedManifest.workerId,
  });
  if (
    accepted < normalizedAuth.issuedAtMs ||
    accepted > normalizedAuth.expiresAtMs
  )
    throw new Error(
      'Execution-open acknowledgement is outside its authenticated session'
    );
  return seal(
    {
      schema: DISTRIBUTED_EXECUTION_OPEN_ACK_SCHEMA,
      controllerId: verifiedManifest.binding.controllerId,
      workerId: verifiedManifest.workerId,
      machineIdentitySha256: machineIdentity,
      instanceId: identifier(instanceId, 'acknowledging worker instance ID'),
      agentVersion: version(agentVersion, 'acknowledging worker agent version'),
      manifestSha256: verifiedManifest.manifestSha256,
      bridgeSha256: verifiedManifest.bridgeSha256,
      bindingSha256: canonicalJsonSha256(verifiedManifest.binding),
      sourceWorkspaceIdentitySha256:
        verifiedManifest.sourceWorkspaceIdentitySha256,
      adapterSetSha256: canonicalJsonSha256(verifiedManifest.adapters),
      taskSetSha256: canonicalJsonSha256(verifiedManifest.tasks),
      assignmentSetSha256: canonicalJsonSha256(verifiedManifest.assignments),
      status: 'accepted',
      acceptedAtMs: accepted,
      auth: normalizedAuth,
    },
    'ackSha256',
    MAX_DISTRIBUTED_FLEET_MESSAGE_BYTES,
    'Distributed execution-open acknowledgement'
  );
}

export function sealDistributedExecutionOpenAck(value) {
  exactKeys(
    value,
    [
      'acceptedAtMs',
      'agentVersion',
      'auth',
      'instanceId',
      'machineIdentitySha256',
      'manifest',
      'manifestExpectations',
    ],
    'execution-open acknowledgement sources'
  );
  return deriveExecutionOpenAck(value);
}

export function distributedExecutionOpenAckSigningSha256(value) {
  return signingSha256(
    value,
    ACK_KEYS,
    'ackSha256',
    'sealed distributed execution-open acknowledgement'
  );
}

function verifyExecutionOpenAck(value, expectations) {
  exactKeys(
    value,
    ACK_KEYS,
    'sealed distributed execution-open acknowledgement'
  );
  exactKeys(
    expectations,
    [
      'expectedAckSha256',
      'expectedAgentVersion',
      'expectedInstanceId',
      'expectedMachineIdentitySha256',
      'manifest',
      'manifestExpectations',
    ],
    'execution-open acknowledgement expectations'
  );
  if (value.status !== 'accepted')
    throw new Error('Execution-open acknowledgement was not accepted');
  const expectedAckSha256 = digest(
    expectations.expectedAckSha256,
    'expected execution-open acknowledgement hash'
  );
  if (value.ackSha256 !== expectedAckSha256)
    throw new Error(
      'Execution-open acknowledgement does not match its trusted hash'
    );
  const expected = deriveExecutionOpenAck({
    manifest: expectations.manifest,
    manifestExpectations: expectations.manifestExpectations,
    machineIdentitySha256: expectations.expectedMachineIdentitySha256,
    instanceId: expectations.expectedInstanceId,
    agentVersion: expectations.expectedAgentVersion,
    acceptedAtMs: value.acceptedAtMs,
    auth: value.auth,
  });
  if (!sameCanonical(value, expected))
    throw new Error(
      'Execution-open acknowledgement does not match its manifest'
    );
  return expected;
}

export function verifyDistributedExecutionOpenAck(value, expectations) {
  return verifyExecutionOpenAck(value, expectations);
}

export function authenticateDistributedExecutionOpenAck(
  value,
  { nowMs, verifyProof, ...expectations }
) {
  const acknowledgement = verifyExecutionOpenAck(value, expectations);
  return authenticate(acknowledgement, {
    kind: 'Distributed execution-open acknowledgement',
    nowMs,
    eventAtMs: acknowledgement.acceptedAtMs,
    signingSha256: distributedExecutionOpenAckSigningSha256(acknowledgement),
    verifyProof,
  });
}
