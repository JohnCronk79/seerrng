// Copyright (c) snapetech and SeerrNG contributors.
// Machine-local, namespace-isolated storage for distributed evidence bytes.
// This is a storage-only authority: its runtime-branded receipts prove the
// observed bytes, path, and admitted local root, not broker task/message/lease
// authority. It is intentionally not wired into broker acceptance yet.
//
// The operator-attested local root is a cooperative-process boundary. Portable
// Node has no handle-relative delete-by-verified-inode primitive, so a hostile
// same-user process mutating the staging directory remains a pre-launch limit.
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import {
  MAX_DISTRIBUTED_EVIDENCE_ARTIFACT_BYTES,
  verifyDistributedEvidenceManifest,
} from './distributed-evidence-artifact.mjs';
import { verifyDistributedLocalStateRootAdmission } from './distributed-local-state-root.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_LOCAL_BLOB_STORE_SCHEMA =
  'seerrng-distributed-local-blob-store/v1';
export const DISTRIBUTED_LOCAL_BLOB_STORE_IDENTITY_SCHEMA =
  'seerrng-distributed-local-blob-store-identity/v1';
export const DISTRIBUTED_LOCAL_BLOB_FILE_FINGERPRINT_SCHEMA =
  'seerrng-distributed-local-blob-file-fingerprint/v1';
export const DISTRIBUTED_LOCAL_BLOB_VERIFICATION_RECEIPT_SCHEMA =
  'seerrng-distributed-local-blob-verification-receipt/v1';
export const DISTRIBUTED_LOCAL_BLOB_LAYOUT_VERSION = 1;
export const MAX_DISTRIBUTED_LOCAL_BLOB_CHUNK_BYTES = 1024 * 1024;

