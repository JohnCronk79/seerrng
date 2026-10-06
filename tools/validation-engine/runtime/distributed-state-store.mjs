// Copyright (c) snapetech and SeerrNG contributors.
// Synchronous, fail-closed persistence for distributed validation state.
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, parse, resolve } from 'node:path';

import {
  describeBrokerLeaseStateTransition,
  rehydrateBrokerLeaseState,
  verifyBrokerLeaseState,
} from './broker-lease-state.mjs';
import {
  describeDistributedControllerQueueTransition,
  rehydrateDistributedControllerQueue,
  snapshotDistributedControllerQueue,
} from './distributed-controller-queue.mjs';
import {
  describeDistributedWorkerAttemptTransition,
  rehydrateDistributedWorkerAttemptState,
  snapshotDistributedWorkerAttemptState,
  verifyDistributedWorkerAttemptState,
} from './distributed-worker-attempt-state.mjs';
import { verifyDistributedLocalStateRootAdmission } from './distributed-local-state-root.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

export const DISTRIBUTED_STATE_STORE_SCHEMA_VERSION = 2;
export const DISTRIBUTED_STATE_ENTRY_SCHEMA =
  'seerrng-distributed-state-entry/v1';
export const DISTRIBUTED_STATE_TRANSITION_RECORD_SCHEMA =
  'seerrng-distributed-state-transition-record/v1';
export const DISTRIBUTED_STATE_STORE_APPLICATION_ID = 0x534e4733;
export const DISTRIBUTED_STATE_STORE_PAGE_SIZE = 4_096;
export const DISTRIBUTED_STATE_STORE_MAX_PAGES = 1_048_576;
export const DISTRIBUTED_STATE_STORE_BUSY_TIMEOUT_MS = 5_000;
export const DISTRIBUTED_STATE_STORE_WAL_AUTOCHECKPOINT_PAGES = 1_000;
export const DISTRIBUTED_STATE_STORE_JOURNAL_SIZE_LIMIT_BYTES =
  64 * 1024 * 1024;
export const DISTRIBUTED_STATE_STORE_MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const DISTRIBUTED_STATE_STORE_MAX_QUEUE_BYTES = 16 * 1024 * 1024;
export const DISTRIBUTED_STATE_STORE_MAX_BROKER_BYTES = 256 * 1024 * 1024;
export const DISTRIBUTED_STATE_STORE_MAX_WORKER_ATTEMPT_BYTES =
  16 * 1024 * 1024;
export const DISTRIBUTED_STATE_STORE_MAX_TRANSITION_BYTES = 64 * 1024;

const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ZERO_SHA256 = '0'.repeat(64);
const SQLITE_SIDECAR_SUFFIXES = ['-journal', '-shm', '-wal'];
const require = createRequire(import.meta.url);
const STATE_STORE_CONSTRUCTION_TOKEN = Symbol('distributed-state-store');
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const SCHEMA_STATEMENTS = [
  `CREATE TABLE distributed_store_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_version INTEGER NOT NULL CHECK (schema_version = 2),
    schema_manifest_sha256 TEXT NOT NULL CHECK (
      length(schema_manifest_sha256) = 64 AND
      schema_manifest_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    store_id TEXT NOT NULL UNIQUE CHECK (length(store_id) BETWEEN 1 AND 128),
    owner_role TEXT NOT NULL CHECK (owner_role IN ('controller', 'worker')),
    owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 128),
    controller_id TEXT NOT NULL CHECK (length(controller_id) BETWEEN 1 AND 128),
    worker_id TEXT CHECK (
      worker_id IS NULL OR length(worker_id) BETWEEN 1 AND 128
    ),
    machine_identity_sha256 TEXT NOT NULL CHECK (
      length(machine_identity_sha256) = 64 AND
      machine_identity_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    root_identity_sha256 TEXT NOT NULL CHECK (
      length(root_identity_sha256) = 64 AND
      root_identity_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    root_config_sha256 TEXT NOT NULL CHECK (
      length(root_config_sha256) = 64 AND
      root_config_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    root_marker_sha256 TEXT NOT NULL CHECK (
      length(root_marker_sha256) = 64 AND
      root_marker_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    root_object_fingerprint_sha256 TEXT NOT NULL CHECK (
      length(root_object_fingerprint_sha256) = 64 AND
      root_object_fingerprint_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    recovery_policy_sha256 TEXT NOT NULL CHECK (
      length(recovery_policy_sha256) = 64 AND
      recovery_policy_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    engine_version TEXT NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 128),
    canonical_hash_schema TEXT NOT NULL CHECK (
      canonical_hash_schema = 'seerrng-canonical-json-sha256/v1'
    ),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    CHECK (
      (owner_role = 'controller' AND owner_id = controller_id AND
        worker_id IS NULL) OR
      (owner_role = 'worker' AND worker_id IS NOT NULL AND owner_id = worker_id)
    )
  ) STRICT`,
  `CREATE TABLE distributed_schema_migration (
    version INTEGER PRIMARY KEY CHECK (version >= 1),
    migration_sha256 TEXT NOT NULL UNIQUE CHECK (
      length(migration_sha256) = 64 AND
      migration_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms >= 0)
  ) STRICT`,
  `CREATE TABLE distributed_writer_fence (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    epoch INTEGER NOT NULL CHECK (epoch >= 0),
    owner_token TEXT,
    process_id INTEGER,
    process_started_at_ms INTEGER,
    acquired_at_ms INTEGER,
    heartbeat_at_ms INTEGER,
    CHECK (
      (owner_token IS NULL AND process_id IS NULL AND process_started_at_ms IS NULL AND
        acquired_at_ms IS NULL AND heartbeat_at_ms IS NULL) OR
      (owner_token IS NOT NULL AND length(owner_token) BETWEEN 1 AND 128 AND
        process_id IS NOT NULL AND process_id >= 0 AND
        process_started_at_ms IS NOT NULL AND process_started_at_ms >= 0 AND
        acquired_at_ms IS NOT NULL AND acquired_at_ms >= 0 AND
        heartbeat_at_ms IS NOT NULL AND heartbeat_at_ms >= acquired_at_ms)
    )
  ) STRICT`,
  `CREATE TABLE distributed_sealed_document (
    document_kind TEXT NOT NULL CHECK (length(document_kind) BETWEEN 1 AND 128),
    contract_sha256 TEXT NOT NULL CHECK (
      length(contract_sha256) = 64 AND contract_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    document_schema TEXT NOT NULL CHECK (length(document_schema) BETWEEN 1 AND 256),
    content_sha256 TEXT NOT NULL CHECK (
      length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    document_bytes INTEGER NOT NULL CHECK (
      document_bytes >= 1 AND document_bytes <= 33554432
    ),
    document_json TEXT NOT NULL CHECK (
      json_valid(document_json) AND
      length(CAST(document_json AS BLOB)) = document_bytes
    ),
    created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
    PRIMARY KEY (document_kind, contract_sha256),
    UNIQUE (document_kind, content_sha256)
  ) STRICT`,
  `CREATE TABLE distributed_state_history (
    stream_kind TEXT NOT NULL CHECK (
      stream_kind IN ('queue', 'broker', 'worker-attempt')
    ),
    stream_id TEXT NOT NULL CHECK (length(stream_id) BETWEEN 1 AND 128),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    entry_schema TEXT NOT NULL CHECK (
      entry_schema = 'seerrng-distributed-state-entry/v1'
    ),
    previous_entry_sha256 TEXT NOT NULL CHECK (
      length(previous_entry_sha256) = 64 AND
      previous_entry_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    previous_snapshot_contract_sha256 TEXT NOT NULL CHECK (
      length(previous_snapshot_contract_sha256) = 64 AND
      previous_snapshot_contract_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    snapshot_schema TEXT NOT NULL CHECK (length(snapshot_schema) BETWEEN 1 AND 256),
    snapshot_contract_sha256 TEXT NOT NULL CHECK (
      length(snapshot_contract_sha256) = 64 AND
      snapshot_contract_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    snapshot_content_sha256 TEXT NOT NULL CHECK (
      length(snapshot_content_sha256) = 64 AND
      snapshot_content_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    snapshot_bytes INTEGER NOT NULL CHECK (snapshot_bytes >= 1),
    transition_kind TEXT NOT NULL CHECK (length(transition_kind) BETWEEN 1 AND 128),
    transition_input_sha256 TEXT NOT NULL CHECK (
      length(transition_input_sha256) = 64 AND
      transition_input_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    transition_record_sha256 TEXT NOT NULL CHECK (
      length(transition_record_sha256) = 64 AND
      transition_record_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    transition_record_json TEXT NOT NULL CHECK (
      json_valid(transition_record_json) AND
      length(CAST(transition_record_json AS BLOB)) <= 65536
    ),
    occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms >= 0),
    writer_epoch INTEGER NOT NULL CHECK (writer_epoch >= 1),
    entry_sha256 TEXT NOT NULL UNIQUE CHECK (
      length(entry_sha256) = 64 AND entry_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    PRIMARY KEY (stream_kind, stream_id, revision)
  ) STRICT`,
  `CREATE TABLE distributed_state_head (
    stream_kind TEXT NOT NULL CHECK (
      stream_kind IN ('queue', 'broker', 'worker-attempt')
    ),
    stream_id TEXT NOT NULL CHECK (length(stream_id) BETWEEN 1 AND 128),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    head_entry_sha256 TEXT NOT NULL UNIQUE CHECK (
      length(head_entry_sha256) = 64 AND head_entry_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    snapshot_schema TEXT NOT NULL CHECK (length(snapshot_schema) BETWEEN 1 AND 256),
    snapshot_contract_sha256 TEXT NOT NULL CHECK (
      length(snapshot_contract_sha256) = 64 AND
      snapshot_contract_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    snapshot_content_sha256 TEXT NOT NULL CHECK (
      length(snapshot_content_sha256) = 64 AND
      snapshot_content_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    snapshot_bytes INTEGER NOT NULL CHECK (snapshot_bytes >= 1),
    snapshot_json TEXT NOT NULL CHECK (
      json_valid(snapshot_json) AND
      length(CAST(snapshot_json AS BLOB)) = snapshot_bytes
    ),
    occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms >= 0),
    writer_epoch INTEGER NOT NULL CHECK (writer_epoch >= 1),
    PRIMARY KEY (stream_kind, stream_id),
    FOREIGN KEY (stream_kind, stream_id, revision)
      REFERENCES distributed_state_history (stream_kind, stream_id, revision)
  ) STRICT`,
  `CREATE TRIGGER distributed_store_metadata_no_update
    BEFORE UPDATE ON distributed_store_metadata
    BEGIN SELECT RAISE(ABORT, 'distributed store metadata is immutable'); END`,
  `CREATE TRIGGER distributed_store_metadata_no_delete
    BEFORE DELETE ON distributed_store_metadata
    BEGIN SELECT RAISE(ABORT, 'distributed store metadata is immutable'); END`,
  `CREATE TRIGGER distributed_schema_migration_no_update
    BEFORE UPDATE ON distributed_schema_migration
    BEGIN SELECT RAISE(ABORT, 'distributed schema history is immutable'); END`,
  `CREATE TRIGGER distributed_schema_migration_no_delete
    BEFORE DELETE ON distributed_schema_migration
    BEGIN SELECT RAISE(ABORT, 'distributed schema history is immutable'); END`,
  `CREATE TRIGGER distributed_sealed_document_no_update
    BEFORE UPDATE ON distributed_sealed_document
    BEGIN SELECT RAISE(ABORT, 'distributed sealed documents are immutable'); END`,
  `CREATE TRIGGER distributed_sealed_document_no_delete
    BEFORE DELETE ON distributed_sealed_document
    BEGIN SELECT RAISE(ABORT, 'distributed sealed documents are immutable'); END`,
  `CREATE TRIGGER distributed_state_history_no_update
    BEFORE UPDATE ON distributed_state_history
    BEGIN SELECT RAISE(ABORT, 'distributed state history is immutable'); END`,
  `CREATE TRIGGER distributed_state_history_no_delete
    BEFORE DELETE ON distributed_state_history
    BEGIN SELECT RAISE(ABORT, 'distributed state history is immutable'); END`,
];

