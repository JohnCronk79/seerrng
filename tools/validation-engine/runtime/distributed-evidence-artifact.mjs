// Copyright (c) snapetech and SeerrNG contributors.
// Transport-neutral controller contract for persisted distributed evidence.
import {
  BROKER_CLEANUP_EVIDENCE_NAMESPACE_KIND,
  MAX_EVIDENCE_BLOB_BYTES,
  assertAuthenticatedBrokerMessage,
  brokerApplicationIsolationKeySha256,
  normalizeEvidenceSchemaToken,
  verifyBrokerBinding,
} from './broker-protocol.mjs';
import { assertTrustedDistributedExecutionBridge } from './distributed-execution-bridge.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_EVIDENCE_MANIFEST_SCHEMA =
  'seerrng-distributed-evidence-manifest/v1';
export const DISTRIBUTED_EVIDENCE_ARTIFACT_SCHEMA =
  'seerrng-distributed-evidence-artifact/v1';
export const DISTRIBUTED_EVIDENCE_STORAGE_IDENTITY_SCHEMA =
  'seerrng-distributed-evidence-storage-identity/v1';
export const DISTRIBUTED_EVIDENCE_VERIFICATION_RECEIPT_SCHEMA =
  'seerrng-distributed-evidence-verification-receipt/v1';
export const MAX_DISTRIBUTED_EVIDENCE_ARTIFACTS = 256;
// Blob bytes live outside this metadata-only contract. These bounds admit
// native browser video/log evidence while keeping one execution finite.
export const MAX_DISTRIBUTED_EVIDENCE_ARTIFACT_BYTES = MAX_EVIDENCE_BLOB_BYTES;
export const MAX_DISTRIBUTED_EVIDENCE_TOTAL_BYTES = 32 * 1024 * 1024 * 1024;
export const MAX_DISTRIBUTED_EVIDENCE_PATH_BYTES = 1_024;
export const MAX_DISTRIBUTED_EVIDENCE_PATH_SEGMENTS = 4;
export const MAX_DISTRIBUTED_EVIDENCE_MANIFEST_BYTES = 1024 * 1024;

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const NAMESPACE_FIELD_BY_KIND = Object.freeze({
  evidence: 'evidenceIdentitySha256',
  failure: 'failureIdentitySha256',
  results: 'resultsIdentitySha256',
});
const OUTPUT_NAMESPACE_KEYS = [
  'cacheIdentitySha256',
  'evidenceIdentitySha256',
  'failureIdentitySha256',
  'resultsIdentitySha256',
];
const MANIFEST_INPUT_KEYS = [
  'artifacts',
  'attempt',
  'binding',
  'bridgeSha256',
  'brokerApplicationIsolationKeySha256',
  'executionId',
  'instanceId',
  'leaseId',
  'outputNamespaces',
  'queueApplicationIsolationKeySha256',
  'schema',
  'sourceCompletedAtMs',
  'sourceMessageSha256',
  'sourceMessageSentAtMs',
  'sourceSubmissionSha256',
  'taskId',
  'taskSha256',
  'workerId',
  'workerSessionId',
];
const MANIFEST_KEYS = [
  ...MANIFEST_INPUT_KEYS,
  'bindingSha256',
  'manifestSha256',
  'totalBytes',
];
const ARTIFACT_INPUT_KEYS = [
  'blobSha256',
  'bytes',
  'evidenceId',
  'evidenceSchema',
  'mediaType',
  'namespaceKind',
  'relativePath',
];
const ARTIFACT_KEYS = [
  ...ARTIFACT_INPUT_KEYS,
  'artifactSha256',
  'namespaceIdentitySha256',
  'schema',
  'storageIdentitySha256',
];
const EXPECTATION_KEYS = [
  'expectedArtifacts',
  'expectedAttempt',
  'expectedBinding',
  'expectedBridgeSha256',
  'expectedBrokerApplicationIsolationKeySha256',
  'expectedInstanceId',
  'expectedLeaseId',
  'expectedManifestSha256',
  'expectedOutputNamespaces',
  'expectedQueueApplicationIsolationKeySha256',
  'expectedSourceCompletedAtMs',
  'expectedSourceMessageSha256',
  'expectedSourceMessageSentAtMs',
  'expectedSourceSubmissionSha256',
  'expectedTaskId',
  'expectedTaskSha256',
  'expectedWorkerId',
  'expectedWorkerSessionId',
];
const EXPECTED_ARTIFACT_KEYS = [
  'evidenceId',
  'mediaType',
  'namespaceKind',
  'required',
  'schema',
];
const AUTHENTICATED_CLEANUP_MANIFEST_VERIFICATION_KEYS = [
  'cancelledMessage',
  'executionBridge',
  'manifest',
];
const RECEIPT_CREATE_KEYS = [
  'manifest',
  'manifestExpectations',
  'verificationPolicySha256',
  'verifiedAtMs',
  'verifierId',
  'verifierIdentitySha256',
  'verifyArtifact',
];
const RECEIPT_KEYS = [
  'artifactCount',
  'artifacts',
  'bindingSha256',
  'bridgeSha256',
  'brokerApplicationIsolationKeySha256',
  'executionId',
  'manifestSha256',
  'queueApplicationIsolationKeySha256',
  'receiptSha256',
  'schema',
  'sourceCompletedAtMs',
  'sourceMessageSha256',
  'sourceMessageSentAtMs',
  'sourceSubmissionSha256',
  'totalBytes',
  'verificationPolicySha256',
  'verifiedAtMs',
  'verifierId',
  'verifierIdentitySha256',
];
const RECEIPT_ARTIFACT_KEYS = [
  'artifactSha256',
  'blobSha256',
  'bytes',
  'evidenceId',
  'namespaceIdentitySha256',
  'namespaceKind',
  'storageIdentitySha256',
];
const RECEIPT_EXPECTATION_KEYS = [
  'expectedReceiptSha256',
  'expectedVerificationPolicySha256',
  'expectedVerifierId',
  'expectedVerifierIdentitySha256',
  'manifest',
  'manifestExpectations',
];

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

