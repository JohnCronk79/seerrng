// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  BROKER_BINDING_SCHEMA,
  brokerApplicationIsolationKeySha256,
} from '../tools/validation-engine/runtime/broker-protocol.mjs';
import {
  DISTRIBUTED_EVIDENCE_MANIFEST_SCHEMA,
  createDistributedEvidenceManifest,
} from '../tools/validation-engine/runtime/distributed-evidence-artifact.mjs';
import {
  DISTRIBUTED_LOCAL_BLOB_VERIFICATION_RECEIPT_SCHEMA,
  MAX_DISTRIBUTED_LOCAL_BLOB_CHUNK_BYTES,
  openDistributedLocalBlobStore,
} from '../tools/validation-engine/runtime/distributed-local-blob-store.mjs';
import {
  DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_FILENAME,
  createDistributedLocalStateRootConfig,
  createDistributedLocalStateRootMarker,
} from '../tools/validation-engine/runtime/distributed-local-state-root.mjs';
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function temporaryRoot(t, label) {
  const root = realpathSync.native(
    mkdtempSync(join(realpathSync.native(tmpdir()), `seerrng-${label}-`))
  );
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

function expectations(config) {
  return {
    expectedConfigSha256: config.configSha256,
    expectedControllerId: config.controllerId,
    expectedMachineIdentitySha256: config.machineIdentitySha256,
    expectedPlatform: config.platform,
    expectedRecoveryPolicySha256: config.recoveryPolicySha256,
    expectedRole: config.role,
    expectedRootIdentitySha256: config.rootIdentitySha256,
    expectedWorkerId: config.workerId,
  };
}

function localRoot(t, label, { createBlobDirectories = true } = {}) {
  const root = temporaryRoot(t, label);
  if (createBlobDirectories) {
    mkdirSync(join(root, 'blobs'), { mode: 0o700 });
    mkdirSync(join(root, 'staging'), { mode: 0o700 });
  }
  const config = createDistributedLocalStateRootConfig({
    role: 'controller',
    controllerId: 'controller-a',
    workerId: null,
    machineIdentitySha256: hash('controller-machine-a'),
    platform: process.platform,
    canonicalRoot: root,
    localityAcceptance: {
      status: 'operator-attested-local',
      acceptedAtMs: 10,
      acceptanceId: 'locality-a',
    },
    recoveryAcceptance: {
      staleWriterAfterMs: 30_000,
      allowStaleWriterTakeover: false,
      crashRecoveryAccepted: true,
      acceptedAtMs: 11,
      acceptanceId: 'recovery-a',
    },
  });
  const marker = createDistributedLocalStateRootMarker({
    config,
    createdAtMs: 12,
  });
  writeFileSync(
    join(root, DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_FILENAME),
    JSON.stringify(marker)
  );
  return { config, marker, root };
}

function openStore(rootContract) {
  return openDistributedLocalBlobStore({
    config: rootContract.config,
    marker: rootContract.marker,
    expectations: expectations(rootContract.config),
  });
}

function binding() {
  return {
    schema: BROKER_BINDING_SCHEMA,
    controllerId: 'controller-a',
    applicationId: 'application-a',
    submissionId: 'submission-a',
    submissionSequence: 1,
    executionId: 'execution-a-1',
    runAttempt: 1,
    repositoryIdentitySha256: hash('repository-a'),
    candidateSha256: hash('candidate-a'),
    planSha256: hash('plan-a'),
  };
}

function outputNamespaces() {
  return {
    cacheIdentitySha256: hash('cache-namespace-a'),
    evidenceIdentitySha256: hash('evidence-namespace-a'),
    failureIdentitySha256: hash('failure-namespace-a'),
    resultsIdentitySha256: hash('results-namespace-a'),
  };
}

function manifestFor(bytes, options = {}) {
  const blobSha256 = options.blobSha256 ?? hash(bytes);
  const namespaceKind = options.namespaceKind ?? 'evidence';
  const namespaceField = {
    evidence: 'evidenceIdentitySha256',
    failure: 'failureIdentitySha256',
    results: 'resultsIdentitySha256',
  }[namespaceKind];
  const namespaces = outputNamespaces();
  const bound = binding();
  return createDistributedEvidenceManifest({
    schema: DISTRIBUTED_EVIDENCE_MANIFEST_SCHEMA,
    bridgeSha256: hash('bridge-a'),
    binding: bound,
    executionId: bound.executionId,
    queueApplicationIsolationKeySha256: hash('queue-isolation-a'),
    brokerApplicationIsolationKeySha256:
      brokerApplicationIsolationKeySha256(bound),
    outputNamespaces: namespaces,
    workerId: 'worker-a',
    instanceId: 'worker-a-boot-1',
    workerSessionId: 'worker-a-session-1',
    taskId: 'task-a',
    taskSha256: hash('task-a'),
    leaseId: 'lease-a',
    attempt: 1,
    sourceSubmissionSha256: hash(`submission-${namespaceKind}`),
    sourceCompletedAtMs: 100,
    sourceMessageSha256: hash(`message-${namespaceKind}`),
    sourceMessageSentAtMs: 101,
    artifacts: [
      {
        evidenceId: options.evidenceId ?? `${namespaceKind}-artifact`,
        evidenceSchema: 'seerrng-test-blob/v1',
        mediaType: 'application/octet-stream',
        namespaceKind,
        relativePath:
          `${namespaceKind}/${namespaces[namespaceField]}/` +
          `${blobSha256.slice(0, 2)}/${blobSha256}`,
        bytes: bytes.length,
        blobSha256,
      },
    ],
  });
}

function physicalPath(root, artifact) {
  return join(root, 'blobs', ...artifact.relativePath.split('/'));
}

test('publishes and brands namespace-isolated local blobs', (t) => {
  const local = localRoot(t, 'local-blob-publish');
  const store = openStore(local);
  const bytes = Buffer.from('bounded distributed blob bytes');
  const manifest = manifestFor(bytes);
  const artifact = manifest.artifacts[0];
  const receipt = store.publishArtifactBlob({
    manifest,
    artifact,
    chunks: [bytes.subarray(0, 8), bytes.subarray(8)],
  });

  assert.equal(
    receipt.schema,
    DISTRIBUTED_LOCAL_BLOB_VERIFICATION_RECEIPT_SCHEMA
  );
  assert.equal(receipt.operation, 'publish');
  assert.equal(receipt.manifestSha256, manifest.manifestSha256);
  assert.equal(receipt.artifactSha256, artifact.artifactSha256);
  assert.equal(receipt.blobStoreIdentitySha256, store.blobStoreIdentitySha256);
  assert.equal(
    readFileSync(physicalPath(local.root, artifact), 'utf8'),
    bytes.toString('utf8')
  );
  assert.equal(
    store.assertVerificationReceipt({
      receipt,
      manifest,
      artifact,
      operation: 'publish',
    }),
    receipt
  );

  const verified = store.verifyArtifactBlob({ manifest, artifact });
  assert.equal(verified.operation, 'verify');
  assert.equal(
    store.assertVerificationReceipt({
      receipt: verified,
      manifest,
      artifact,
      operation: 'verify',
    }),
    verified
  );

  const idempotent = store.publishArtifactBlob({
    manifest,
    artifact,
    chunks: [Buffer.from('ignored because exact final already exists')],
  });
  assert.equal(idempotent.operation, 'publish');
  assert.equal(
    readFileSync(physicalPath(local.root, artifact), 'utf8'),
    bytes.toString('utf8')
  );
});

test('physically isolates identical bytes in different namespaces', (t) => {
  const local = localRoot(t, 'local-blob-namespace');
  const store = openStore(local);
  const bytes = Buffer.from('same bytes, separate namespaces');
  const evidenceManifest = manifestFor(bytes, {
    namespaceKind: 'evidence',
  });
  const resultsManifest = manifestFor(bytes, {
    namespaceKind: 'results',
  });
  const evidenceArtifact = evidenceManifest.artifacts[0];
  const resultsArtifact = resultsManifest.artifacts[0];

  store.publishArtifactBlob({
    manifest: evidenceManifest,
    artifact: evidenceArtifact,
    chunks: [bytes],
  });
  assert.throws(
    () =>
      store.verifyArtifactBlob({
        manifest: resultsManifest,
        artifact: resultsArtifact,
      }),
    /is missing|must be an existing ordinary directory/
  );
  store.publishArtifactBlob({
    manifest: resultsManifest,
    artifact: resultsArtifact,
    chunks: [bytes],
  });

  const evidencePath = physicalPath(local.root, evidenceArtifact);
  const resultsPath = physicalPath(local.root, resultsArtifact);
  assert.notEqual(evidencePath, resultsPath);
  assert.equal(readFileSync(evidencePath, 'utf8'), bytes.toString('utf8'));
  assert.equal(readFileSync(resultsPath, 'utf8'), bytes.toString('utf8'));
});

test('rejects cloned, substituted, stale, and tampered receipts', (t) => {
  const local = localRoot(t, 'local-blob-receipt');
  const store = openStore(local);
  const bytes = Buffer.from('receipt-bound bytes');
  const manifest = manifestFor(bytes);
  const artifact = manifest.artifacts[0];
  const receipt = store.publishArtifactBlob({
    manifest,
    artifact,
    chunks: [bytes],
  });

  assert.throws(
    () =>
      store.assertVerificationReceipt({
        receipt: structuredClone(receipt),
        manifest,
        artifact,
        operation: 'publish',
      }),
    /no matching runtime provenance/
  );
  assert.throws(
    () =>
      store.assertVerificationReceipt({
        receipt,
        manifest,
        artifact: structuredClone(artifact),
        operation: 'publish',
      }),
    /exact manifest member|runtime provenance/
  );
  assert.throws(
    () =>
      store.assertVerificationReceipt({
        receipt,
        manifest,
        artifact,
        operation: 'verify',
      }),
    /runtime provenance/
  );

  writeFileSync(physicalPath(local.root, artifact), Buffer.alloc(bytes.length));
  assert.throws(
    () =>
      store.assertVerificationReceipt({
        receipt,
        manifest,
        artifact,
        operation: 'publish',
      }),
    /digest does not match|receipt is stale/
  );

  store.close();
  assert.throws(
    () =>
      store.assertVerificationReceipt({
        receipt,
        manifest,
        artifact,
        operation: 'publish',
      }),
    /has been closed/
  );
});

test('requires fresh byte verification after a store restart', (t) => {
  const local = localRoot(t, 'local-blob-restart');
  const firstStore = openStore(local);
  const bytes = Buffer.from('restart-bound bytes');
  const manifest = manifestFor(bytes);
  const artifact = manifest.artifacts[0];
  const firstReceipt = firstStore.publishArtifactBlob({
    manifest,
    artifact,
    chunks: [bytes],
  });
  firstStore.close();

  const reopenedStore = openStore(local);
  const persistedReceipt = structuredClone(firstReceipt);
  const rehydratedManifest = structuredClone(manifest);
  const rehydratedArtifact = rehydratedManifest.artifacts[0];
  assert.throws(
    () =>
      reopenedStore.assertVerificationReceipt({
        receipt: persistedReceipt,
        manifest: rehydratedManifest,
        artifact: rehydratedArtifact,
        operation: 'publish',
      }),
    /no matching runtime provenance/
  );

  const freshReceipt = reopenedStore.verifyArtifactBlob({
    manifest: rehydratedManifest,
    artifact: rehydratedArtifact,
  });
  assert.equal(
    reopenedStore.assertVerificationReceipt({
      receipt: freshReceipt,
      manifest: rehydratedManifest,
      artifact: rehydratedArtifact,
      operation: 'verify',
    }),
    freshReceipt
  );
});

test('rejects group- or world-writable blob boundaries on POSIX', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX mode bits are not the Windows ACL authority');
    return;
  }
  const local = localRoot(t, 'local-blob-permissions');
  chmodSync(join(local.root, 'staging'), 0o777);
  assert.throws(() => openStore(local), /must not be group- or world-writable/);
});