function normalizeSchemaSql(value) {
  return value.replace(/\s+/g, ' ').trim().replace(/;$/, '');
}

const EXPECTED_SCHEMA_OBJECTS = SCHEMA_STATEMENTS.map((statement) => {
  const match = /^CREATE (TABLE|TRIGGER) ([A-Za-z0-9_]+)/.exec(statement);
  if (!match) throw new Error('Distributed state schema statement is invalid');
  const type = match[1].toLowerCase();
  const tableMatch = /\sON ([A-Za-z0-9_]+)\s/.exec(statement);
  return {
    type,
    name: match[2],
    tableName: type === 'table' ? match[2] : tableMatch?.[1],
    sql: normalizeSchemaSql(statement),
  };
})
  .concat(
    [
      [
        'sqlite_autoindex_distributed_schema_migration_1',
        'distributed_schema_migration',
      ],
      [
        'sqlite_autoindex_distributed_sealed_document_1',
        'distributed_sealed_document',
      ],
      [
        'sqlite_autoindex_distributed_sealed_document_2',
        'distributed_sealed_document',
      ],
      ['sqlite_autoindex_distributed_state_head_1', 'distributed_state_head'],
      ['sqlite_autoindex_distributed_state_head_2', 'distributed_state_head'],
      [
        'sqlite_autoindex_distributed_state_history_1',
        'distributed_state_history',
      ],
      [
        'sqlite_autoindex_distributed_state_history_2',
        'distributed_state_history',
      ],
      [
        'sqlite_autoindex_distributed_store_metadata_1',
        'distributed_store_metadata',
      ],
    ].map(([name, tableName]) => ({
      type: 'index',
      name,
      tableName,
      sql: null,
    }))
  )
  .toSorted((left, right) =>
    left.type === right.type
      ? compareText(left.name, right.name)
      : compareText(left.type, right.type)
  );

export const DISTRIBUTED_STATE_STORE_SCHEMA_MANIFEST_SHA256 =
  canonicalJsonSha256({
    schema: 'seerrng-distributed-state-store-schema-manifest/v2',
    version: DISTRIBUTED_STATE_STORE_SCHEMA_VERSION,
    statements: SCHEMA_STATEMENTS,
  });

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
  const expected = [...expectedKeys].toSorted();
  const sorted = actual.toSorted();
  if (
    sorted.length !== expected.length ||
    sorted.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function rejectUnknownKeys(value, allowedKeys, label) {
  plainObject(value, label);
  const allowed = new Set(allowedKeys);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key))
      throw new Error(`${label} contains an unsupported field: ${String(key)}`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`Exact ${label} is required`);
  return value;
}

function exactText(value, label, maximum = 256) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    value.normalize('NFC') !== value ||
    // eslint-disable-next-line no-control-regex -- Persisted identities cross hosts.
    /[\x00-\x1f\x7f]/.test(value)
  )
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

function localWallClockNowMs(previousAtMs = 0) {
  integer(previousAtMs, 'Previous local writer heartbeat time');
  const observedAtMs = integer(Date.now(), 'Local wall-clock time');
  return Math.max(previousAtMs, observedAtMs);
}

function sha256Bytes(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function serializeJson(value, label, maximumBytes) {
  canonicalJsonSha256(value);
  const json = JSON.stringify(value);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes < 1 || bytes > maximumBytes)
    throw new Error(`${label} exceeds its persisted byte limit`);
  return { json, bytes, contentSha256: sha256Bytes(json) };
}

function parseStoredJson(
  json,
  expectedBytes,
  expectedSha256,
  label,
  maximumBytes
) {
  if (typeof json !== 'string') throw new Error(`${label} is not text`);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes !== expectedBytes || bytes < 1 || bytes > maximumBytes)
    throw new Error(`${label} byte count does not match`);
  if (sha256Bytes(json) !== expectedSha256)
    throw new Error(`${label} content hash does not match`);
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  canonicalJsonSha256(value);
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

function verifyCanonicalComponents(value, { leafKind }) {
  const root = parse(value).root;
  const segments = value
    .slice(root.length)
    .split(process.platform === 'win32' ? /[\\/]/ : /[/]/)
    .filter(Boolean);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    if (!existsSync(current)) break;
    const statistics = lstatSync(current);
    if (statistics.isSymbolicLink())
      throw new Error(
        'Distributed state database path must not traverse a symbolic-link or reparse-point alias'
      );
    const isLeaf = index === segments.length - 1;
    if ((!isLeaf || leafKind === 'directory') && !statistics.isDirectory())
      throw new Error(
        'Distributed state database parent path is not an ordinary directory'
      );
    if (isLeaf && leafKind === 'file' && !statistics.isFile())
      throw new Error('Distributed state database path is not a regular file');
    if (pathIdentity(realpathSync.native(current)) !== pathIdentity(current))
      throw new Error(
        'Distributed state database path must not traverse a reparse or canonical-path alias'
      );
  }
}

function decimalBigInt(value, label, { nonzero = false } = {}) {
  if (
    typeof value !== 'bigint' ||
    value < 0n ||
    (nonzero && value === 0n)
  )
    throw new Error(`${label} has no stable filesystem identity`);
  return value.toString(10);
}

function verifyOrdinaryFileIfPresent(value, label, expectedDeviceId) {
  if (!existsSync(value)) return false;
  const statistics = lstatSync(value, { bigint: true });
  if (
    statistics.isSymbolicLink() ||
    !statistics.isFile() ||
    statistics.nlink !== 1n
  )
    throw new Error(
      `${label} must be a regular non-symbolic file with exactly one filesystem link`
    );
  verifyCanonicalComponents(value, { leafKind: 'file' });
  const deviceId = decimalBigInt(statistics.dev, `${label} device`);
  if (expectedDeviceId !== undefined && deviceId !== expectedDeviceId)
    throw new Error(`${label} must be on the admitted root filesystem`);
  if (process.platform !== 'win32' && (statistics.mode & 0o022n) !== 0n)
    throw new Error(`${label} must not be group- or world-writable`);
  return {
    deviceId,
    inodeId: decimalBigInt(statistics.ino, `${label} inode`, {
      nonzero: true,
    }),
  };
}

function verifyDatabaseFilesystem(
  databasePath,
  { expectedDeviceId, fileMustExist, sidecarsMustBeAbsent = false }
) {
  // Physical locality (for example, mapped or mounted network storage) is an
  // integration/deployment precondition that portable Node path APIs cannot prove.
  verifyCanonicalComponents(dirname(databasePath), {
    leafKind: 'directory',
  });
  const databaseExists = verifyOrdinaryFileIfPresent(
    databasePath,
    'Distributed state database',
    expectedDeviceId
  );
  if (fileMustExist && !databaseExists)
    throw new Error('Distributed state store file is missing');
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const sidecarPath = `${databasePath}${suffix}`;
    const sidecarExists = verifyOrdinaryFileIfPresent(
      sidecarPath,
      `Distributed state SQLite ${suffix.slice(1)} sidecar`,
      expectedDeviceId
    );
    if (sidecarsMustBeAbsent && sidecarExists)
      throw new Error(
        'New distributed state database must not have pre-existing SQLite sidecars'
      );
  }
  return databaseExists;
}

function stateDirectoryIdentity(path, expectedDeviceId) {
  let before;
  try {
    before = lstatSync(path, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT')
      throw new Error('Distributed state directory is missing');
    throw error;
  }
  if (before.isSymbolicLink() || !before.isDirectory())
    throw new Error(
      'Distributed state directory must be an ordinary non-symbolic directory'
    );
  verifyCanonicalComponents(path, { leafKind: 'directory' });
  if (realpathSync.native(path) !== path)
    throw new Error(
      'Distributed state directory must use its exact native canonical spelling'
    );
  const after = lstatSync(path, { bigint: true });
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode
  )
    throw new Error(
      'Distributed state directory changed during filesystem identity verification'
    );
  const deviceId = decimalBigInt(after.dev, 'Distributed state directory device');
  if (deviceId !== expectedDeviceId)
    throw new Error(
      'Distributed state directory must be on the admitted root filesystem'
    );
  if (process.platform !== 'win32' && (after.mode & 0o022n) !== 0n)
    throw new Error(
      'Distributed state directory must not be group- or world-writable'
    );
  return deepFreeze({
    deviceId,
    inodeId: decimalBigInt(after.ino, 'Distributed state directory inode', {
      nonzero: true,
    }),
    mode: decimalBigInt(after.mode, 'Distributed state directory mode'),
  });
}

function sameFilesystemIdentity(left, right) {
  return canonicalJsonSha256(left) === canonicalJsonSha256(right);
}

function normalizeOwner(value) {
  exactKeys(
    value,
    ['controllerId', 'machineIdentitySha256', 'ownerId', 'role', 'workerId'],
    'distributed state store owner'
  );
  if (!['controller', 'worker'].includes(value.role))
    throw new Error('Distributed state store owner role is unsupported');
  const owner = {
    role: value.role,
    ownerId: identifier(value.ownerId, 'state store owner ID'),
    controllerId:
      value.controllerId === null
        ? null
        : identifier(value.controllerId, 'state store controller ID'),
    workerId:
      value.workerId === null
        ? null
        : identifier(value.workerId, 'state store worker ID'),
    machineIdentitySha256: digest(
      value.machineIdentitySha256,
      'state store machine identity hash'
    ),
  };
  if (
    (owner.role === 'controller' &&
      (owner.controllerId === null ||
        owner.workerId !== null ||
        owner.ownerId !== owner.controllerId)) ||
    (owner.role === 'worker' &&
      (owner.workerId === null ||
        owner.controllerId === null ||
        owner.ownerId !== owner.workerId))
  )
    throw new Error(
      'Distributed state store owner fields do not match its role'
    );
  return owner;
}

