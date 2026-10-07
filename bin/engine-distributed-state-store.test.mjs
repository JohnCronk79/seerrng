// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createBrokerLeaseState,
  rehydrateBrokerLeaseState,
} from '../tools/validation-engine/runtime/broker-lease-state.mjs';
import {
  BROKER_BINDING_SCHEMA,
  BROKER_WORKER_CONFIG_SCHEMA,
  brokerApplicationIsolationKeySha256,
  sealBrokerTask,
} from '../tools/validation-engine/runtime/broker-protocol.mjs';
import {
  DISTRIBUTED_APP_SUBMISSION_SCHEMA,
  createDistributedControllerQueue,
  enqueueDistributedApp,
  rehydrateDistributedControllerQueue,
  sealDistributedAppSubmission,
} from '../tools/validation-engine/runtime/distributed-controller-queue.mjs';
import {
  createDistributedLocalStateRootConfig,
  createDistributedLocalStateRootMarker,
  deriveDistributedLocalStateRootPaths,
} from '../tools/validation-engine/runtime/distributed-local-state-root.mjs';
import {
  DISTRIBUTED_STATE_STORE_APPLICATION_ID,
  DISTRIBUTED_STATE_STORE_BUSY_TIMEOUT_MS,
  DISTRIBUTED_STATE_STORE_PAGE_SIZE,
  DISTRIBUTED_STATE_STORE_SCHEMA_MANIFEST_SHA256,
  DISTRIBUTED_STATE_STORE_SCHEMA_VERSION,
  DISTRIBUTED_STATE_TRANSITION_RECORD_SCHEMA,
  createBetterSqlite3StateStoreAdapter,
  createDistributedStateHistoryEntry,
  initializeDistributedStateStore,
  openDistributedStateStore,
} from '../tools/validation-engine/runtime/distributed-state-store.mjs';
import {
  createDistributedWorkerAttemptState,
  finishDistributedWorkerAttempt,
  rehydrateDistributedWorkerAttemptState,
  startDistributedWorkerAttempt,
} from '../tools/validation-engine/runtime/distributed-worker-attempt-state.mjs';
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

const rootContracts = new Map();
const LEGACY_V1_SCHEMA_MANIFEST_SHA256 =
  '489b8728a25cba54615a1d7eb68da9b83b605db47e9a6f5509b71fecd6505d56';

function admissionExpectations(config) {
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

function databasePath(t, label, overrides = {}) {
  const root = mkdtempSync(
    join(realpathSync.native(tmpdir()), `seerrng-${label}-`)
  );
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const role = overrides.role ?? 'controller';
  const controllerId = overrides.controllerId ?? 'controller-a';
  const workerId =
    role === 'worker' ? (overrides.workerId ?? 'worker-a') : null;
  const machineIdentitySha256 =
    overrides.machineIdentitySha256 ??
    hash(role === 'worker' ? `${workerId}-machine` : `${controllerId}-machine`);
  const config = createDistributedLocalStateRootConfig({
    role,
    controllerId,
    workerId,
    machineIdentitySha256,
    platform: process.platform,
    canonicalRoot: root,
    localityAcceptance: {
      status: 'operator-attested-local',
      acceptedAtMs: 10,
      acceptanceId: `locality-${label}`,
    },
    recoveryAcceptance: {
      staleWriterAfterMs: overrides.staleWriterAfterMs ?? 30_000,
      allowStaleWriterTakeover: overrides.allowStaleWriterTakeover ?? false,
      crashRecoveryAccepted: true,
      acceptedAtMs: 11,
      acceptanceId: `recovery-${label}`,
    },
  });
  const marker = createDistributedLocalStateRootMarker({
    config,
    createdAtMs: 12,
  });
  const paths = deriveDistributedLocalStateRootPaths(config);
  writeFileSync(paths.markerPath, JSON.stringify(marker));
  rootContracts.set(paths.databasePath, {
    config,
    marker,
    expectations: admissionExpectations(config),
    paths,
  });
  return paths.databasePath;
}

function rootOptions(path) {
  const contract = rootContracts.get(path);
  assert.ok(contract, `Missing state-root fixture for ${path}`);
  return {
    config: contract.config,
    marker: contract.marker,
    expectations: contract.expectations,
  };
}

function openOptions(path, overrides = {}) {
  return {
    ...rootOptions(path),
    writer: writer('writer-b', 202, 20),
    documentVerifiers: {},
    ...overrides,
  };
}

function openDatabase(path) {
  return createBetterSqlite3StateStoreAdapter().open(path, {
    fileMustExist: true,
    timeoutMs: DISTRIBUTED_STATE_STORE_BUSY_TIMEOUT_MS,
  });
}

function withDatabase(path, operation) {
  const database = openDatabase(path);
  try {
    return operation(database);
  } finally {
    database.close();
  }
}

function rewriteAsLegacyV1Store(path) {
  withDatabase(path, (database) => {
    database.exec(`
      ALTER TABLE distributed_store_metadata
        RENAME TO distributed_store_metadata_v2;
      CREATE TABLE distributed_store_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        schema_manifest_sha256 TEXT NOT NULL CHECK (
          length(schema_manifest_sha256) = 64 AND
          schema_manifest_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        store_id TEXT NOT NULL UNIQUE CHECK (length(store_id) BETWEEN 1 AND 128),
        owner_role TEXT NOT NULL CHECK (owner_role IN ('controller', 'worker')),
        owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 128),
        controller_id TEXT,
        worker_id TEXT,
        machine_identity_sha256 TEXT CHECK (
          machine_identity_sha256 IS NULL OR (
            length(machine_identity_sha256) = 64 AND
            machine_identity_sha256 NOT GLOB '*[^0-9a-f]*'
          )
        ),
        engine_version TEXT NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 128),
        canonical_hash_schema TEXT NOT NULL CHECK (
          canonical_hash_schema = 'seerrng-canonical-json-sha256/v1'
        ),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
        CHECK (
          (owner_role = 'controller' AND controller_id IS NOT NULL AND
            worker_id IS NULL AND machine_identity_sha256 IS NULL) OR
          (owner_role = 'worker' AND worker_id IS NOT NULL AND
            controller_id IS NULL AND machine_identity_sha256 IS NOT NULL)
        )
      ) STRICT;
      INSERT INTO distributed_store_metadata (
        singleton, schema_version, schema_manifest_sha256, store_id,
        owner_role, owner_id, controller_id, worker_id,
        machine_identity_sha256, engine_version, canonical_hash_schema,
        created_at_ms
      ) VALUES (
        1, 1, '${LEGACY_V1_SCHEMA_MANIFEST_SHA256}', 'legacy-store-a',
        'controller', 'controller-a', 'controller-a', NULL, NULL,
        'state-store-test-v1', 'seerrng-canonical-json-sha256/v1', 10
      );
      DROP TABLE distributed_store_metadata_v2;
      CREATE TRIGGER distributed_store_metadata_no_update
        BEFORE UPDATE ON distributed_store_metadata
        BEGIN SELECT RAISE(ABORT, 'distributed store metadata is immutable'); END;
      CREATE TRIGGER distributed_store_metadata_no_delete
        BEFORE DELETE ON distributed_store_metadata
        BEGIN SELECT RAISE(ABORT, 'distributed store metadata is immutable'); END;
      DROP TRIGGER distributed_schema_migration_no_update;
      DROP TRIGGER distributed_schema_migration_no_delete;
      DELETE FROM distributed_schema_migration;
      INSERT INTO distributed_schema_migration (
        version, migration_sha256, applied_at_ms
      ) VALUES (1, '${LEGACY_V1_SCHEMA_MANIFEST_SHA256}', 10);
      CREATE TRIGGER distributed_schema_migration_no_update
        BEFORE UPDATE ON distributed_schema_migration
        BEGIN SELECT RAISE(ABORT, 'distributed schema history is immutable'); END;
      CREATE TRIGGER distributed_schema_migration_no_delete
        BEFORE DELETE ON distributed_schema_migration
        BEGIN SELECT RAISE(ABORT, 'distributed schema history is immutable'); END;
      PRAGMA user_version = 1;
    `);
  });
}

function writer(token, processId, processStartedAtMs) {
  return { token, processId, processStartedAtMs };
}

function initialize(path, overrides = {}) {
  return initializeDistributedStateStore({
    ...rootOptions(path),
    engineVersion: 'state-store-test-v2',
    writer: writer('writer-a', 101, 1),
    initializedAtMs: 10,
    documentVerifiers: {},
    storeId: 'store-a',
    ...overrides,
  });
}

function transition(occurredAtMs) {
  return { occurredAtMs };
}

function casHead(head) {
  return {
    revision: head.revision,
    headEntrySha256: head.headEntrySha256,
    snapshotContractSha256: head.snapshotContractSha256,
  };
}

function submission(label) {
  return sealDistributedAppSubmission({
    schema: DISTRIBUTED_APP_SUBMISSION_SCHEMA,
    controllerId: 'controller-a',
    submissionId: `submission-${label}`,
    applicationId: `application-${label}`,
    testSuiteId: `suite-${label}`,
    repositoryIdentitySha256: hash(`repository-${label}`),
    revisionIdentitySha256: hash(`revision-${label}`),
    inventoryIdentitySha256: hash(`inventory-${label}`),
    taskCatalogIdentitySha256: hash(`task-catalog-${label}`),
    adapters: [
      {
        adapterId: 'node-native',
        adapterIdentitySha256: hash(`adapter-${label}`),
      },
    ],
    profileIdentitySha256: hash(`profile-${label}`),
    cacheIdentitySha256: hash(`cache-${label}`),
    evidenceIdentitySha256: hash(`evidence-${label}`),
    resultsIdentitySha256: hash(`results-${label}`),
    failureIdentitySha256: hash(`failure-${label}`),
    planSha256: hash(`plan-${label}`),
  });
}

function binding(overrides = {}) {
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
    ...overrides,
  };
}