const HASH64 = /^[a-f0-9]{64}$/;
const STORE_OPEN_KEYS = ['config', 'expectations', 'marker'];
const PUBLISH_KEYS = ['artifact', 'chunks', 'manifest'];
const VERIFY_KEYS = ['artifact', 'manifest'];
const ASSERT_RECEIPT_KEYS = ['artifact', 'manifest', 'operation', 'receipt'];
const FILE_FINGERPRINT_KEYS = [
  'ctimeNs',
  'deviceId',
  'inodeId',
  'linkCount',
  'mode',
  'mtimeNs',
  'schema',
  'size',
];
const RECEIPT_KEYS = [
  'artifactSha256',
  'blobSha256',
  'blobStoreIdentitySha256',
  'bytes',
  'configSha256',
  'controllerId',
  'fileObjectFingerprint',
  'machineIdentitySha256',
  'manifestSha256',
  'markerSha256',
  'namespaceIdentitySha256',
  'namespaceKind',
  'operation',
  'receiptSha256',
  'relativePath',
  'role',
  'rootIdentitySha256',
  'rootObjectFingerprintSha256',
  'schema',
  'storageIdentitySha256',
  'verifiedAtMs',
  'workerId',
];
const trustedStores = new WeakMap();
const trustedReceipts = new WeakMap();

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

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative safe integer`);
  return value;
}

function sameFileStatistics(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(
      (key) => left[key] === right[key]
    )
  );
}

function sameDirectoryStatistics(left, right) {
  return (
    left.isDirectory() &&
    right.isDirectory() &&
    ['dev', 'ino', 'mode'].every((key) => left[key] === right[key])
  );
}

function decimal(value, label, { nonzero = false } = {}) {
  if (typeof value !== 'bigint' || value < 0n || (nonzero && value === 0n))
    throw new Error(`${label} has no stable filesystem identity`);
  return value.toString(10);
}

function fileFingerprint(statistics) {
  if (
    !statistics.isFile() ||
    statistics.isSymbolicLink() ||
    statistics.nlink !== 1n
  )
    throw new Error(
      'Distributed local blob must be a regular single-link file'
    );
  return deepFreeze({
    schema: DISTRIBUTED_LOCAL_BLOB_FILE_FINGERPRINT_SCHEMA,
    deviceId: decimal(statistics.dev, 'Distributed blob device'),
    inodeId: decimal(statistics.ino, 'Distributed blob inode', {
      nonzero: true,
    }),
    mode: decimal(statistics.mode, 'Distributed blob mode'),
    linkCount: decimal(statistics.nlink, 'Distributed blob link count', {
      nonzero: true,
    }),
    size: decimal(statistics.size, 'Distributed blob size'),
    mtimeNs: decimal(statistics.mtimeNs, 'Distributed blob modification time'),
    ctimeNs: decimal(statistics.ctimeNs, 'Distributed blob change time'),
  });
}

function sameFingerprint(left, right) {
  return canonicalJsonSha256(left) === canonicalJsonSha256(right);
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function directoryFingerprint(path, label, rootDeviceId) {
  const before = lstatIfPresent(path);
  if (before === null || before.isSymbolicLink() || !before.isDirectory())
    throw new Error(`${label} must be an existing ordinary directory`);
  const nativePath = realpathSync.native(path);
  if (nativePath !== path)
    throw new Error(`${label} must use its exact native canonical spelling`);
  const after = lstatIfPresent(path);
  if (after === null || !sameDirectoryStatistics(before, after))
    throw new Error(`${label} changed during filesystem identity verification`);
  const deviceId = decimal(after.dev, `${label} device`);
  if (deviceId !== rootDeviceId)
    throw new Error(`${label} must be on the admitted root filesystem`);
  if (process.platform !== 'win32' && (after.mode & 0o022n) !== 0n)
    throw new Error(`${label} must not be group- or world-writable`);
  return deepFreeze({
    deviceId,
    inodeId: decimal(after.ino, `${label} inode`, { nonzero: true }),
    mode: decimal(after.mode, `${label} mode`),
  });
}

function storeDirectoryFingerprints(admission) {
  const rootDeviceId = admission.config.rootObjectFingerprint.deviceId;
  const blobDirectory = directoryFingerprint(
    admission.paths.blobDirectory,
    'Distributed blob directory',
    rootDeviceId
  );
  const stagingDirectory = directoryFingerprint(
    admission.paths.stagingDirectory,
    'Distributed blob staging directory',
    rootDeviceId
  );
  if (
    blobDirectory.deviceId === stagingDirectory.deviceId &&
    blobDirectory.inodeId === stagingDirectory.inodeId
  )
    throw new Error(
      'Distributed blob and staging directories must be distinct objects'
    );
  return deepFreeze({ blobDirectory, stagingDirectory });
}

function admissionExpectations(value) {
  return deepFreeze(structuredClone(value));
}

function assertStore(value) {
  const entry = trustedStores.get(value);
  if (!entry)
    throw new Error('Trusted distributed local blob store is required');
  if (entry.closed)
    throw new Error('Distributed local blob store has been closed');
  return entry;
}

function readmission(entry) {
  const admission = verifyDistributedLocalStateRootAdmission({
    config: entry.config,
    marker: entry.marker,
    expectations: entry.expectations,
  });
  if (
    admission.config.configSha256 !== entry.configSha256 ||
    admission.config.rootIdentitySha256 !== entry.rootIdentitySha256 ||
    admission.marker.markerSha256 !== entry.markerSha256 ||
    canonicalJsonSha256(admission.config.rootObjectFingerprint) !==
      entry.rootObjectFingerprintSha256
  )
    throw new Error('Distributed local blob store root admission drifted');
  const fingerprints = storeDirectoryFingerprints(admission);
  if (
    !sameFingerprint(
      fingerprints.blobDirectory,
      entry.directoryFingerprints.blobDirectory
    ) ||
    !sameFingerprint(
      fingerprints.stagingDirectory,
      entry.directoryFingerprints.stagingDirectory
    )
  )
    throw new Error('Distributed local blob store directory identity drifted');
  return admission;
}

function withAdmittedFilesystem(store, operation) {
  const entry = assertStore(store);
  const admission = readmission(entry);
  let result;
  let operationError;
  try {
    result = operation(entry, admission);
  } catch (error) {
    operationError = error;
  }
  try {
    readmission(entry);
  } catch (error) {
    throw new Error(
      'Distributed local blob store admission changed during filesystem access',
      { cause: error }
    );
  }
  if (operationError) throw operationError;
  return result;
}

function selfManifestExpectations(value) {
  plainObject(value, 'distributed evidence manifest');
  if (!Array.isArray(value.artifacts))
    throw new Error('Distributed evidence manifest artifacts must be an array');
  return {
    expectedManifestSha256: value.manifestSha256,
    expectedBridgeSha256: value.bridgeSha256,
    expectedBinding: value.binding,
    expectedQueueApplicationIsolationKeySha256:
      value.queueApplicationIsolationKeySha256,
    expectedBrokerApplicationIsolationKeySha256:
      value.brokerApplicationIsolationKeySha256,
    expectedOutputNamespaces: value.outputNamespaces,
    expectedWorkerId: value.workerId,
    expectedInstanceId: value.instanceId,
    expectedWorkerSessionId: value.workerSessionId,
    expectedTaskId: value.taskId,
    expectedTaskSha256: value.taskSha256,
    expectedLeaseId: value.leaseId,
    expectedAttempt: value.attempt,
    expectedSourceSubmissionSha256: value.sourceSubmissionSha256,
    expectedSourceCompletedAtMs: value.sourceCompletedAtMs,
    expectedSourceMessageSha256: value.sourceMessageSha256,
    expectedSourceMessageSentAtMs: value.sourceMessageSentAtMs,
    expectedArtifacts: value.artifacts.map((artifact) => ({
      evidenceId: artifact.evidenceId,
      schema: artifact.evidenceSchema,
      mediaType: artifact.mediaType,
      required: true,
      namespaceKind: artifact.namespaceKind,
    })),
  };
}

function verifiedArtifactContext(manifest, artifact) {
  const index = Array.isArray(manifest?.artifacts)
    ? manifest.artifacts.indexOf(artifact)
    : -1;
  if (index < 0)
    throw new Error(
      'Distributed local blob artifact must be the exact manifest member'
    );
  const verifiedManifest = verifyDistributedEvidenceManifest(
    manifest,
    selfManifestExpectations(manifest)
  );
  const verifiedArtifact = verifiedManifest.artifacts[index];
  if (
    !verifiedArtifact ||
    verifiedArtifact.artifactSha256 !== artifact.artifactSha256 ||
    canonicalJsonSha256(verifiedArtifact) !== canonicalJsonSha256(artifact)
  )
    throw new Error(
      'Distributed local blob artifact does not match its manifest'
    );
  return { verifiedArtifact, verifiedManifest };
}

function containedPath(root, path, label) {
  const child = relative(root, path);
  if (
    child === '' ||
    child === '..' ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  )
    throw new Error(`${label} escaped its approved directory`);
  return path;
}

function artifactPath(admission, artifact) {
  const parts = artifact.relativePath.split('/');
  if (parts.length !== 4)
    throw new Error('Distributed local blob path is not canonical');
  return containedPath(
    admission.paths.blobDirectory,
    join(admission.paths.blobDirectory, ...parts),
    'Distributed local blob path'
  );
}

function blobParentDirectorySnapshot(admission, artifact, { create }) {
  const rootDeviceId = admission.config.rootObjectFingerprint.deviceId;
  const parts = artifact.relativePath.split('/').slice(0, -1);
  let parent = admission.paths.blobDirectory;
  const snapshot = [];
  for (const part of parts) {
    parent = containedPath(
      admission.paths.blobDirectory,
      join(parent, part),
      'Distributed local blob parent'
    );
    if (create) {
      try {
        mkdirSync(parent, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    snapshot.push({
      path: parent,
      fingerprint: directoryFingerprint(
        parent,
        'Distributed local blob parent directory',
        rootDeviceId
      ),
    });
  }
  return snapshot;
}

function assertBlobParentDirectorySnapshot(admission, snapshot) {
  const rootDeviceId = admission.config.rootObjectFingerprint.deviceId;
  for (const entry of snapshot) {
    const actual = directoryFingerprint(
      entry.path,
      'Distributed local blob parent directory',
      rootDeviceId
    );
    if (!sameFingerprint(actual, entry.fingerprint))
      throw new Error(
        'Distributed local blob parent directory identity drifted'
      );
  }
}

function openReadOnlyNoFollow(path, label) {
  try {
    return openSync(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0)
    );
  } catch (error) {
    throw new Error(`${label} could not be opened safely`, { cause: error });
  }
}

function readAndHashFile(
  path,
  artifact,
  expectedDeviceId,
  label = 'Distributed local blob'
) {
  const beforePath = lstatIfPresent(path);
  if (beforePath === null) throw new Error(`${label} is missing`);
  if (
    beforePath.isSymbolicLink() ||
    !beforePath.isFile() ||
    beforePath.nlink !== 1n
  )
    throw new Error(`${label} must be a regular single-link file`);
  if (decimal(beforePath.dev, `${label} device`) !== expectedDeviceId)
    throw new Error(`${label} must be on the admitted root filesystem`);
  const descriptor = openReadOnlyNoFollow(path, label);
  try {
    const beforeDescriptor = fstatSync(descriptor, { bigint: true });
    if (!sameFileStatistics(beforePath, beforeDescriptor))
      throw new Error(`${label} changed before its descriptor read`);
    if (beforeDescriptor.size !== BigInt(artifact.bytes))
      throw new Error(`${label} size does not match its artifact`);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    while (total < artifact.bytes) {
      const requested = Math.min(buffer.length, artifact.bytes - total);
      const count = readSync(descriptor, buffer, 0, requested, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      total += count;
    }
    const extra = readSync(descriptor, buffer, 0, 1, null);
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatIfPresent(path);
    if (
      afterPath === null ||
      !sameFileStatistics(beforeDescriptor, afterDescriptor) ||
      !sameFileStatistics(beforeDescriptor, afterPath) ||
      total !== artifact.bytes ||
      extra !== 0
    )
      throw new Error(`${label} changed during its bounded descriptor read`);
    if (hash.digest('hex') !== artifact.blobSha256)
      throw new Error(`${label} digest does not match its artifact`);
    return fileFingerprint(afterDescriptor);
  } finally {
    closeSync(descriptor);
  }
}

function assertFileFingerprint(path, expected, expectedDeviceId) {
  const statistics = lstatIfPresent(path);
  if (statistics === null)
    throw new Error('Distributed local blob changed after verification');
  if (
    decimal(statistics.dev, 'Distributed local blob device') !==
      expectedDeviceId ||
    !sameFingerprint(fileFingerprint(statistics), expected)
  )
    throw new Error('Distributed local blob changed after verification');
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = writeSync(
      descriptor,
      bytes,
      offset,
      bytes.length - offset,
      null
    );
    if (count < 1)
      throw new Error('Distributed local blob write made no progress');
    offset += count;
  }
}

function claimKey(relativePath) {
  return canonicalJsonSha256({
    schema: 'seerrng-distributed-local-blob-claim-key/v1',
    relativePath,
  });
}

function createClaim(entry, admission, artifact) {
  const key = claimKey(artifact.relativePath);
  const claimId = randomUUID();
  const claimPath = containedPath(
    admission.paths.stagingDirectory,
    join(admission.paths.stagingDirectory, `${key}.claim`),
    'Distributed local blob claim'
  );
  const stagingPath = containedPath(
    admission.paths.stagingDirectory,
    join(admission.paths.stagingDirectory, `${key}.${claimId}.partial`),
    'Distributed local blob staging path'
  );
  let descriptor;
  try {
    descriptor = openSync(
      claimPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o600
    );
  } catch (error) {
    if (error?.code === 'EEXIST')
      throw new Error('Distributed local blob publication is already claimed');
    throw error;
  }
  let fingerprint;
  try {
    const unsigned = {
      schema: 'seerrng-distributed-local-blob-claim/v1',
      claimId,
      blobStoreIdentitySha256: entry.blobStoreIdentitySha256,
      relativePath: artifact.relativePath,
      blobSha256: artifact.blobSha256,
      bytes: artifact.bytes,
      stagingName: `${key}.${claimId}.partial`,
      createdAtMs: Date.now(),
    };
    const claim = {
      ...unsigned,
      claimSha256: canonicalJsonSha256(unsigned),
    };
    writeAll(descriptor, Buffer.from(JSON.stringify(claim), 'utf8'));
    fsyncSync(descriptor);
    const descriptorStatistics = fstatSync(descriptor, { bigint: true });
    const pathStatistics = lstatIfPresent(claimPath);
    if (
      pathStatistics === null ||
      !sameFileStatistics(descriptorStatistics, pathStatistics)
    )
      throw new Error('Distributed local blob claim changed while sealing');
    fingerprint = {
      dev: descriptorStatistics.dev,
      ino: descriptorStatistics.ino,
    };
  } catch (error) {
    try {
      const statistics = fstatSync(descriptor, { bigint: true });
      fingerprint = { dev: statistics.dev, ino: statistics.ino };
    } catch {
      // Retain the path when its exact object cannot be proven.
    }
    closeSync(descriptor);
    descriptor = undefined;
    if (fingerprint)
      removeOwnedStagingPath(
        claimPath,
        fingerprint,
        'Distributed local blob claim'
      );
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return { claimId, claimPath, fingerprint, stagingPath };
}

function removeOwnedStagingPath(path, fingerprint, label) {
  if (!fingerprint) return;
  // Portable Node cannot unlink by an already verified file handle. This
  // path-based cleanup therefore relies on the admitted, non-group/world-
  // writable staging directory and cooperative same-user process boundary.
  const statistics = lstatIfPresent(path);
  if (statistics === null) return;
  if (
    statistics.isSymbolicLink() ||
    !statistics.isFile() ||
    statistics.dev !== fingerprint.dev ||
    statistics.ino !== fingerprint.ino
  )
    throw new Error(`${label} object identity became ambiguous`);
  unlinkSync(path);
}

function writeStagingBlob(claim, artifact, chunks) {
  if (!chunks || typeof chunks[Symbol.iterator] !== 'function')
    throw new Error(
      'Distributed local blob chunks must be a synchronous iterable'
    );
  const descriptor = openSync(
    claim.stagingPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    0o600
  );
  let fingerprint;
  try {
    const hash = createHash('sha256');
    let total = 0;
    for (const value of chunks) {
      if (!(value instanceof Uint8Array) || value.byteLength < 1)
        throw new Error(
          'Distributed local blob chunks must be nonempty byte arrays'
        );
      if (value.byteLength > MAX_DISTRIBUTED_LOCAL_BLOB_CHUNK_BYTES)
        throw new Error(
          'Distributed local blob chunk exceeds its memory bound'
        );
      if (
        total + value.byteLength > artifact.bytes ||
        total + value.byteLength > MAX_DISTRIBUTED_EVIDENCE_ARTIFACT_BYTES
      )
        throw new Error(
          'Distributed local blob stream exceeds its declared size'
        );
      // Own one immutable snapshot so SharedArrayBuffer-backed caller memory
      // cannot make the file write and digest observe different bytes.
      const bytes = Buffer.from(value);
      writeAll(descriptor, bytes);
      hash.update(bytes);
      total += bytes.length;
    }
    if (total !== artifact.bytes)
      throw new Error('Distributed local blob stream is shorter than declared');
    if (hash.digest('hex') !== artifact.blobSha256)
      throw new Error('Distributed local blob stream digest does not match');
    fsyncSync(descriptor);
    const descriptorStatistics = fstatSync(descriptor, { bigint: true });
    const pathStatistics = lstatIfPresent(claim.stagingPath);
    if (
      pathStatistics === null ||
      !sameFileStatistics(descriptorStatistics, pathStatistics) ||
      descriptorStatistics.nlink !== 1n
    )
      throw new Error(
        'Distributed local blob staging file changed while sealing'
      );
    fingerprint = {
      dev: descriptorStatistics.dev,
      ino: descriptorStatistics.ino,
    };
  } catch (error) {
    const statistics = fstatSync(descriptor, { bigint: true });
    fingerprint = { dev: statistics.dev, ino: statistics.ino };
    throw error;
  } finally {
    closeSync(descriptor);
    if (fingerprint) claim.stagingFingerprint = fingerprint;
  }
  return fingerprint;
}

function directoryStatisticsMatchFingerprint(statistics, fingerprint) {
  return (
    statistics.isDirectory() &&
    decimal(statistics.dev, 'Distributed blob parent directory device') ===
      fingerprint.deviceId &&
    decimal(statistics.ino, 'Distributed blob parent directory inode', {
      nonzero: true,
    }) === fingerprint.inodeId &&
    decimal(statistics.mode, 'Distributed blob parent directory mode') ===
      fingerprint.mode
  );
}

function syncDirectoryIfSupported(path, expectedFingerprint) {
  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0)
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (!directoryStatisticsMatchFingerprint(before, expectedFingerprint))
      throw new Error(
        'Distributed local blob parent directory changed before sync'
      );
    fsyncSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (!directoryStatisticsMatchFingerprint(after, expectedFingerprint))
      throw new Error(
        'Distributed local blob parent directory changed during sync'
      );
  } catch (error) {
    const unsupported = ['EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP'].includes(
      error?.code
    );
    const windowsUnsupported =
      process.platform === 'win32' && ['EACCES', 'EPERM'].includes(error?.code);
    if (!unsupported && !windowsUnsupported) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function publishStagingBlob(
  claim,
  finalPath,
  artifact,
  expectedDeviceId,
  finalParentFingerprint
) {
  const existing = lstatIfPresent(finalPath);
  if (existing !== null) {
    readAndHashFile(finalPath, artifact, expectedDeviceId);
    removeOwnedStagingPath(
      claim.stagingPath,
      claim.stagingFingerprint,
      'Distributed local blob staging file'
    );
    claim.stagingFingerprint = null;
    return;
  }
  try {
    linkSync(claim.stagingPath, finalPath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    readAndHashFile(finalPath, artifact, expectedDeviceId);
    removeOwnedStagingPath(
      claim.stagingPath,
      claim.stagingFingerprint,
      'Distributed local blob staging file'
    );
    claim.stagingFingerprint = null;
    return;
  }
  const stagingStatistics = lstatIfPresent(claim.stagingPath);
  const finalStatistics = lstatIfPresent(finalPath);
  if (
    stagingStatistics === null ||
    finalStatistics === null ||
    stagingStatistics.isSymbolicLink() ||
    finalStatistics.isSymbolicLink() ||
    !stagingStatistics.isFile() ||
    !finalStatistics.isFile() ||
    stagingStatistics.dev !== finalStatistics.dev ||
    stagingStatistics.ino !== finalStatistics.ino ||
    stagingStatistics.nlink !== 2n ||
    finalStatistics.nlink !== 2n
  )
    throw new Error(
      'Distributed local blob no-overwrite publication was unsafe'
    );
  removeOwnedStagingPath(
    claim.stagingPath,
    claim.stagingFingerprint,
    'Distributed local blob staging file'
  );
  claim.stagingFingerprint = null;
  // The staging descriptor was synced before the hard link. Sync only the
  // directory entry here; reopening the mutable final pathname would add a
  // path-swap hazard without making the already-synced inode more durable.
  // Unsupported directory fsync means this foundation receipt is not yet a
  // power-loss-durability assertion; broker integration remains gated.
  syncDirectoryIfSupported(dirname(finalPath), finalParentFingerprint);
}

function receiptCore(entry, manifest, artifact, operation, fingerprint) {
  return {
    schema: DISTRIBUTED_LOCAL_BLOB_VERIFICATION_RECEIPT_SCHEMA,
    operation,
    blobStoreIdentitySha256: entry.blobStoreIdentitySha256,
    rootIdentitySha256: entry.rootIdentitySha256,
    configSha256: entry.configSha256,
    markerSha256: entry.markerSha256,
    rootObjectFingerprintSha256: entry.rootObjectFingerprintSha256,
    role: entry.role,
    controllerId: entry.controllerId,
    workerId: entry.workerId,
    machineIdentitySha256: entry.machineIdentitySha256,
    manifestSha256: manifest.manifestSha256,
    artifactSha256: artifact.artifactSha256,
    storageIdentitySha256: artifact.storageIdentitySha256,
    namespaceKind: artifact.namespaceKind,
    namespaceIdentitySha256: artifact.namespaceIdentitySha256,
    relativePath: artifact.relativePath,
    blobSha256: artifact.blobSha256,
    bytes: artifact.bytes,
    fileObjectFingerprint: fingerprint,
    verifiedAtMs: Date.now(),
  };
}

function issueReceipt(
  store,
  entry,
  manifestObject,
  artifactObject,
  manifest,
  artifact,
  operation,
  fingerprint,
  finalPath
) {
  const core = receiptCore(entry, manifest, artifact, operation, fingerprint);
  const receipt = deepFreeze({
    ...core,
    receiptSha256: canonicalJsonSha256(core),
  });
  trustedReceipts.set(receipt, {
    store,
    entry,
    manifestObject,
    artifactObject,
    operation,
    finalPath,
    fingerprint,
  });
  return receipt;
}

function publishArtifactBlob(store, value) {
  exactKeys(value, PUBLISH_KEYS, 'distributed local blob publication input');
  const { verifiedArtifact, verifiedManifest } = verifiedArtifactContext(
    value.manifest,
    value.artifact
  );
  return withAdmittedFilesystem(store, (entry, admission) => {
    const finalPath = artifactPath(admission, verifiedArtifact);
    const claim = createClaim(entry, admission, verifiedArtifact);
    let completed = false;
    try {
      const parentSnapshot = blobParentDirectorySnapshot(
        admission,
        verifiedArtifact,
        { create: true }
      );
      const existing = lstatIfPresent(finalPath);
      const expectedDeviceId = admission.config.rootObjectFingerprint.deviceId;
      if (existing === null) {
        writeStagingBlob(claim, verifiedArtifact, value.chunks);
        publishStagingBlob(
          claim,
          finalPath,
          verifiedArtifact,
          expectedDeviceId,
          parentSnapshot.at(-1).fingerprint
        );
      } else {
        readAndHashFile(finalPath, verifiedArtifact, expectedDeviceId);
      }
      const fingerprint = readAndHashFile(
        finalPath,
        verifiedArtifact,
        expectedDeviceId
      );
      assertBlobParentDirectorySnapshot(admission, parentSnapshot);
      assertFileFingerprint(finalPath, fingerprint, expectedDeviceId);
      completed = true;
      return issueReceipt(
        store,
        entry,
        value.manifest,
        value.artifact,
        verifiedManifest,
        verifiedArtifact,
        'publish',
        fingerprint,
        finalPath
      );
    } finally {
      if (!completed && claim.stagingFingerprint)
        removeOwnedStagingPath(
          claim.stagingPath,
          claim.stagingFingerprint,
          'Distributed local blob staging file'
        );
      removeOwnedStagingPath(
        claim.claimPath,
        claim.fingerprint,
        'Distributed local blob claim'
      );
    }
  });
}

function verifyArtifactBlob(store, value) {
  exactKeys(value, VERIFY_KEYS, 'distributed local blob verification input');
  const { verifiedArtifact, verifiedManifest } = verifiedArtifactContext(
    value.manifest,
    value.artifact
  );
  return withAdmittedFilesystem(store, (entry, admission) => {
    const finalPath = artifactPath(admission, verifiedArtifact);
    const parentSnapshot = blobParentDirectorySnapshot(
      admission,
      verifiedArtifact,
      { create: false }
    );
    const fingerprint = readAndHashFile(
      finalPath,
      verifiedArtifact,
      admission.config.rootObjectFingerprint.deviceId
    );
    assertBlobParentDirectorySnapshot(admission, parentSnapshot);
    assertFileFingerprint(
      finalPath,
      fingerprint,
      admission.config.rootObjectFingerprint.deviceId
    );
    return issueReceipt(
      store,
      entry,
      value.manifest,
      value.artifact,
      verifiedManifest,
      verifiedArtifact,
      'verify',
      fingerprint,
      finalPath
    );
  });
}

function normalizeReceipt(value) {
  exactKeys(value, RECEIPT_KEYS, 'distributed local blob receipt');
  if (value.schema !== DISTRIBUTED_LOCAL_BLOB_VERIFICATION_RECEIPT_SCHEMA)
    throw new Error('Unsupported distributed local blob receipt schema');
  if (!['publish', 'verify'].includes(value.operation))
    throw new Error('Distributed local blob receipt operation is unsupported');
  exactKeys(
    value.fileObjectFingerprint,
    FILE_FINGERPRINT_KEYS,
    'distributed local blob file fingerprint'
  );
  if (
    value.fileObjectFingerprint.schema !==
    DISTRIBUTED_LOCAL_BLOB_FILE_FINGERPRINT_SCHEMA
  )
    throw new Error('Unsupported distributed local blob fingerprint schema');
  for (const [field, label] of [
    ['blobStoreIdentitySha256', 'blob store identity hash'],
    ['rootIdentitySha256', 'root identity hash'],
    ['configSha256', 'config hash'],
    ['markerSha256', 'marker hash'],
    ['rootObjectFingerprintSha256', 'root object fingerprint hash'],
    ['machineIdentitySha256', 'machine identity hash'],
    ['manifestSha256', 'manifest hash'],
    ['artifactSha256', 'artifact hash'],
    ['storageIdentitySha256', 'storage identity hash'],
    ['namespaceIdentitySha256', 'namespace identity hash'],
    ['blobSha256', 'blob hash'],
    ['receiptSha256', 'receipt hash'],
  ])
    digest(value[field], label);
  integer(value.bytes, 'Distributed local blob receipt bytes');
  integer(value.verifiedAtMs, 'Distributed local blob receipt time');
  const unsigned = { ...value };
  delete unsigned.receiptSha256;
  if (value.receiptSha256 !== canonicalJsonSha256(unsigned))
    throw new Error('Distributed local blob receipt seal does not match');
  return value;
}

export function assertTrustedDistributedLocalBlobVerificationReceipt(
  store,
  value
) {
  exactKeys(value, ASSERT_RECEIPT_KEYS, 'trusted local blob receipt assertion');
  const entry = assertStore(store);
  const receipt = normalizeReceipt(value.receipt);
  const provenance = trustedReceipts.get(receipt);
  if (
    !provenance ||
    provenance.store !== store ||
    provenance.entry !== entry ||
    provenance.manifestObject !== value.manifest ||
    provenance.artifactObject !== value.artifact ||
    provenance.operation !== value.operation ||
    receipt.operation !== value.operation
  )
    throw new Error(
      'Distributed local blob receipt has no matching runtime provenance'
    );
  const { verifiedArtifact, verifiedManifest } = verifiedArtifactContext(
    value.manifest,
    value.artifact
  );
  if (
    receipt.manifestSha256 !== verifiedManifest.manifestSha256 ||
    receipt.artifactSha256 !== verifiedArtifact.artifactSha256 ||
    receipt.blobStoreIdentitySha256 !== entry.blobStoreIdentitySha256
  )
    throw new Error('Distributed local blob receipt context drifted');
  withAdmittedFilesystem(store, (_storeEntry, admission) => {
    const finalPath = artifactPath(admission, verifiedArtifact);
    if (finalPath !== provenance.finalPath)
      throw new Error('Distributed local blob receipt path drifted');
    const parentSnapshot = blobParentDirectorySnapshot(
      admission,
      verifiedArtifact,
      { create: false }
    );
    const fingerprint = readAndHashFile(
      finalPath,
      verifiedArtifact,
      admission.config.rootObjectFingerprint.deviceId
    );
    assertBlobParentDirectorySnapshot(admission, parentSnapshot);
    assertFileFingerprint(
      finalPath,
      fingerprint,
      admission.config.rootObjectFingerprint.deviceId
    );
    if (
      !sameFingerprint(fingerprint, provenance.fingerprint) ||
      !sameFingerprint(fingerprint, receipt.fileObjectFingerprint)
    )
      throw new Error('Distributed local blob receipt is stale');
    const expectedCore = {
      ...receiptCore(
        entry,
        verifiedManifest,
        verifiedArtifact,
        value.operation,
        fingerprint
      ),
      verifiedAtMs: receipt.verifiedAtMs,
    };
    const actualCore = { ...receipt };
    delete actualCore.receiptSha256;
    if (canonicalJsonSha256(actualCore) !== canonicalJsonSha256(expectedCore))
      throw new Error('Distributed local blob receipt context drifted');
  });
  return receipt;
}

export function openDistributedLocalBlobStore(value) {
  exactKeys(value, STORE_OPEN_KEYS, 'distributed local blob store input');
  const expectations = admissionExpectations(value.expectations);
  const admission = verifyDistributedLocalStateRootAdmission({
    config: value.config,
    marker: value.marker,
    expectations,
  });
  const directoryFingerprints = storeDirectoryFingerprints(admission);
  const repeatedAdmission = verifyDistributedLocalStateRootAdmission({
    config: admission.config,
    marker: admission.marker,
    expectations,
  });
  const repeatedFingerprints = storeDirectoryFingerprints(repeatedAdmission);
  if (
    !sameFingerprint(
      directoryFingerprints.blobDirectory,
      repeatedFingerprints.blobDirectory
    ) ||
    !sameFingerprint(
      directoryFingerprints.stagingDirectory,
      repeatedFingerprints.stagingDirectory
    )
  )
    throw new Error(
      'Distributed local blob store directories changed while opening'
    );
  const rootObjectFingerprintSha256 = canonicalJsonSha256(
    admission.config.rootObjectFingerprint
  );
  const identity = {
    schema: DISTRIBUTED_LOCAL_BLOB_STORE_IDENTITY_SCHEMA,
    layoutVersion: DISTRIBUTED_LOCAL_BLOB_LAYOUT_VERSION,
    rootIdentitySha256: admission.config.rootIdentitySha256,
    configSha256: admission.config.configSha256,
    markerSha256: admission.marker.markerSha256,
    rootObjectFingerprintSha256,
    role: admission.config.role,
    controllerId: admission.config.controllerId,
    workerId: admission.config.workerId,
    machineIdentitySha256: admission.config.machineIdentitySha256,
    blobDirectoryFingerprint: directoryFingerprints.blobDirectory,
    stagingDirectoryFingerprint: directoryFingerprints.stagingDirectory,
  };
  const blobStoreIdentitySha256 = canonicalJsonSha256(identity);
  let store;
  store = deepFreeze({
    schema: DISTRIBUTED_LOCAL_BLOB_STORE_SCHEMA,
    layoutVersion: DISTRIBUTED_LOCAL_BLOB_LAYOUT_VERSION,
    blobStoreIdentitySha256,
    rootIdentitySha256: admission.config.rootIdentitySha256,
    configSha256: admission.config.configSha256,
    markerSha256: admission.marker.markerSha256,
    role: admission.config.role,
    controllerId: admission.config.controllerId,
    workerId: admission.config.workerId,
    machineIdentitySha256: admission.config.machineIdentitySha256,
    publishArtifactBlob: (input) => publishArtifactBlob(store, input),
    verifyArtifactBlob: (input) => verifyArtifactBlob(store, input),
    assertVerificationReceipt: (input) =>
      assertTrustedDistributedLocalBlobVerificationReceipt(store, input),
    close: () => {
      const entry = assertStore(store);
      entry.closed = true;
    },
  });
  trustedStores.set(store, {
    closed: false,
    config: admission.config,
    marker: admission.marker,
    expectations,
    directoryFingerprints,
    blobStoreIdentitySha256,
    rootIdentitySha256: admission.config.rootIdentitySha256,
    configSha256: admission.config.configSha256,
    markerSha256: admission.marker.markerSha256,
    rootObjectFingerprintSha256,
    role: admission.config.role,
    controllerId: admission.config.controllerId,
    workerId: admission.config.workerId,
    machineIdentitySha256: admission.config.machineIdentitySha256,
  });
  return store;
}