function rootBindingFromAdmission(admission) {
  return deepFreeze({
    rootIdentitySha256: digest(
      admission.config.rootIdentitySha256,
      'state root identity hash'
    ),
    rootConfigSha256: digest(
      admission.config.configSha256,
      'state root config hash'
    ),
    rootMarkerSha256: digest(
      admission.marker.markerSha256,
      'state root marker hash'
    ),
    rootObjectFingerprintSha256: canonicalJsonSha256(
      admission.config.rootObjectFingerprint
    ),
    recoveryPolicySha256: digest(
      admission.config.recoveryPolicySha256,
      'state root recovery policy hash'
    ),
  });
}

function ownerFromAdmission(admission) {
  const { config } = admission;
  return normalizeOwner({
    role: config.role,
    ownerId:
      config.role === 'controller' ? config.controllerId : config.workerId,
    controllerId: config.controllerId,
    workerId: config.workerId,
    machineIdentitySha256: config.machineIdentitySha256,
  });
}

function createStateRootContext({ config, expectations, marker }) {
  const frozenExpectations = deepFreeze(structuredClone(expectations));
  const admission = verifyDistributedLocalStateRootAdmission({
    config,
    marker,
    expectations: frozenExpectations,
  });
  return {
    config: admission.config,
    marker: admission.marker,
    expectations: frozenExpectations,
    paths: admission.paths,
    owner: ownerFromAdmission(admission),
    rootBinding: rootBindingFromAdmission(admission),
    recoveryPolicy: admission.recoveryPolicy,
  };
}

function readmitStateRoot(context) {
  const admission = verifyDistributedLocalStateRootAdmission({
    config: context.config,
    marker: context.marker,
    expectations: context.expectations,
  });
  const binding = rootBindingFromAdmission(admission);
  if (
    !sameFilesystemIdentity(binding, context.rootBinding) ||
    admission.paths.databasePath !== context.paths.databasePath ||
    admission.paths.stateDirectory !== context.paths.stateDirectory
  )
    throw new Error('Distributed state store root admission drifted');
  return admission;
}

function verifyBoundStateStoreFilesystem(
  context,
  {
    databaseMustExist,
    expectedDatabaseIdentity,
    expectedStateDirectoryIdentity,
    sidecarsMustBeAbsent = false,
  }
) {
  const admission = readmitStateRoot(context);
  const expectedDeviceId = admission.config.rootObjectFingerprint.deviceId;
  const directoryIdentityBefore = stateDirectoryIdentity(
    admission.paths.stateDirectory,
    expectedDeviceId
  );
  if (
    expectedStateDirectoryIdentity !== undefined &&
    !sameFilesystemIdentity(
      directoryIdentityBefore,
      expectedStateDirectoryIdentity
    )
  )
    throw new Error('Distributed state directory identity drifted');
  const databaseIdentity = verifyDatabaseFilesystem(
    admission.paths.databasePath,
    {
      expectedDeviceId,
      fileMustExist: databaseMustExist,
      sidecarsMustBeAbsent,
    }
  );
  if (
    expectedDatabaseIdentity !== undefined &&
    (!databaseIdentity ||
      !sameFilesystemIdentity(databaseIdentity, expectedDatabaseIdentity))
  )
    throw new Error('Distributed state database identity drifted');
  const directoryIdentity = stateDirectoryIdentity(
    admission.paths.stateDirectory,
    expectedDeviceId
  );
  if (!sameFilesystemIdentity(directoryIdentity, directoryIdentityBefore))
    throw new Error(
      'Distributed state directory changed during database filesystem verification'
    );
  if (
    expectedStateDirectoryIdentity !== undefined &&
    !sameFilesystemIdentity(directoryIdentity, expectedStateDirectoryIdentity)
  )
    throw new Error('Distributed state directory identity drifted');
  return { admission, databaseIdentity, directoryIdentity };
}

