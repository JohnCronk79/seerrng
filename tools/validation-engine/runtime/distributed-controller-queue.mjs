// Copyright (c) snapetech and SeerrNG contributors.
// Deterministic, app-isolated submission queue for one distributed controller.
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_CONTROLLER_QUEUE_SCHEMA =
  'seerrng-distributed-controller-queue/v2';
export const DISTRIBUTED_APP_SUBMISSION_SCHEMA =
  'seerrng-distributed-app-submission/v2';
export const DISTRIBUTED_TERMINAL_RECONCILIATION_SCHEMA =
  'seerrng-distributed-terminal-reconciliation/v1';
export const DISTRIBUTED_CLEANUP_PROOF_SCHEMA =
  'seerrng-distributed-cleanup-proof/v1';
export const DISTRIBUTED_APPLICATION_ISOLATION_SCHEMA =
  'seerrng-distributed-application-isolation/v1';
export const MAX_DISTRIBUTED_QUEUE_SUBMISSIONS = 256;

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PROOF = /^[A-Za-z0-9_-]{16,8192}$/;
const FAILURE_POLICIES = new Set(['stop-on-failure', 'continue-on-failure']);
const LIVE_STATUSES = new Set([
  'running',
  'awaiting-cleanup',
  'ready-to-advance',
]);
const FINAL_STATUSES = new Set(['passed', 'failed']);