function brokerTask(bound = binding()) {
  return sealBrokerTask({
    applicationIsolationKeySha256: brokerApplicationIsolationKeySha256(bound),
    taskId: 'task-node-a',
    unitId: 'unit-node',
    caseId: 'case-node-a',
    adapterId: 'node-native',
    assignment: {
      workerId: 'worker-a',
      slotId: 'worker-a.slot-1',
      slotIndex: 1,
      slotPosition: 1,
    },
    dependencyTaskIds: [],
    timeoutMs: 1_000,
    maxAttempts: 2,
    payload: {
      schema: 'seerrng-distributed-task-payload/v1',
      argv: ['--test', 'bin/example.test.mjs'],
    },
    expectedEvidence: [
      {
        evidenceId: 'native-log',
        schema: 'seerrng-native-log-v1',
        mediaType: 'text/plain',
        required: true,
      },
    ],
  });
}

function brokerState(bound = binding(), task = brokerTask(bound)) {
  return createBrokerLeaseState({
    binding: bound,
    expectedTasks: [task],
    workerConfig: {
      schema: BROKER_WORKER_CONFIG_SCHEMA,
      controllerId: bound.controllerId,
      workers: [
        {
          workerId: 'worker-a',
          machineIdentitySha256: hash('worker-a-machine'),
          enabled: true,
          configuredN: 1,
        },
      ],
    },
  });
}

function workerAttempt(bound = binding(), task = brokerTask(bound)) {
  return createDistributedWorkerAttemptState({
    binding: bound,
    bridgeSha256: hash('bridge-a'),
    applicationIsolationKeySha256: brokerApplicationIsolationKeySha256(bound),
    task,
    lease: {
      leaseId: 'lease-a-1',
      attempt: 1,
      workerId: 'worker-a',
      machineIdentitySha256: hash('worker-a-machine'),
      instanceId: 'worker-a-boot-1',
      workerSessionId: 'worker-a-session-1',
      grantedAtMs: 100,
      expiresAtMs: 1_100,
    },
    sourceWorkspaceIdentitySha256: hash('source-workspace-a'),
    adapters: [
      {
        adapterId: 'node-native',
        adapterIdentitySha256: hash('node-native-adapter'),
      },
    ],
    createdAtMs: 110,
  });
}

test('history entries are deterministic and the adapter fails closed without its pinned driver', (t) => {
  const input = {
    storeId: 'store-a',
    streamKind: 'queue',
    streamId: 'controller-a',
    revision: 0,
    previousEntrySha256: '0'.repeat(64),
    previousSnapshotContractSha256: '0'.repeat(64),
    snapshotSchema: 'seerrng-distributed-controller-queue/v2',
    snapshotContractSha256: hash('snapshot-contract'),
    snapshotContentSha256: hash('snapshot-content'),
    snapshotBytes: 128,
    transitionKind: 'genesis',
    transitionInputSha256: hash('transition-input'),
    transitionRecordSha256: hash('transition-record'),
    occurredAtMs: 10,
    writerEpoch: 1,
  };
  const first = createDistributedStateHistoryEntry(input);
  const reordered = createDistributedStateHistoryEntry(
    Object.fromEntries(Object.entries(input).reverse())
  );

  assert.deepEqual(first, reordered);
  assert.equal(Object.isFrozen(first), true);
  assert.match(first.entrySha256, /^[a-f0-9]{64}$/);

  const adapter = createBetterSqlite3StateStoreAdapter({
    loader: () => {
      throw new Error('driver unavailable');
    },
  });
  assert.throws(
    () => adapter.open('unused.sqlite', { fileMustExist: true, timeoutMs: 1 }),
    /requires pinned better-sqlite3/
  );
  const legacyPath = databasePath(t, 'state-store-legacy-options');
  const initialization = {
    ...rootOptions(legacyPath),
    engineVersion: 'state-store-test-v2',
    writer: writer('writer-a', 101, 1),
    initializedAtMs: 10,
    documentVerifiers: {},
  };
  assert.throws(
    () =>
      initializeDistributedStateStore({
        ...initialization,
        databasePath: legacyPath,
      }),
    /unsupported field: databasePath/
  );
  assert.throws(
    () =>
      initializeDistributedStateStore({
        ...initialization,
        owner: { role: 'controller' },
      }),
    /unsupported field: owner/
  );
  assert.throws(
    () =>
      initialize(databasePath(t, 'state-store-injected-adapter'), {
        adapter: createBetterSqlite3StateStoreAdapter(),
      }),
    /unsupported field: adapter/
  );
});