function reserveNewDatabaseFile(databasePath) {
  let descriptor;
  try {
    descriptor = openSync(databasePath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST')
      throw new Error('Distributed state store already exists', {
        cause: error,
      });
    throw error;
  }
  try {
    closeSync(descriptor);
  } catch (error) {
    throw new Error(
      'Distributed state store could not close its exclusive file reservation',
      { cause: error }
    );
  }
}

function closeDatabaseAfterFailure(database, failure) {
  try {
    database.close();
  } catch (closeError) {
    throw new AggregateError(
      [failure, closeError],
      failure instanceof Error
        ? failure.message
        : 'Distributed state store operation and cleanup both failed'
    );
  }
  throw failure;
}

function normalizeWriter(value) {
  exactKeys(
    value,
    ['processId', 'processStartedAtMs', 'token'],
    'distributed state store writer'
  );
  return {
    token: identifier(value.token, 'writer token'),
    processId: integer(value.processId, 'Writer process ID'),
    processStartedAtMs: integer(
      value.processStartedAtMs,
      'Writer process start time'
    ),
  };
}

function normalizeDocumentVerifierRegistry(value) {
  plainObject(value, 'sealed document verifier registry');
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string'))
    throw new Error('Sealed document verifier registry requires string kinds');
  const registry = new Map();
  for (const kind of keys.toSorted()) {
    identifier(kind, 'sealed document verifier kind');
    if (typeof value[kind] !== 'function')
      throw new Error(
        `Sealed document verifier registry requires a function for ${kind}`
      );
    registry.set(kind, value[kind]);
  }
  return registry;
}

function verifyDocumentWithRegistry(
  registry,
  { documentKind, contractSha256, value, expectedSchema, expectedJson }
) {
  const verifier = registry.get(documentKind);
  if (!verifier)
    throw new Error(
      `Sealed document kind has no registered verifier: ${documentKind}`
    );
  const verified = verifier(structuredClone(value), contractSha256);
  if (verified && typeof verified.then === 'function')
    throw new Error('Sealed document verifier must be synchronous');
  plainObject(verified, 'verified sealed document');
  const schema = exactText(verified.schema, 'sealed document schema');
  const serialized = serializeJson(
    verified,
    'Sealed document',
    DISTRIBUTED_STATE_STORE_MAX_DOCUMENT_BYTES
  );
  if (
    (expectedSchema !== undefined && schema !== expectedSchema) ||
    (expectedJson !== undefined && serialized.json !== expectedJson)
  )
    throw new Error(
      'Sealed document verifier output does not exactly match persisted content'
    );
  return { verified, schema, serialized };
}

function pragmaScalar(database, statement) {
  return database.pragma(statement, { simple: true });
}

function setAndRequirePragma(database, assignment, readName, expected) {
  database.pragma(assignment);
  const actual = pragmaScalar(database, readName);
  if (String(actual).toLowerCase() !== String(expected).toLowerCase())
    throw new Error(
      `SQLite pragma ${readName} did not retain its required value`
    );
}

function configureNewDatabase(database) {
  setAndRequirePragma(
    database,
    `page_size = ${DISTRIBUTED_STATE_STORE_PAGE_SIZE}`,
    'page_size',
    DISTRIBUTED_STATE_STORE_PAGE_SIZE
  );
  configureRuntimePragmas(database);
}

function requirePristineDatabase(database) {
  const schemaObjectCount = database
    .prepare(`SELECT COUNT(*) AS count FROM sqlite_schema`)
    .get().count;
  if (
    pragmaScalar(database, 'application_id') !== 0 ||
    pragmaScalar(database, 'user_version') !== 0 ||
    schemaObjectCount !== 0
  )
    throw new Error(
      'Distributed state initialization requires a new empty file'
    );
}

function configureRuntimePragmas(database) {
  setAndRequirePragma(database, 'journal_mode = WAL', 'journal_mode', 'wal');
  setAndRequirePragma(database, 'synchronous = FULL', 'synchronous', 2);
  setAndRequirePragma(database, 'foreign_keys = ON', 'foreign_keys', 1);
  setAndRequirePragma(database, 'trusted_schema = OFF', 'trusted_schema', 0);
  setAndRequirePragma(
    database,
    `busy_timeout = ${DISTRIBUTED_STATE_STORE_BUSY_TIMEOUT_MS}`,
    'busy_timeout',
    DISTRIBUTED_STATE_STORE_BUSY_TIMEOUT_MS
  );
  setAndRequirePragma(
    database,
    `wal_autocheckpoint = ${DISTRIBUTED_STATE_STORE_WAL_AUTOCHECKPOINT_PAGES}`,
    'wal_autocheckpoint',
    DISTRIBUTED_STATE_STORE_WAL_AUTOCHECKPOINT_PAGES
  );
  setAndRequirePragma(
    database,
    `journal_size_limit = ${DISTRIBUTED_STATE_STORE_JOURNAL_SIZE_LIMIT_BYTES}`,
    'journal_size_limit',
    DISTRIBUTED_STATE_STORE_JOURNAL_SIZE_LIMIT_BYTES
  );
  setAndRequirePragma(
    database,
    `max_page_count = ${DISTRIBUTED_STATE_STORE_MAX_PAGES}`,
    'max_page_count',
    DISTRIBUTED_STATE_STORE_MAX_PAGES
  );
}

function requireStoreHeader(database) {
  if (
    pragmaScalar(database, 'application_id') !==
    DISTRIBUTED_STATE_STORE_APPLICATION_ID
  )
    throw new Error('SQLite file is not a distributed state store');
  if (
    pragmaScalar(database, 'user_version') !==
    DISTRIBUTED_STATE_STORE_SCHEMA_VERSION
  )
    throw new Error('Distributed state store schema version is unsupported');
  if (pragmaScalar(database, 'page_size') !== DISTRIBUTED_STATE_STORE_PAGE_SIZE)
    throw new Error('Distributed state store page size is unsupported');
}

function verifySqliteIntegrity(database) {
  const integrity = database.pragma('integrity_check');
  if (
    !Array.isArray(integrity) ||
    integrity.length !== 1 ||
    Object.values(integrity[0] ?? {}).length !== 1 ||
    Object.values(integrity[0])[0] !== 'ok'
  )
    throw new Error('Distributed state store failed SQLite integrity_check');
  const foreignKeys = database.pragma('foreign_key_check');
  if (!Array.isArray(foreignKeys) || foreignKeys.length !== 0)
    throw new Error('Distributed state store failed SQLite foreign_key_check');
}

function verifySchemaObjects(database) {
  const rows = database
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       ORDER BY type, name`
    )
    .all()
    .map((row) => ({
      type: row.type,
      name: row.name,
      tableName: row.tbl_name,
      sql: row.sql === null ? null : normalizeSchemaSql(row.sql),
    }));
  if (
    canonicalJsonSha256(rows) !== canonicalJsonSha256(EXPECTED_SCHEMA_OBJECTS)
  )
    throw new Error('Distributed state store schema objects do not match v2');
}

function stateHeadFromRow(row) {
  if (!row) return null;
  return deepFreeze({
    streamKind: row.stream_kind,
    streamId: row.stream_id,
    revision: row.revision,
    headEntrySha256: row.head_entry_sha256,
    snapshotSchema: row.snapshot_schema,
    snapshotContractSha256: row.snapshot_contract_sha256,
    snapshotContentSha256: row.snapshot_content_sha256,
    snapshotBytes: row.snapshot_bytes,
    occurredAtMs: row.occurred_at_ms,
    writerEpoch: row.writer_epoch,
  });
}

function normalizeExpectedHead(value) {
  exactKeys(
    value,
    ['headEntrySha256', 'revision', 'snapshotContractSha256'],
    'expected distributed state head'
  );
  return {
    revision: integer(value.revision, 'Expected state revision'),
    headEntrySha256: digest(value.headEntrySha256, 'expected state entry hash'),
    snapshotContractSha256: digest(
      value.snapshotContractSha256,
      'expected snapshot contract hash'
    ),
  };
}

function normalizeTransitionTime(value) {
  exactKeys(value, ['occurredAtMs'], 'distributed state transition time');
  return integer(value.occurredAtMs, 'State transition time');
}

function normalizeLineageDescriptor(value) {
  exactKeys(
    value,
    ['inputSha256', 'kind', 'occurredAtMs'],
    'state-machine transition provenance'
  );
  if (!Object.isFrozen(value))
    throw new Error('State-machine transition provenance must be frozen');
  return {
    kind: identifier(value.kind, 'state transition kind'),
    inputSha256: digest(value.inputSha256, 'state transition input hash'),
    occurredAtMs:
      value.occurredAtMs === null
        ? null
        : integer(value.occurredAtMs, 'Authoritative state transition time'),
  };
}

function createPersistedTransition({
  streamKind,
  streamId,
  previousSnapshotContractSha256,
  snapshotContractSha256,
  lineage,
  occurredAtMs,
}) {
  const descriptor = normalizeLineageDescriptor(lineage);
  if (
    descriptor.occurredAtMs !== null &&
    descriptor.occurredAtMs !== occurredAtMs
  )
    throw new Error(
      'Persisted transition time does not match authoritative state-machine time'
    );
  const record = deepFreeze({
    schema: DISTRIBUTED_STATE_TRANSITION_RECORD_SCHEMA,
    streamKind,
    streamId,
    previousSnapshotContractSha256,
    snapshotContractSha256,
    kind: descriptor.kind,
    inputSha256: descriptor.inputSha256,
    occurredAtMs,
  });
  const serialized = serializeJson(
    record,
    'Distributed state transition record',
    DISTRIBUTED_STATE_STORE_MAX_TRANSITION_BYTES
  );
  return {
    kind: descriptor.kind,
    inputSha256: descriptor.inputSha256,
    occurredAtMs,
    record,
    recordJson: serialized.json,
    recordSha256: canonicalJsonSha256(record),
  };
}

export function createDistributedStateHistoryEntry(value) {
  exactKeys(
    value,
    [
      'occurredAtMs',
      'previousEntrySha256',
      'previousSnapshotContractSha256',
      'revision',
      'snapshotBytes',
      'snapshotContentSha256',
      'snapshotContractSha256',
      'snapshotSchema',
      'storeId',
      'streamId',
      'streamKind',
      'transitionInputSha256',
      'transitionKind',
      'transitionRecordSha256',
      'writerEpoch',
    ],
    'distributed state history entry input'
  );
  if (!['queue', 'broker', 'worker-attempt'].includes(value.streamKind))
    throw new Error('Distributed state stream kind is unsupported');
  const entry = {
    schema: DISTRIBUTED_STATE_ENTRY_SCHEMA,
    storeId: identifier(value.storeId, 'state store ID'),
    streamKind: value.streamKind,
    streamId: identifier(value.streamId, 'state stream ID'),
    revision: integer(value.revision, 'State revision'),
    previousEntrySha256: digest(
      value.previousEntrySha256,
      'previous state entry hash'
    ),
    previousSnapshotContractSha256: digest(
      value.previousSnapshotContractSha256,
      'previous snapshot contract hash'
    ),
    snapshotSchema: exactText(value.snapshotSchema, 'snapshot schema'),
    snapshotContractSha256: digest(
      value.snapshotContractSha256,
      'snapshot contract hash'
    ),
    snapshotContentSha256: digest(
      value.snapshotContentSha256,
      'snapshot content hash'
    ),
    snapshotBytes: integer(value.snapshotBytes, 'Snapshot byte count', {
      minimum: 1,
    }),
    transitionKind: identifier(value.transitionKind, 'state transition kind'),
    transitionInputSha256: digest(
      value.transitionInputSha256,
      'state transition input hash'
    ),
    transitionRecordSha256: digest(
      value.transitionRecordSha256,
      'state transition record hash'
    ),
    occurredAtMs: integer(value.occurredAtMs, 'State transition time'),
    writerEpoch: integer(value.writerEpoch, 'Writer epoch', { minimum: 1 }),
  };
  return deepFreeze({ ...entry, entrySha256: canonicalJsonSha256(entry) });
}

function historyEntryFromRow(row, storeId) {
  const record = parseStoredJson(
    row.transition_record_json,
    Buffer.byteLength(row.transition_record_json, 'utf8'),
    sha256Bytes(row.transition_record_json),
    'Persisted transition record',
    DISTRIBUTED_STATE_STORE_MAX_TRANSITION_BYTES
  );
  if (canonicalJsonSha256(record) !== row.transition_record_sha256)
    throw new Error('Persisted transition record hash does not match');
  exactKeys(
    record,
    [
      'inputSha256',
      'kind',
      'occurredAtMs',
      'previousSnapshotContractSha256',
      'schema',
      'snapshotContractSha256',
      'streamId',
      'streamKind',
    ],
    'persisted state transition record'
  );
  if (
    record.schema !== DISTRIBUTED_STATE_TRANSITION_RECORD_SCHEMA ||
    record.streamKind !== row.stream_kind ||
    record.streamId !== row.stream_id ||
    record.previousSnapshotContractSha256 !==
      row.previous_snapshot_contract_sha256 ||
    record.snapshotContractSha256 !== row.snapshot_contract_sha256 ||
    record.kind !== row.transition_kind ||
    record.inputSha256 !== row.transition_input_sha256 ||
    record.occurredAtMs !== row.occurred_at_ms
  )
    throw new Error(
      'Persisted transition record is not bound to its state history entry'
    );
  const entry = createDistributedStateHistoryEntry({
    storeId,
    streamKind: row.stream_kind,
    streamId: row.stream_id,
    revision: row.revision,
    previousEntrySha256: row.previous_entry_sha256,
    previousSnapshotContractSha256: row.previous_snapshot_contract_sha256,
    snapshotSchema: row.snapshot_schema,
    snapshotContractSha256: row.snapshot_contract_sha256,
    snapshotContentSha256: row.snapshot_content_sha256,
    snapshotBytes: row.snapshot_bytes,
    transitionKind: row.transition_kind,
    transitionInputSha256: row.transition_input_sha256,
    transitionRecordSha256: row.transition_record_sha256,
    occurredAtMs: row.occurred_at_ms,
    writerEpoch: row.writer_epoch,
  });
  if (entry.entrySha256 !== row.entry_sha256)
    throw new Error('Persisted state history entry hash does not match');
  return entry;
}

function verifyStateChains(database, storeId) {
  const heads = database
    .prepare(
      `SELECT * FROM distributed_state_head ORDER BY stream_kind, stream_id`
    )
    .all();
  const historyStatement = database.prepare(
    `SELECT * FROM distributed_state_history
     WHERE stream_kind = ? AND stream_id = ?
     ORDER BY revision`
  );
  for (const head of heads) {
    const history = historyStatement.all(head.stream_kind, head.stream_id);
    if (history.length === 0)
      throw new Error('Distributed state head has no immutable history');
    let prior = null;
    for (const row of history) {
      const entry = historyEntryFromRow(row, storeId);
      if (prior === null) {
        if (
          entry.revision !== (entry.streamKind === 'worker-attempt' ? 1 : 0) ||
          entry.transitionKind !== 'genesis' ||
          entry.previousEntrySha256 !== ZERO_SHA256 ||
          entry.previousSnapshotContractSha256 !== ZERO_SHA256
        )
          throw new Error('Distributed state genesis is invalid');
      } else if (
        entry.revision !== prior.revision + 1 ||
        entry.transitionKind === 'genesis' ||
        entry.previousEntrySha256 !== prior.entrySha256 ||
        entry.previousSnapshotContractSha256 !== prior.snapshotContractSha256 ||
        entry.writerEpoch < prior.writerEpoch
      ) {
        throw new Error('Distributed state history is not contiguous');
      }
      prior = entry;
    }
    if (
      prior.revision !== head.revision ||
      prior.entrySha256 !== head.head_entry_sha256 ||
      prior.snapshotSchema !== head.snapshot_schema ||
      prior.snapshotContractSha256 !== head.snapshot_contract_sha256 ||
      prior.snapshotContentSha256 !== head.snapshot_content_sha256 ||
      prior.snapshotBytes !== head.snapshot_bytes ||
      prior.occurredAtMs !== head.occurred_at_ms ||
      prior.writerEpoch !== head.writer_epoch
    )
      throw new Error(
        'Distributed state head does not match immutable history'
      );
    parseStoredJson(
      head.snapshot_json,
      head.snapshot_bytes,
      head.snapshot_content_sha256,
      'Persisted distributed state snapshot',
      maximumSnapshotBytes(head.stream_kind)
    );
  }
  const orphanHistory = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM distributed_state_history AS history
       LEFT JOIN distributed_state_head AS head
         ON head.stream_kind = history.stream_kind
        AND head.stream_id = history.stream_id
       WHERE head.stream_id IS NULL`
    )
    .get().count;
  if (orphanHistory !== 0)
    throw new Error('Distributed state history has no authoritative head');
}

function maximumSnapshotBytes(streamKind) {
  switch (streamKind) {
    case 'queue':
      return DISTRIBUTED_STATE_STORE_MAX_QUEUE_BYTES;
    case 'broker':
      return DISTRIBUTED_STATE_STORE_MAX_BROKER_BYTES;
    case 'worker-attempt':
      return DISTRIBUTED_STATE_STORE_MAX_WORKER_ATTEMPT_BYTES;
    default:
      throw new Error('Distributed state stream kind is unsupported');
  }
}

