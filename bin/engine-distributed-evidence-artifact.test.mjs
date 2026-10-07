// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  BROKER_BINDING_SCHEMA,
  MAX_EVIDENCE_BLOB_BYTES,
  brokerApplicationIsolationKeySha256,
} from '../tools/validation-engine/runtime/broker-protocol.mjs';
import {
  DISTRIBUTED_EVIDENCE_ARTIFACT_SCHEMA,
  DISTRIBUTED_EVIDENCE_MANIFEST_SCHEMA,
  DISTRIBUTED_EVIDENCE_VERIFICATION_RECEIPT_SCHEMA,
  MAX_DISTRIBUTED_EVIDENCE_ARTIFACTS,
  MAX_DISTRIBUTED_EVIDENCE_ARTIFACT_BYTES,
  createDistributedEvidenceManifest,
  createDistributedEvidenceVerificationReceipt,
  verifyDistributedEvidenceManifest,
  verifyDistributedEvidenceVerificationReceipt,
} from '../tools/validation-engine/runtime/distributed-evidence-artifact.mjs';

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function binding(overrides = {}) {
  return {
    schema: BROKER_BINDING_SCHEMA,
    controllerId: 'controller-a',
    applicationId: 'application-a',
    submissionId: 'submission-a',
    submissionSequence: 4,
    executionId: 'execution-a-1',
    runAttempt: 1,
    repositoryIdentitySha256: hash('repository-a'),
    candidateSha256: hash('candidate-a'),
    planSha256: hash('plan-a'),
    ...overrides,
  };
}

function outputNamespaces(overrides = {}) {
  return {
    cacheIdentitySha256: hash('cache-namespace-a'),
    evidenceIdentitySha256: hash('evidence-namespace-a'),
    failureIdentitySha256: hash('failure-namespace-a'),
    resultsIdentitySha256: hash('results-namespace-a'),
    ...overrides,
  };
}

function artifact(evidenceId, overrides = {}) {
  const defaults = {
    'native-log': {
      evidenceSchema: 'seerrng-native-log-v1',
      mediaType: 'text/plain',
      namespaceKind: 'evidence',
    },
    'native-summary': {
      evidenceSchema: 'seerrng-native-summary-v1',
      mediaType: 'application/json',
      namespaceKind: 'results',
    },
  };
  const value = {
    evidenceId,
    ...defaults[evidenceId],
    bytes: 128,
    blobSha256: hash(`blob-${evidenceId}`),
    ...overrides,
  };
  const namespaceField = {
    evidence: 'evidenceIdentitySha256',
    failure: 'failureIdentitySha256',
    results: 'resultsIdentitySha256',
  }[value.namespaceKind];
  if (!Object.hasOwn(overrides, 'relativePath')) {
    const namespaceIdentity = outputNamespaces()[namespaceField];
    value.relativePath = `${value.namespaceKind}/${namespaceIdentity}/${value.blobSha256.slice(0, 2)}/${value.blobSha256}`;
  }
  return value;
}

function expectedArtifacts(overrides = []) {
  const expected = [
    {
      evidenceId: 'native-log',
      schema: 'seerrng-native-log-v1',
      mediaType: 'text/plain',
      required: true,
      namespaceKind: 'evidence',
    },
    {
      evidenceId: 'native-summary',
      schema: 'seerrng-native-summary-v1',
      mediaType: 'application/json',
      required: false,
      namespaceKind: 'results',
    },
  ];
  return overrides.length === 0 ? expected : overrides;
}

function manifestInput(overrides = {}) {
  const bound = overrides.binding ?? binding();
  return {
    schema: DISTRIBUTED_EVIDENCE_MANIFEST_SCHEMA,
    bridgeSha256: hash('bridge-a'),
    binding: bound,
    executionId: bound.executionId,
    queueApplicationIsolationKeySha256: hash('queue-isolation-a'),
    brokerApplicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(bound),
    outputNamespaces: outputNamespaces(),
    workerId: 'worker-a',
    instanceId: 'worker-a-boot-1',
    workerSessionId: 'worker-a-session-1',
    taskId: 'task-node-a',
    taskSha256: hash('task-node-a'),
    leaseId: 'lease-a-1',
    attempt: 1,
    sourceSubmissionSha256: hash('worker-result-body-a'),
    sourceCompletedAtMs: 300,
    sourceMessageSha256: hash('worker-result-message-a'),
    sourceMessageSentAtMs: 320,
    artifacts: [artifact('native-summary'), artifact('native-log')],
    ...overrides,
  };
}