test('schema v2 binds one admitted root and reopens only its derived database', (t) => {
  const path = databasePath(t, 'state-store-schema');

  assert.throws(
    () =>
      openDistributedStateStore(
        openOptions(path, { writer: writer('writer-a', 101, 1) })
      ),
    /state directory is missing|file is missing/
  );

  const store = initialize(path);
  const database = openDatabase(path);
  assert.equal(store.metadata.storeId, 'store-a');
  assert.equal(store.databasePath, path);
  assert.equal(store.writerEpoch, 1);
  assert.equal('database' in store, false);
  assert.equal('writer' in store, false);
  assert.equal(store.writer, undefined);
  const root = rootContracts.get(path);
  assert.equal(
    store.metadata.owner.machineIdentitySha256,
    root.config.machineIdentitySha256
  );
  assert.equal(store.metadata.owner.controllerId, 'controller-a');
  assert.deepEqual(store.metadata.rootBinding, {
    rootIdentitySha256: root.config.rootIdentitySha256,
    rootConfigSha256: root.config.configSha256,
    rootMarkerSha256: root.marker.markerSha256,
    rootObjectFingerprintSha256: canonicalJsonSha256(
      root.config.rootObjectFingerprint
    ),
    recoveryPolicySha256: root.config.recoveryPolicySha256,
  });
  assert.throws(
    () => new store.constructor(Symbol('forged-state-store'), {}),
    /construction is private/
  );
  assert.throws(() => {
    store.metadata = { storeId: 'forged' };
  }, TypeError);
  assert.throws(() => {
    store.writerEpoch = 999;
  }, TypeError);
  assert.equal(
    database.pragma('application_id', { simple: true }),
    DISTRIBUTED_STATE_STORE_APPLICATION_ID
  );
  assert.equal(
    database.pragma('user_version', { simple: true }),
    DISTRIBUTED_STATE_STORE_SCHEMA_VERSION
  );
  assert.equal(
    database.pragma('page_size', { simple: true }),
    DISTRIBUTED_STATE_STORE_PAGE_SIZE
  );
  assert.equal(database.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(
    database
      .prepare(
        `SELECT schema_manifest_sha256, machine_identity_sha256,
                root_identity_sha256, root_config_sha256,
                root_marker_sha256, root_object_fingerprint_sha256,
                recovery_policy_sha256
         FROM distributed_store_metadata WHERE singleton = 1`
      )
      .get().schema_manifest_sha256,
    DISTRIBUTED_STATE_STORE_SCHEMA_MANIFEST_SHA256
  );
  assert.equal(
    database
      .prepare(
        'SELECT machine_identity_sha256 FROM distributed_store_metadata WHERE singleton = 1'
      )
      .get().machine_identity_sha256,
    root.config.machineIdentitySha256
  );
  const persistedBinding = database
    .prepare(
      `SELECT root_identity_sha256 AS rootIdentitySha256,
              root_config_sha256 AS rootConfigSha256,
              root_marker_sha256 AS rootMarkerSha256,
              root_object_fingerprint_sha256 AS rootObjectFingerprintSha256,
              recovery_policy_sha256 AS recoveryPolicySha256
       FROM distributed_store_metadata WHERE singleton = 1`
    )
    .get();
  assert.deepEqual(persistedBinding, store.metadata.rootBinding);
  assert.throws(() => initialize(path), /already exists/);
  assert.throws(
    () =>
      database
        .prepare(
          "UPDATE distributed_store_metadata SET engine_version = 'changed' WHERE singleton = 1"
        )
        .run(),
    /immutable/
  );
  database.close();
  store.close();

  const reopened = openDistributedStateStore(openOptions(path));
  assert.equal(reopened.writerEpoch, 2);
  assert.throws(
    () =>
      openDistributedStateStore({
        ...openOptions(path),
        owner: { role: 'controller' },
        writer: writer('writer-c', 303, 30),
      }),
    /unsupported field: owner/
  );
  assert.throws(
    () =>
      openDistributedStateStore({
        ...openOptions(path),
        writer: writer('writer-c', 303, 30),
        adapter: createBetterSqlite3StateStoreAdapter(),
      }),
    /unsupported field: adapter/
  );
  reopened.close();
});

test('copied state cannot transfer authority to another admitted root', (t) => {
  const sourcePath = databasePath(t, 'state-store-copy-source');
  const destinationPath = databasePath(t, 'state-store-copy-destination');
  const source = rootContracts.get(sourcePath);
  const destination = rootContracts.get(destinationPath);
  const store = initialize(sourcePath, { storeId: 'copied-root-store' });
  store.close();

  mkdirSync(destination.paths.stateDirectory, { mode: 0o700 });
  copyFileSync(sourcePath, destinationPath);

  assert.throws(
    () =>
      openDistributedStateStore({
        ...openOptions(destinationPath),
        expectations: source.expectations,
      }),
    /config hash does not match|root identity hash does not match/
  );
  assert.throws(
    () => openDistributedStateStore(openOptions(destinationPath)),
    /belongs to another admitted root/
  );
});

test('persisted owner metadata cannot transfer authority', (t) => {
  const path = databasePath(t, 'state-store-owner-tamper');
  const store = initialize(path);
  store.close();
  withDatabase(path, (database) => {
    database.exec(`
      DROP TRIGGER distributed_store_metadata_no_update;
      UPDATE distributed_store_metadata
      SET owner_id = 'controller-b', controller_id = 'controller-b'
      WHERE singleton = 1;
      CREATE TRIGGER distributed_store_metadata_no_update
        BEFORE UPDATE ON distributed_store_metadata
        BEGIN SELECT RAISE(ABORT, 'distributed store metadata is immutable'); END;
    `);
  });

  assert.throws(
    () => openDistributedStateStore(openOptions(path)),
    /belongs to another owner/
  );
});

test('open rejects schema v1 instead of silently migrating it', (t) => {
  const path = databasePath(t, 'state-store-v1-rejection');
  const store = initialize(path);
  store.close();
  rewriteAsLegacyV1Store(path);
  withDatabase(path, (database) => {
    assert.equal(database.pragma('user_version', { simple: true }), 1);
    assert.deepEqual(
      database
        .pragma('table_info(distributed_store_metadata)')
        .map((column) => column.name),
      [
        'singleton',
        'schema_version',
        'schema_manifest_sha256',
        'store_id',
        'owner_role',
        'owner_id',
        'controller_id',
        'worker_id',
        'machine_identity_sha256',
        'engine_version',
        'canonical_hash_schema',
        'created_at_ms',
      ]
    );
    assert.deepEqual(
      database
        .prepare(
          `SELECT schema_version AS schemaVersion,
                  schema_manifest_sha256 AS schemaManifestSha256
           FROM distributed_store_metadata WHERE singleton = 1`
        )
        .get(),
      {
        schemaVersion: 1,
        schemaManifestSha256: LEGACY_V1_SCHEMA_MANIFEST_SHA256,
      }
    );
    assert.deepEqual(
      database
        .prepare(
          `SELECT version, migration_sha256 AS migrationSha256
           FROM distributed_schema_migration`
        )
        .get(),
      {
        version: 1,
        migrationSha256: LEGACY_V1_SCHEMA_MANIFEST_SHA256,
      }
    );
  });

  assert.throws(
    () => openDistributedStateStore(openOptions(path)),
    /schema version is unsupported/
  );
});

test('an open store re-admits its marker before every database operation', (t) => {
  const path = databasePath(t, 'state-store-marker-readmission');
  const root = rootContracts.get(path);
  const store = initialize(path);
  const replacementMarker = createDistributedLocalStateRootMarker({
    config: root.config,
    createdAtMs: 13,
  });
  writeFileSync(root.paths.markerPath, JSON.stringify(replacementMarker));

  assert.throws(() => store.heartbeatWriter(), /marker hash does not match/);
  assert.throws(
    () => store.close({ releaseFence: false }),
    /marker hash does not match|admission changed while closing/
  );
  assert.equal(store.closed, true);
});

test('an open store rejects state-directory identity drift', (t) => {
  const path = databasePath(t, 'state-store-directory-drift');
  const root = rootContracts.get(path);
  const store = initialize(path);
  const originalMode = Number(
    lstatSync(root.paths.stateDirectory, { bigint: true }).mode & 0o777n
  );
  chmodSync(
    root.paths.stateDirectory,
    process.platform === 'win32' ? 0o444 : 0o755
  );
  try {
    assert.throws(
      () => store.heartbeatWriter(),
      /state directory identity drifted/
    );
    assert.throws(
      () => store.close({ releaseFence: false }),
      /state directory identity drifted|admission changed while closing/
    );
    assert.equal(store.closed, true);
  } finally {
    chmodSync(root.paths.stateDirectory, originalMode);
  }
});

test(
  'an open POSIX store rejects database inode replacement',
  { skip: process.platform === 'win32' },
  (t) => {
    const path = databasePath(t, 'state-store-database-drift');
    const root = rootContracts.get(path);
    const store = initialize(path);
    const displacedPath = join(root.paths.stateDirectory, 'displaced.sqlite');
    renameSync(path, displacedPath);
    copyFileSync(displacedPath, path);
    chmodSync(path, 0o600);

    assert.throws(() => store.heartbeatWriter(), /database identity drifted/);
    rmSync(path);
    renameSync(displacedPath, path);
    store.close({ releaseFence: false });
    assert.equal(store.closed, true);
  }
);

test('writer fencing rejects duplicate owners and obeys sealed recovery policy', (t) => {
  const path = databasePath(t, 'state-store-fence', {
    staleWriterAfterMs: 60_000,
  });
  const original = initialize(path);

  assert.throws(
    () =>
      openDistributedStateStore(
        openOptions(path, { writer: writer('writer-a', 101, 1) })
      ),
    /already has an active writer/
  );

  withDatabase(path, (database) => {
    const staleAtMs = Date.now() - 120_000;
    database
      .prepare(
        `UPDATE distributed_writer_fence
         SET acquired_at_ms = ?, heartbeat_at_ms = ?
         WHERE singleton = 1 AND epoch = 1 AND owner_token = 'writer-a'`
      )
      .run(staleAtMs, staleAtMs);
  });

  assert.throws(
    () =>
      openDistributedStateStore(
        openOptions(path, { writer: writer('writer-b', 202, 20) })
      ),
    /recovery policy forbids stale-writer takeover/
  );
  assert.throws(
    () =>
      openDistributedStateStore({
        ...openOptions(path),
        staleWriterAfterMs: 50,
      }),
    /unsupported field: staleWriterAfterMs/
  );
  assert.throws(
    () =>
      openDistributedStateStore({
        ...openOptions(path),
        allowStaleWriterTakeover: true,
      }),
    /unsupported field: allowStaleWriterTakeover/
  );
  original.close();
});

test('sealed stale takeover fences a still-open predecessor', (t) => {
  const path = databasePath(t, 'state-store-live-predecessor-takeover', {
    allowStaleWriterTakeover: true,
    staleWriterAfterMs: 600_000,
  });
  const original = initialize(path);
  withDatabase(path, (database) => {
    const staleAtMs = Date.now() - 120_000;
    database
      .prepare(
        `UPDATE distributed_writer_fence
         SET acquired_at_ms = ?, heartbeat_at_ms = ?
         WHERE singleton = 1 AND epoch = 1 AND owner_token = 'writer-a'`
      )
      .run(staleAtMs, staleAtMs);
  });
  assert.throws(
    () =>
      openDistributedStateStore(
        openOptions(path, { writer: writer('writer-too-early', 202, 20) })
      ),
    /already has an active writer/
  );
  withDatabase(path, (database) => {
    const staleAtMs = Date.now() - 1_200_000;
    database
      .prepare(
        `UPDATE distributed_writer_fence
         SET acquired_at_ms = ?, heartbeat_at_ms = ?
         WHERE singleton = 1 AND epoch = 1 AND owner_token = 'writer-a'`
      )
      .run(staleAtMs, staleAtMs);
  });

  const takeover = openDistributedStateStore(
    openOptions(path, { writer: writer('writer-takeover', 303, 30) })
  );
  assert.equal(takeover.writerEpoch, 2);
  assert.throws(() => original.heartbeatWriter(), /writer fence was lost/);
  assert.throws(() => original.close(), /writer fence was lost/);
  assert.equal(original.closed, true);
  assert.throws(() => original.heartbeatWriter(), /store is closed/);
  takeover.close();
});

test('crash-style close recovers only through the sealed takeover policy', (t) => {
  const path = databasePath(t, 'state-store-crash-reopen', {
    allowStaleWriterTakeover: true,
    staleWriterAfterMs: 60_000,
  });
  const store = initialize(path);
  const queue = createDistributedControllerQueue({
    controllerId: 'controller-a',
  });
  const head = store.persistQueueSnapshot({
    queue,
    transition: transition(10),
  });
  assert.equal(head.writerEpoch, 1);
  store.close({ releaseFence: false });

  assert.throws(
    () =>
      openDistributedStateStore(
        openOptions(path, {
          writer: writer('writer-crash-reopen', 202, 20),
        })
      ),
    /already has an active writer/
  );
  withDatabase(path, (database) => {
    const staleAtMs = Date.now() - 120_000;
    database
      .prepare(
        `UPDATE distributed_writer_fence
         SET acquired_at_ms = ?, heartbeat_at_ms = ?
         WHERE singleton = 1 AND epoch = 1 AND owner_token = 'writer-a'`
      )
      .run(staleAtMs, staleAtMs);
  });
  const recovered = openDistributedStateStore(
    openOptions(path, {
      writer: writer('writer-crash-reopen', 202, 20),
    })
  );
  assert.equal(recovered.writerEpoch, 2);
  assert.deepEqual(recovered.rehydrateQueueSnapshot(), queue);
  recovered.close();
});

test('writer acquisition advances beyond every persisted history epoch', (t) => {
  const path = databasePath(t, 'state-store-epoch-reconciliation');
  const store = initialize(path);
  store.persistQueueSnapshot({
    queue: createDistributedControllerQueue({ controllerId: 'controller-a' }),
    transition: transition(20),
  });
  store.close();

  const database = openDatabase(path);
  assert.equal(
    database
      .prepare(
        'SELECT MAX(writer_epoch) AS maximum_epoch FROM distributed_state_history'
      )
      .get().maximum_epoch,
    1
  );
  database
    .prepare(
      `UPDATE distributed_writer_fence SET epoch = 0
       WHERE singleton = 1 AND owner_token IS NULL`
    )
    .run();
  database.close();

  const reopened = openDistributedStateStore(
    openOptions(path, { writer: writer('writer-b', 202, 21) })
  );
  assert.equal(reopened.writerEpoch, 2);
  reopened.close();
});

test('nonmonotonic event provenance never controls writer heartbeat, takeover, or close', (t) => {
  const path = databasePath(t, 'state-store-event-time');
  let store = initialize(path);
  const futureEventAtMs = Date.now() + 86_400_000;
  const emptyQueue = createDistributedControllerQueue({
    controllerId: 'controller-a',
  });
  const genesis = store.persistQueueSnapshot({
    queue: emptyQueue,
    transition: transition(futureEventAtMs),
  });
  const firstHeartbeatAtMs = withDatabase(
    path,
    (database) =>
      database
        .prepare(
          `SELECT heartbeat_at_ms FROM distributed_writer_fence
         WHERE singleton = 1`
        )
        .get().heartbeat_at_ms
  );
  assert.ok(firstHeartbeatAtMs < futureEventAtMs);

  store.heartbeatWriter();
  const queued = enqueueDistributedApp(emptyQueue, submission('event-time'));
  const head = store.persistQueueSnapshot({
    queue: queued,
    expectedHead: casHead(genesis),
    transition: transition(1),
  });
  assert.equal(head.occurredAtMs, 1);
  const { heartbeatAtMs, historyTimes } = withDatabase(path, (database) => ({
    heartbeatAtMs: database
      .prepare(
        `SELECT heartbeat_at_ms FROM distributed_writer_fence
         WHERE singleton = 1`
      )
      .get().heartbeat_at_ms,
    historyTimes: database
      .prepare(
        `SELECT occurred_at_ms FROM distributed_state_history
         WHERE stream_kind = 'queue' AND stream_id = ? ORDER BY revision`
      )
      .all('controller-a')
      .map((row) => row.occurred_at_ms),
  }));
  assert.ok(heartbeatAtMs >= firstHeartbeatAtMs);
  assert.notEqual(heartbeatAtMs, 1);
  assert.deepEqual(historyTimes, [futureEventAtMs, 1]);
  assert.throws(
    () =>
      openDistributedStateStore(
        openOptions(path, {
          writer: writer('writer-event-contender', 303, 30),
        })
      ),
    /already has an active writer/
  );

  store.close();
  store = openDistributedStateStore(
    openOptions(path, {
      writer: writer('writer-event-reopen', 404, 40),
    })
  );
  assert.deepEqual(store.rehydrateQueueSnapshot(), queued);
  store.close();
});

test('sealed documents are immutable, idempotent, and verified on read', (t) => {
  const path = databasePath(t, 'state-store-document');
  const document = {
    schema: 'seerrng-test-document/v1',
    documentId: 'document-a',
    value: 'sealed',
  };
  const contractSha256 = hash('document-a-contract');
  const verifyDocument = (value, expectedContractSha256) => {
    assert.equal(expectedContractSha256, contractSha256);
    assert.equal(value.schema, document.schema);
    assert.equal(value.documentId, document.documentId);
    return value;
  };
  const documentVerifiers = {
    'async-document': async (value) => value,
    'test-document': verifyDocument,
  };
  let store = initialize(path, { documentVerifiers });

  assert.throws(
    () =>
      store.putSealedDocument({
        documentKind: 'async-document',
        contractSha256: hash('async-document-contract'),
        value: { schema: 'seerrng-async-document/v1' },
        createdAtMs: 19,
      }),
    /must be synchronous/
  );

  assert.deepEqual(
    store.putSealedDocument({
      documentKind: 'test-document',
      contractSha256,
      value: document,
      createdAtMs: 20,
    }),
    document
  );
  assert.deepEqual(
    store.putSealedDocument({
      documentKind: 'test-document',
      contractSha256,
      value: document,
      createdAtMs: 21,
    }),
    document
  );
  assert.deepEqual(
    store.getSealedDocument({
      documentKind: 'test-document',
      contractSha256,
    }),
    document
  );
  assert.throws(
    () =>
      store.putSealedDocument({
        documentKind: 'test-document',
        contractSha256,
        value: { ...document, value: 'conflict' },
        createdAtMs: 22,
      }),
    /Conflicting document/
  );
  assert.throws(
    () =>
      withDatabase(path, (database) =>
        database
          .prepare(
            "UPDATE distributed_sealed_document SET document_schema = 'changed'"
          )
          .run()
      ),
    /immutable/
  );
  store.close();

  assert.throws(
    () =>
      openDistributedStateStore(
        openOptions(path, {
          writer: writer('writer-b', 202, 23),
        })
      ),
    /no registered verifier/
  );
  assert.throws(
    () =>
      openDistributedStateStore({
        ...openOptions(path),
        writer: writer('writer-b', 202, 23),
        documentVerifiers: {
          'test-document': (value) => ({ ...value, value: 'changed' }),
        },
      }),
    /does not exactly match persisted content/
  );

  let verificationCalls = 0;
  assert.throws(
    () =>
      openDistributedStateStore({
        ...openOptions(path),
        writer: writer('writer-b', 202, 23),
        documentVerifiers: {
          'test-document': (value, expectedContractSha256) => {
            verificationCalls += 1;
            if (verificationCalls === 2)
              throw new Error('second semantic verification failed');
            return verifyDocument(value, expectedContractSha256);
          },
        },
      }),
    /second semantic verification failed/
  );
  assert.equal(verificationCalls, 2);

  store = openDistributedStateStore(
    openOptions(path, {
      writer: writer('writer-b', 202, 23),
      documentVerifiers,
    })
  );
  assert.equal(store.writerEpoch, 2);
  assert.deepEqual(
    store.getSealedDocument({
      documentKind: 'test-document',
      contractSha256,
    }),
    document
  );
  store.close();
});

test('queue, broker, and worker-attempt snapshots persist through verified CAS history and rehydrate', (t) => {
  const controllerPath = databasePath(t, 'controller-state-snapshots');
  const workerPath = databasePath(t, 'worker-state-snapshots', {
    role: 'worker',
  });
  const wrongWorkerPath = databasePath(t, 'wrong-worker-state-snapshots', {
    role: 'worker',
    workerId: 'worker-b',
  });
  const wrongMachinePath = databasePath(t, 'wrong-machine-state-snapshots', {
    role: 'worker',
    machineIdentitySha256: hash('worker-a-machine-2'),
  });
  const wrongControllerPath = databasePath(
    t,
    'wrong-controller-state-snapshots',
    {
      role: 'worker',
      controllerId: 'controller-b',
    }
  );
  let controllerStore = initialize(controllerPath);

  const emptyQueue = createDistributedControllerQueue({
    controllerId: 'controller-a',
  });
  assert.throws(
    () =>
      controllerStore.persistQueueSnapshot({
        queue: emptyQueue,
        transition: transition(20),
        unexpected: true,
      }),
    /unsupported field: unexpected/
  );
  assert.throws(
    () =>
      controllerStore.persistQueueSnapshot({
        queue: emptyQueue,
        transition: {
          occurredAtMs: 20,
          kind: 'caller-authored-genesis',
          inputSha256: hash('caller-authored-input'),
          record: { forged: true },
        },
      }),
    /exact field set/
  );
  const queueGenesis = controllerStore.persistQueueSnapshot({
    queue: emptyQueue,
    transition: transition(20),
  });
  assert.equal(queueGenesis.revision, 0);
  assert.deepEqual(controllerStore.rehydrateQueueSnapshot(), emptyQueue);
  assert.throws(
    () => controllerStore.rehydrateQueueSnapshot({ unexpected: true }),
    /unsupported field: unexpected/
  );

  const queued = enqueueDistributedApp(emptyQueue, submission('alpha'));
  const queueHead = controllerStore.persistQueueSnapshot({
    queue: queued,
    expectedHead: casHead(queueGenesis),
    transition: transition(30),
  });
  assert.equal(queueHead.revision, 1);
  assert.deepEqual(controllerStore.rehydrateQueueSnapshot(), queued);
  const queueHistory = withDatabase(controllerPath, (database) =>
    database
      .prepare(
        `SELECT * FROM distributed_state_history
         WHERE stream_kind = 'queue' AND stream_id = ? AND revision = 1`
      )
      .get('controller-a')
  );
  const queueTransitionRecord = JSON.parse(queueHistory.transition_record_json);
  assert.deepEqual(queueTransitionRecord, {
    schema: DISTRIBUTED_STATE_TRANSITION_RECORD_SCHEMA,
    streamKind: 'queue',
    streamId: 'controller-a',
    previousSnapshotContractSha256: emptyQueue.queueSha256,
    snapshotContractSha256: queued.queueSha256,
    kind: 'enqueue',
    inputSha256: queued.submissions[0].submission.submissionSha256,
    occurredAtMs: 30,
  });
  assert.equal(queueHistory.transition_kind, queueTransitionRecord.kind);
  assert.equal(
    queueHistory.transition_input_sha256,
    queueTransitionRecord.inputSha256
  );
  assert.equal(
    queueHistory.transition_record_sha256,
    canonicalJsonSha256(queueTransitionRecord)
  );

  const twiceQueued = enqueueDistributedApp(queued, submission('beta'));
  assert.throws(
    () =>
      controllerStore.persistQueueSnapshot({
        queue: twiceQueued,
        expectedHead: casHead(queueGenesis),
        transition: transition(40),
      }),
    /CAS head is stale/
  );
  assert.throws(
    () =>
      controllerStore.persistQueueSnapshot({
        queue: queued,
        expectedHead: casHead(queueHead),
        transition: transition(40),
      }),
    /no-op must not create history/
  );
  assert.deepEqual(
    controllerStore.readStateHead('queue', 'controller-a'),
    queueHead
  );

  const restoredCandidate = rehydrateDistributedControllerQueue(twiceQueued, {
    expectedControllerId: 'controller-a',
    expectedQueueSha256: twiceQueued.queueSha256,
  });
  assert.throws(
    () =>
      controllerStore.persistQueueSnapshot({
        queue: restoredCandidate,
        expectedHead: casHead(queueHead),
        transition: transition(40),
      }),
    /transition provenance/
  );

  const unrelatedFirst = enqueueDistributedApp(
    createDistributedControllerQueue({ controllerId: 'controller-a' }),
    submission('gamma')
  );
  const unrelatedSecond = enqueueDistributedApp(
    unrelatedFirst,
    submission('delta')
  );
  assert.equal(unrelatedSecond.revision, 2);
  assert.throws(
    () =>
      controllerStore.persistQueueSnapshot({
        queue: unrelatedSecond,
        expectedHead: casHead(queueHead),
        transition: transition(40),
      }),
    /exact previous queue/
  );
  assert.throws(
    () =>
      controllerStore.persistQueueSnapshot({
        queue: createDistributedControllerQueue({
          controllerId: 'controller-b',
        }),
        transition: transition(40),
      }),
    /does not belong to this controller state store/
  );

  const bound = binding();
  const task = brokerTask(bound);
  const leases = brokerState(bound, task);
  const otherBound = binding({
    controllerId: 'controller-b',
    executionId: 'execution-b-1',
  });
  const otherLeases = brokerState(otherBound, brokerTask(otherBound));
  assert.throws(
    () =>
      controllerStore.persistBrokerSnapshot({
        streamId: bound.executionId,
        state: leases,
        expectedBindng: bound,
        transition: transition(50),
      }),
    /unsupported field: expectedBindng/
  );
  assert.throws(
    () =>
      controllerStore.persistBrokerSnapshot({
        streamId: otherBound.executionId,
        state: otherLeases,
        expectedBinding: otherBound,
        transition: transition(50),
      }),
    /does not belong to this controller state store/
  );
  assert.throws(
    () =>
      controllerStore.persistBrokerSnapshot({
        streamId: 'not-the-binding-execution',
        state: leases,
        expectedBinding: bound,
        transition: transition(50),
      }),
    /must equal its binding execution identity/
  );
  const restoredLeases = rehydrateBrokerLeaseState(leases, {
    expectedBinding: bound,
    expectedStateSha256: leases.stateSha256,
  });
  assert.throws(
    () =>
      controllerStore.persistBrokerSnapshot({
        streamId: bound.executionId,
        state: restoredLeases,
        expectedBinding: bound,
        transition: transition(50),
      }),
    /transition provenance/
  );
  const brokerHead = controllerStore.persistBrokerSnapshot({
    streamId: bound.executionId,
    state: leases,
    expectedBinding: bound,
    transition: transition(50),
  });
  assert.equal(brokerHead.revision, 0);
  assert.deepEqual(
    controllerStore.rehydrateBrokerSnapshot({
      streamId: bound.executionId,
      expectedBinding: bound,
    }),
    leases
  );
  assert.throws(
    () =>
      controllerStore.rehydrateBrokerSnapshot({
        streamId: bound.executionId,
        expectedBinding: bound,
        unexpected: true,
      }),
    /unsupported field: unexpected/
  );

  controllerStore.close();
  controllerStore = openDistributedStateStore(
    openOptions(controllerPath, {
      writer: writer('writer-b', 202, 60),
    })
  );
  assert.deepEqual(controllerStore.rehydrateQueueSnapshot(), queued);
  assert.deepEqual(
    controllerStore.rehydrateBrokerSnapshot({
      streamId: bound.executionId,
      expectedBinding: bound,
    }),
    leases
  );
  controllerStore.close();

  const pending = workerAttempt(bound, task);
  const wrongWorkerStore = initialize(wrongWorkerPath, {
    storeId: 'worker-store-b',
  });
  assert.throws(
    () =>
      wrongWorkerStore.persistWorkerAttemptSnapshot({
        state: pending,
        transition: transition(110),
      }),
    /does not belong to this worker state store/
  );
  wrongWorkerStore.close();

  const wrongMachineStore = initialize(wrongMachinePath, {
    storeId: 'worker-store-wrong-machine',
  });
  assert.throws(
    () =>
      wrongMachineStore.persistWorkerAttemptSnapshot({
        state: pending,
        transition: transition(110),
      }),
    /does not belong to this worker state store/
  );
  wrongMachineStore.close();

  const wrongControllerStore = initialize(wrongControllerPath, {
    storeId: 'worker-store-wrong-controller',
  });
  assert.throws(
    () =>
      wrongControllerStore.persistWorkerAttemptSnapshot({
        state: pending,
        transition: transition(110),
      }),
    /does not belong to this worker state store/
  );
  wrongControllerStore.close();

  let workerStore = initialize(workerPath, {
    storeId: 'worker-store-a',
  });
  assert.equal(workerStore.metadata.owner.controllerId, 'controller-a');
  assert.equal(
    workerStore.metadata.owner.machineIdentitySha256,
    hash('worker-a-machine')
  );
  assert.throws(
    () =>
      workerStore.persistWorkerAttemptSnapshot({
        state: pending,
        transition: transition(110),
        unexpected: true,
      }),
    /unsupported field: unexpected/
  );
  assert.throws(
    () =>
      workerStore.persistWorkerAttemptSnapshot({
        state: pending,
        transition: transition(111),
      }),
    /does not match authoritative state-machine time/
  );
  const restoredPendingCandidate = rehydrateDistributedWorkerAttemptState(
    JSON.parse(JSON.stringify(pending)),
    { expectedStateSha256: pending.stateSha256 }
  );
  assert.throws(
    () =>
      workerStore.persistWorkerAttemptSnapshot({
        state: restoredPendingCandidate,
        transition: transition(110),
      }),
    /runtime transition provenance/
  );
  const attemptGenesis = workerStore.persistWorkerAttemptSnapshot({
    state: pending,
    transition: transition(110),
  });
  assert.equal(attemptGenesis.revision, 1);
  assert.deepEqual(
    workerStore.rehydrateWorkerAttemptSnapshot({
      attemptIdentitySha256: pending.attemptIdentitySha256,
    }),
    pending
  );
  assert.throws(
    () =>
      workerStore.rehydrateWorkerAttemptSnapshot({
        attemptIdentitySha256: pending.attemptIdentitySha256,
        unexpected: true,
      }),
    /unsupported field: unexpected/
  );

  const running = startDistributedWorkerAttempt(pending, {
    startedAtMs: 120,
    nativeProcess: {
      pid: 8_421,
      processStartIdentitySha256: hash('pid-8421-start-marker'),
      launchIdentitySha256: hash('native-launch-a'),
    },
  });
  assert.throws(
    () =>
      workerStore.persistWorkerAttemptSnapshot({
        state: running,
        expectedHead: casHead(attemptGenesis),
        transition: transition(121),
      }),
    /does not match authoritative state-machine time/
  );
  const restoredRunningCandidate = rehydrateDistributedWorkerAttemptState(
    JSON.parse(JSON.stringify(running)),
    { expectedStateSha256: running.stateSha256 }
  );
  assert.throws(
    () =>
      workerStore.persistWorkerAttemptSnapshot({
        state: restoredRunningCandidate,
        expectedHead: casHead(attemptGenesis),
        transition: transition(120),
      }),
    /runtime transition provenance/
  );
  const attemptHead = workerStore.persistWorkerAttemptSnapshot({
    state: running,
    expectedHead: casHead(attemptGenesis),
    transition: transition(120),
  });
  assert.equal(attemptHead.revision, 2);
  assert.deepEqual(
    workerStore.rehydrateWorkerAttemptSnapshot({
      attemptIdentitySha256: running.attemptIdentitySha256,
    }),
    running
  );

  const alternateRunning = startDistributedWorkerAttempt(pending, {
    startedAtMs: 121,
    nativeProcess: {
      pid: 8_422,
      processStartIdentitySha256: hash('pid-8422-start-marker'),
      launchIdentitySha256: hash('native-launch-alternate'),
    },
  });
  const alternateFinished = finishDistributedWorkerAttempt(alternateRunning, {
    finishedAtMs: 125,
    outcome: {
      status: 'passed',
      exitCode: 0,
      completed: true,
      cancelled: false,
      timedOut: false,
    },
    evidenceReferences: [
      {
        referenceId: 'native-log',
        schema: 'seerrng-native-log-v1',
        mediaType: 'text/plain',
        bytes: 128,
        sha256: hash('alternate-native-log-content'),
        storageIdentitySha256: hash('alternate-native-log-storage'),
      },
    ],
    resultReference: {
      referenceId: 'result',
      schema: 'seerrng-artifact/v1',
      mediaType: 'application/json',
      bytes: 128,
      sha256: hash('alternate-result-content'),
      storageIdentitySha256: hash('alternate-result-storage'),
    },
    failureReference: null,
  });
  assert.equal(alternateFinished.revision, 3);
  assert.throws(
    () =>
      workerStore.persistWorkerAttemptSnapshot({
        state: alternateFinished,
        expectedHead: casHead(attemptHead),
        transition: transition(125),
      }),
    /not linked to its predecessor/
  );

  workerStore.close();
  workerStore = openDistributedStateStore(
    openOptions(workerPath, {
      writer: writer('writer-b', 202, 130),
    })
  );
  assert.deepEqual(
    workerStore.rehydrateWorkerAttemptSnapshot({
      attemptIdentitySha256: running.attemptIdentitySha256,
    }),
    running
  );
  workerStore.close();
});

test('open fails closed when a schema object is removed', (t) => {
  const path = databasePath(t, 'state-store-schema-corruption');
  const store = initialize(path);
  store.close();

  const database = openDatabase(path);
  database.exec('DROP TRIGGER distributed_state_history_no_update');
  database.close();

  assert.throws(
    () =>
      openDistributedStateStore(
        openOptions(path, { writer: writer('writer-b', 202, 20) })
      ),
    /schema objects do not match v2/
  );
});

test('open rejects every rogue non-internal schema name and object type', (t) => {
  const cases = [
    {
      label: 'table',
      sql: `CREATE TABLE rogue_state_table (
              value TEXT NOT NULL
            ) STRICT`,
    },
    {
      label: 'index',
      sql: `CREATE INDEX rogue_state_index
            ON distributed_state_history (stream_id)`,
    },
    {
      label: 'trigger',
      sql: `CREATE TRIGGER rogue_state_trigger
            AFTER UPDATE ON distributed_writer_fence
            BEGIN SELECT 1; END`,
    },
    {
      label: 'view',
      sql: `CREATE VIEW rogue_state_view AS
            SELECT epoch FROM distributed_writer_fence`,
    },
  ];
  for (const [index, entry] of cases.entries()) {
    const path = databasePath(t, `state-store-rogue-${entry.label}`);
    const store = initialize(path, { storeId: `store-rogue-${index}` });
    store.close();
    const database = openDatabase(path);
    database.exec(entry.sql);
    database.close();
    assert.throws(
      () =>
        openDistributedStateStore(
          openOptions(path, {
            writer: writer(`writer-rogue-${index}`, 300 + index, 20),
          })
        ),
      /schema objects do not match v2/
    );
  }
});

test('reopen rejects transition JSON, row, and hash tampering after its immutable trigger is restored', (t) => {
  const cases = [
    {
      label: 'json',
      tamper(database) {
        const row = database
          .prepare(
            `SELECT transition_record_json FROM distributed_state_history
             WHERE stream_kind = 'queue' AND stream_id = 'controller-a'`
          )
          .get();
        const record = JSON.parse(row.transition_record_json);
        database
          .prepare(
            `UPDATE distributed_state_history SET transition_record_json = ?
             WHERE stream_kind = 'queue' AND stream_id = 'controller-a'`
          )
          .run(JSON.stringify({ ...record, kind: 'forged-json' }));
      },
    },
    {
      label: 'row',
      tamper(database) {
        database
          .prepare(
            `UPDATE distributed_state_history SET transition_kind = 'forged-row'
             WHERE stream_kind = 'queue' AND stream_id = 'controller-a'`
          )
          .run();
      },
    },
    {
      label: 'hash',
      tamper(database) {
        database
          .prepare(
            `UPDATE distributed_state_history SET transition_record_sha256 = ?
             WHERE stream_kind = 'queue' AND stream_id = 'controller-a'`
          )
          .run(hash('forged-transition-record'));
      },
    },
  ];
  for (const [index, entry] of cases.entries()) {
    const path = databasePath(
      t,
      `state-store-transition-tamper-${entry.label}`
    );
    const store = initialize(path, { storeId: `tamper-store-${index}` });
    store.persistQueueSnapshot({
      queue: createDistributedControllerQueue({
        controllerId: 'controller-a',
      }),
      transition: transition(10),
    });
    store.close();

    withDatabase(path, (database) => {
      database.exec('DROP TRIGGER distributed_state_history_no_update');
      entry.tamper(database);
      database.exec(`CREATE TRIGGER distributed_state_history_no_update
        BEFORE UPDATE ON distributed_state_history
        BEGIN SELECT RAISE(ABORT, 'distributed state history is immutable'); END`);
    });

    assert.throws(
      () =>
        openDistributedStateStore(
          openOptions(path, {
            writer: writer(`writer-tamper-${index}`, 500 + index, 20),
          })
        ),
      /transition record hash does not match|not bound to its state history entry/
    );
  }
});

test(
  'Windows admitted roots reject a state junction, hard-linked database, and unsafe sidecar',
  { skip: process.platform !== 'win32' },
  (t) => {
    const reparsePath = databasePath(t, 'state-store-reparse-parent');
    const reparse = rootContracts.get(reparsePath);
    const realDirectory = join(reparse.paths.root, 'real-state-directory');
    mkdirSync(realDirectory);
    symlinkSync(realDirectory, reparse.paths.stateDirectory, 'junction');
    assert.throws(
      () => initialize(reparsePath),
      /ordinary non-symbolic directory|reparse-point alias|canonical-path alias/
    );

    const realFilePath = databasePath(t, 'state-store-reparse-file');
    const realFileStore = initialize(realFilePath, {
      storeId: 'reparse-file-store',
    });
    realFileStore.close();
    const aliasFilePath = join(
      rootContracts.get(realFilePath).paths.root,
      'alias-state.sqlite'
    );
    linkSync(realFilePath, aliasFilePath);
    assert.throws(
      () =>
        openDistributedStateStore(
          openOptions(realFilePath, {
            writer: writer('writer-alias', 404, 20),
          })
        ),
      /regular non-symbolic file/
    );

    const sidecarPath = databasePath(t, 'state-store-unsafe-sidecar');
    mkdirSync(rootContracts.get(sidecarPath).paths.stateDirectory);
    mkdirSync(`${sidecarPath}-wal`);
    assert.throws(
      () => initialize(sidecarPath),
      /sidecar must be a regular non-symbolic file/
    );
  }
);

test(
  'POSIX admitted roots reject symbolic, linked, and writable state files',
  { skip: process.platform === 'win32' },
  (t) => {
    const symbolicPath = databasePath(t, 'state-store-posix-symbolic-parent');
    const symbolic = rootContracts.get(symbolicPath);
    const realDirectory = join(symbolic.paths.root, 'real-state-directory');
    mkdirSync(realDirectory);
    symlinkSync(realDirectory, symbolic.paths.stateDirectory, 'dir');
    assert.throws(
      () => initialize(symbolicPath),
      /ordinary non-symbolic directory|symbolic-link or reparse-point alias|canonical-path alias/
    );

    const realFilePath = databasePath(t, 'state-store-posix-hard-link');
    const realFileStore = initialize(realFilePath, {
      storeId: 'posix-hard-link-store',
    });
    realFileStore.close();
    const aliasFilePath = join(
      rootContracts.get(realFilePath).paths.root,
      'alias-state.sqlite'
    );
    linkSync(realFilePath, aliasFilePath);
    assert.throws(
      () =>
        openDistributedStateStore(
          openOptions(realFilePath, {
            writer: writer('writer-posix-alias', 601, 20),
          })
        ),
      /regular non-symbolic file/
    );

    const sidecarPath = databasePath(t, 'state-store-posix-hard-sidecar');
    mkdirSync(rootContracts.get(sidecarPath).paths.stateDirectory);
    const sidecarSource = join(
      rootContracts.get(sidecarPath).paths.root,
      'sidecar-source'
    );
    writeFileSync(sidecarSource, 'unsafe-sidecar', 'utf8');
    linkSync(sidecarSource, `${sidecarPath}-wal`);
    assert.throws(
      () => initialize(sidecarPath),
      /sidecar must be a regular non-symbolic file/
    );

    const writableDatabasePath = databasePath(
      t,
      'state-store-posix-writable-database'
    );
    const writableDatabaseStore = initialize(writableDatabasePath, {
      storeId: 'posix-writable-database-store',
    });
    writableDatabaseStore.close();
    chmodSync(
      rootContracts.get(writableDatabasePath).paths.stateDirectory,
      0o755
    );
    chmodSync(writableDatabasePath, 0o660);
    assert.throws(
      () => openDistributedStateStore(openOptions(writableDatabasePath)),
      /database must not be group- or world-writable/
    );

    const writableSidecarPath = databasePath(
      t,
      'state-store-posix-writable-sidecar'
    );
    mkdirSync(rootContracts.get(writableSidecarPath).paths.stateDirectory, {
      mode: 0o755,
    });
    writeFileSync(`${writableSidecarPath}-wal`, 'unsafe-sidecar', 'utf8');
    chmodSync(`${writableSidecarPath}-wal`, 0o660);
    assert.throws(
      () => initialize(writableSidecarPath),
      /sidecar must not be group- or world-writable/
    );
  }
);