function verifyMetadata(database, expectedOwner, expectedRootBinding) {
  const metadata = database
    .prepare(`SELECT * FROM distributed_store_metadata WHERE singleton = 1`)
    .get();
  if (!metadata) throw new Error('Distributed state store metadata is missing');
  if (
    metadata.schema_version !== DISTRIBUTED_STATE_STORE_SCHEMA_VERSION ||
    metadata.schema_manifest_sha256 !==
      DISTRIBUTED_STATE_STORE_SCHEMA_MANIFEST_SHA256 ||
    metadata.canonical_hash_schema !== 'seerrng-canonical-json-sha256/v1'
  )
    throw new Error('Distributed state store metadata is unsupported');
  identifier(metadata.store_id, 'persisted state store ID');
  exactText(metadata.engine_version, 'persisted engine version', 128);
  integer(metadata.created_at_ms, 'Persisted state store creation time');
  const owner = normalizeOwner({
    role: metadata.owner_role,
    ownerId: metadata.owner_id,
    controllerId: metadata.controller_id,
    workerId: metadata.worker_id,
    machineIdentitySha256: metadata.machine_identity_sha256,
  });
  if (
    owner.role !== expectedOwner.role ||
    owner.ownerId !== expectedOwner.ownerId ||
    owner.controllerId !== expectedOwner.controllerId ||
    owner.workerId !== expectedOwner.workerId ||
    owner.machineIdentitySha256 !== expectedOwner.machineIdentitySha256
  )
    throw new Error('Distributed state store belongs to another owner');
  const rootBinding = {
    rootIdentitySha256: digest(
      metadata.root_identity_sha256,
      'persisted state root identity hash'
    ),
    rootConfigSha256: digest(
      metadata.root_config_sha256,
      'persisted state root config hash'
    ),
    rootMarkerSha256: digest(
      metadata.root_marker_sha256,
      'persisted state root marker hash'
    ),
    rootObjectFingerprintSha256: digest(
      metadata.root_object_fingerprint_sha256,
      'persisted state root object fingerprint hash'
    ),
    recoveryPolicySha256: digest(
      metadata.recovery_policy_sha256,
      'persisted state root recovery policy hash'
    ),
  };
  if (!sameFilesystemIdentity(rootBinding, expectedRootBinding))
    throw new Error('Distributed state store belongs to another admitted root');
  const migrations = database
    .prepare(
      `SELECT version, migration_sha256
       FROM distributed_schema_migration ORDER BY version`
    )
    .all();
  if (
    migrations.length !== 1 ||
    migrations[0].version !== DISTRIBUTED_STATE_STORE_SCHEMA_VERSION ||
    migrations[0].migration_sha256 !==
      DISTRIBUTED_STATE_STORE_SCHEMA_MANIFEST_SHA256
  )
    throw new Error('Distributed state store migration history is invalid');
  return {
    storeId: metadata.store_id,
    owner,
    rootBinding: deepFreeze(rootBinding),
    engineVersion: metadata.engine_version,
    createdAtMs: metadata.created_at_ms,
  };
}

function verifySealedDocuments(database, documentVerifiers) {
  const rows = database
    .prepare(`SELECT * FROM distributed_sealed_document`)
    .all();
  for (const row of rows) {
    digest(row.contract_sha256, 'sealed document contract hash');
    exactText(row.document_kind, 'sealed document kind');
    exactText(row.document_schema, 'sealed document schema');
    const value = parseStoredJson(
      row.document_json,
      row.document_bytes,
      row.content_sha256,
      'Persisted sealed document',
      DISTRIBUTED_STATE_STORE_MAX_DOCUMENT_BYTES
    );
    verifyDocumentWithRegistry(documentVerifiers, {
      documentKind: row.document_kind,
      contractSha256: row.contract_sha256,
      value,
      expectedSchema: row.document_schema,
      expectedJson: row.document_json,
    });
  }
}

function createTransaction(database, operation) {
  const transaction = database.transaction(operation);
  if (typeof transaction?.immediate !== 'function')
    throw new Error('SQLite adapter does not support immediate transactions');
  return (...args) => transaction.immediate(...args);
}

function acquireWriterFenceLocked(
  database,
  writer,
  { allowStaleTakeover, staleAfterMs }
) {
  integer(staleAfterMs, 'Writer stale interval', { minimum: 1 });
  if (typeof allowStaleTakeover !== 'boolean')
    throw new Error('Writer stale takeover flag must be boolean');
  const current = database
    .prepare(`SELECT * FROM distributed_writer_fence WHERE singleton = 1`)
    .get();
  if (!current)
    throw new Error('Distributed state store writer fence is missing');
  const currentEpoch = integer(current.epoch, 'Persisted writer fence epoch');
  const currentHeartbeatAtMs =
    current.owner_token === null
      ? null
      : integer(current.heartbeat_at_ms, 'Persisted writer heartbeat time');
  const checkedAtMs = localWallClockNowMs();
  const maximumPersistedEpoch = integer(
    database
      .prepare(
        `SELECT COALESCE(MAX(writer_epoch), 0) AS maximum_epoch
         FROM distributed_state_history`
      )
      .get().maximum_epoch,
    'Maximum persisted writer epoch'
  );
  if (current.owner_token !== null) {
    const stale =
      currentHeartbeatAtMs <= checkedAtMs &&
      checkedAtMs - currentHeartbeatAtMs >= staleAfterMs;
    if (!stale)
      throw new Error('Distributed state store already has an active writer');
    if (!allowStaleTakeover)
      throw new Error(
        'Distributed state store recovery policy forbids stale-writer takeover'
      );
  }
  const nextEpoch = Math.max(currentEpoch, maximumPersistedEpoch) + 1;
  if (
    !Number.isSafeInteger(nextEpoch) ||
    nextEpoch <= currentEpoch ||
    nextEpoch <= maximumPersistedEpoch
  )
    throw new Error(
      'Distributed state store cannot allocate a greater writer epoch'
    );
  const acquiredAtMs = localWallClockNowMs(checkedAtMs);
  const result = database
    .prepare(
      `UPDATE distributed_writer_fence
       SET epoch = ?, owner_token = ?, process_id = ?,
           process_started_at_ms = ?, acquired_at_ms = ?, heartbeat_at_ms = ?
       WHERE singleton = 1 AND epoch = ? AND owner_token IS ?`
    )
    .run(
      nextEpoch,
      writer.token,
      writer.processId,
      writer.processStartedAtMs,
      acquiredAtMs,
      acquiredAtMs,
      currentEpoch,
      current.owner_token
    );
  if (result.changes !== 1)
    throw new Error(
      'Distributed state store writer fence changed concurrently'
    );
  return nextEpoch;
}

export function createBetterSqlite3StateStoreAdapter({ loader } = {}) {
  if (loader !== undefined && typeof loader !== 'function')
    throw new Error('better-sqlite3 loader must be a function');
  const load = loader ?? (() => require('better-sqlite3'));
  return deepFreeze({
    name: 'better-sqlite3',
    open(databasePath, { fileMustExist, timeoutMs }) {
      let loaded;
      try {
        loaded = load();
      } catch (error) {
        throw new Error(
          'Distributed state persistence requires pinned better-sqlite3; install repository dependencies before opening the store',
          { cause: error }
        );
      }
      const Database = loaded?.default ?? loaded;
      if (typeof Database !== 'function')
        throw new Error(
          'Pinned better-sqlite3 did not provide its Database class'
        );
      return new Database(databasePath, {
        fileMustExist,
        timeout: timeoutMs,
      });
    },
  });
}

function openWithAdapter(adapter, databasePath, fileMustExist) {
  plainObject(adapter, 'distributed state store SQLite adapter');
  if (adapter.name !== 'better-sqlite3' || typeof adapter.open !== 'function')
    throw new Error(
      'Distributed state store requires a better-sqlite3 adapter'
    );
  const database = adapter.open(databasePath, {
    fileMustExist,
    timeoutMs: DISTRIBUTED_STATE_STORE_BUSY_TIMEOUT_MS,
  });
  for (const method of ['close', 'exec', 'pragma', 'prepare', 'transaction'])
    if (typeof database?.[method] !== 'function') {
      database?.close?.();
      throw new Error(`SQLite adapter database is missing ${method}()`);
    }
  return database;
}

class DistributedStateStore {
  #closed = false;
  #database;
  #databaseIdentity;
  #databasePath;
  #documentVerifiers;
  #metadata;
  #rootContext;
  #stateDirectoryIdentity;
  #writer;
  #writerEpoch;

  constructor(
    constructionToken,
    {
      database,
      databaseIdentity,
      databasePath,
      documentVerifiers,
      metadata,
      rootContext,
      stateDirectoryIdentity,
      writer,
      writerEpoch,
    }
  ) {
    if (constructionToken !== STATE_STORE_CONSTRUCTION_TOKEN)
      throw new Error('Distributed state store construction is private');
    this.#database = database;
    this.#databaseIdentity = databaseIdentity;
    this.#databasePath = databasePath;
    this.#documentVerifiers = documentVerifiers;
    this.#metadata = deepFreeze(structuredClone(metadata));
    this.#rootContext = rootContext;
    this.#stateDirectoryIdentity = stateDirectoryIdentity;
    this.#writer = deepFreeze(structuredClone(writer));
    this.#writerEpoch = writerEpoch;
  }

  get databasePath() {
    return this.#databasePath;
  }

  get metadata() {
    return this.#metadata;
  }

  get writerEpoch() {
    return this.#writerEpoch;
  }

  get closed() {
    return this.#closed;
  }

  #requireOpen() {
    if (this.#closed) throw new Error('Distributed state store is closed');
  }