test('requires pre-provisioned admitted directories without creating them', (t) => {
  const local = localRoot(t, 'local-blob-missing-directories', {
    createBlobDirectories: false,
  });
  assert.throws(
    () => openStore(local),
    /must be an existing ordinary directory/
  );
  assert.equal(existsSync(join(local.root, 'blobs')), false);
  assert.equal(existsSync(join(local.root, 'staging')), false);
});

test('fails closed on directory identity drift after opening', (t) => {
  const local = localRoot(t, 'local-blob-directory-drift');
  const store = openStore(local);
  const displaced = join(local.root, 'blobs-displaced');
  renameSync(join(local.root, 'blobs'), displaced);
  mkdirSync(join(local.root, 'blobs'));
  const bytes = Buffer.from('directory drift bytes');
  const manifest = manifestFor(bytes);

  assert.throws(
    () =>
      store.publishArtifactBlob({
        manifest,
        artifact: manifest.artifacts[0],
        chunks: [bytes],
      }),
    /directory identity drifted/
  );
});

test('re-admits the sealed root immediately before later access', (t) => {
  const local = localRoot(t, 'local-blob-readmission');
  const store = openStore(local);
  const bytes = Buffer.from('root readmission bytes');
  const manifest = manifestFor(bytes);
  const artifact = manifest.artifacts[0];
  store.publishArtifactBlob({ manifest, artifact, chunks: [bytes] });
  writeFileSync(
    join(local.root, DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_FILENAME),
    '{invalid-json'
  );

  assert.throws(
    () => store.verifyArtifactBlob({ manifest, artifact }),
    /marker is not valid JSON/
  );
});

