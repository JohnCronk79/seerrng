// Copyright (c) snapetech and SeerrNG contributors.
// Sealed, machine-bound admission contracts for one local distributed state root.
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import {
  isAbsolute,
  join,
  parse,
  posix as posixPath,
  relative,
  resolve,
  win32 as win32Path,
} from 'node:path';

import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_LOCAL_STATE_ROOT_CONFIG_SCHEMA =
  'seerrng-distributed-local-state-root/v1';
export const DISTRIBUTED_LOCAL_STATE_ROOT_IDENTITY_SCHEMA =
  'seerrng-distributed-local-state-root-identity/v1';
export const DISTRIBUTED_LOCAL_STATE_ROOT_OBJECT_FINGERPRINT_SCHEMA =
  'seerrng-distributed-local-state-root-object-fingerprint/v1';
export const DISTRIBUTED_LOCALITY_ATTESTATION_SCHEMA =
  'seerrng-distributed-locality-attestation/v1';
export const DISTRIBUTED_STATE_RECOVERY_POLICY_SCHEMA =
  'seerrng-distributed-state-recovery-policy/v1';
export const DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_SCHEMA =
  'seerrng-distributed-local-state-root-marker/v1';
export const DISTRIBUTED_PHYSICAL_LOCALITY_EVIDENCE =
  'operator-attestation-only';
export const DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_FILENAME =
  '.seerrng-distributed-state-root.json';

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]{0,39})$/;
const DOS_DEVICE_SEGMENT =
  /^(?:aux|clock\$|com[1-9]|con|conin\$|conout\$|lpt[1-9]|nul|prn)(?:\.|$)/i;
const CONFIG_INPUT_KEYS = [
  'canonicalRoot',
  'controllerId',
  'localityAcceptance',
  'machineIdentitySha256',
  'platform',
  'recoveryAcceptance',
  'role',
  'workerId',
];
const LOCALITY_ACCEPTANCE_KEYS = ['acceptanceId', 'acceptedAtMs', 'status'];
const RECOVERY_ACCEPTANCE_KEYS = [
  'acceptanceId',
  'acceptedAtMs',
  'allowStaleWriterTakeover',
  'crashRecoveryAccepted',
  'staleWriterAfterMs',
];
const IDENTITY_KEYS = [
  'canonicalRoot',
  'controllerId',
  'machineIdentitySha256',
  'platform',
  'role',
  'rootObjectFingerprint',
  'schema',
  'workerId',
];
const ROOT_OBJECT_FINGERPRINT_KEYS = [
  'deviceId',
  'inodeId',
  'platform',
  'schema',
];
const LOCALITY_ATTESTATION_KEYS = [
  'acceptanceId',
  'acceptedAtMs',
  'attestationSha256',
  'evidenceBasis',
  'rootIdentitySha256',
  'schema',
  'status',
];
const RECOVERY_POLICY_KEYS = [
  'acceptanceId',
  'acceptedAtMs',
  'allowStaleWriterTakeover',
  'crashRecoveryAccepted',
  'recoveryPolicySha256',
  'rootIdentitySha256',
  'schema',
  'staleWriterAfterMs',
];
const CONFIG_KEYS = [
  'canonicalRoot',
  'configSha256',
  'controllerId',
  'localityAttestation',
  'machineIdentitySha256',
  'platform',
  'recoveryPolicy',
  'recoveryPolicySha256',
  'role',
  'rootIdentitySha256',
  'rootObjectFingerprint',
  'schema',
  'workerId',
];
const MARKER_KEYS = [
  'config',
  'configSha256',
  'createdAtMs',
  'markerSha256',
  'physicalLocalityEvidence',
  'rootIdentitySha256',
  'schema',
];
const CONFIG_EXPECTATION_FIELDS = [
  'expectedConfigSha256',
  'expectedControllerId',
  'expectedMachineIdentitySha256',
  'expectedPlatform',
  'expectedRecoveryPolicySha256',
  'expectedRole',
  'expectedRootIdentitySha256',
  'expectedWorkerId',
];
const CONFIG_EXPECTATION_KEYS = new Set(CONFIG_EXPECTATION_FIELDS);
const MARKER_EXPECTATION_KEYS = new Set([
  'expectedConfig',
  'expectedMarkerSha256',
]);

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