  #verifyFilesystem() {
    return verifyBoundStateStoreFilesystem(this.#rootContext, {
      databaseMustExist: true,
      expectedDatabaseIdentity: this.#databaseIdentity,
      expectedStateDirectoryIdentity: this.#stateDirectoryIdentity,
    });
  }

  #read(operation) {
    this.#requireOpen();
    this.#verifyFilesystem();
    let value;
    let operationError;
    try {
      value = operation();
    } catch (error) {
      operationError = error;
    }
    try {
      this.#verifyFilesystem();
    } catch (error) {
      throw new Error(
        'Distributed state store admission changed during database access',
        { cause: error }
      );
    }
    if (operationError) throw operationError;
    return value;
  }

  #write(operation) {
    this.#requireOpen();
    this.#verifyFilesystem();
    let committed;
    let operationError;
    try {
      committed = createTransaction(this.#database, () => {
        const fence = this.#database
          .prepare(
            `SELECT epoch, owner_token, heartbeat_at_ms
             FROM distributed_writer_fence WHERE singleton = 1`
          )
          .get();
        if (
          !fence ||
          fence.epoch !== this.#writerEpoch ||
          fence.owner_token !== this.#writer.token
        )
          throw new Error('Distributed state store writer fence was lost');
        const priorHeartbeatAtMs = integer(
          fence.heartbeat_at_ms,
          'Persisted writer heartbeat time'
        );
        const value = operation();
        const heartbeatAtMs = localWallClockNowMs(priorHeartbeatAtMs);
        const heartbeat = this.#database
          .prepare(
            `UPDATE distributed_writer_fence
             SET heartbeat_at_ms = ?
             WHERE singleton = 1 AND epoch = ? AND owner_token = ?
               AND heartbeat_at_ms = ?`
          )
          .run(
            heartbeatAtMs,
            this.#writerEpoch,
            this.#writer.token,
            priorHeartbeatAtMs
          );
        if (heartbeat.changes !== 1)
          throw new Error('Distributed state store writer fence was lost');
        this.#verifyFilesystem();
        return { value };
      })();
    } catch (error) {
      operationError = error;
    }
    try {
      this.#verifyFilesystem();
    } catch (error) {
      throw new Error(
        'Distributed state store admission changed during database access',
        { cause: error }
      );
    }
    if (operationError) throw operationError;
    return committed.value;
  }

  heartbeatWriter() {
    if (arguments.length !== 0)
      throw new Error('Writer heartbeat time is sampled internally');
    return this.#write(() => this.#writerEpoch);
  }

  readStateHead(streamKind, streamId) {
    if (!['queue', 'broker', 'worker-attempt'].includes(streamKind))
      throw new Error('Distributed state stream kind is unsupported');
    identifier(streamId, 'state stream ID');
    return this.#read(() =>
      stateHeadFromRow(
        this.#database
          .prepare(
            `SELECT * FROM distributed_state_head
             WHERE stream_kind = ? AND stream_id = ?`
          )
          .get(streamKind, streamId)
      )
    );
  }

  putSealedDocument(input) {
    this.#requireOpen();
    exactKeys(
      input,
      ['contractSha256', 'createdAtMs', 'documentKind', 'value'],
      'sealed document write'
    );
    const { documentKind, contractSha256, value, createdAtMs } = input;
    const kind = identifier(documentKind, 'sealed document kind');
    const contract = digest(contractSha256, 'sealed document contract hash');
    integer(createdAtMs, 'Sealed document creation time');
    const { verified, schema, serialized } = verifyDocumentWithRegistry(
      this.#documentVerifiers,
      { documentKind: kind, contractSha256: contract, value }
    );
    return this.#write(() => {
      const existing = this.#database
        .prepare(
          `SELECT * FROM distributed_sealed_document
           WHERE document_kind = ? AND contract_sha256 = ?`
        )
        .get(kind, contract);
      if (existing) {
        if (
          existing.document_schema !== schema ||
          existing.content_sha256 !== serialized.contentSha256 ||
          existing.document_bytes !== serialized.bytes ||
          existing.document_json !== serialized.json
        )
          throw new Error('Conflicting document reused a sealed contract hash');
        return deepFreeze(structuredClone(verified));
      }
      this.#database
        .prepare(
          `INSERT INTO distributed_sealed_document (
             document_kind, contract_sha256, document_schema,
             content_sha256, document_bytes, document_json, created_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          kind,
          contract,
          schema,
          serialized.contentSha256,
          serialized.bytes,
          serialized.json,
          createdAtMs
        );
      return deepFreeze(structuredClone(verified));
    });
  }

  getSealedDocument(input) {
    exactKeys(
      input,
      ['contractSha256', 'documentKind'],
      'sealed document read'
    );
    const { documentKind, contractSha256 } = input;
    const kind = identifier(documentKind, 'sealed document kind');
    const contract = digest(contractSha256, 'sealed document contract hash');
    return this.#read(() => {
      const row = this.#database
        .prepare(
          `SELECT * FROM distributed_sealed_document
           WHERE document_kind = ? AND contract_sha256 = ?`
        )
        .get(kind, contract);
      if (!row) throw new Error('Sealed document is missing');
      const stored = parseStoredJson(
        row.document_json,
        row.document_bytes,
        row.content_sha256,
        'Persisted sealed document',
        DISTRIBUTED_STATE_STORE_MAX_DOCUMENT_BYTES
      );
      const { verified } = verifyDocumentWithRegistry(this.#documentVerifiers, {
        documentKind: kind,
        contractSha256: contract,
        value: stored,
        expectedSchema: row.document_schema,
        expectedJson: row.document_json,
      });
      return deepFreeze(structuredClone(verified));
    });
  }

  #persistSnapshot({
    streamKind,
    streamId,
    snapshot,
    contractSha256,
    internalRevision,
    initialRevision,
    expectedHead,
    transition,
    verifyLineage,
  }) {
    const id = identifier(streamId, 'state stream ID');
    const contract = digest(contractSha256, 'snapshot contract hash');
    const schema = exactText(snapshot.schema, 'snapshot schema');
    const occurredAtMs = normalizeTransitionTime(transition);
    const serialized = serializeJson(
      snapshot,
      'Distributed state snapshot',
      maximumSnapshotBytes(streamKind)
    );
    const expected =
      expectedHead === null ? null : normalizeExpectedHead(expectedHead);
    if (internalRevision !== null)
      integer(internalRevision, 'Snapshot internal revision');
    integer(initialRevision, 'Initial state revision');
    if (typeof verifyLineage !== 'function')
      throw new Error(
        'Distributed state snapshot requires lineage verification'
      );

    return this.#write(() => {
      const currentRow = this.#database
        .prepare(
          `SELECT * FROM distributed_state_head
           WHERE stream_kind = ? AND stream_id = ?`
        )
        .get(streamKind, id);
      const current = stateHeadFromRow(currentRow);
      let revision;
      let previousEntrySha256;
      let previousSnapshotContractSha256;
      if (current === null) {
        if (expected !== null)
          throw new Error('Expected state head does not exist');
        revision = initialRevision;
        previousEntrySha256 = ZERO_SHA256;
        previousSnapshotContractSha256 = ZERO_SHA256;
      } else {
        if (expected === null)
          throw new Error('Existing state requires an expected CAS head');
        if (
          expected.revision !== current.revision ||
          expected.headEntrySha256 !== current.headEntrySha256 ||
          expected.snapshotContractSha256 !== current.snapshotContractSha256
        )
          throw new Error('Distributed state CAS head is stale');
        if (contract === current.snapshotContractSha256)
          throw new Error('Distributed state no-op must not create history');
        revision = current.revision + 1;
        previousEntrySha256 = current.headEntrySha256;
        previousSnapshotContractSha256 = current.snapshotContractSha256;
      }
      if (internalRevision !== null && internalRevision !== revision)
        throw new Error(
          'Snapshot internal revision does not match persistence history'
        );
      let previousSnapshot = null;
      if (current !== null) {
        previousSnapshot = parseStoredJson(
          currentRow.snapshot_json,
          currentRow.snapshot_bytes,
          currentRow.snapshot_content_sha256,
          'Persisted predecessor snapshot',
          maximumSnapshotBytes(streamKind)
        );
        if (previousSnapshot.schema !== currentRow.snapshot_schema)
          throw new Error(
            'Persisted predecessor schema does not match its state head'
          );
      }
      const lineage = verifyLineage({
        previousSnapshot,
        previousContractSha256: current?.snapshotContractSha256 ?? ZERO_SHA256,
      });
      if (lineage && typeof lineage.then === 'function')
        throw new Error(
          'Distributed state lineage verifier must be synchronous'
        );
      const persistedTransition = createPersistedTransition({
        streamKind,
        streamId: id,
        previousSnapshotContractSha256,
        snapshotContractSha256: contract,
        lineage,
        occurredAtMs,
      });
      if (
        (current === null && persistedTransition.kind !== 'genesis') ||
        (current !== null && persistedTransition.kind === 'genesis')
      )
        throw new Error(
          current === null
            ? 'First persisted state transition must be genesis'
            : 'Existing state cannot accept another genesis'
        );
      const entry = createDistributedStateHistoryEntry({
        storeId: this.#metadata.storeId,
        streamKind,
        streamId: id,
        revision,
        previousEntrySha256,
        previousSnapshotContractSha256,
        snapshotSchema: schema,
        snapshotContractSha256: contract,
        snapshotContentSha256: serialized.contentSha256,
        snapshotBytes: serialized.bytes,
        transitionKind: persistedTransition.kind,
        transitionInputSha256: persistedTransition.inputSha256,
        transitionRecordSha256: persistedTransition.recordSha256,
        occurredAtMs: persistedTransition.occurredAtMs,
        writerEpoch: this.#writerEpoch,
      });
      this.#database
        .prepare(
          `INSERT INTO distributed_state_history (
             stream_kind, stream_id, revision, entry_schema,
             previous_entry_sha256, previous_snapshot_contract_sha256,
             snapshot_schema, snapshot_contract_sha256,
             snapshot_content_sha256, snapshot_bytes,
             transition_kind, transition_input_sha256,
             transition_record_sha256, transition_record_json,
             occurred_at_ms, writer_epoch, entry_sha256
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          streamKind,
          id,
          revision,
          entry.schema,
          entry.previousEntrySha256,
          entry.previousSnapshotContractSha256,
          entry.snapshotSchema,
          entry.snapshotContractSha256,
          entry.snapshotContentSha256,
          entry.snapshotBytes,
          entry.transitionKind,
          entry.transitionInputSha256,
          entry.transitionRecordSha256,
          persistedTransition.recordJson,
          entry.occurredAtMs,
          entry.writerEpoch,
          entry.entrySha256
        );
      if (current === null) {
        this.#database
          .prepare(
            `INSERT INTO distributed_state_head (
               stream_kind, stream_id, revision, head_entry_sha256,
               snapshot_schema, snapshot_contract_sha256,
               snapshot_content_sha256, snapshot_bytes, snapshot_json,
               occurred_at_ms, writer_epoch
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            streamKind,
            id,
            revision,
            entry.entrySha256,
            schema,
            contract,
            serialized.contentSha256,
            serialized.bytes,
            serialized.json,
            persistedTransition.occurredAtMs,
            this.#writerEpoch
          );
      } else {
        const update = this.#database
          .prepare(
            `UPDATE distributed_state_head
             SET revision = ?, head_entry_sha256 = ?, snapshot_schema = ?,
                 snapshot_contract_sha256 = ?, snapshot_content_sha256 = ?,
                 snapshot_bytes = ?, snapshot_json = ?, occurred_at_ms = ?,
                 writer_epoch = ?
             WHERE stream_kind = ? AND stream_id = ? AND revision = ?
               AND head_entry_sha256 = ? AND snapshot_contract_sha256 = ?
               AND writer_epoch = ?`
          )
          .run(
            revision,
            entry.entrySha256,
            schema,
            contract,
            serialized.contentSha256,
            serialized.bytes,
            serialized.json,
            persistedTransition.occurredAtMs,
            this.#writerEpoch,
            streamKind,
            id,
            current.revision,
            current.headEntrySha256,
            current.snapshotContractSha256,
            current.writerEpoch
          );
        if (update.changes !== 1)
          throw new Error('Distributed state head changed during CAS update');
      }
      return stateHeadFromRow({
        stream_kind: streamKind,
        stream_id: id,
        revision,
        head_entry_sha256: entry.entrySha256,
        snapshot_schema: schema,
        snapshot_contract_sha256: contract,
        snapshot_content_sha256: serialized.contentSha256,
        snapshot_bytes: serialized.bytes,
        occurred_at_ms: persistedTransition.occurredAtMs,
        writer_epoch: this.#writerEpoch,
      });
    });
  }

  persistQueueSnapshot(input) {
    rejectUnknownKeys(
      input,
      ['expectedHead', 'queue', 'transition', 'verifyAuthentication'],
      'queue snapshot persistence options'
    );
    const {
      queue,
      expectedHead = null,
      transition,
      verifyAuthentication,
    } = input;
    const snapshot = snapshotDistributedControllerQueue(queue);
    if (
      this.#metadata.owner.role !== 'controller' ||
      snapshot.controllerId !== this.#metadata.owner.controllerId
    )
      throw new Error(
        'Queue snapshot does not belong to this controller state store'
      );
    return this.#persistSnapshot({
      streamKind: 'queue',
      streamId: snapshot.controllerId,
      snapshot,
      contractSha256: snapshot.queueSha256,
      internalRevision: snapshot.revision,
      initialRevision: 0,
      expectedHead,
      transition,
      verifyLineage: ({ previousSnapshot, previousContractSha256 }) => {
        const previous =
          previousSnapshot === null
            ? null
            : rehydrateDistributedControllerQueue(previousSnapshot, {
                expectedControllerId: this.#metadata.owner.controllerId,
                expectedQueueSha256: previousContractSha256,
                verifyAuthentication,
              });
        return describeDistributedControllerQueueTransition(previous, queue);
      },
    });
  }

  persistBrokerSnapshot(input) {
    rejectUnknownKeys(
      input,
      ['expectedBinding', 'expectedHead', 'state', 'streamId', 'transition'],
      'broker snapshot persistence options'
    );
    const {
      streamId,
      state,
      expectedBinding = state?.binding,
      expectedHead = null,
      transition,
    } = input;
    const snapshot = verifyBrokerLeaseState(state, {
      expectedBinding,
      expectedStateSha256: state?.stateSha256,
    });
    const id = identifier(streamId, 'broker state stream ID');
    if (
      this.#metadata.owner.role !== 'controller' ||
      snapshot.binding.controllerId !== this.#metadata.owner.controllerId
    )
      throw new Error(
        'Broker snapshot does not belong to this controller state store'
      );
    if (id !== snapshot.binding.executionId)
      throw new Error(
        'Broker stream ID must equal its binding execution identity'
      );
    return this.#persistSnapshot({
      streamKind: 'broker',
      streamId: id,
      snapshot,
      contractSha256: snapshot.stateSha256,
      internalRevision: null,
      initialRevision: 0,
      expectedHead,
      transition,
      verifyLineage: ({ previousSnapshot, previousContractSha256 }) => {
        const previous =
          previousSnapshot === null
            ? null
            : rehydrateBrokerLeaseState(previousSnapshot, {
                expectedBinding: snapshot.binding,
                expectedStateSha256: previousContractSha256,
              });
        return describeBrokerLeaseStateTransition(previous, state);
      },
    });
  }

  persistWorkerAttemptSnapshot(input) {
    rejectUnknownKeys(
      input,
      ['expectations', 'expectedHead', 'state', 'transition'],
      'worker-attempt snapshot persistence options'
    );
    const { state, expectations = {}, expectedHead = null, transition } = input;
    const snapshot = snapshotDistributedWorkerAttemptState(state);
    if (
      this.#metadata.owner.role !== 'worker' ||
      snapshot.binding.controllerId !== this.#metadata.owner.controllerId ||
      snapshot.task.assignment.workerId !== this.#metadata.owner.workerId ||
      snapshot.lease.workerId !== this.#metadata.owner.workerId ||
      snapshot.lease.machineIdentitySha256 !==
        this.#metadata.owner.machineIdentitySha256
    )
      throw new Error(
        'Worker attempt does not belong to this worker state store'
      );
    verifyDistributedWorkerAttemptState(snapshot, {
      ...expectations,
      expectedWorkerId: this.#metadata.owner.workerId,
      expectedMachineIdentitySha256: this.#metadata.owner.machineIdentitySha256,
      expectedStateSha256: snapshot.stateSha256,
    });
    return this.#persistSnapshot({
      streamKind: 'worker-attempt',
      streamId: snapshot.attemptIdentitySha256,
      snapshot,
      contractSha256: snapshot.stateSha256,
      internalRevision: snapshot.revision,
      initialRevision: 1,
      expectedHead,
      transition,
      verifyLineage: ({ previousSnapshot, previousContractSha256 }) => {
        const previous =
          previousSnapshot === null
            ? null
            : rehydrateDistributedWorkerAttemptState(previousSnapshot, {
                ...expectations,
                expectedWorkerId: this.#metadata.owner.workerId,
                expectedMachineIdentitySha256:
                  this.#metadata.owner.machineIdentitySha256,
                expectedAttemptIdentitySha256: snapshot.attemptIdentitySha256,
                expectedStateSha256: previousContractSha256,
              });
        return describeDistributedWorkerAttemptTransition(previous, state, {
          ...expectations,
          expectedWorkerId: this.#metadata.owner.workerId,
          expectedMachineIdentitySha256:
            this.#metadata.owner.machineIdentitySha256,
          expectedAttemptIdentitySha256: snapshot.attemptIdentitySha256,
          expectedStateSha256: snapshot.stateSha256,
        });
      },
    });
  }

  #loadSnapshot(streamKind, streamId) {
    const id = identifier(streamId, 'state stream ID');
    return this.#read(() => {
      const row = this.#database
        .prepare(
          `SELECT * FROM distributed_state_head
           WHERE stream_kind = ? AND stream_id = ?`
        )
        .get(streamKind, id);
      if (!row) throw new Error('Distributed state snapshot is missing');
      const value = parseStoredJson(
        row.snapshot_json,
        row.snapshot_bytes,
        row.snapshot_content_sha256,
        'Persisted distributed state snapshot',
        maximumSnapshotBytes(streamKind)
      );
      if (value.schema !== row.snapshot_schema)
        throw new Error('Persisted snapshot schema does not match its head');
      return { head: stateHeadFromRow(row), value };
    });
  }

  rehydrateQueueSnapshot(options = {}) {
    rejectUnknownKeys(
      options,
      ['controllerId', 'verifyAuthentication'],
      'queue snapshot rehydration options'
    );
    const {
      controllerId = this.#metadata.owner.controllerId,
      verifyAuthentication,
    } = options;
    if (
      this.#metadata.owner.role !== 'controller' ||
      controllerId !== this.#metadata.owner.controllerId
    )
      throw new Error(
        'Queue snapshot does not belong to this controller state store'
      );
    const normalizedControllerId = identifier(
      controllerId,
      'expected queue controller ID'
    );
    const { head, value } = this.#loadSnapshot('queue', normalizedControllerId);
    const queue = rehydrateDistributedControllerQueue(value, {
      expectedControllerId: normalizedControllerId,
      expectedQueueSha256: head.snapshotContractSha256,
      verifyAuthentication,
    });
    if (queue.revision !== head.revision)
      throw new Error('Queue revision does not match persistence history');
    return queue;
  }

  rehydrateBrokerSnapshot(options) {
    rejectUnknownKeys(
      options,
      ['expectedBinding', 'streamId'],
      'broker snapshot rehydration options'
    );
    const { streamId, expectedBinding } = options;
    const id = identifier(streamId, 'broker state stream ID');
    if (
      this.#metadata.owner.role !== 'controller' ||
      expectedBinding?.controllerId !== this.#metadata.owner.controllerId
    )
      throw new Error(
        'Broker snapshot does not belong to this controller state store'
      );
    if (id !== expectedBinding.executionId)
      throw new Error(
        'Broker stream ID must equal its binding execution identity'
      );
    const { head, value } = this.#loadSnapshot('broker', id);
    return rehydrateBrokerLeaseState(value, {
      expectedBinding,
      expectedStateSha256: head.snapshotContractSha256,
    });
  }

  rehydrateWorkerAttemptSnapshot(options) {
    rejectUnknownKeys(
      options,
      ['attemptIdentitySha256', 'expectations'],
      'worker-attempt snapshot rehydration options'
    );
    const { attemptIdentitySha256, expectations = {} } = options;
    if (this.#metadata.owner.role !== 'worker')
      throw new Error(
        'Worker attempt requires a worker-owned distributed state store'
      );
    const id = digest(
      attemptIdentitySha256,
      'expected worker attempt identity hash'
    );
    const { head, value } = this.#loadSnapshot('worker-attempt', id);
    const state = rehydrateDistributedWorkerAttemptState(value, {
      ...expectations,
      expectedWorkerId: this.#metadata.owner.workerId,
      expectedMachineIdentitySha256: this.#metadata.owner.machineIdentitySha256,
      expectedAttemptIdentitySha256: id,
      expectedStateSha256: head.snapshotContractSha256,
    });
    if (state.binding.controllerId !== this.#metadata.owner.controllerId)
      throw new Error(
        'Worker attempt does not belong to this controller state root'
      );
    if (state.revision !== head.revision)
      throw new Error(
        'Worker attempt revision does not match persistence history'
      );
    return state;
  }

  close(options = {}) {
    this.#requireOpen();
    rejectUnknownKeys(
      options,
      ['releaseFence'],
      'distributed state store close options'
    );
    const { releaseFence = true } = options;
    if (typeof releaseFence !== 'boolean')
      throw new Error('Writer fence release flag must be boolean');
    let failure = null;
    try {
      this.#verifyFilesystem();
      if (releaseFence) {
        createTransaction(this.#database, () => {
          const fence = this.#database
            .prepare(
              `SELECT epoch, owner_token, heartbeat_at_ms
               FROM distributed_writer_fence WHERE singleton = 1`
            )
            .get();
          if (
            !fence ||
            fence.epoch !== this.#writerEpoch ||
            fence.owner_token !== this.#writer.token
          )
            throw new Error('Distributed state store writer fence was lost');
          const heartbeatAtMs = integer(
            fence.heartbeat_at_ms,
            'Persisted writer heartbeat time'
          );
          const result = this.#database
            .prepare(
              `UPDATE distributed_writer_fence
               SET owner_token = NULL, process_id = NULL,
                   process_started_at_ms = NULL, acquired_at_ms = NULL,
                   heartbeat_at_ms = NULL
               WHERE singleton = 1 AND epoch = ? AND owner_token = ?
                 AND heartbeat_at_ms = ?`
            )
            .run(this.#writerEpoch, this.#writer.token, heartbeatAtMs);
          if (result.changes !== 1)
            throw new Error('Distributed state store writer fence was lost');
          this.#verifyFilesystem();
        })();
      }
    } catch (error) {
      failure = error;
    } finally {
      this.#closed = true;
      try {
        this.#database.close();
      } catch (error) {
        failure ??= error;
      }
      try {
        this.#verifyFilesystem();
      } catch (error) {
        failure ??= new Error(
          'Distributed state store admission changed while closing',
          { cause: error }
        );
      }
    }
    if (failure) throw failure;
  }
}

function initializeSchema(
  database,
  metadata,
  writer,
  nowMs,
  verifyFilesystem
) {
  const initialize = createTransaction(database, () => {
    requirePristineDatabase(database);
    setAndRequirePragma(
      database,
      `application_id = ${DISTRIBUTED_STATE_STORE_APPLICATION_ID}`,
      'application_id',
      DISTRIBUTED_STATE_STORE_APPLICATION_ID
    );
    setAndRequirePragma(
      database,
      `user_version = ${DISTRIBUTED_STATE_STORE_SCHEMA_VERSION}`,
      'user_version',
      DISTRIBUTED_STATE_STORE_SCHEMA_VERSION
    );
    database.exec(SCHEMA_STATEMENTS.join(';\n'));
    database
      .prepare(
        `INSERT INTO distributed_store_metadata (
            singleton, schema_version, schema_manifest_sha256, store_id,
            owner_role, owner_id, controller_id, worker_id,
            machine_identity_sha256, root_identity_sha256,
            root_config_sha256, root_marker_sha256,
            root_object_fingerprint_sha256, recovery_policy_sha256,
            engine_version, canonical_hash_schema, created_at_ms
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        DISTRIBUTED_STATE_STORE_SCHEMA_VERSION,
        DISTRIBUTED_STATE_STORE_SCHEMA_MANIFEST_SHA256,
        metadata.storeId,
        metadata.owner.role,
        metadata.owner.ownerId,
        metadata.owner.controllerId,
        metadata.owner.workerId,
        metadata.owner.machineIdentitySha256,
        metadata.rootBinding.rootIdentitySha256,
        metadata.rootBinding.rootConfigSha256,
        metadata.rootBinding.rootMarkerSha256,
        metadata.rootBinding.rootObjectFingerprintSha256,
        metadata.rootBinding.recoveryPolicySha256,
        metadata.engineVersion,
        'seerrng-canonical-json-sha256/v1',
        nowMs
      );
    database
      .prepare(
        `INSERT INTO distributed_schema_migration (
           version, migration_sha256, applied_at_ms
         ) VALUES (?, ?, ?)`
      )
      .run(
        DISTRIBUTED_STATE_STORE_SCHEMA_VERSION,
        DISTRIBUTED_STATE_STORE_SCHEMA_MANIFEST_SHA256,
        nowMs
      );
    const acquiredAtMs = localWallClockNowMs();
    database
      .prepare(
        `INSERT INTO distributed_writer_fence (
           singleton, epoch, owner_token, process_id, process_started_at_ms,
           acquired_at_ms, heartbeat_at_ms
         ) VALUES (1, 1, ?, ?, ?, ?, ?)`
      )
      .run(
        writer.token,
        writer.processId,
        writer.processStartedAtMs,
        acquiredAtMs,
        acquiredAtMs
      );
    verifyFilesystem();
  });
  initialize();
}

export function initializeDistributedStateStore(options) {
  rejectUnknownKeys(
    options,
    [
      'config',
      'documentVerifiers',
      'engineVersion',
      'expectations',
      'initializedAtMs',
      'marker',
      'storeId',
      'writer',
    ],
    'distributed state store initialization'
  );
  const {
    config,
    marker,
    expectations,
    engineVersion,
    writer,
    initializedAtMs,
    documentVerifiers,
    storeId = randomUUID(),
  } = options;
  const rootContext = createStateRootContext({
    config,
    marker,
    expectations,
  });
  const path = rootContext.paths.databasePath;
  const normalizedWriter = normalizeWriter(writer);
  const normalizedDocumentVerifiers =
    normalizeDocumentVerifierRegistry(documentVerifiers);
  const normalizedStoreId = identifier(storeId, 'state store ID');
  const normalizedVersion = exactText(engineVersion, 'engine version', 128);
  integer(initializedAtMs, 'State store initialization time');
  if (existsSync(path))
    throw new Error('Distributed state store already exists');
  verifyDatabaseFilesystem(path, {
    expectedDeviceId: rootContext.config.rootObjectFingerprint.deviceId,
    fileMustExist: false,
    sidecarsMustBeAbsent: true,
  });
  mkdirSync(rootContext.paths.stateDirectory, {
    recursive: true,
    mode: 0o700,
  });
  const initialFilesystem = verifyBoundStateStoreFilesystem(rootContext, {
    databaseMustExist: false,
    sidecarsMustBeAbsent: true,
  });
  reserveNewDatabaseFile(path);
  const reservedFilesystem = verifyBoundStateStoreFilesystem(rootContext, {
    databaseMustExist: true,
    expectedStateDirectoryIdentity: initialFilesystem.directoryIdentity,
    sidecarsMustBeAbsent: true,
  });
  const database = openWithAdapter(
    createBetterSqlite3StateStoreAdapter(),
    path,
    true
  );
  try {
    const openedFilesystem = verifyBoundStateStoreFilesystem(rootContext, {
      databaseMustExist: true,
      expectedDatabaseIdentity: reservedFilesystem.databaseIdentity,
      expectedStateDirectoryIdentity: initialFilesystem.directoryIdentity,
      sidecarsMustBeAbsent: true,
    });
    requirePristineDatabase(database);
    configureNewDatabase(database);
    verifyBoundStateStoreFilesystem(rootContext, {
      databaseMustExist: true,
      expectedDatabaseIdentity: openedFilesystem.databaseIdentity,
      expectedStateDirectoryIdentity: initialFilesystem.directoryIdentity,
    });
    initializeSchema(
      database,
      {
        storeId: normalizedStoreId,
        owner: rootContext.owner,
        rootBinding: rootContext.rootBinding,
        engineVersion: normalizedVersion,
      },
      normalizedWriter,
      initializedAtMs,
      () =>
        verifyBoundStateStoreFilesystem(rootContext, {
          databaseMustExist: true,
          expectedDatabaseIdentity: openedFilesystem.databaseIdentity,
          expectedStateDirectoryIdentity: initialFilesystem.directoryIdentity,
        })
    );
    requireStoreHeader(database);
    verifySchemaObjects(database);
    verifySqliteIntegrity(database);
    const verifiedMetadata = verifyMetadata(
      database,
      rootContext.owner,
      rootContext.rootBinding
    );
    verifySealedDocuments(database, normalizedDocumentVerifiers);
    verifyStateChains(database, verifiedMetadata.storeId);
    const finalFilesystem = verifyBoundStateStoreFilesystem(rootContext, {
      databaseMustExist: true,
      expectedDatabaseIdentity: openedFilesystem.databaseIdentity,
      expectedStateDirectoryIdentity: initialFilesystem.directoryIdentity,
    });
    return new DistributedStateStore(STATE_STORE_CONSTRUCTION_TOKEN, {
      database,
      databaseIdentity: finalFilesystem.databaseIdentity,
      databasePath: path,
      documentVerifiers: normalizedDocumentVerifiers,
      metadata: verifiedMetadata,
      rootContext,
      stateDirectoryIdentity: finalFilesystem.directoryIdentity,
      writer: normalizedWriter,
      writerEpoch: 1,
    });
  } catch (error) {
    closeDatabaseAfterFailure(database, error);
  }
}

export function openDistributedStateStore(options) {
  rejectUnknownKeys(
    options,
    [
      'config',
      'documentVerifiers',
      'expectations',
      'marker',
      'writer',
    ],
    'distributed state store open'
  );
  const {
    config,
    marker,
    expectations,
    writer,
    documentVerifiers,
  } = options;
  const rootContext = createStateRootContext({
    config,
    marker,
    expectations,
  });
  const path = rootContext.paths.databasePath;
  const normalizedWriter = normalizeWriter(writer);
  const normalizedDocumentVerifiers =
    normalizeDocumentVerifierRegistry(documentVerifiers);
  const initialFilesystem = verifyBoundStateStoreFilesystem(rootContext, {
    databaseMustExist: true,
  });
  const database = openWithAdapter(
    createBetterSqlite3StateStoreAdapter(),
    path,
    true
  );
  try {
    verifyBoundStateStoreFilesystem(rootContext, {
      databaseMustExist: true,
      expectedDatabaseIdentity: initialFilesystem.databaseIdentity,
      expectedStateDirectoryIdentity: initialFilesystem.directoryIdentity,
    });
    requireStoreHeader(database);
    configureRuntimePragmas(database);
    verifyBoundStateStoreFilesystem(rootContext, {
      databaseMustExist: true,
      expectedDatabaseIdentity: initialFilesystem.databaseIdentity,
      expectedStateDirectoryIdentity: initialFilesystem.directoryIdentity,
    });
    const verifyStoreLocked = () => {
      requireStoreHeader(database);
      verifySqliteIntegrity(database);
      verifySchemaObjects(database);
      const metadata = verifyMetadata(
        database,
        rootContext.owner,
        rootContext.rootBinding
      );
      verifySealedDocuments(database, normalizedDocumentVerifiers);
      verifyStateChains(database, metadata.storeId);
      return metadata;
    };
    const { metadata, writerEpoch } = createTransaction(database, () => {
      verifyBoundStateStoreFilesystem(rootContext, {
        databaseMustExist: true,
        expectedDatabaseIdentity: initialFilesystem.databaseIdentity,
        expectedStateDirectoryIdentity: initialFilesystem.directoryIdentity,
      });
      verifyStoreLocked();
      const acquiredEpoch = acquireWriterFenceLocked(
        database,
        normalizedWriter,
        {
          allowStaleTakeover:
            rootContext.recoveryPolicy.allowStaleWriterTakeover,
          staleAfterMs: rootContext.recoveryPolicy.staleWriterAfterMs,
        }
      );
      const verifiedMetadata = verifyStoreLocked();
      verifyBoundStateStoreFilesystem(rootContext, {
        databaseMustExist: true,
        expectedDatabaseIdentity: initialFilesystem.databaseIdentity,
        expectedStateDirectoryIdentity: initialFilesystem.directoryIdentity,
      });
      return {
        metadata: verifiedMetadata,
        writerEpoch: acquiredEpoch,
      };
    })();
    const finalFilesystem = verifyBoundStateStoreFilesystem(rootContext, {
      databaseMustExist: true,
      expectedDatabaseIdentity: initialFilesystem.databaseIdentity,
      expectedStateDirectoryIdentity: initialFilesystem.directoryIdentity,
    });
    return new DistributedStateStore(STATE_STORE_CONSTRUCTION_TOKEN, {
      database,
      databaseIdentity: finalFilesystem.databaseIdentity,
      databasePath: path,
      documentVerifiers: normalizedDocumentVerifiers,
      metadata,
      rootContext,
      stateDirectoryIdentity: finalFilesystem.directoryIdentity,
      writer: normalizedWriter,
      writerEpoch,
    });
  } catch (error) {
    closeDatabaseAfterFailure(database, error);
  }
}