function exactKeys(value, expectedKeys, label) {
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
  { maximum = Number.MAX_SAFE_INTEGER, minimum = 0 } = {}
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${label} must be a safe integer from ${minimum} through ${maximum}`
    );
  return value;
}

function mediaType(value, label) {
  if (typeof value !== 'string' || !MEDIA_TYPE.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function namespaceKind(value) {
  if (!Object.hasOwn(NAMESPACE_FIELD_BY_KIND, value))
    throw new Error('Unsupported distributed evidence namespace kind');
  return value;
}

function normalizeOutputNamespaces(value) {
  exactKeys(value, OUTPUT_NAMESPACE_KEYS, 'distributed output namespaces');
  const namespaces = Object.fromEntries(
    OUTPUT_NAMESPACE_KEYS.map((key) => [key, digest(value[key], key)])
  );
  if (new Set(Object.values(namespaces)).size !== OUTPUT_NAMESPACE_KEYS.length)
    throw new Error('Distributed output namespaces must be distinct');
  return namespaces;
}

function normalizeRelativePath(value, kind, namespaceIdentity, blobSha256) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.normalize('NFC') !== value ||
    Buffer.byteLength(value, 'utf8') > MAX_DISTRIBUTED_EVIDENCE_PATH_BYTES ||
    // eslint-disable-next-line no-control-regex -- Paths cross operating systems.
    /[\x00-\x1f\x7f]/.test(value) ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes(':')
  )
    throw new Error('Evidence path must be a canonical safe relative path');
  const segments = value.split('/');
  if (
    segments.length !== MAX_DISTRIBUTED_EVIDENCE_PATH_SEGMENTS ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        segment.endsWith('.') ||
        segment.endsWith(' ') ||
        !PATH_SEGMENT.test(segment) ||
        WINDOWS_DEVICE.test(segment)
    )
  )
    throw new Error('Evidence path must be a canonical safe relative path');
  const canonical = `${kind}/${namespaceIdentity}/${blobSha256.slice(0, 2)}/${blobSha256}`;
  if (value !== canonical)
    throw new Error(
      'Evidence path must use its exact content-addressed namespace path'
    );
  return canonical;
}

function manifestContext(value) {
  return {
    bridgeSha256: value.bridgeSha256,
    bindingSha256: value.bindingSha256,
    executionId: value.executionId,
    queueApplicationIsolationKeySha256:
      value.queueApplicationIsolationKeySha256,
    brokerApplicationIsolationKeySha256:
      value.brokerApplicationIsolationKeySha256,
    workerId: value.workerId,
    instanceId: value.instanceId,
    workerSessionId: value.workerSessionId,
    taskId: value.taskId,
    taskSha256: value.taskSha256,
    leaseId: value.leaseId,
    attempt: value.attempt,
    sourceCompletedAtMs: value.sourceCompletedAtMs,
    sourceSubmissionSha256: value.sourceSubmissionSha256,
    sourceMessageSha256: value.sourceMessageSha256,
    sourceMessageSentAtMs: value.sourceMessageSentAtMs,
  };
}

function storageIdentitySha256(context, artifact) {
  return canonicalJsonSha256({
    schema: DISTRIBUTED_EVIDENCE_STORAGE_IDENTITY_SCHEMA,
    context,
    evidenceId: artifact.evidenceId,
    namespaceKind: artifact.namespaceKind,
    namespaceIdentitySha256: artifact.namespaceIdentitySha256,
    relativePath: artifact.relativePath,
  });
}

function artifactSeal(context, artifact) {
  const unsigned = { ...artifact };
  delete unsigned.artifactSha256;
  return canonicalJsonSha256({ context, artifact: unsigned });
}

function normalizeArtifactInput(value, index, context, outputNamespaces) {
  exactKeys(
    value,
    ARTIFACT_INPUT_KEYS,
    `distributed evidence artifact input ${index}`
  );
  const evidenceId = identifier(value.evidenceId, 'evidence ID');
  const kind = namespaceKind(value.namespaceKind);
  const namespaceIdentitySha256 =
    outputNamespaces[NAMESPACE_FIELD_BY_KIND[kind]];
  const blobSha256 = digest(value.blobSha256, 'evidence blob hash');
  const artifact = {
    schema: DISTRIBUTED_EVIDENCE_ARTIFACT_SCHEMA,
    evidenceId,
    namespaceKind: kind,
    namespaceIdentitySha256,
    relativePath: normalizeRelativePath(
      value.relativePath,
      kind,
      namespaceIdentitySha256,
      blobSha256
    ),
    evidenceSchema: normalizeEvidenceSchemaToken(value.evidenceSchema),
    mediaType: mediaType(value.mediaType, 'evidence media type'),
    bytes: integer(value.bytes, 'Evidence byte count', {
      maximum: MAX_DISTRIBUTED_EVIDENCE_ARTIFACT_BYTES,
      minimum: 1,
    }),
    blobSha256,
  };
  const withStorage = {
    ...artifact,
    storageIdentitySha256: storageIdentitySha256(context, artifact),
  };
  return {
    ...withStorage,
    artifactSha256: artifactSeal(context, withStorage),
  };
}

function normalizeSealedArtifact(value, index, context, outputNamespaces) {
  exactKeys(
    value,
    ARTIFACT_KEYS,
    `sealed distributed evidence artifact ${index}`
  );
  if (value.schema !== DISTRIBUTED_EVIDENCE_ARTIFACT_SCHEMA)
    throw new Error('Unsupported distributed evidence artifact schema');
  const artifact = normalizeArtifactInput(
    Object.fromEntries(ARTIFACT_INPUT_KEYS.map((key) => [key, value[key]])),
    index,
    context,
    outputNamespaces
  );
  if (
    value.namespaceIdentitySha256 !== artifact.namespaceIdentitySha256 ||
    value.storageIdentitySha256 !== artifact.storageIdentitySha256
  )
    throw new Error(
      'Evidence artifact crossed its namespace or storage identity'
    );
  if (value.artifactSha256 !== artifact.artifactSha256)
    throw new Error('Evidence artifact seal does not match its contents');
  return artifact;
}

function normalizeManifestInput(value) {
  exactKeys(value, MANIFEST_INPUT_KEYS, 'distributed evidence manifest input');
  if (value.schema !== DISTRIBUTED_EVIDENCE_MANIFEST_SCHEMA)
    throw new Error('Unsupported distributed evidence manifest schema');
  const binding = verifyBrokerBinding(value.binding);
  const bindingSha256 = canonicalJsonSha256(binding);
  const executionId = identifier(value.executionId, 'execution ID');
  if (executionId !== binding.executionId)
    throw new Error('Evidence manifest execution does not match its binding');
  const brokerIsolation = brokerApplicationIsolationKeySha256(binding);
  if (value.brokerApplicationIsolationKeySha256 !== brokerIsolation)
    throw new Error('Evidence manifest crossed its broker isolation boundary');
  const outputNamespaces = normalizeOutputNamespaces(value.outputNamespaces);
  const queueIsolation = digest(
    value.queueApplicationIsolationKeySha256,
    'queue application isolation hash'
  );
  if (
    new Set([
      queueIsolation,
      brokerIsolation,
      ...Object.values(outputNamespaces),
    ]).size !==
    OUTPUT_NAMESPACE_KEYS.length + 2
  )
    throw new Error('Evidence manifest identities must remain isolated');
  const normalized = {
    schema: DISTRIBUTED_EVIDENCE_MANIFEST_SCHEMA,
    bridgeSha256: digest(value.bridgeSha256, 'execution bridge hash'),
    binding,
    bindingSha256,
    executionId,
    queueApplicationIsolationKeySha256: queueIsolation,
    brokerApplicationIsolationKeySha256: brokerIsolation,
    outputNamespaces,
    workerId: identifier(value.workerId, 'worker ID'),
    instanceId: identifier(value.instanceId, 'worker instance ID'),
    workerSessionId: identifier(
      value.workerSessionId,
      'worker authentication session ID'
    ),
    taskId: identifier(value.taskId, 'task ID'),
    taskSha256: digest(value.taskSha256, 'task hash'),
    leaseId: identifier(value.leaseId, 'lease ID'),
    attempt: integer(value.attempt, 'Task attempt', { minimum: 1 }),
    sourceSubmissionSha256: digest(
      value.sourceSubmissionSha256,
      'source submission hash'
    ),
    sourceCompletedAtMs: integer(
      value.sourceCompletedAtMs,
      'Source completion time'
    ),
    sourceMessageSha256: digest(
      value.sourceMessageSha256,
      'source message hash'
    ),
    sourceMessageSentAtMs: integer(
      value.sourceMessageSentAtMs,
      'Source message send time'
    ),
  };
  if (normalized.sourceCompletedAtMs > normalized.sourceMessageSentAtMs)
    throw new Error(
      'Evidence source cannot complete after its message is sent'
    );
  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0)
    throw new Error('Distributed evidence manifest requires artifacts');
  if (value.artifacts.length > MAX_DISTRIBUTED_EVIDENCE_ARTIFACTS)
    throw new Error('Distributed evidence manifest exceeds its artifact limit');
  const context = manifestContext(normalized);
  const artifacts = value.artifacts
    .map((artifact, index) =>
      normalizeArtifactInput(artifact, index, context, outputNamespaces)
    )
    .toSorted((left, right) => compareText(left.evidenceId, right.evidenceId));
  if (
    new Set(artifacts.map((artifact) => artifact.evidenceId)).size !==
    artifacts.length
  )
    throw new Error('Distributed evidence IDs must be exact-once');
  if (
    new Set(artifacts.map((artifact) => artifact.relativePath)).size !==
      artifacts.length ||
    new Set(artifacts.map((artifact) => artifact.storageIdentitySha256))
      .size !== artifacts.length
  )
    throw new Error(
      'Distributed evidence storage identities must be exact-once'
    );
  const totalBytes = artifacts.reduce(
    (total, artifact) => total + artifact.bytes,
    0
  );
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes > MAX_DISTRIBUTED_EVIDENCE_TOTAL_BYTES
  )
    throw new Error(
      'Distributed evidence manifest exceeds its total byte limit'
    );
  return { ...normalized, artifacts, totalBytes };
}

function normalizeSealedManifest(value) {
  exactKeys(value, MANIFEST_KEYS, 'sealed distributed evidence manifest');
  if (!Array.isArray(value.artifacts))
    throw new Error('Sealed distributed evidence artifacts must be an array');
  value.artifacts.forEach((artifact, index) => {
    exactKeys(
      artifact,
      ARTIFACT_KEYS,
      `sealed distributed evidence artifact ${index}`
    );
  });
  const input = Object.fromEntries(
    MANIFEST_INPUT_KEYS.map((key) => [
      key,
      key === 'artifacts'
        ? value.artifacts.map((artifact) =>
            Object.fromEntries(
              ARTIFACT_INPUT_KEYS.map((artifactKey) => [
                artifactKey,
                artifact[artifactKey],
              ])
            )
          )
        : value[key],
    ])
  );
  const manifest = normalizeManifestInput(input);
  const context = manifestContext(manifest);
  const artifacts = value.artifacts.map((artifact, index) =>
    normalizeSealedArtifact(artifact, index, context, manifest.outputNamespaces)
  );
  if (
    canonicalJsonSha256(artifacts) !== canonicalJsonSha256(manifest.artifacts)
  )
    throw new Error(
      'Evidence manifest artifact order or seals are not canonical'
    );
  if (
    value.bindingSha256 !== manifest.bindingSha256 ||
    value.totalBytes !== manifest.totalBytes
  )
    throw new Error('Evidence manifest summary does not match its contents');
  const sealed = {
    ...manifest,
    manifestSha256: canonicalJsonSha256(manifest),
  };
  if (value.manifestSha256 !== sealed.manifestSha256)
    throw new Error('Evidence manifest seal does not match its contents');
  if (
    Buffer.byteLength(JSON.stringify(sealed), 'utf8') >
    MAX_DISTRIBUTED_EVIDENCE_MANIFEST_BYTES
  )
    throw new Error(
      'Distributed evidence manifest exceeds its descriptor limit'
    );
  return sealed;
}

function normalizeExpectedArtifacts(value) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('Expected distributed evidence contracts are required');
  if (value.length > MAX_DISTRIBUTED_EVIDENCE_ARTIFACTS)
    throw new Error('Expected distributed evidence exceeds its artifact limit');
  const expected = value
    .map((entry, index) => {
      exactKeys(
        entry,
        EXPECTED_ARTIFACT_KEYS,
        `expected distributed evidence ${index}`
      );
      if (typeof entry.required !== 'boolean')
        throw new Error('Expected evidence required flag must be boolean');
      return {
        evidenceId: identifier(entry.evidenceId, 'expected evidence ID'),
        schema: normalizeEvidenceSchemaToken(
          entry.schema,
          'expected evidence schema'
        ),
        mediaType: mediaType(entry.mediaType, 'expected evidence media type'),
        required: entry.required,
        namespaceKind: namespaceKind(entry.namespaceKind),
      };
    })
    .toSorted((left, right) => compareText(left.evidenceId, right.evidenceId));
  if (
    new Set(expected.map((entry) => entry.evidenceId)).size !== expected.length
  )
    throw new Error('Expected distributed evidence IDs must be unique');
  return expected;
}

function assertExpectedArtifacts(manifest, expectedValue) {
  const expected = normalizeExpectedArtifacts(expectedValue);
  const expectedById = new Map(
    expected.map((entry) => [entry.evidenceId, entry])
  );
  for (const artifact of manifest.artifacts) {
    const contract = expectedById.get(artifact.evidenceId);
    if (!contract)
      throw new Error(
        `Unexpected distributed evidence: ${artifact.evidenceId}`
      );
    if (
      artifact.evidenceSchema !== contract.schema ||
      artifact.mediaType !== contract.mediaType ||
      artifact.namespaceKind !== contract.namespaceKind
    )
      throw new Error(
        `Distributed evidence contract drifted: ${artifact.evidenceId}`
      );
  }
  if (
    expected.some(
      (entry) =>
        entry.required &&
        !manifest.artifacts.some(
          (artifact) => artifact.evidenceId === entry.evidenceId
        )
    )
  )
    throw new Error('Distributed evidence is missing a required artifact');
}

function sameCanonical(left, right) {
  return canonicalJsonSha256(left) === canonicalJsonSha256(right);
}

export function createDistributedEvidenceManifest(value) {
  const manifest = normalizeManifestInput(value);
  const sealed = deepFreeze({
    ...manifest,
    manifestSha256: canonicalJsonSha256(manifest),
  });
  if (
    Buffer.byteLength(JSON.stringify(sealed), 'utf8') >
    MAX_DISTRIBUTED_EVIDENCE_MANIFEST_BYTES
  )
    throw new Error(
      'Distributed evidence manifest exceeds its descriptor limit'
    );
  return sealed;
}

// Low-level generic verifier. Authenticated worker cancellation cleanup must
// use verifyAuthenticatedDistributedCleanupEvidenceManifest below.
export function verifyDistributedEvidenceManifest(value, expectations) {
  exactKeys(
    expectations,
    EXPECTATION_KEYS,
    'distributed evidence manifest expectations'
  );
  const manifest = normalizeSealedManifest(value);
  if (
    manifest.manifestSha256 !==
    digest(
      expectations.expectedManifestSha256,
      'expected evidence manifest hash'
    )
  )
    throw new Error('Evidence manifest does not match its trusted hash');
  const expectedBinding = verifyBrokerBinding(expectations.expectedBinding);
  if (!sameCanonical(manifest.binding, expectedBinding))
    throw new Error('Evidence manifest has another broker binding');
  const expectedOutputNamespaces = normalizeOutputNamespaces(
    expectations.expectedOutputNamespaces
  );
  for (const [actual, expected, label] of [
    [manifest.bridgeSha256, expectations.expectedBridgeSha256, 'bridge'],
    [
      manifest.queueApplicationIsolationKeySha256,
      expectations.expectedQueueApplicationIsolationKeySha256,
      'queue isolation',
    ],
    [
      manifest.brokerApplicationIsolationKeySha256,
      expectations.expectedBrokerApplicationIsolationKeySha256,
      'broker isolation',
    ],
    [manifest.taskSha256, expectations.expectedTaskSha256, 'task'],
    [
      manifest.sourceSubmissionSha256,
      expectations.expectedSourceSubmissionSha256,
      'source submission',
    ],
    [
      manifest.sourceMessageSha256,
      expectations.expectedSourceMessageSha256,
      'source message',
    ],
  ])
    if (actual !== digest(expected, `expected ${label} hash`))
      throw new Error(`Evidence manifest has another ${label} hash`);
  for (const [actual, expected, label] of [
    [manifest.workerId, expectations.expectedWorkerId, 'worker ID'],
    [
      manifest.instanceId,
      expectations.expectedInstanceId,
      'worker instance ID',
    ],
    [
      manifest.workerSessionId,
      expectations.expectedWorkerSessionId,
      'worker session ID',
    ],
    [manifest.taskId, expectations.expectedTaskId, 'task ID'],
    [manifest.leaseId, expectations.expectedLeaseId, 'lease ID'],
  ])
    if (actual !== identifier(expected, `expected ${label}`))
      throw new Error(`Evidence manifest has another ${label}`);
  if (
    manifest.attempt !==
    integer(expectations.expectedAttempt, 'Expected task attempt', {
      minimum: 1,
    })
  )
    throw new Error('Evidence manifest has another task attempt');
  if (
    manifest.sourceCompletedAtMs !==
      integer(
        expectations.expectedSourceCompletedAtMs,
        'Expected source completion time'
      ) ||
    manifest.sourceMessageSentAtMs !==
      integer(
        expectations.expectedSourceMessageSentAtMs,
        'Expected source message send time'
      )
  )
    throw new Error('Evidence manifest has another trusted source time');
  if (!sameCanonical(manifest.outputNamespaces, expectedOutputNamespaces))
    throw new Error('Evidence manifest has another output namespace set');
  assertExpectedArtifacts(manifest, expectations.expectedArtifacts);
  return deepFreeze(manifest);
}

// Runtime authority: the controller derives every cleanup expectation from one
// authenticated cancellation and one controller-owned execution bridge.
export function verifyAuthenticatedDistributedCleanupEvidenceManifest(value) {
  exactKeys(
    value,
    AUTHENTICATED_CLEANUP_MANIFEST_VERIFICATION_KEYS,
    'authenticated cleanup evidence manifest verification input'
  );
  const message = assertAuthenticatedBrokerMessage(
    value.cancelledMessage,
    'worker.cancelled'
  );
  const bridge = assertTrustedDistributedExecutionBridge(value.executionBridge);
  const binding = verifyBrokerBinding(message.binding);
  const brokerApplicationIsolationSha256 =
    brokerApplicationIsolationKeySha256(binding);
  const body = message.body;
  const cleanup = body.cleanupEvidence;
  const task = bridge.tasks.find((entry) => entry.taskId === body.taskId);

  if (
    !sameCanonical(bridge.binding, binding) ||
    !task ||
    task.applicationIsolationKeySha256 !== brokerApplicationIsolationSha256 ||
    task.assignment.workerId !== body.workerId ||
    task.taskSha256 !== cleanup.taskSha256 ||
    bridge.bridgeSha256 !== cleanup.bridgeSha256 ||
    body.attempt > task.maxAttempts
  )
    throw new Error(
      'Authenticated cleanup message does not match its controller execution bridge'
    );

  const expected = createDistributedEvidenceManifest({
    schema: DISTRIBUTED_EVIDENCE_MANIFEST_SCHEMA,
    bridgeSha256: bridge.bridgeSha256,
    binding,
    executionId: binding.executionId,
    queueApplicationIsolationKeySha256:
      bridge.queueApplicationIsolationKeySha256,
    brokerApplicationIsolationKeySha256: brokerApplicationIsolationSha256,
    outputNamespaces: bridge.outputNamespaces,
    workerId: body.workerId,
    instanceId: body.instanceId,
    workerSessionId: body.workerSessionId,
    taskId: task.taskId,
    taskSha256: task.taskSha256,
    leaseId: body.leaseId,
    attempt: body.attempt,
    sourceSubmissionSha256: canonicalJsonSha256(body),
    sourceCompletedAtMs: body.cancelledAtMs,
    sourceMessageSha256: canonicalJsonSha256(message),
    sourceMessageSentAtMs: message.sentAtMs,
    artifacts: [
      {
        evidenceId: cleanup.evidenceId,
        evidenceSchema: cleanup.evidenceSchema,
        mediaType: cleanup.mediaType,
        namespaceKind: BROKER_CLEANUP_EVIDENCE_NAMESPACE_KIND,
        relativePath:
          `${BROKER_CLEANUP_EVIDENCE_NAMESPACE_KIND}/` +
          `${bridge.outputNamespaces.failureIdentitySha256}/` +
          `${cleanup.blobSha256.slice(0, 2)}/${cleanup.blobSha256}`,
        bytes: cleanup.bytes,
        blobSha256: cleanup.blobSha256,
      },
    ],
  });
  const manifest = normalizeSealedManifest(value.manifest);
  if (!sameCanonical(manifest, expected))
    throw new Error(
      'Authenticated cleanup evidence manifest does not match its controller execution authority'
    );
  return expected;
}

function receiptProjection(manifest) {
  return manifest.artifacts.map((artifact) => ({
    evidenceId: artifact.evidenceId,
    namespaceKind: artifact.namespaceKind,
    namespaceIdentitySha256: artifact.namespaceIdentitySha256,
    storageIdentitySha256: artifact.storageIdentitySha256,
    artifactSha256: artifact.artifactSha256,
    blobSha256: artifact.blobSha256,
    bytes: artifact.bytes,
  }));
}

function sealReceipt(value) {
  const unsigned = { ...value };
  delete unsigned.receiptSha256;
  return canonicalJsonSha256(unsigned);
}

function normalizeReceiptCore(value, manifest) {
  const verifierId = identifier(value.verifierId, 'evidence verifier ID');
  if (verifierId !== manifest.binding.controllerId)
    throw new Error('Evidence verification must be owned by the controller');
  if (verifierId === manifest.workerId)
    throw new Error('Evidence verifier must be independent from the worker');
  const receipt = {
    schema: DISTRIBUTED_EVIDENCE_VERIFICATION_RECEIPT_SCHEMA,
    manifestSha256: manifest.manifestSha256,
    bridgeSha256: manifest.bridgeSha256,
    bindingSha256: manifest.bindingSha256,
    executionId: manifest.executionId,
    queueApplicationIsolationKeySha256:
      manifest.queueApplicationIsolationKeySha256,
    brokerApplicationIsolationKeySha256:
      manifest.brokerApplicationIsolationKeySha256,
    sourceSubmissionSha256: manifest.sourceSubmissionSha256,
    sourceCompletedAtMs: manifest.sourceCompletedAtMs,
    sourceMessageSha256: manifest.sourceMessageSha256,
    sourceMessageSentAtMs: manifest.sourceMessageSentAtMs,
    verifierId,
    verifierIdentitySha256: digest(
      value.verifierIdentitySha256,
      'evidence verifier identity hash'
    ),
    verificationPolicySha256: digest(
      value.verificationPolicySha256,
      'evidence verification policy hash'
    ),
    verifiedAtMs: integer(value.verifiedAtMs, 'Evidence verification time'),
    artifactCount: manifest.artifacts.length,
    totalBytes: manifest.totalBytes,
    artifacts: receiptProjection(manifest),
  };
  if (receipt.verifiedAtMs < manifest.sourceMessageSentAtMs)
    throw new Error('Evidence verification predates its source message');
  return receipt;
}

export function createDistributedEvidenceVerificationReceipt(value) {
  exactKeys(value, RECEIPT_CREATE_KEYS, 'distributed evidence receipt input');
  if (typeof value.verifyArtifact !== 'function')
    throw new Error('Evidence receipt requires an independent verifier');
  const manifest = verifyDistributedEvidenceManifest(
    value.manifest,
    value.manifestExpectations
  );
  const core = normalizeReceiptCore(value, manifest);
  for (const artifact of manifest.artifacts) {
    const accepted = value.verifyArtifact({ artifact, manifest });
    if (accepted && typeof accepted.then === 'function')
      throw new Error('Evidence artifact verifier must be synchronous');
    if (accepted !== true)
      throw new Error(
        `Evidence artifact was not accepted: ${artifact.evidenceId}`
      );
  }
  return deepFreeze({ ...core, receiptSha256: sealReceipt(core) });
}

export function verifyDistributedEvidenceVerificationReceipt(
  value,
  expectations
) {
  exactKeys(
    expectations,
    RECEIPT_EXPECTATION_KEYS,
    'distributed evidence receipt expectations'
  );
  exactKeys(value, RECEIPT_KEYS, 'distributed evidence verification receipt');
  if (value.schema !== DISTRIBUTED_EVIDENCE_VERIFICATION_RECEIPT_SCHEMA)
    throw new Error('Unsupported distributed evidence receipt schema');
  const manifest = verifyDistributedEvidenceManifest(
    expectations.manifest,
    expectations.manifestExpectations
  );
  if (!Array.isArray(value.artifacts))
    throw new Error('Evidence receipt artifacts must be an array');
  value.artifacts.forEach((artifact, index) => {
    exactKeys(
      artifact,
      RECEIPT_ARTIFACT_KEYS,
      `evidence receipt artifact ${index}`
    );
  });
  const core = normalizeReceiptCore(value, manifest);
  if (!sameCanonical(value.artifacts, core.artifacts))
    throw new Error('Evidence receipt artifacts do not match the manifest');
  for (const key of [
    'artifactCount',
    'bindingSha256',
    'bridgeSha256',
    'brokerApplicationIsolationKeySha256',
    'executionId',
    'manifestSha256',
    'queueApplicationIsolationKeySha256',
    'sourceCompletedAtMs',
    'sourceMessageSha256',
    'sourceMessageSentAtMs',
    'sourceSubmissionSha256',
    'totalBytes',
  ])
    if (value[key] !== core[key])
      throw new Error(`Evidence receipt ${key} does not match its manifest`);
  if (
    core.verifierId !==
      identifier(expectations.expectedVerifierId, 'expected verifier ID') ||
    core.verifierIdentitySha256 !==
      digest(
        expectations.expectedVerifierIdentitySha256,
        'expected verifier identity hash'
      ) ||
    core.verificationPolicySha256 !==
      digest(
        expectations.expectedVerificationPolicySha256,
        'expected verification policy hash'
      )
  )
    throw new Error(
      'Evidence receipt has another independent verifier identity'
    );
  const sealed = { ...core, receiptSha256: sealReceipt(core) };
  if (
    value.receiptSha256 !== sealed.receiptSha256 ||
    sealed.receiptSha256 !==
      digest(
        expectations.expectedReceiptSha256,
        'expected evidence receipt hash'
      )
  )
    throw new Error('Evidence receipt does not match its trusted hash');
  return deepFreeze(sealed);
}