function rejectUnknownKeys(value, allowedKeys, label) {
  plainObject(value, label);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key))
      throw new Error(`${label} contains an unsupported field: ${String(key)}`);
  }
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

function unsignedDecimal(value, label, { nonzero = false } = {}) {
  if (
    typeof value !== 'string' ||
    !UNSIGNED_DECIMAL.test(value) ||
    BigInt(value) > 18_446_744_073_709_551_615n ||
    (nonzero && value === '0')
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function lstatIfPresent(value, options) {
  try {
    return lstatSync(value, options);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function exactPathText(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 32_768 ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- Local paths cross config files.
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error('Exact canonical local state root path is required');
  return value;
}

function pathIdentity(value) {
  const normalized = resolve(value);
  return process.platform === 'win32'
    ? normalized
        .replaceAll('/', '\\')
        .replace(/[\\]+$/, '')
        .toLowerCase()
    : normalized.replace(/[/]+$/, '');
}

function normalizeCanonicalRoot(value, platform) {
  exactPathText(value);
  const pathApi = platform === 'win32' ? win32Path : posixPath;
  if (!pathApi.isAbsolute(value))
    throw new Error('Distributed local state root must be absolute');
  const parsed = pathApi.parse(value);
  if (pathApi.resolve(value) === pathApi.resolve(parsed.root))
    throw new Error('Distributed local state root cannot be a filesystem root');
  if (platform === 'win32') {
    if (!/^[A-Za-z]:[\\/]/.test(value) || /^[\\/]{2}/.test(value))
      throw new Error(
        'Distributed local state root must use a fully-qualified local Windows drive path'
      );
    if (value.slice(parsed.root.length).includes(':'))
      throw new Error(
        'Distributed local state root must not use an NTFS alternate data stream'
      );
    const segments = value
      .slice(parsed.root.length)
      .split(/[\\/]/)
      .filter(Boolean);
    if (
      segments.some(
        (segment) =>
          segment === '.' ||
          segment === '..' ||
          /[. ]$/.test(segment) ||
          DOS_DEVICE_SEGMENT.test(segment)
      )
    )
      throw new Error(
        'Distributed local state root contains a noncanonical or reserved Windows segment'
      );
  }
  const normalized = pathApi.resolve(value);
  if (normalized !== value)
    throw new Error('Distributed local state root path is not canonical');
  return normalized;
}

function verifyCanonicalComponents(value, { leafKind }) {
  const root = parse(value).root;
  const segments = value
    .slice(root.length)
    .split(process.platform === 'win32' ? /[\\/]/ : /[/]/)
    .filter(Boolean);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    const statistics = lstatIfPresent(current);
    if (statistics === null) break;
    if (statistics.isSymbolicLink())
      throw new Error(
        'Distributed local state root must not traverse a symbolic link or reparse-point alias'
      );
    const isLeaf = index === segments.length - 1;
    if ((!isLeaf || leafKind === 'directory') && !statistics.isDirectory())
      throw new Error(
        'Distributed local state root path component is not an ordinary directory'
      );
    if (isLeaf && leafKind === 'file' && !statistics.isFile())
      throw new Error('Distributed local state path is not a regular file');
    if (pathIdentity(realpathSync.native(current)) !== pathIdentity(current))
      throw new Error(
        'Distributed local state root must not traverse a canonical-path alias'
      );
  }
}

function verifyExistingDirectory(value, label, { required = false } = {}) {
  const statistics = lstatIfPresent(value);
  if (statistics === null) {
    if (required) throw new Error(`${label} is missing`);
    return;
  }
  if (statistics.isSymbolicLink() || !statistics.isDirectory())
    throw new Error(`${label} must be an ordinary non-symbolic directory`);
  verifyCanonicalComponents(value, { leafKind: 'directory' });
}

function verifyExistingFile(value, label) {
  const statistics = lstatIfPresent(value);
  if (statistics === null) return;
  if (
    statistics.isSymbolicLink() ||
    !statistics.isFile() ||
    statistics.nlink !== 1
  )
    throw new Error(
      `${label} must be a regular non-symbolic file with exactly one filesystem link`
    );
  verifyCanonicalComponents(value, { leafKind: 'file' });
}

function normalizeRootObjectFingerprint(value, expectedPlatform) {
  exactKeys(
    value,
    ROOT_OBJECT_FINGERPRINT_KEYS,
    'distributed local state root object fingerprint'
  );
  if (value.schema !== DISTRIBUTED_LOCAL_STATE_ROOT_OBJECT_FINGERPRINT_SCHEMA)
    throw new Error(
      'Unsupported distributed local state root object fingerprint schema'
    );
  const platform = identifier(value.platform, 'root object platform');
  if (platform !== expectedPlatform)
    throw new Error(
      'Distributed local state root object platform does not match its identity'
    );
  return deepFreeze({
    schema: DISTRIBUTED_LOCAL_STATE_ROOT_OBJECT_FINGERPRINT_SCHEMA,
    platform,
    deviceId: unsignedDecimal(value.deviceId, 'root object device ID'),
    inodeId: unsignedDecimal(value.inodeId, 'root object inode ID', {
      nonzero: true,
    }),
  });
}

function fingerprintLocalRootStatistics(statistics) {
  // Decimal text preserves the complete bigint fs.Stats dev/ino identity on
  // every supported platform without lossy Number conversion.
  if (
    typeof statistics.dev !== 'bigint' ||
    typeof statistics.ino !== 'bigint' ||
    statistics.dev < 0n ||
    statistics.ino <= 0n
  )
    throw new Error(
      'Distributed local state root has no stable filesystem object identity'
    );
  return normalizeRootObjectFingerprint(
    {
      schema: DISTRIBUTED_LOCAL_STATE_ROOT_OBJECT_FINGERPRINT_SCHEMA,
      platform: process.platform,
      deviceId: statistics.dev.toString(10),
      inodeId: statistics.ino.toString(10),
    },
    process.platform
  );
}

function sameRootObject(left, right) {
  return (
    left.isDirectory() &&
    right.isDirectory() &&
    !left.isSymbolicLink() &&
    !right.isSymbolicLink() &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function readVerifiedLocalRootObject(value, label) {
  const before = lstatIfPresent(value, { bigint: true });
  if (before === null) throw new Error(`${label} is missing`);
  if (before.isSymbolicLink() || !before.isDirectory())
    throw new Error(`${label} must be an ordinary non-symbolic directory`);
  verifyCanonicalComponents(value, { leafKind: 'directory' });
  if (process.platform === 'win32' && realpathSync.native(value) !== value)
    throw new Error(
      `${label} must use its exact native Windows realpath spelling`
    );
  const after = lstatIfPresent(value, { bigint: true });
  if (after === null || !sameRootObject(before, after))
    throw new Error(`${label} changed during filesystem identity verification`);
  return fingerprintLocalRootStatistics(after);
}

function verifyLocalRootObjectBinding(config) {
  const actual = readVerifiedLocalRootObject(
    config.canonicalRoot,
    'Distributed local state root'
  );
  if (
    actual.schema !== config.rootObjectFingerprint.schema ||
    actual.platform !== config.rootObjectFingerprint.platform ||
    actual.deviceId !== config.rootObjectFingerprint.deviceId ||
    actual.inodeId !== config.rootObjectFingerprint.inodeId
  )
    throw new Error(
      'Distributed local state root object fingerprint does not match'
    );
  return actual;
}

function sameFile(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.nlink === 1n &&
    right.nlink === 1n &&
    ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].every(
      (key) => left[key] === right[key]
    )
  );
}

function readCheckedMarkerFile(value, config) {
  // These paired checks narrow root rename/replacement races around the marker
  // descriptor read. Portable Node does not expose one cross-platform
  // handle-relative traversal primitive, so later filesystem consumers must
  // revalidate the sealed root object at their own point of use.
  verifyLocalRootObjectBinding(config);
  let descriptor;
  try {
    descriptor = openSync(
      value,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0)
    );
  } catch (error) {
    if (error?.code === 'ENOENT')
      throw new Error('Distributed local state root marker is missing');
    throw new Error('Distributed local state root marker is unsafe', {
      cause: error,
    });
  }
  try {
    const before = fstatSync(descriptor, { bigint: true });
    let checked;
    try {
      checked = lstatSync(value, { bigint: true });
    } catch (error) {
      throw new Error(
        'Distributed local state root marker changed before its descriptor read',
        { cause: error }
      );
    }
    if (
      checked.isSymbolicLink() ||
      !sameFile(checked, before) ||
      before.size < 1n ||
      before.size > 262_144n
    )
      throw new Error('Distributed local state root marker is unsafe');
    const approvedBytes = Number(before.size);
    const bytes = Buffer.alloc(approvedBytes);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        null
      );
      if (count === 0) break;
      offset += count;
    }
    const extra = Buffer.alloc(1);
    const extraBytes =
      offset === bytes.length
        ? readSync(descriptor, extra, 0, extra.length, null)
        : 0;
    let afterPath;
    try {
      afterPath = lstatSync(value, { bigint: true });
    } catch (error) {
      throw new Error(
        'Distributed local state root marker changed during its descriptor read',
        { cause: error }
      );
    }
    const afterDescriptor = fstatSync(descriptor, { bigint: true });
    verifyLocalRootObjectBinding(config);
    if (
      !sameFile(afterDescriptor, before) ||
      afterPath.isSymbolicLink() ||
      !sameFile(afterPath, before) ||
      BigInt(offset) !== before.size ||
      extraBytes !== 0
    )
      throw new Error(
        'Distributed local state root marker changed during its descriptor read'
      );
    return bytes.toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

function assertContained(root, child, label) {
  const childRelative = relative(root, child);
  if (
    childRelative === '' ||
    childRelative === '..' ||
    childRelative.startsWith(
      `..${process.platform === 'win32' ? '\\' : '/'}`
    ) ||
    isAbsolute(childRelative)
  )
    throw new Error(`${label} escaped its approved local state root`);
  return child;
}

function identityProjection(value) {
  return {
    schema: DISTRIBUTED_LOCAL_STATE_ROOT_IDENTITY_SCHEMA,
    role: value.role,
    controllerId: value.controllerId,
    workerId: value.workerId,
    machineIdentitySha256: value.machineIdentitySha256,
    platform: value.platform,
    canonicalRoot: value.canonicalRoot,
    rootObjectFingerprint: value.rootObjectFingerprint,
  };
}

function normalizeIdentity(value) {
  exactKeys(value, IDENTITY_KEYS, 'distributed local state root identity');
  if (value.schema !== DISTRIBUTED_LOCAL_STATE_ROOT_IDENTITY_SCHEMA)
    throw new Error('Unsupported distributed local state root identity schema');
  if (!['controller', 'worker'].includes(value.role))
    throw new Error('Distributed local state root role is unsupported');
  const platform = identifier(value.platform, 'state root platform');
  const rootObjectFingerprint = normalizeRootObjectFingerprint(
    value.rootObjectFingerprint,
    platform
  );
  const identity = {
    schema: DISTRIBUTED_LOCAL_STATE_ROOT_IDENTITY_SCHEMA,
    role: value.role,
    controllerId: identifier(value.controllerId, 'state root controller ID'),
    workerId:
      value.workerId === null
        ? null
        : identifier(value.workerId, 'state root worker ID'),
    machineIdentitySha256: digest(
      value.machineIdentitySha256,
      'state root machine identity hash'
    ),
    platform,
    canonicalRoot: normalizeCanonicalRoot(value.canonicalRoot, platform),
    rootObjectFingerprint,
  };
  if (
    (identity.role === 'controller' && identity.workerId !== null) ||
    (identity.role === 'worker' && identity.workerId === null)
  )
    throw new Error(
      'Distributed local state root identity does not match its role'
    );
  return identity;
}

function sealLocalityAttestation(rootIdentitySha256, value) {
  exactKeys(value, LOCALITY_ACCEPTANCE_KEYS, 'distributed locality acceptance');
  if (value.status !== 'operator-attested-local')
    throw new Error(
      'Physical locality requires explicit operator-attested-local acceptance'
    );
  const attestation = {
    schema: DISTRIBUTED_LOCALITY_ATTESTATION_SCHEMA,
    rootIdentitySha256,
    evidenceBasis: DISTRIBUTED_PHYSICAL_LOCALITY_EVIDENCE,
    status: value.status,
    acceptedAtMs: integer(value.acceptedAtMs, 'Locality acceptance time'),
    acceptanceId: identifier(value.acceptanceId, 'locality acceptance ID'),
  };
  return deepFreeze({
    ...attestation,
    attestationSha256: canonicalJsonSha256(attestation),
  });
}

function normalizeLocalityAttestation(value, rootIdentitySha256) {
  exactKeys(
    value,
    LOCALITY_ATTESTATION_KEYS,
    'sealed distributed locality attestation'
  );
  if (
    value.schema !== DISTRIBUTED_LOCALITY_ATTESTATION_SCHEMA ||
    value.rootIdentitySha256 !== rootIdentitySha256 ||
    value.evidenceBasis !== DISTRIBUTED_PHYSICAL_LOCALITY_EVIDENCE ||
    value.status !== 'operator-attested-local'
  )
    throw new Error(
      'Distributed locality attestation is not bound to its root'
    );
  const sealed = sealLocalityAttestation(rootIdentitySha256, {
    status: value.status,
    acceptedAtMs: value.acceptedAtMs,
    acceptanceId: value.acceptanceId,
  });
  if (value.attestationSha256 !== sealed.attestationSha256)
    throw new Error('Distributed locality attestation seal does not match');
  return sealed;
}

function sealRecoveryPolicy(rootIdentitySha256, value) {
  exactKeys(value, RECOVERY_ACCEPTANCE_KEYS, 'distributed recovery acceptance');
  if (value.crashRecoveryAccepted !== true)
    throw new Error('Distributed crash recovery requires explicit acceptance');
  if (typeof value.allowStaleWriterTakeover !== 'boolean')
    throw new Error('Stale-writer takeover policy must be boolean');
  const policy = {
    schema: DISTRIBUTED_STATE_RECOVERY_POLICY_SCHEMA,
    rootIdentitySha256,
    staleWriterAfterMs: integer(
      value.staleWriterAfterMs,
      'Stale-writer interval',
      { minimum: 1 }
    ),
    allowStaleWriterTakeover: value.allowStaleWriterTakeover,
    crashRecoveryAccepted: true,
    acceptedAtMs: integer(value.acceptedAtMs, 'Recovery acceptance time'),
    acceptanceId: identifier(value.acceptanceId, 'recovery acceptance ID'),
  };
  return deepFreeze({
    ...policy,
    recoveryPolicySha256: canonicalJsonSha256(policy),
  });
}

function normalizeRecoveryPolicy(value, rootIdentitySha256) {
  exactKeys(value, RECOVERY_POLICY_KEYS, 'sealed distributed recovery policy');
  if (
    value.schema !== DISTRIBUTED_STATE_RECOVERY_POLICY_SCHEMA ||
    value.rootIdentitySha256 !== rootIdentitySha256
  )
    throw new Error('Distributed recovery policy is not bound to its root');
  const sealed = sealRecoveryPolicy(rootIdentitySha256, {
    staleWriterAfterMs: value.staleWriterAfterMs,
    allowStaleWriterTakeover: value.allowStaleWriterTakeover,
    crashRecoveryAccepted: value.crashRecoveryAccepted,
    acceptedAtMs: value.acceptedAtMs,
    acceptanceId: value.acceptanceId,
  });
  if (value.recoveryPolicySha256 !== sealed.recoveryPolicySha256)
    throw new Error('Distributed recovery policy seal does not match');
  return sealed;
}

function normalizeConfig(value) {
  exactKeys(value, CONFIG_KEYS, 'sealed distributed local state root config');
  if (value.schema !== DISTRIBUTED_LOCAL_STATE_ROOT_CONFIG_SCHEMA)
    throw new Error('Unsupported distributed local state root config schema');
  const identity = normalizeIdentity(identityProjection(value));
  const rootIdentitySha256 = canonicalJsonSha256(identity);
  if (value.rootIdentitySha256 !== rootIdentitySha256)
    throw new Error(
      'Distributed local state root identity hash does not match'
    );
  const localityAttestation = normalizeLocalityAttestation(
    value.localityAttestation,
    rootIdentitySha256
  );
  const recoveryPolicy = normalizeRecoveryPolicy(
    value.recoveryPolicy,
    rootIdentitySha256
  );
  if (value.recoveryPolicySha256 !== recoveryPolicy.recoveryPolicySha256)
    throw new Error('Distributed recovery policy hash drifted');
  const config = {
    schema: DISTRIBUTED_LOCAL_STATE_ROOT_CONFIG_SCHEMA,
    role: identity.role,
    controllerId: identity.controllerId,
    workerId: identity.workerId,
    machineIdentitySha256: identity.machineIdentitySha256,
    platform: identity.platform,
    canonicalRoot: identity.canonicalRoot,
    rootObjectFingerprint: identity.rootObjectFingerprint,
    rootIdentitySha256,
    localityAttestation,
    recoveryPolicy,
    recoveryPolicySha256: recoveryPolicy.recoveryPolicySha256,
  };
  const sealed = deepFreeze({
    ...config,
    configSha256: canonicalJsonSha256(config),
  });
  if (value.configSha256 !== sealed.configSha256)
    throw new Error('Distributed local state root config seal does not match');
  return sealed;
}

function assertConfigExpectations(config, expectations) {
  rejectUnknownKeys(
    expectations,
    CONFIG_EXPECTATION_KEYS,
    'distributed local state root expectations'
  );
  const comparisons = [
    [
      'expectedConfigSha256',
      config.configSha256,
      digest,
      'expected state root config hash',
    ],
    [
      'expectedControllerId',
      config.controllerId,
      identifier,
      'expected state root controller ID',
    ],
    [
      'expectedMachineIdentitySha256',
      config.machineIdentitySha256,
      digest,
      'expected state root machine identity hash',
    ],
    [
      'expectedPlatform',
      config.platform,
      identifier,
      'expected state root platform',
    ],
    [
      'expectedRecoveryPolicySha256',
      config.recoveryPolicySha256,
      digest,
      'expected recovery policy hash',
    ],
    [
      'expectedRootIdentitySha256',
      config.rootIdentitySha256,
      digest,
      'expected state root identity hash',
    ],
  ];
  for (const [key, actual, normalize, label] of comparisons) {
    if (
      expectations[key] !== undefined &&
      normalize(expectations[key], label) !== actual
    )
      throw new Error(`${label} does not match`);
  }
  if (
    expectations.expectedRole !== undefined &&
    (!['controller', 'worker'].includes(expectations.expectedRole) ||
      expectations.expectedRole !== config.role)
  )
    throw new Error('Expected state root role does not match');
  if (expectations.expectedWorkerId !== undefined) {
    const expectedWorkerId =
      expectations.expectedWorkerId === null
        ? null
        : identifier(
            expectations.expectedWorkerId,
            'expected state root worker ID'
          );
    if (expectedWorkerId !== config.workerId)
      throw new Error('Expected state root worker ID does not match');
  }
}

export function createDistributedLocalStateRootConfig(value) {
  exactKeys(
    value,
    CONFIG_INPUT_KEYS,
    'distributed local state root config input'
  );
  const platform = identifier(value.platform, 'state root platform');
  if (platform !== process.platform)
    throw new Error('Local state root platform does not match this machine');
  const canonicalRoot = normalizeCanonicalRoot(value.canonicalRoot, platform);
  const rootObjectFingerprint = readVerifiedLocalRootObject(
    canonicalRoot,
    'Distributed local state root'
  );
  const identity = normalizeIdentity({
    schema: DISTRIBUTED_LOCAL_STATE_ROOT_IDENTITY_SCHEMA,
    role: value.role,
    controllerId: value.controllerId,
    workerId: value.workerId,
    machineIdentitySha256: value.machineIdentitySha256,
    platform,
    canonicalRoot,
    rootObjectFingerprint,
  });
  const rootIdentitySha256 = canonicalJsonSha256(identity);
  const localityAttestation = sealLocalityAttestation(
    rootIdentitySha256,
    value.localityAcceptance
  );
  const recoveryPolicy = sealRecoveryPolicy(
    rootIdentitySha256,
    value.recoveryAcceptance
  );
  const config = {
    schema: DISTRIBUTED_LOCAL_STATE_ROOT_CONFIG_SCHEMA,
    role: identity.role,
    controllerId: identity.controllerId,
    workerId: identity.workerId,
    machineIdentitySha256: identity.machineIdentitySha256,
    platform: identity.platform,
    canonicalRoot: identity.canonicalRoot,
    rootObjectFingerprint: identity.rootObjectFingerprint,
    rootIdentitySha256,
    localityAttestation,
    recoveryPolicy,
    recoveryPolicySha256: recoveryPolicy.recoveryPolicySha256,
  };
  return deepFreeze({
    ...config,
    configSha256: canonicalJsonSha256(config),
  });
}

export function verifyDistributedLocalStateRootConfig(
  value,
  expectations = {}
) {
  const config = normalizeConfig(value);
  assertConfigExpectations(config, expectations);
  return config;
}

export function createDistributedLocalStateRootMarker(value) {
  exactKeys(
    value,
    ['config', 'createdAtMs'],
    'distributed local state root marker input'
  );
  const verifiedConfig = verifyDistributedLocalStateRootConfig(value.config);
  const created = integer(value.createdAtMs, 'State root marker creation time');
  if (
    created < verifiedConfig.localityAttestation.acceptedAtMs ||
    created < verifiedConfig.recoveryPolicy.acceptedAtMs
  )
    throw new Error('State root marker predates its required acceptances');
  const marker = {
    schema: DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_SCHEMA,
    rootIdentitySha256: verifiedConfig.rootIdentitySha256,
    configSha256: verifiedConfig.configSha256,
    physicalLocalityEvidence: DISTRIBUTED_PHYSICAL_LOCALITY_EVIDENCE,
    createdAtMs: created,
    config: verifiedConfig,
  };
  return deepFreeze({
    ...marker,
    markerSha256: canonicalJsonSha256(marker),
  });
}

export function verifyDistributedLocalStateRootMarker(
  value,
  expectations = {}
) {
  exactKeys(value, MARKER_KEYS, 'sealed distributed local state root marker');
  rejectUnknownKeys(
    expectations,
    MARKER_EXPECTATION_KEYS,
    'distributed local state root marker expectations'
  );
  if (value.schema !== DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_SCHEMA)
    throw new Error('Unsupported distributed local state root marker schema');
  const config = verifyDistributedLocalStateRootConfig(value.config);
  const createdAtMs = integer(
    value.createdAtMs,
    'State root marker creation time'
  );
  if (
    value.rootIdentitySha256 !== config.rootIdentitySha256 ||
    value.configSha256 !== config.configSha256 ||
    value.physicalLocalityEvidence !== DISTRIBUTED_PHYSICAL_LOCALITY_EVIDENCE
  )
    throw new Error(
      'Distributed local state root marker drifted from its config'
    );
  if (
    createdAtMs < config.localityAttestation.acceptedAtMs ||
    createdAtMs < config.recoveryPolicy.acceptedAtMs
  )
    throw new Error('State root marker predates its required acceptances');
  const marker = {
    schema: DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_SCHEMA,
    rootIdentitySha256: config.rootIdentitySha256,
    configSha256: config.configSha256,
    physicalLocalityEvidence: DISTRIBUTED_PHYSICAL_LOCALITY_EVIDENCE,
    createdAtMs,
    config,
  };
  const sealed = deepFreeze({
    ...marker,
    markerSha256: canonicalJsonSha256(marker),
  });
  if (value.markerSha256 !== sealed.markerSha256)
    throw new Error('Distributed local state root marker seal does not match');
  if (
    expectations.expectedMarkerSha256 !== undefined &&
    digest(
      expectations.expectedMarkerSha256,
      'expected state root marker hash'
    ) !== sealed.markerSha256
  )
    throw new Error('Expected state root marker hash does not match');
  if (expectations.expectedConfig !== undefined) {
    const expected = verifyDistributedLocalStateRootConfig(
      expectations.expectedConfig
    );
    if (expected.configSha256 !== sealed.configSha256)
      throw new Error('State root marker contains another config');
  }
  return sealed;
}

export function deriveDistributedLocalStateRootPaths(configValue) {
  const config = verifyDistributedLocalStateRootConfig(configValue, {
    expectedPlatform: process.platform,
  });
  const root = config.canonicalRoot;
  verifyLocalRootObjectBinding(config);
  const stateDirectory = assertContained(
    root,
    join(root, 'state'),
    'Distributed state directory'
  );
  const mailboxDirectory = assertContained(
    root,
    join(root, 'mailbox'),
    'Distributed mailbox directory'
  );
  const blobDirectory = assertContained(
    root,
    join(root, 'blobs'),
    'Distributed blob directory'
  );
  const stagingDirectory = assertContained(
    root,
    join(root, 'staging'),
    'Distributed staging directory'
  );
  const markerPath = assertContained(
    root,
    join(root, DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_FILENAME),
    'Distributed state root marker path'
  );
  const databasePath = assertContained(
    root,
    join(stateDirectory, 'distributed-state.sqlite3'),
    'Distributed state database path'
  );
  const paths = {
    root,
    markerPath,
    stateDirectory,
    databasePath,
    databaseJournalPath: `${databasePath}-journal`,
    databaseShmPath: `${databasePath}-shm`,
    databaseWalPath: `${databasePath}-wal`,
    mailboxDirectory,
    blobDirectory,
    stagingDirectory,
  };
  for (const [key, child] of Object.entries(paths)) {
    if (key !== 'root') assertContained(root, child, key);
  }
  for (const [path, label] of [
    [stateDirectory, 'Distributed state directory'],
    [mailboxDirectory, 'Distributed mailbox directory'],
    [blobDirectory, 'Distributed blob directory'],
    [stagingDirectory, 'Distributed staging directory'],
  ])
    verifyExistingDirectory(path, label);
  for (const [path, label] of [
    [markerPath, 'Distributed state root marker'],
    [databasePath, 'Distributed state database'],
    [paths.databaseJournalPath, 'Distributed state journal sidecar'],
    [paths.databaseShmPath, 'Distributed state shared-memory sidecar'],
    [paths.databaseWalPath, 'Distributed state WAL sidecar'],
  ])
    verifyExistingFile(path, label);
  return deepFreeze(paths);
}

export function verifyDistributedLocalStateRootAdmission(value) {
  exactKeys(
    value,
    ['config', 'expectations', 'marker'],
    'distributed local state root admission'
  );
  exactKeys(
    value.expectations,
    CONFIG_EXPECTATION_FIELDS,
    'distributed local state root admission expectations'
  );
  const admissionExpectations = {};
  for (const key of CONFIG_EXPECTATION_FIELDS) {
    const expectation = value.expectations[key];
    if (expectation === undefined)
      throw new Error(
        `Distributed local state root admission expectation ${key} must be defined`
      );
    admissionExpectations[key] = expectation;
  }
  const config = verifyDistributedLocalStateRootConfig(
    value.config,
    admissionExpectations
  );
  const marker = verifyDistributedLocalStateRootMarker(value.marker, {
    expectedConfig: config,
  });
  const paths = deriveDistributedLocalStateRootPaths(config);
  let persistedMarker;
  try {
    persistedMarker = JSON.parse(
      readCheckedMarkerFile(paths.markerPath, config)
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error('Distributed local state root marker is not valid JSON', {
        cause: error,
      });
    throw error;
  }
  const admittedMarker = verifyDistributedLocalStateRootMarker(
    persistedMarker,
    {
      expectedConfig: config,
      expectedMarkerSha256: marker.markerSha256,
    }
  );
  return deepFreeze({
    config,
    marker: admittedMarker,
    paths,
    physicalLocalityEvidence: DISTRIBUTED_PHYSICAL_LOCALITY_EVIDENCE,
    recoveryPolicy: config.recoveryPolicy,
  });
}