function manifestExpectations(manifest, overrides = {}) {
  return {
    expectedManifestSha256: manifest.manifestSha256,
    expectedBridgeSha256: manifest.bridgeSha256,
    expectedBinding: manifest.binding,
    expectedQueueApplicationIsolationKeySha256:
      manifest.queueApplicationIsolationKeySha256,
    expectedBrokerApplicationIsolationKeySha256:
      manifest.brokerApplicationIsolationKeySha256,
    expectedOutputNamespaces: manifest.outputNamespaces,
    expectedWorkerId: manifest.workerId,
    expectedInstanceId: manifest.instanceId,
    expectedWorkerSessionId: manifest.workerSessionId,
    expectedTaskId: manifest.taskId,
    expectedTaskSha256: manifest.taskSha256,
    expectedLeaseId: manifest.leaseId,
    expectedAttempt: manifest.attempt,
    expectedSourceSubmissionSha256: manifest.sourceSubmissionSha256,
    expectedSourceCompletedAtMs: manifest.sourceCompletedAtMs,
    expectedSourceMessageSha256: manifest.sourceMessageSha256,
    expectedSourceMessageSentAtMs: manifest.sourceMessageSentAtMs,
    expectedArtifacts: expectedArtifacts(),
    ...overrides,
  };
}

function receipt(manifest, overrides = {}) {
  return createDistributedEvidenceVerificationReceipt({
    manifest,
    manifestExpectations: manifestExpectations(manifest),
    verifierId: 'controller-a',
    verifierIdentitySha256: hash('controller-verifier-a'),
    verificationPolicySha256: hash('verification-policy-a'),
    verifiedAtMs: 500,
    verifyArtifact: () => true,
    ...overrides,
  });
}

function receiptExpectations(manifest, sealedReceipt, overrides = {}) {
  return {
    manifest,
    manifestExpectations: manifestExpectations(manifest),
    expectedReceiptSha256: sealedReceipt.receiptSha256,
    expectedVerifierId: sealedReceipt.verifierId,
    expectedVerifierIdentitySha256: sealedReceipt.verifierIdentitySha256,
    expectedVerificationPolicySha256: sealedReceipt.verificationPolicySha256,
    ...overrides,
  };
}

test('manifest is canonical, context-bound, sealed, and deeply frozen', () => {
  const first = createDistributedEvidenceManifest(manifestInput());
  const reorderedInput = manifestInput({
    artifacts: [artifact('native-log'), artifact('native-summary')],
  });
  const second = createDistributedEvidenceManifest(
    Object.fromEntries(Object.entries(reorderedInput).reverse())
  );

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.artifacts.map((entry) => entry.evidenceId),
    ['native-log', 'native-summary']
  );
  assert.equal(first.artifacts[0].schema, DISTRIBUTED_EVIDENCE_ARTIFACT_SCHEMA);
  assert.equal(
    first.artifacts[0].namespaceIdentitySha256,
    first.outputNamespaces.evidenceIdentitySha256
  );
  assert.match(first.artifacts[0].storageIdentitySha256, /^[a-f0-9]{64}$/);
  assert.match(first.artifacts[0].artifactSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.totalBytes, 256);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.binding), true);
  assert.equal(Object.isFrozen(first.artifacts[0]), true);
  assert.throws(() => {
    first.artifacts[0].bytes = 0;
  }, TypeError);

  assert.deepEqual(
    verifyDistributedEvidenceManifest(first, manifestExpectations(first)),
    first
  );
});

test('trusted manifest expectations reject source and execution substitution', () => {
  const trusted = createDistributedEvidenceManifest(manifestInput());
  const substituted = createDistributedEvidenceManifest(
    manifestInput({
      sourceMessageSha256: hash('substituted-message'),
    })
  );

  assert.throws(
    () =>
      verifyDistributedEvidenceManifest(
        substituted,
        manifestExpectations(trusted)
      ),
    /trusted hash/
  );
  assert.throws(
    () =>
      createDistributedEvidenceManifest(
        manifestInput({ executionId: 'execution-b-1' })
      ),
    /execution does not match/
  );
});

test('manifest rejects missing, extra, and drifted evidence contracts', () => {
  const missing = createDistributedEvidenceManifest(
    manifestInput({ artifacts: [artifact('native-summary')] })
  );
  assert.throws(
    () =>
      verifyDistributedEvidenceManifest(missing, manifestExpectations(missing)),
    /missing a required artifact/
  );

  const unexpectedArtifact = artifact('unexpected', {
    evidenceSchema: 'seerrng-unexpected-v1',
    mediaType: 'text/plain',
    namespaceKind: 'evidence',
  });
  const extra = createDistributedEvidenceManifest(
    manifestInput({ artifacts: [artifact('native-log'), unexpectedArtifact] })
  );
  assert.throws(
    () => verifyDistributedEvidenceManifest(extra, manifestExpectations(extra)),
    /Unexpected distributed evidence/
  );

  const drifted = createDistributedEvidenceManifest(
    manifestInput({
      artifacts: [artifact('native-log', { mediaType: 'application/json' })],
    })
  );
  assert.throws(
    () =>
      verifyDistributedEvidenceManifest(drifted, manifestExpectations(drifted)),
    /contract drifted/
  );
});