test('rejects a namespace parent symbolic link or junction', (t) => {
  const local = localRoot(t, 'local-blob-namespace-link');
  const store = openStore(local);
  const bytes = Buffer.from('namespace link bytes');
  const manifest = manifestFor(bytes);
  const artifact = manifest.artifacts[0];
  store.publishArtifactBlob({ manifest, artifact, chunks: [bytes] });
  const namespacePath = join(local.root, 'blobs', artifact.namespaceKind);
  const displacedPath = `${namespacePath}-displaced`;
  renameSync(namespacePath, displacedPath);
  try {
    symlinkSync(
      displacedPath,
      namespacePath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (['EACCES', 'EPERM'].includes(error?.code)) {
      t.skip(`Platform denied symbolic-link creation: ${error.code}`);
      return;
    }
    throw error;
  }

  assert.throws(
    () => store.verifyArtifactBlob({ manifest, artifact }),
    /must be an existing ordinary directory|native canonical spelling/
  );
});

test('rejects short, long, mismatched, and oversized streams cleanly', (t) => {
  const local = localRoot(t, 'local-blob-stream-bounds');
  const store = openStore(local);
  const bytes = Buffer.from('declared bytes');
  const manifest = manifestFor(bytes);
  const artifact = manifest.artifacts[0];

  assert.throws(
    () =>
      store.publishArtifactBlob({
        manifest,
        artifact,
        chunks: [bytes.subarray(0, bytes.length - 1)],
      }),
    /shorter than declared/
  );
  assert.throws(
    () =>
      store.publishArtifactBlob({
        manifest,
        artifact,
        chunks: [Buffer.concat([bytes, Buffer.from('x')])],
      }),
    /exceeds its declared size/
  );
  assert.throws(
    () =>
      store.publishArtifactBlob({
        manifest,
        artifact,
        chunks: [Buffer.alloc(bytes.length, 0x6d)],
      }),
    /digest does not match/
  );

  const largeBytes = Buffer.alloc(MAX_DISTRIBUTED_LOCAL_BLOB_CHUNK_BYTES + 1);
  const largeManifest = manifestFor(largeBytes);
  assert.throws(
    () =>
      store.publishArtifactBlob({
        manifest: largeManifest,
        artifact: largeManifest.artifacts[0],
        chunks: [largeBytes],
      }),
    /chunk exceeds its memory bound/
  );
  assert.deepEqual(readdirSync(join(local.root, 'staging')), []);
});

test('an exclusive claim blocks a second cooperative publication', (t) => {
  const local = localRoot(t, 'local-blob-claim');
  const store = openStore(local);
  const bytes = Buffer.from('claimed bytes');
  const manifest = manifestFor(bytes);
  const artifact = manifest.artifacts[0];
  const key = canonicalJsonSha256({
    schema: 'seerrng-distributed-local-blob-claim-key/v1',
    relativePath: artifact.relativePath,
  });
  const claimPath = join(local.root, 'staging', `${key}.claim`);
  writeFileSync(claimPath, 'existing cooperative claim');

  assert.throws(
    () =>
      store.publishArtifactBlob({
        manifest,
        artifact,
        chunks: [bytes],
      }),
    /already claimed/
  );
  assert.equal(readFileSync(claimPath, 'utf8'), 'existing cooperative claim');
  assert.equal(existsSync(physicalPath(local.root, artifact)), false);
});

test('never overwrites or deletes a conflicting final blob', (t) => {
  const local = localRoot(t, 'local-blob-no-overwrite');
  const store = openStore(local);
  const bytes = Buffer.from('expected final bytes');
  const manifest = manifestFor(bytes);
  const artifact = manifest.artifacts[0];
  const finalPath = physicalPath(local.root, artifact);
  mkdirSync(dirname(finalPath), { mode: 0o700, recursive: true });
  const conflict = Buffer.alloc(bytes.length, 0x78);
  writeFileSync(finalPath, conflict);

  assert.throws(
    () =>
      store.publishArtifactBlob({
        manifest,
        artifact,
        chunks: [bytes],
      }),
    /digest does not match/
  );
  assert.deepEqual(readFileSync(finalPath), conflict);
  store.close();
  assert.deepEqual(readFileSync(finalPath), conflict);
});