const SUBMISSION_INPUT_KEYS = [
  'adapters',
  'applicationId',
  'cacheIdentitySha256',
  'controllerId',
  'evidenceIdentitySha256',
  'failureIdentitySha256',
  'inventoryIdentitySha256',
  'planSha256',
  'profileIdentitySha256',
  'repositoryIdentitySha256',
  'resultsIdentitySha256',
  'revisionIdentitySha256',
  'schema',
  'submissionId',
  'taskCatalogIdentitySha256',
  'testSuiteId',
];
const ADAPTER_KEYS = ['adapterId', 'adapterIdentitySha256'];
const SUBMISSION_KEYS = [
  ...SUBMISSION_INPUT_KEYS,
  'submissionSha256',
  'workKeySha256',
];
const OUTPUT_NAMESPACE_KEYS = [
  'cacheIdentitySha256',
  'evidenceIdentitySha256',
  'resultsIdentitySha256',
  'failureIdentitySha256',
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
const TERMINAL_INPUT_KEYS = [
  'applicationIsolationKeySha256',
  'auth',
  'completedAtMs',
  'controllerId',
  'executionId',
  'failureSha256',
  'reconciliationInputSha256',
  'resultSha256',
  'schema',
  'status',
  'submissionId',
  'submissionSha256',
];
const TERMINAL_KEYS = [...TERMINAL_INPUT_KEYS, 'terminalReconciliationSha256'];
const CLEANUP_INPUT_KEYS = [
  'applicationIsolationKeySha256',
  'auth',
  'cleanupInventorySha256',
  'completedAtMs',
  'controllerId',
  'executionId',
  'schema',
  'submissionId',
  'submissionSha256',
  'terminalReconciliationSha256',
];
const CLEANUP_KEYS = [...CLEANUP_INPUT_KEYS, 'cleanupProofSha256'];
const RECORD_KEYS = [
  'applicationIsolationKeySha256',
  'cleanupProof',
  'executionId',
  'finalizedAtMs',
  'runAttempt',
  'sequence',
  'startedAtMs',
  'status',
  'submission',
  'terminalReconciliation',
];
const QUEUE_KEYS = [
  'activeSubmissionId',
  'controllerId',
  'failurePolicy',
  'haltedBySubmissionId',
  'maxSubmissions',
  'nextSequence',
  'queueSha256',
  'revision',
  'schema',
  'submissions',
];
const trustedQueues = new WeakSet();
// Runtime-only lineage is never serialized or restored by rehydration.
const queueTransitionProvenance = new WeakMap();

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

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

function exactObject(value, label, expectedKeys) {
  plainObject(value, label);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const expected = [...expectedKeys].toSorted(compareText);
  const sorted = actual.toSorted(compareText);
  if (
    sorted.length !== expected.length ||
    sorted.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
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

function nullableIdentifier(value, label) {
  return value === null ? null : identifier(value, label);
}

function nullableInteger(value, label) {
  return value === null ? null : integer(value, label);
}

function normalizeAuth(value, controllerId) {
  exactObject(value, 'distributed proof authentication', AUTH_KEYS);
  if (
    !['ed25519', 'hmac-sha256', 'mtls-exporter-sha256'].includes(
      value.algorithm
    )
  )
    throw new Error('Unsupported distributed proof authentication algorithm');
  const auth = {
    algorithm: value.algorithm,
    sessionId: identifier(value.sessionId, 'authentication session ID'),
    principalId: identifier(value.principalId, 'authentication principal ID'),
    keyId: identifier(value.keyId, 'authentication key ID'),
    nonce: identifier(value.nonce, 'authentication nonce'),
    issuedAtMs: integer(value.issuedAtMs, 'Authentication issue time'),
    expiresAtMs: integer(value.expiresAtMs, 'Authentication expiry time'),
    proof: value.proof,
  };
  if (!PROOF.test(auth.proof ?? ''))
    throw new Error('Exact detached authentication proof is required');
  if (auth.principalId !== controllerId)
    throw new Error(
      'Distributed proof must be authenticated by its controller'
    );
  if (auth.expiresAtMs <= auth.issuedAtMs)
    throw new Error('Authentication expiry must follow its issue time');
  return auth;
}

function normalizeSubmissionInput(value) {
  exactObject(value, 'distributed app submission input', SUBMISSION_INPUT_KEYS);
  if (value.schema !== DISTRIBUTED_APP_SUBMISSION_SCHEMA)
    throw new Error('Unsupported distributed app submission schema');
  const submission = {
    schema: DISTRIBUTED_APP_SUBMISSION_SCHEMA,
    controllerId: identifier(value.controllerId, 'submission controller ID'),
    submissionId: identifier(value.submissionId, 'submission ID'),
    applicationId: identifier(value.applicationId, 'application ID'),
    testSuiteId: identifier(value.testSuiteId, 'test suite ID'),
    repositoryIdentitySha256: digest(
      value.repositoryIdentitySha256,
      'repository identity hash'
    ),
    revisionIdentitySha256: digest(
      value.revisionIdentitySha256,
      'revision identity hash'
    ),
    inventoryIdentitySha256: digest(
      value.inventoryIdentitySha256,
      'test inventory identity hash'
    ),
    taskCatalogIdentitySha256: digest(
      value.taskCatalogIdentitySha256,
      'task catalog identity hash'
    ),
    adapters: normalizeSubmissionAdapters(value.adapters),
    profileIdentitySha256: digest(
      value.profileIdentitySha256,
      'profile identity hash'
    ),
    cacheIdentitySha256: digest(
      value.cacheIdentitySha256,
      'cache namespace identity hash'
    ),
    evidenceIdentitySha256: digest(
      value.evidenceIdentitySha256,
      'evidence namespace identity hash'
    ),
    resultsIdentitySha256: digest(
      value.resultsIdentitySha256,
      'results namespace identity hash'
    ),
    failureIdentitySha256: digest(
      value.failureIdentitySha256,
      'failure namespace identity hash'
    ),
    planSha256: digest(value.planSha256, 'execution plan hash'),
  };
  const outputNamespaces = OUTPUT_NAMESPACE_KEYS.map((key) => submission[key]);
  if (new Set(outputNamespaces).size !== outputNamespaces.length)
    throw new Error(
      'Cache, evidence, results, and failure namespaces must be distinct'
    );
  return submission;
}

function normalizeSubmissionAdapters(value) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('Distributed app submission requires at least one adapter');
  const adapters = value.map((entry) => {
    exactObject(entry, 'distributed app submission adapter', ADAPTER_KEYS);
    return {
      adapterId: identifier(entry.adapterId, 'adapter ID'),
      adapterIdentitySha256: digest(
        entry.adapterIdentitySha256,
        'adapter identity hash'
      ),
    };
  });
  if (
    new Set(adapters.map((entry) => entry.adapterId)).size !== adapters.length
  )
    throw new Error('Distributed app submission adapter IDs must be unique');
  if (
    new Set(adapters.map((entry) => entry.adapterIdentitySha256)).size !==
    adapters.length
  )
    throw new Error(
      'Distributed app submission adapter identity hashes must be unique'
    );
  return adapters.toSorted((left, right) =>
    compareText(left.adapterId, right.adapterId)
  );
}

function submissionWorkKey(value) {
  const { submissionId: _submissionId, ...workIdentity } = value;
  return canonicalJsonSha256(workIdentity);
}

function submissionSeal(value) {
  const unsigned = { ...value };
  delete unsigned.submissionSha256;
  return canonicalJsonSha256(unsigned);
}

export function sealDistributedAppSubmission(value) {
  const submission = normalizeSubmissionInput(value);
  const withWorkKey = {
    ...submission,
    workKeySha256: submissionWorkKey(submission),
  };
  return deepFreeze({
    ...withWorkKey,
    submissionSha256: submissionSeal(withWorkKey),
  });
}

export function verifyDistributedAppSubmission(value) {
  exactObject(value, 'distributed app submission', SUBMISSION_KEYS);
  const normalized = sealDistributedAppSubmission(
    Object.fromEntries(SUBMISSION_INPUT_KEYS.map((key) => [key, value[key]]))
  );
  if (value.workKeySha256 !== normalized.workKeySha256)
    throw new Error('Distributed app submission work identity does not match');
  if (value.submissionSha256 !== normalized.submissionSha256)
    throw new Error(
      'Distributed app submission seal does not match its contents'
    );
  return normalized;
}

export function distributedApplicationIsolationKeySha256(submissionValue) {
  const submission = verifyDistributedAppSubmission(submissionValue);
  return canonicalJsonSha256({
    schema: DISTRIBUTED_APPLICATION_ISOLATION_SCHEMA,
    controllerId: submission.controllerId,
    submissionId: submission.submissionId,
    submissionSha256: submission.submissionSha256,
    workKeySha256: submission.workKeySha256,
  });
}

function normalizeTerminalInput(value) {
  exactObject(
    value,
    'distributed terminal reconciliation input',
    TERMINAL_INPUT_KEYS
  );
  if (value.schema !== DISTRIBUTED_TERMINAL_RECONCILIATION_SCHEMA)
    throw new Error('Unsupported distributed terminal reconciliation schema');
  if (!['passed', 'failed'].includes(value.status))
    throw new Error('Terminal reconciliation status must be passed or failed');
  const controllerId = identifier(
    value.controllerId,
    'terminal reconciliation controller ID'
  );
  const reconciliation = {
    schema: DISTRIBUTED_TERMINAL_RECONCILIATION_SCHEMA,
    controllerId,
    submissionId: identifier(value.submissionId, 'submission ID'),
    submissionSha256: digest(value.submissionSha256, 'submission hash'),
    applicationIsolationKeySha256: digest(
      value.applicationIsolationKeySha256,
      'application isolation key hash'
    ),
    executionId: identifier(value.executionId, 'execution ID'),
    reconciliationInputSha256: digest(
      value.reconciliationInputSha256,
      'terminal reconciliation input hash'
    ),
    status: value.status,
    resultSha256: digest(value.resultSha256, 'terminal result hash'),
    failureSha256:
      value.failureSha256 === null
        ? null
        : digest(value.failureSha256, 'terminal failure hash'),
    completedAtMs: integer(value.completedAtMs, 'Terminal completion time'),
    auth: normalizeAuth(value.auth, controllerId),
  };
  if (
    reconciliation.completedAtMs < reconciliation.auth.issuedAtMs ||
    reconciliation.completedAtMs > reconciliation.auth.expiresAtMs
  )
    throw new Error(
      'Terminal reconciliation is outside its authenticated session'
    );
  if (
    (reconciliation.status === 'passed' &&
      reconciliation.failureSha256 !== null) ||
    (reconciliation.status === 'failed' &&
      reconciliation.failureSha256 === null)
  )
    throw new Error('Terminal failure identity does not match terminal status');
  return reconciliation;
}

function terminalSeal(value) {
  const unsigned = { ...value };
  delete unsigned.terminalReconciliationSha256;
  return canonicalJsonSha256(unsigned);
}

export function distributedTerminalReconciliationSigningSha256(value) {
  const reconciliation = normalizeTerminalInput(value);
  return canonicalJsonSha256({
    ...reconciliation,
    auth: { ...reconciliation.auth, proof: null },
  });
}

export function sealDistributedTerminalReconciliation(value) {
  const reconciliation = normalizeTerminalInput(value);
  return deepFreeze({
    ...reconciliation,
    terminalReconciliationSha256: terminalSeal(reconciliation),
  });
}

function verifyTerminalReconciliation(value, verifyAuthentication) {
  exactObject(value, 'distributed terminal reconciliation', TERMINAL_KEYS);
  const reconciliation = sealDistributedTerminalReconciliation(
    Object.fromEntries(TERMINAL_INPUT_KEYS.map((key) => [key, value[key]]))
  );
  if (
    value.terminalReconciliationSha256 !==
    reconciliation.terminalReconciliationSha256
  )
    throw new Error('Terminal reconciliation seal does not match its contents');
  authenticateProof(reconciliation, verifyAuthentication, {
    sealKey: 'terminalReconciliationSha256',
    signingSha256: distributedTerminalReconciliationSigningSha256(
      Object.fromEntries(TERMINAL_INPUT_KEYS.map((key) => [key, value[key]]))
    ),
  });
  return reconciliation;
}

function normalizeCleanupInput(value) {
  exactObject(value, 'distributed cleanup proof input', CLEANUP_INPUT_KEYS);
  if (value.schema !== DISTRIBUTED_CLEANUP_PROOF_SCHEMA)
    throw new Error('Unsupported distributed cleanup proof schema');
  const controllerId = identifier(value.controllerId, 'cleanup controller ID');
  const proof = {
    schema: DISTRIBUTED_CLEANUP_PROOF_SCHEMA,
    controllerId,
    submissionId: identifier(value.submissionId, 'submission ID'),
    submissionSha256: digest(value.submissionSha256, 'submission hash'),
    applicationIsolationKeySha256: digest(
      value.applicationIsolationKeySha256,
      'application isolation key hash'
    ),
    executionId: identifier(value.executionId, 'execution ID'),
    terminalReconciliationSha256: digest(
      value.terminalReconciliationSha256,
      'terminal reconciliation hash'
    ),
    cleanupInventorySha256: digest(
      value.cleanupInventorySha256,
      'cleanup inventory hash'
    ),
    completedAtMs: integer(value.completedAtMs, 'Cleanup completion time'),
    auth: normalizeAuth(value.auth, controllerId),
  };
  if (
    proof.completedAtMs < proof.auth.issuedAtMs ||
    proof.completedAtMs > proof.auth.expiresAtMs
  )
    throw new Error('Cleanup proof is outside its authenticated session');
  return proof;
}

function cleanupSeal(value) {
  const unsigned = { ...value };
  delete unsigned.cleanupProofSha256;
  return canonicalJsonSha256(unsigned);
}

export function distributedCleanupProofSigningSha256(value) {
  const proof = normalizeCleanupInput(value);
  return canonicalJsonSha256({
    ...proof,
    auth: { ...proof.auth, proof: null },
  });
}

export function sealDistributedCleanupProof(value) {
  const proof = normalizeCleanupInput(value);
  return deepFreeze({ ...proof, cleanupProofSha256: cleanupSeal(proof) });
}

function verifyCleanupProof(value, verifyAuthentication) {
  exactObject(value, 'distributed cleanup proof', CLEANUP_KEYS);
  const proof = sealDistributedCleanupProof(
    Object.fromEntries(CLEANUP_INPUT_KEYS.map((key) => [key, value[key]]))
  );
  if (value.cleanupProofSha256 !== proof.cleanupProofSha256)
    throw new Error('Cleanup proof seal does not match its contents');
  authenticateProof(proof, verifyAuthentication, {
    sealKey: 'cleanupProofSha256',
    signingSha256: distributedCleanupProofSigningSha256(
      Object.fromEntries(CLEANUP_INPUT_KEYS.map((key) => [key, value[key]]))
    ),
  });
  return proof;
}

function authenticateProof(
  payload,
  verifyAuthentication,
  { sealKey, signingSha256 }
) {
  if (typeof verifyAuthentication !== 'function')
    throw new Error(
      'Distributed proof requires an external authentication verifier'
    );
  const verified = verifyAuthentication({
    auth: payload.auth,
    signingSha256,
    payload,
    payloadSha256: payload[sealKey],
  });
  if (verified && typeof verified.then === 'function')
    throw new Error('Distributed authentication verifier must be synchronous');
  if (verified !== true)
    throw new Error('Distributed authentication proof was rejected');
}

function queueHash(value) {
  const unsigned = { ...value };
  delete unsigned.queueSha256;
  return canonicalJsonSha256(unsigned);
}

function sealQueue(value) {
  const state = {
    schema: DISTRIBUTED_CONTROLLER_QUEUE_SCHEMA,
    controllerId: value.controllerId,
    failurePolicy: value.failurePolicy,
    maxSubmissions: value.maxSubmissions,
    revision: value.revision,
    nextSequence: value.nextSequence,
    activeSubmissionId: value.activeSubmissionId,
    haltedBySubmissionId: value.haltedBySubmissionId,
    submissions: [...value.submissions].toSorted(
      (left, right) => left.sequence - right.sequence
    ),
  };
  const sealed = deepFreeze({ ...state, queueSha256: queueHash(state) });
  trustedQueues.add(sealed);
  return sealed;
}

function queueTransitionDescription(kind, inputSha256, occurredAtMs) {
  return deepFreeze({ kind, inputSha256, occurredAtMs });
}

function sealQueueTransition(previousQueue, transition, value) {
  const sealed = sealQueue(value);
  if (sealed.revision !== previousQueue.revision + 1)
    throw new Error('Queue transition must advance exactly one revision');
  queueTransitionProvenance.set(
    sealed,
    Object.freeze({
      kind: 'transition',
      previousQueueSha256: previousQueue.queueSha256,
      previousRevision: previousQueue.revision,
      transition,
    })
  );
  return sealed;
}

function exactNullable(value, label, normalizer) {
  return value === null ? null : normalizer(value, label);
}

function validateRecord(value, controllerId, verifyAuthentication) {
  exactObject(value, 'distributed queue submission record', RECORD_KEYS);
  const submission = verifyDistributedAppSubmission(value.submission);
  if (submission.controllerId !== controllerId)
    throw new Error('Queue record belongs to a different controller');
  const isolationKey = distributedApplicationIsolationKeySha256(submission);
  if (value.applicationIsolationKeySha256 !== isolationKey)
    throw new Error('Queue record crossed an application isolation boundary');
  const status = value.status;
  if (!['queued', ...LIVE_STATUSES, ...FINAL_STATUSES].includes(status))
    throw new Error('Unsupported distributed queue submission status');
  const record = {
    sequence: integer(value.sequence, 'Submission sequence', { minimum: 1 }),
    submission,
    applicationIsolationKeySha256: isolationKey,
    status,
    executionId: nullableIdentifier(value.executionId, 'execution ID'),
    runAttempt: nullableInteger(value.runAttempt, 'Run attempt'),
    startedAtMs: nullableInteger(value.startedAtMs, 'Execution start time'),
    terminalReconciliation: exactNullable(
      value.terminalReconciliation,
      'terminal reconciliation',
      (entry) => verifyTerminalReconciliation(entry, verifyAuthentication)
    ),
    cleanupProof: exactNullable(value.cleanupProof, 'cleanup proof', (entry) =>
      verifyCleanupProof(entry, verifyAuthentication)
    ),
    finalizedAtMs: nullableInteger(value.finalizedAtMs, 'Finalization time'),
  };
  const { terminalReconciliation: terminal, cleanupProof: cleanup } = record;
  if (status === 'queued') {
    if (
      record.executionId !== null ||
      record.runAttempt !== null ||
      record.startedAtMs !== null ||
      terminal !== null ||
      cleanup !== null ||
      record.finalizedAtMs !== null
    )
      throw new Error('Queued submission contains execution state');
    return record;
  }
  if (
    record.executionId === null ||
    record.runAttempt !== 1 ||
    record.startedAtMs === null
  )
    throw new Error(
      'Started submission requires an execution identity, first run attempt, and time'
    );
  if (status === 'running') {
    if (terminal !== null || cleanup !== null || record.finalizedAtMs !== null)
      throw new Error('Running submission contains terminal state');
    return record;
  }
  if (terminal === null)
    throw new Error(
      'Terminal submission state requires reconciliation evidence'
    );
  if (
    terminal.controllerId !== controllerId ||
    terminal.submissionId !== submission.submissionId ||
    terminal.submissionSha256 !== submission.submissionSha256 ||
    terminal.applicationIsolationKeySha256 !== isolationKey ||
    terminal.executionId !== record.executionId ||
    terminal.completedAtMs < record.startedAtMs
  )
    throw new Error('Terminal reconciliation is not bound to its queue record');
  if (status === 'awaiting-cleanup') {
    if (cleanup !== null || record.finalizedAtMs !== null)
      throw new Error('Cleanup-pending submission contains final state');
    return record;
  }
  if (cleanup === null) throw new Error('Advancement requires cleanup proof');
  if (
    cleanup.controllerId !== controllerId ||
    cleanup.submissionId !== submission.submissionId ||
    cleanup.submissionSha256 !== submission.submissionSha256 ||
    cleanup.applicationIsolationKeySha256 !== isolationKey ||
    cleanup.executionId !== record.executionId ||
    cleanup.terminalReconciliationSha256 !==
      terminal.terminalReconciliationSha256 ||
    cleanup.completedAtMs < terminal.completedAtMs
  )
    throw new Error(
      'Cleanup proof is not bound to its terminal reconciliation'
    );
  if (status === 'ready-to-advance') {
    if (record.finalizedAtMs !== null)
      throw new Error('Ready submission cannot already be finalized');
    return record;
  }
  if (
    record.finalizedAtMs === null ||
    record.finalizedAtMs < cleanup.completedAtMs ||
    status !== terminal.status
  )
    throw new Error('Final submission state is inconsistent with its proofs');
  return record;
}

function validateQueue(
  value,
  { expectedControllerId, expectedQueueSha256, verifyAuthentication }
) {
  exactObject(value, 'persisted distributed controller queue', QUEUE_KEYS);
  if (value.schema !== DISTRIBUTED_CONTROLLER_QUEUE_SCHEMA)
    throw new Error('Unsupported distributed controller queue schema');
  const controllerId = identifier(value.controllerId, 'queue controller ID');
  if (
    controllerId !== identifier(expectedControllerId, 'expected controller ID')
  )
    throw new Error('Persisted queue belongs to a different controller');
  digest(expectedQueueSha256, 'expected queue hash');
  digest(value.queueSha256, 'persisted queue hash');
  if (value.queueSha256 !== expectedQueueSha256)
    throw new Error('Persisted queue does not match its trusted hash');
  if (value.queueSha256 !== queueHash(value))
    throw new Error(
      'Distributed controller queue seal does not match its contents'
    );
  if (!FAILURE_POLICIES.has(value.failurePolicy))
    throw new Error('Unsupported distributed queue failure policy');
  const maxSubmissions = integer(
    value.maxSubmissions,
    'Queue submission limit',
    {
      minimum: 1,
      maximum: MAX_DISTRIBUTED_QUEUE_SUBMISSIONS,
    }
  );
  if (!Array.isArray(value.submissions))
    throw new Error('Distributed controller submissions must be an array');
  if (value.submissions.length > maxSubmissions)
    throw new Error(
      'Distributed controller queue exceeds its configured bound'
    );
  const submissions = value.submissions.map((entry) =>
    validateRecord(entry, controllerId, verifyAuthentication)
  );
  submissions.forEach((entry, index) => {
    if (entry.sequence !== index + 1)
      throw new Error(
        'Queue submission sequence must be contiguous and ordered'
      );
  });
  for (const [label, values] of [
    [
      'submission ID',
      submissions.map((entry) => entry.submission.submissionId),
    ],
    [
      'submission seal',
      submissions.map((entry) => entry.submission.submissionSha256),
    ],
    [
      'work identity',
      submissions.map((entry) => entry.submission.workKeySha256),
    ],
  ])
    if (new Set(values).size !== values.length)
      throw new Error(`Distributed queue contains a duplicate ${label}`);
  const executionIds = submissions
    .map((entry) => entry.executionId)
    .filter((entry) => entry !== null);
  if (new Set(executionIds).size !== executionIds.length)
    throw new Error('Distributed queue contains a duplicate execution ID');
  const activeSubmissionId = nullableIdentifier(
    value.activeSubmissionId,
    'active submission ID'
  );
  const live = submissions.filter((entry) => LIVE_STATUSES.has(entry.status));
  if (
    live.length > 1 ||
    (live.length === 0 && activeSubmissionId !== null) ||
    (live.length === 1 &&
      activeSubmissionId !== live[0].submission.submissionId)
  )
    throw new Error('Distributed queue may contain exactly one active app');
  const haltedBySubmissionId = nullableIdentifier(
    value.haltedBySubmissionId,
    'halting submission ID'
  );
  if (haltedBySubmissionId !== null) {
    const failure = submissions.find(
      (entry) => entry.submission.submissionId === haltedBySubmissionId
    );
    if (
      value.failurePolicy !== 'stop-on-failure' ||
      !failure ||
      failure.status !== 'failed' ||
      activeSubmissionId !== null
    )
      throw new Error('Queue halt state is not bound to a retained failure');
  }
  const nextSequence = integer(value.nextSequence, 'Next submission sequence', {
    minimum: 1,
  });
  if (nextSequence !== submissions.length + 1)
    throw new Error('Next submission sequence does not match queue history');
  return {
    schema: DISTRIBUTED_CONTROLLER_QUEUE_SCHEMA,
    controllerId,
    failurePolicy: value.failurePolicy,
    maxSubmissions,
    revision: integer(value.revision, 'Queue revision'),
    nextSequence,
    activeSubmissionId,
    haltedBySubmissionId,
    submissions,
  };
}

function assertTrustedQueue(value) {
  if (!trustedQueues.has(value))
    throw new Error(
      'Distributed controller queue is not trusted runtime state'
    );
  if (value.queueSha256 !== queueHash(value))
    throw new Error('Distributed controller queue changed after verification');
  return value;
}

export function verifyDistributedControllerQueueTransition(
  previousQueueValue,
  candidateQueueValue
) {
  const candidate = assertTrustedQueue(candidateQueueValue);
  const provenance = queueTransitionProvenance.get(candidate);
  if (!provenance)
    throw new Error(
      'Distributed controller queue lacks runtime transition provenance'
    );

  if (previousQueueValue === null) {
    if (
      provenance.kind !== 'genesis' ||
      candidate.revision !== 0 ||
      candidate.nextSequence !== 1 ||
      candidate.activeSubmissionId !== null ||
      candidate.haltedBySubmissionId !== null ||
      candidate.submissions.length !== 0
    )
      throw new Error(
        'Distributed controller queue genesis is not an exact initial queue'
      );
    return candidate;
  }

  if (provenance.kind !== 'transition')
    throw new Error(
      'Distributed controller queue genesis cannot follow persisted state'
    );
  const previous = assertTrustedQueue(previousQueueValue);
  if (previous.controllerId !== candidate.controllerId)
    throw new Error('Queue transition crossed a controller boundary');
  if (provenance.previousQueueSha256 !== previous.queueSha256)
    throw new Error('Queue transition does not match its exact previous queue');
  if (
    provenance.previousRevision !== previous.revision ||
    candidate.revision !== previous.revision + 1
  )
    throw new Error('Queue transition must advance exactly one revision');
  return candidate;
}

export function describeDistributedControllerQueueTransition(
  previousQueueValue,
  candidateQueueValue
) {
  const candidate = verifyDistributedControllerQueueTransition(
    previousQueueValue,
    candidateQueueValue
  );
  return queueTransitionProvenance.get(candidate).transition;
}

function replaceRecord(queue, submissionId, transform) {
  let found = false;
  const submissions = queue.submissions.map((entry) => {
    if (entry.submission.submissionId !== submissionId) return entry;
    found = true;
    return transform(entry);
  });
  if (!found) throw new Error('Active submission is missing from queue state');
  return submissions;
}

export function createDistributedControllerQueue({
  controllerId,
  failurePolicy = 'stop-on-failure',
  maxSubmissions = 64,
}) {
  if (!FAILURE_POLICIES.has(failurePolicy))
    throw new Error('Unsupported distributed queue failure policy');
  const creationInput = {
    controllerId: identifier(controllerId, 'controller ID'),
    failurePolicy,
    maxSubmissions: integer(maxSubmissions, 'Queue submission limit', {
      minimum: 1,
      maximum: MAX_DISTRIBUTED_QUEUE_SUBMISSIONS,
    }),
  };
  const queue = sealQueue({
    ...creationInput,
    revision: 0,
    nextSequence: 1,
    activeSubmissionId: null,
    haltedBySubmissionId: null,
    submissions: [],
  });
  queueTransitionProvenance.set(
    queue,
    Object.freeze({
      kind: 'genesis',
      transition: queueTransitionDescription(
        'genesis',
        canonicalJsonSha256(creationInput),
        null
      ),
    })
  );
  return queue;
}

export function enqueueDistributedApp(queueValue, submissionValue) {
  const queue = assertTrustedQueue(queueValue);
  const submission = verifyDistributedAppSubmission(submissionValue);
  if (queue.haltedBySubmissionId !== null)
    throw new Error('Stopped queue cannot accept another app submission');
  if (submission.controllerId !== queue.controllerId)
    throw new Error('App submission belongs to a different controller');
  if (queue.submissions.length >= queue.maxSubmissions)
    throw new Error('Distributed controller queue is full');
  if (
    queue.submissions.some(
      (entry) =>
        entry.submission.submissionId === submission.submissionId ||
        entry.submission.submissionSha256 === submission.submissionSha256 ||
        entry.submission.workKeySha256 === submission.workKeySha256
    )
  )
    throw new Error('Duplicate distributed app submission is not allowed');
  const retainedOutputNamespaces = new Set(
    queue.submissions.flatMap((entry) =>
      OUTPUT_NAMESPACE_KEYS.map((key) => entry.submission[key])
    )
  );
  if (
    OUTPUT_NAMESPACE_KEYS.some((key) =>
      retainedOutputNamespaces.has(submission[key])
    )
  )
    throw new Error(
      'Distributed app output namespace is already retained by another submission'
    );
  const record = {
    sequence: queue.nextSequence,
    submission,
    applicationIsolationKeySha256:
      distributedApplicationIsolationKeySha256(submission),
    status: 'queued',
    executionId: null,
    runAttempt: null,
    startedAtMs: null,
    terminalReconciliation: null,
    cleanupProof: null,
    finalizedAtMs: null,
  };
  const transition = queueTransitionDescription(
    'enqueue',
    submission.submissionSha256,
    null
  );
  return sealQueueTransition(queue, transition, {
    ...queue,
    revision: queue.revision + 1,
    nextSequence: queue.nextSequence + 1,
    submissions: [...queue.submissions, record],
  });
}

export function startNextDistributedApp(
  queueValue,
  { executionId, startedAtMs }
) {
  const queue = assertTrustedQueue(queueValue);
  if (queue.haltedBySubmissionId !== null)
    throw new Error('Queue is stopped by a retained failed app result');
  if (queue.activeSubmissionId !== null)
    throw new Error('Another app is already active; interleaving is forbidden');
  const next = queue.submissions.find((entry) => entry.status === 'queued');
  if (!next) throw new Error('Distributed controller queue has no pending app');
  const normalizedExecutionId = identifier(executionId, 'execution ID');
  if (
    queue.submissions.some(
      (entry) => entry.executionId === normalizedExecutionId
    )
  )
    throw new Error('Execution ID was already used by this queue');
  const normalizedStartedAtMs = integer(startedAtMs, 'Execution start time');
  const transition = queueTransitionDescription(
    'start',
    canonicalJsonSha256({
      executionId: normalizedExecutionId,
      startedAtMs: normalizedStartedAtMs,
    }),
    normalizedStartedAtMs
  );
  return sealQueueTransition(queue, transition, {
    ...queue,
    revision: queue.revision + 1,
    activeSubmissionId: next.submission.submissionId,
    submissions: replaceRecord(
      queue,
      next.submission.submissionId,
      (entry) => ({
        ...entry,
        status: 'running',
        executionId: normalizedExecutionId,
        runAttempt: 1,
        startedAtMs: normalizedStartedAtMs,
      })
    ),
  });
}

export function recordDistributedTerminalReconciliation(
  queueValue,
  reconciliationValue,
  { verifyAuthentication }
) {
  const queue = assertTrustedQueue(queueValue);
  if (queue.activeSubmissionId === null)
    throw new Error('Terminal reconciliation requires an active app');
  const active = queue.submissions.find(
    (entry) => entry.submission.submissionId === queue.activeSubmissionId
  );
  if (active.status !== 'running')
    throw new Error('Terminal reconciliation was already recorded');
  const reconciliation = verifyTerminalReconciliation(
    reconciliationValue,
    verifyAuthentication
  );
  if (
    reconciliation.controllerId !== queue.controllerId ||
    reconciliation.submissionId !== active.submission.submissionId ||
    reconciliation.submissionSha256 !== active.submission.submissionSha256 ||
    reconciliation.applicationIsolationKeySha256 !==
      active.applicationIsolationKeySha256 ||
    reconciliation.executionId !== active.executionId ||
    reconciliation.completedAtMs < active.startedAtMs
  )
    throw new Error('Terminal reconciliation is not bound to the active app');
  const transition = queueTransitionDescription(
    'terminal-reconciliation',
    reconciliation.terminalReconciliationSha256,
    reconciliation.completedAtMs
  );
  return sealQueueTransition(queue, transition, {
    ...queue,
    revision: queue.revision + 1,
    submissions: replaceRecord(queue, queue.activeSubmissionId, (entry) => ({
      ...entry,
      status: 'awaiting-cleanup',
      terminalReconciliation: reconciliation,
    })),
  });
}

export function recordDistributedCleanupProof(
  queueValue,
  cleanupValue,
  { verifyAuthentication }
) {
  const queue = assertTrustedQueue(queueValue);
  if (queue.activeSubmissionId === null)
    throw new Error('Cleanup proof requires an active app');
  const active = queue.submissions.find(
    (entry) => entry.submission.submissionId === queue.activeSubmissionId
  );
  if (active.status !== 'awaiting-cleanup')
    throw new Error('Cleanup proof requires terminal reconciliation first');
  const proof = verifyCleanupProof(cleanupValue, verifyAuthentication);
  if (
    proof.controllerId !== queue.controllerId ||
    proof.submissionId !== active.submission.submissionId ||
    proof.submissionSha256 !== active.submission.submissionSha256 ||
    proof.applicationIsolationKeySha256 !==
      active.applicationIsolationKeySha256 ||
    proof.executionId !== active.executionId ||
    proof.terminalReconciliationSha256 !==
      active.terminalReconciliation.terminalReconciliationSha256 ||
    proof.completedAtMs < active.terminalReconciliation.completedAtMs
  )
    throw new Error('Cleanup proof is not bound to the active terminal result');
  const transition = queueTransitionDescription(
    'cleanup-proof',
    proof.cleanupProofSha256,
    proof.completedAtMs
  );
  return sealQueueTransition(queue, transition, {
    ...queue,
    revision: queue.revision + 1,
    submissions: replaceRecord(queue, queue.activeSubmissionId, (entry) => ({
      ...entry,
      status: 'ready-to-advance',
      cleanupProof: proof,
    })),
  });
}

export function advanceDistributedControllerQueue(
  queueValue,
  { finalizedAtMs }
) {
  const queue = assertTrustedQueue(queueValue);
  if (queue.activeSubmissionId === null)
    throw new Error('Queue advancement requires an active app');
  const active = queue.submissions.find(
    (entry) => entry.submission.submissionId === queue.activeSubmissionId
  );
  if (active.status !== 'ready-to-advance')
    throw new Error(
      'Queue cannot advance before terminal reconciliation and cleanup proof'
    );
  const normalizedFinalizedAtMs = integer(finalizedAtMs, 'Finalization time');
  if (normalizedFinalizedAtMs < active.cleanupProof.completedAtMs)
    throw new Error('Finalization cannot precede cleanup completion');
  const terminalStatus = active.terminalReconciliation.status;
  const haltedBySubmissionId =
    terminalStatus === 'failed' && queue.failurePolicy === 'stop-on-failure'
      ? active.submission.submissionId
      : null;
  const transition = queueTransitionDescription(
    'advance',
    canonicalJsonSha256({ finalizedAtMs: normalizedFinalizedAtMs }),
    normalizedFinalizedAtMs
  );
  return sealQueueTransition(queue, transition, {
    ...queue,
    revision: queue.revision + 1,
    activeSubmissionId: null,
    haltedBySubmissionId,
    submissions: replaceRecord(queue, queue.activeSubmissionId, (entry) => ({
      ...entry,
      status: terminalStatus,
      finalizedAtMs: normalizedFinalizedAtMs,
    })),
  });
}

// This returns an inert, sealed in-memory value for a future persistence layer.
// It deliberately performs no filesystem or transport I/O.
export function snapshotDistributedControllerQueue(queueValue) {
  return deepFreeze(structuredClone(assertTrustedQueue(queueValue)));
}

export function rehydrateDistributedControllerQueue(
  value,
  { expectedControllerId, expectedQueueSha256, verifyAuthentication }
) {
  const normalized = validateQueue(value, {
    expectedControllerId,
    expectedQueueSha256,
    verifyAuthentication,
  });
  const restored = sealQueue(normalized);
  if (restored.queueSha256 !== expectedQueueSha256)
    throw new Error('Rehydrated queue differs from its trusted snapshot');
  return restored;
}