test('manifest rejects cross-namespace and content tampering', () => {
  const manifest = createDistributedEvidenceManifest(manifestInput());
  const crossed = structuredClone(manifest);
  crossed.artifacts[0].namespaceIdentitySha256 =
    manifest.outputNamespaces.resultsIdentitySha256;
  assert.throws(
    () =>
      verifyDistributedEvidenceManifest(
        crossed,
        manifestExpectations(manifest)
      ),
    /crossed its namespace/
  );

  const tampered = structuredClone(manifest);
  tampered.artifacts[0].bytes += 1;
  assert.throws(
    () =>
      verifyDistributedEvidenceManifest(
        tampered,
        manifestExpectations(manifest)
      ),
    /artifact seal does not match/
  );

  assert.throws(
    () =>
      createDistributedEvidenceManifest(
        manifestInput({
          outputNamespaces: outputNamespaces({
            failureIdentitySha256: hash('evidence-namespace-a'),
          }),
        })
      ),
    /must be distinct/
  );

  const original = artifact('native-log');
  assert.throws(
    () =>
      createDistributedEvidenceManifest(
        manifestInput({
          artifacts: [
            artifact('native-log', {
              blobSha256: hash('substituted-content'),
              relativePath: original.relativePath,
            }),
          ],
        })
      ),
    /content-addressed namespace path/
  );

  const sharedBlobSha256 = hash('shared-content');
  assert.throws(
    () =>
      createDistributedEvidenceManifest(
        manifestInput({
          artifacts: [
            artifact('native-log', { blobSha256: sharedBlobSha256 }),
            artifact('native-summary', {
              blobSha256: sharedBlobSha256,
              namespaceKind: 'evidence',
            }),
          ],
        })
      ),
    /storage identities must be exact-once/
  );
});

test('manifest requires exact fields and canonical sealed artifact order', () => {
  assert.throws(
    () =>
      createDistributedEvidenceManifest({
        ...manifestInput(),
        ignored: true,
      }),
    /exact field set/
  );
  assert.throws(
    () =>
      createDistributedEvidenceManifest(
        manifestInput({
          artifacts: [{ ...artifact('native-log'), ignored: true }],
        })
      ),
    /exact field set/
  );

  const manifest = createDistributedEvidenceManifest(manifestInput());
  const reversed = structuredClone(manifest);
  reversed.artifacts.reverse();
  assert.throws(
    () =>
      verifyDistributedEvidenceManifest(
        reversed,
        manifestExpectations(manifest)
      ),
    /order or seals are not canonical/
  );
});

test('canonical paths reject traversal, alternate separators, and device forms', () => {
  const invalidPaths = [
    '../native-log/stdout.txt',
    'evidence/../stdout.txt',
    'evidence\\native-log\\stdout.txt',
    'evidence\\..\\stdout.txt',
    '/evidence/native-log/stdout.txt',
    '//server/share/stdout.txt',
    'C:/evidence/native-log/stdout.txt',
    'evidence/native-log/file:stream',
    'evidence//native-log/stdout.txt',
    'evidence/./stdout.txt',
    'evidence/native-log/../stdout.txt',
    'evidence/native-log/CON',
    'evidence/native-log/con.txt',
    'evidence/native-log/file.',
    'evidence/native-log/file ',
    'evidence/native-log/cafe\u0301.txt',
    'evidence/native-log/stdout\u0000.txt',
    'evidence/native-log',
    'results/native-log/stdout.txt',
  ];
  for (const relativePath of invalidPaths)
    assert.throws(
      () =>
        createDistributedEvidenceManifest(
          manifestInput({
            artifacts: [artifact('native-log', { relativePath })],
          })
        ),
      /canonical safe relative path|content-addressed namespace path/
    );
});

test('artifact count and byte limits fail closed', () => {
  assert.equal(
    MAX_DISTRIBUTED_EVIDENCE_ARTIFACT_BYTES,
    MAX_EVIDENCE_BLOB_BYTES
  );
  const largeBlobMetadata = createDistributedEvidenceManifest(
    manifestInput({
      artifacts: [
        artifact('native-log', {
          bytes: MAX_DISTRIBUTED_EVIDENCE_ARTIFACT_BYTES,
        }),
      ],
    })
  );
  assert.equal(
    largeBlobMetadata.totalBytes,
    MAX_DISTRIBUTED_EVIDENCE_ARTIFACT_BYTES
  );
  assert.ok(JSON.stringify(largeBlobMetadata).length < 16_384);

  assert.throws(
    () =>
      createDistributedEvidenceManifest(
        manifestInput({
          artifacts: Array.from(
            { length: MAX_DISTRIBUTED_EVIDENCE_ARTIFACTS + 1 },
            (_, index) => artifact('native-log', { bytes: index + 1 })
          ),
        })
      ),
    /artifact limit/
  );
  assert.throws(
    () =>
      createDistributedEvidenceManifest(
        manifestInput({
          artifacts: [
            artifact('native-log', {
              bytes: MAX_DISTRIBUTED_EVIDENCE_ARTIFACT_BYTES + 1,
            }),
          ],
        })
      ),
    /byte count/
  );
  assert.throws(
    () =>
      createDistributedEvidenceManifest(
        manifestInput({
          artifacts: [artifact('native-log', { bytes: 0 })],
        })
      ),
    /byte count/
  );
  assert.throws(
    () =>
      createDistributedEvidenceManifest(
        manifestInput({
          artifacts: Array.from({ length: 65 }, (_, index) =>
            artifact(`evidence-${index}`, {
              evidenceSchema: 'seerrng-large-evidence-v1',
              mediaType: 'application/octet-stream',
              namespaceKind: 'evidence',
              bytes: MAX_DISTRIBUTED_EVIDENCE_ARTIFACT_BYTES,
            })
          ),
        })
      ),
    /total byte limit/
  );
});

test('controller creates an immutable receipt only after independent verification', () => {
  const manifest = createDistributedEvidenceManifest(manifestInput());
  const verifiedIds = [];
  const sealedReceipt = receipt(manifest, {
    verifyArtifact: ({ artifact: entry, manifest: receivedManifest }) => {
      assert.deepEqual(receivedManifest, manifest);
      verifiedIds.push(entry.evidenceId);
      return true;
    },
  });

  assert.equal(
    sealedReceipt.schema,
    DISTRIBUTED_EVIDENCE_VERIFICATION_RECEIPT_SCHEMA
  );
  assert.deepEqual(verifiedIds, ['native-log', 'native-summary']);
  assert.equal(sealedReceipt.artifactCount, 2);
  assert.equal(sealedReceipt.totalBytes, manifest.totalBytes);
  assert.equal(sealedReceipt.manifestSha256, manifest.manifestSha256);
  assert.equal(Object.isFrozen(sealedReceipt), true);
  assert.equal(Object.isFrozen(sealedReceipt.artifacts[0]), true);
  assert.deepEqual(
    verifyDistributedEvidenceVerificationReceipt(
      sealedReceipt,
      receiptExpectations(manifest, sealedReceipt)
    ),
    sealedReceipt
  );
});

test('receipt rejects worker-owned, rejected, and asynchronous verification', () => {
  const manifest = createDistributedEvidenceManifest(manifestInput());
  assert.throws(
    () => receipt(manifest, { verifierId: 'worker-a' }),
    /owned by the controller/
  );
  assert.throws(
    () => receipt(manifest, { verifyArtifact: () => false }),
    /was not accepted/
  );
  assert.throws(
    () => receipt(manifest, { verifyArtifact: async () => true }),
    /must be synchronous/
  );
  assert.throws(
    () => receipt(manifest, { verifiedAtMs: 319 }),
    /predates its source message/
  );
  assert.throws(
    () =>
      createDistributedEvidenceManifest(
        manifestInput({
          sourceCompletedAtMs: 321,
          sourceMessageSentAtMs: 320,
        })
      ),
    /cannot complete after its message is sent/
  );
});

test('receipt readback rejects tamper, substitution, and extra fields', () => {
  const manifest = createDistributedEvidenceManifest(manifestInput());
  const sealedReceipt = receipt(manifest);
  const expectations = receiptExpectations(manifest, sealedReceipt);

  const tampered = structuredClone(sealedReceipt);
  tampered.artifacts[0].blobSha256 = hash('tampered-receipt-blob');
  assert.throws(
    () => verifyDistributedEvidenceVerificationReceipt(tampered, expectations),
    /do not match the manifest/
  );

  const extra = { ...sealedReceipt, ignored: true };
  assert.throws(
    () => verifyDistributedEvidenceVerificationReceipt(extra, expectations),
    /exact field set/
  );

  assert.throws(
    () =>
      verifyDistributedEvidenceVerificationReceipt(sealedReceipt, {
        ...expectations,
        expectedReceiptSha256: hash('another-receipt'),
      }),
    /trusted hash/
  );
  assert.throws(
    () =>
      verifyDistributedEvidenceVerificationReceipt(sealedReceipt, {
        ...expectations,
        expectedVerifierIdentitySha256: hash('another-verifier'),
      }),
    /another independent verifier identity/
  );
});
