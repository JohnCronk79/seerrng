// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, {
  appendFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, parse, sep } from 'node:path';
import test from 'node:test';

import {
  DISTRIBUTED_LOCAL_STATE_ROOT_CONFIG_SCHEMA,
  DISTRIBUTED_LOCAL_STATE_ROOT_IDENTITY_SCHEMA,
  DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_FILENAME,
  DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_SCHEMA,
  DISTRIBUTED_LOCAL_STATE_ROOT_OBJECT_FINGERPRINT_SCHEMA,
  DISTRIBUTED_LOCALITY_ATTESTATION_SCHEMA,
  DISTRIBUTED_PHYSICAL_LOCALITY_EVIDENCE,
  DISTRIBUTED_STATE_RECOVERY_POLICY_SCHEMA,
  createDistributedLocalStateRootConfig,
  createDistributedLocalStateRootMarker,
  deriveDistributedLocalStateRootPaths,
  verifyDistributedLocalStateRootAdmission,
  verifyDistributedLocalStateRootConfig,
  verifyDistributedLocalStateRootMarker,
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

function configInput(root, overrides = {}) {
  return {
    role: 'controller',
    controllerId: 'controller-a',
    workerId: null,
    machineIdentitySha256: hash('controller-a-machine'),
    platform: process.platform,
    canonicalRoot: root,
    localityAcceptance: {
      status: 'operator-attested-local',
      acceptedAtMs: 10,
      acceptanceId: 'locality-acceptance-a',
    },
    recoveryAcceptance: {
      staleWriterAfterMs: 30_000,
      allowStaleWriterTakeover: false,
      crashRecoveryAccepted: true,
      acceptedAtMs: 11,
      acceptanceId: 'recovery-acceptance-a',
    },
    ...overrides,
  };
}

function sealedRoot(t, label, overrides = {}) {
  const root = temporaryRoot(t, label);
  const config = createDistributedLocalStateRootConfig(
    configInput(root, overrides)
  );
  const marker = createDistributedLocalStateRootMarker({
    config,
    createdAtMs: 12,
  });
  return { root, config, marker };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function remoteWorkerConfig(platform, canonicalRoot) {
  const rootObjectFingerprint = {
    schema: DISTRIBUTED_LOCAL_STATE_ROOT_OBJECT_FINGERPRINT_SCHEMA,
    platform,
    deviceId: '101',
    inodeId: '202',
  };
  const identity = {
    schema: DISTRIBUTED_LOCAL_STATE_ROOT_IDENTITY_SCHEMA,
    role: 'worker',
    controllerId: 'controller-a',
    workerId: 'worker-remote',
    machineIdentitySha256: hash('worker-remote-machine'),
    platform,
    canonicalRoot,
    rootObjectFingerprint,
  };
  const rootIdentitySha256 = canonicalJsonSha256(identity);
  const locality = {
    schema: DISTRIBUTED_LOCALITY_ATTESTATION_SCHEMA,
    rootIdentitySha256,
    evidenceBasis: DISTRIBUTED_PHYSICAL_LOCALITY_EVIDENCE,
    status: 'operator-attested-local',
    acceptedAtMs: 10,
    acceptanceId: 'remote-locality-acceptance',
  };
  const localityAttestation = {
    ...locality,
    attestationSha256: canonicalJsonSha256(locality),
  };
  const recovery = {
    schema: DISTRIBUTED_STATE_RECOVERY_POLICY_SCHEMA,
    rootIdentitySha256,
    staleWriterAfterMs: 30_000,
    allowStaleWriterTakeover: false,
    crashRecoveryAccepted: true,
    acceptedAtMs: 11,
    acceptanceId: 'remote-recovery-acceptance',
  };
  const recoveryPolicy = {
    ...recovery,
    recoveryPolicySha256: canonicalJsonSha256(recovery),
  };
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
  return {
    ...config,
    configSha256: canonicalJsonSha256(config),
  };
}

test('seals and admits a controller-owned local state root', (t) => {
  const { root, config, marker } = sealedRoot(t, 'controller-state-root');
  const initialPaths = deriveDistributedLocalStateRootPaths(config);
  writeFileSync(initialPaths.markerPath, JSON.stringify(marker));
  const admission = verifyDistributedLocalStateRootAdmission({
    config,
    marker,
    expectations: admissionExpectations(config),
  });

  assert.equal(config.schema, DISTRIBUTED_LOCAL_STATE_ROOT_CONFIG_SCHEMA);
  assert.equal(config.rootObjectFingerprint.platform, process.platform);
  assert.match(config.rootObjectFingerprint.deviceId, /^(?:0|[1-9][0-9]*)$/);
  assert.match(config.rootObjectFingerprint.inodeId, /^[1-9][0-9]*$/);
  assert.equal(marker.schema, DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_SCHEMA);
  assert.equal(
    admission.physicalLocalityEvidence,
    DISTRIBUTED_PHYSICAL_LOCALITY_EVIDENCE
  );
  assert.equal(admission.paths.root, root);
  assert.equal(
    admission.paths.markerPath,
    join(root, DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_FILENAME)
  );
  assert.equal(
    admission.paths.databasePath,
    join(root, 'state', 'distributed-state.sqlite3')
  );
  assert.equal(admission.paths.mailboxDirectory, join(root, 'mailbox'));
  assert.equal(admission.paths.blobDirectory, join(root, 'blobs'));
  assert.equal(admission.paths.stagingDirectory, join(root, 'staging'));
  assert.equal(config.recoveryPolicy.allowStaleWriterTakeover, false);
  assert.ok(Object.isFrozen(admission));
  assert.ok(Object.isFrozen(config.localityAttestation));
  assert.ok(Object.isFrozen(config.recoveryPolicy));
  assert.throws(
    () =>
      verifyDistributedLocalStateRootAdmission({
        config,
        marker,
        expectations: {},
      }),
    /admission expectations requires its exact field set/
  );
  assert.throws(
    () =>
      verifyDistributedLocalStateRootAdmission({
        config,
        marker,
        expectations: {
          expectedConfigSha256: undefined,
          expectedControllerId: undefined,
          expectedMachineIdentitySha256: undefined,
          expectedPlatform: undefined,
          expectedRecoveryPolicySha256: undefined,
          expectedRole: undefined,
          expectedRootIdentitySha256: undefined,
          expectedWorkerId: undefined,
        },
      }),
    /admission expectation expectedConfigSha256 must be defined/
  );

  const differentMarker = createDistributedLocalStateRootMarker({
    config,
    createdAtMs: 13,
  });
  writeFileSync(initialPaths.markerPath, JSON.stringify(differentMarker));
  assert.throws(
    () =>
      verifyDistributedLocalStateRootAdmission({
        config,
        marker,
        expectations: admissionExpectations(config),
      }),
    /marker hash does not match/
  );
  writeFileSync(initialPaths.markerPath, '{invalid-json');
  assert.throws(
    () =>
      verifyDistributedLocalStateRootAdmission({
        config,
        marker,
        expectations: admissionExpectations(config),
      }),
    /marker is not valid JSON/
  );
});

test('rejects another valid root against independently frozen policy expectations', (t) => {
  const approved = sealedRoot(t, 'approved-policy-state-root');
  const candidate = sealedRoot(t, 'unapproved-policy-state-root');
  writeFileSync(
    join(candidate.root, DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_FILENAME),
    JSON.stringify(candidate.marker)
  );

  const approvedExpectations = Object.freeze(
    admissionExpectations(approved.config)
  );
  assert.notEqual(
    candidate.config.rootIdentitySha256,
    approved.config.rootIdentitySha256
  );
  assert.throws(
    () =>
      verifyDistributedLocalStateRootAdmission({
        config: candidate.config,
        marker: candidate.marker,
        expectations: approvedExpectations,
      }),
    /config hash does not match|root identity hash does not match/
  );
});

test('rejects a copied marker after the approved root object is replaced', (t) => {
  const { root, config, marker } = sealedRoot(t, 'replaced-state-root');
  writeFileSync(
    join(root, DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_FILENAME),
    JSON.stringify(marker)
  );
  const displacedRoot = `${root}-approved-object`;
  renameSync(root, displacedRoot);
  t.after(() => rmSync(displacedRoot, { force: true, recursive: true }));
  mkdirSync(root);
  writeFileSync(
    join(root, DISTRIBUTED_LOCAL_STATE_ROOT_MARKER_FILENAME),
    JSON.stringify(marker)
  );

  assert.throws(
    () =>
      verifyDistributedLocalStateRootAdmission({
        config,
        marker,
        expectations: admissionExpectations(config),
      }),
    /root object fingerprint does not match/
  );
});

test(
  'bounds the descriptor read and rejects marker growth during admission',
  { concurrency: false },
  (t) => {
    const { config, marker } = sealedRoot(t, 'growing-marker-state-root');
    const paths = deriveDistributedLocalStateRootPaths(config);
    writeFileSync(paths.markerPath, JSON.stringify(marker));
    const originalReadSync = fs.readSync;
    let injectedGrowth = false;
    fs.readSync = (...args) => {
      if (!injectedGrowth) {
        injectedGrowth = true;
        appendFileSync(paths.markerPath, Buffer.alloc(300_000, 0x20));
      }
      return originalReadSync(...args);
    };
    syncBuiltinESMExports();
    try {
      assert.throws(
        () =>
          verifyDistributedLocalStateRootAdmission({
            config,
            marker,
            expectations: admissionExpectations(config),
          }),
        /marker changed during its descriptor read/
      );
      assert.equal(injectedGrowth, true);
    } finally {
      fs.readSync = originalReadSync;
      syncBuiltinESMExports();
    }
  }
);

test('binds worker identity, machine identity, root, and recovery policy', (t) => {
  const { config, marker } = sealedRoot(t, 'worker-state-root', {
    role: 'worker',
    workerId: 'worker-a',
    machineIdentitySha256: hash('worker-a-machine'),
    recoveryAcceptance: {
      staleWriterAfterMs: 45_000,
      allowStaleWriterTakeover: true,
      crashRecoveryAccepted: true,
      acceptedAtMs: 11,
      acceptanceId: 'worker-recovery-acceptance-a',
    },
  });

  const verified = verifyDistributedLocalStateRootConfig(config, {
    expectedControllerId: 'controller-a',
    expectedMachineIdentitySha256: hash('worker-a-machine'),
    expectedRecoveryPolicySha256: config.recoveryPolicySha256,
    expectedRole: 'worker',
    expectedRootIdentitySha256: config.rootIdentitySha256,
    expectedWorkerId: 'worker-a',
  });
  assert.equal(verified.workerId, 'worker-a');
  assert.equal(verified.recoveryPolicy.allowStaleWriterTakeover, true);
  assert.equal(
    verifyDistributedLocalStateRootMarker(marker, {
      expectedConfig: config,
      expectedMarkerSha256: marker.markerSha256,
    }).markerSha256,
    marker.markerSha256
  );
});

test('verifies remote worker root identities with their own path syntax', () => {
  const remotePlatform = process.platform === 'win32' ? 'linux' : 'win32';
  const remoteRoot =
    remotePlatform === 'win32'
      ? 'C:\\seerrng-distributed-state'
      : '/var/lib/seerrng-distributed-state';
  const config = remoteWorkerConfig(remotePlatform, remoteRoot);

  const verified = verifyDistributedLocalStateRootConfig(config, {
    expectedConfigSha256: config.configSha256,
    expectedMachineIdentitySha256: hash('worker-remote-machine'),
    expectedPlatform: remotePlatform,
    expectedRole: 'worker',
    expectedRootIdentitySha256: config.rootIdentitySha256,
    expectedWorkerId: 'worker-remote',
  });
  assert.equal(verified.canonicalRoot, remoteRoot);
  assert.throws(
    () => deriveDistributedLocalStateRootPaths(config),
    /platform does not match/
  );
});

test('rejects unknown fields, identity drift, and sealed-contract tampering', (t) => {
  const { config, marker } = sealedRoot(t, 'tamper-state-root');

  assert.throws(
    () =>
      createDistributedLocalStateRootConfig({
        ...configInput(config.canonicalRoot),
        unsupported: true,
      }),
    /exact field set/
  );
  assert.throws(
    () =>
      createDistributedLocalStateRootConfig({
        ...configInput(config.canonicalRoot),
        rootObjectFingerprint: config.rootObjectFingerprint,
      }),
    /exact field set/
  );
  assert.throws(
    () =>
      createDistributedLocalStateRootMarker({
        config,
        createdAtMs: 12,
        unsupported: true,
      }),
    /exact field set/
  );
  assert.throws(
    () => verifyDistributedLocalStateRootConfig({ ...config, extra: true }),
    /exact field set/
  );
  assert.throws(
    () => verifyDistributedLocalStateRootMarker({ ...marker, extra: true }),
    /exact field set/
  );

  const identityDrift = clone(config);
  identityDrift.controllerId = 'controller-b';
  assert.throws(
    () => verifyDistributedLocalStateRootConfig(identityDrift),
    /identity hash does not match/
  );

  const rootObjectDrift = clone(config);
  rootObjectDrift.rootObjectFingerprint.inodeId = (
    BigInt(rootObjectDrift.rootObjectFingerprint.inodeId) + 1n
  ).toString(10);
  assert.throws(
    () => verifyDistributedLocalStateRootConfig(rootObjectDrift),
    /identity hash does not match/
  );

  const localityDrift = clone(config);
  localityDrift.localityAttestation.acceptanceId = 'different-acceptance';
  assert.throws(
    () => verifyDistributedLocalStateRootConfig(localityDrift),
    /attestation seal does not match/
  );

  const recoveryDrift = clone(config);
  recoveryDrift.recoveryPolicy.staleWriterAfterMs += 1;
  assert.throws(
    () => verifyDistributedLocalStateRootConfig(recoveryDrift),
    /recovery policy seal does not match/
  );

  assert.throws(
    () =>
      verifyDistributedLocalStateRootConfig(config, {
        expectedMachineIdentitySha256: hash('another-machine'),
      }),
    /machine identity hash does not match/
  );
  assert.throws(
    () =>
      verifyDistributedLocalStateRootConfig(config, {
        unsupportedExpectation: true,
      }),
    /unsupported field/
  );

  const markerDrift = clone(marker);
  markerDrift.createdAtMs += 1;
  assert.throws(
    () => verifyDistributedLocalStateRootMarker(markerDrift),
    /marker seal does not match/
  );
});

test('requires explicit physical-locality and crash-recovery acceptance', (t) => {
  const root = temporaryRoot(t, 'acceptance-state-root');
  const input = configInput(root);

  assert.throws(
    () =>
      createDistributedLocalStateRootConfig({
        ...input,
        localityAcceptance: {
          ...input.localityAcceptance,
          status: 'auto-detected-local',
        },
      }),
    /explicit operator-attested-local acceptance/
  );
  assert.throws(
    () =>
      createDistributedLocalStateRootConfig({
        ...input,
        recoveryAcceptance: {
          ...input.recoveryAcceptance,
          crashRecoveryAccepted: false,
        },
      }),
    /requires explicit acceptance/
  );
  assert.throws(
    () =>
      createDistributedLocalStateRootConfig({
        ...input,
        platform: process.platform === 'win32' ? 'linux' : 'win32',
      }),
    /platform does not match this machine/
  );

  const config = createDistributedLocalStateRootConfig(input);
  assert.throws(
    () => createDistributedLocalStateRootMarker({ config, createdAtMs: 9 }),
    /predates its required acceptances/
  );
  const marker = createDistributedLocalStateRootMarker({
    config,
    createdAtMs: 12,
  });
  assert.throws(
    () =>
      verifyDistributedLocalStateRootAdmission({
        config,
        marker,
        expectations: admissionExpectations(config),
      }),
    /marker is missing/
  );
});

test('rejects noncanonical and unsafe root syntax before admission', (t) => {
  const root = temporaryRoot(t, 'syntax-state-root');

  assert.throws(
    () => createDistributedLocalStateRootConfig(configInput('relative-root')),
    /must be absolute/
  );
  assert.throws(
    () => createDistributedLocalStateRootConfig(configInput(parse(root).root)),
    /cannot be a filesystem root/
  );
  assert.throws(
    () => createDistributedLocalStateRootConfig(configInput(`${root}${sep}.`)),
    /noncanonical|not canonical/
  );

  if (process.platform === 'win32') {
    assert.throws(
      () =>
        createDistributedLocalStateRootConfig(
          configInput(`${root}:alternate-stream`)
        ),
      /alternate data stream/
    );
    assert.throws(
      () =>
        createDistributedLocalStateRootConfig(configInput(join(root, 'CON'))),
      /reserved Windows segment/
    );
  }
});

test(
  'rejects a Windows case alias instead of sealing a second path spelling',
  { skip: process.platform !== 'win32' },
  (t) => {
    const root = temporaryRoot(t, 'windows-case-state-root');
    const parsed = parse(root);
    const letterIndex = [...parsed.base].findIndex((value) =>
      /[A-Za-z]/.test(value)
    );
    assert.notEqual(letterIndex, -1);
    const letter = parsed.base[letterIndex];
    const aliasBase =
      parsed.base.slice(0, letterIndex) +
      (letter === letter.toLowerCase()
        ? letter.toUpperCase()
        : letter.toLowerCase()) +
      parsed.base.slice(letterIndex + 1);
    const alias = join(parsed.dir, aliasBase);
    assert.equal(realpathSync.native(alias), root);

    assert.throws(
      () => createDistributedLocalStateRootConfig(configInput(alias)),
      /exact native Windows realpath spelling/
    );
  }
);

test('accepts only ordinary derived directories and single-link files', (t) => {
  const { config, marker } = sealedRoot(t, 'ordinary-paths-state-root');
  const paths = deriveDistributedLocalStateRootPaths(config);
  for (const directory of [
    paths.stateDirectory,
    paths.mailboxDirectory,
    paths.blobDirectory,
    paths.stagingDirectory,
  ])
    mkdirSync(directory);
  for (const file of [
    paths.markerPath,
    paths.databasePath,
    paths.databaseJournalPath,
    paths.databaseShmPath,
    paths.databaseWalPath,
  ])
    writeFileSync(
      file,
      file === paths.markerPath ? JSON.stringify(marker) : ''
    );

  assert.equal(
    deriveDistributedLocalStateRootPaths(config).databasePath,
    paths.databasePath
  );
});

test('rejects a derived-directory symbolic link or junction', (t) => {
  const { config } = sealedRoot(t, 'linked-child-state-root');
  const outside = temporaryRoot(t, 'linked-child-target');
  const paths = deriveDistributedLocalStateRootPaths(config);
  try {
    symlinkSync(
      outside,
      paths.mailboxDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (['EACCES', 'EPERM'].includes(error.code)) {
      t.skip(`Platform denied symbolic-link creation: ${error.code}`);
      return;
    }
    throw error;
  }

  assert.throws(
    () => deriveDistributedLocalStateRootPaths(config),
    /ordinary non-symbolic directory|symbolic link|reparse-point/
  );
});

test('rejects a dangling derived-directory symbolic link or junction', (t) => {
  const { config } = sealedRoot(t, 'dangling-child-state-root');
  const outside = temporaryRoot(t, 'dangling-child-target');
  const paths = deriveDistributedLocalStateRootPaths(config);
  try {
    symlinkSync(
      outside,
      paths.blobDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (['EACCES', 'EPERM'].includes(error.code)) {
      t.skip(`Platform denied symbolic-link creation: ${error.code}`);
      return;
    }
    throw error;
  }
  rmSync(outside, { force: true, recursive: true });

  assert.throws(
    () => deriveDistributedLocalStateRootPaths(config),
    /ordinary non-symbolic directory|symbolic link|reparse-point/
  );
});

test('rejects a hard-linked marker file', (t) => {
  const { root, config, marker } = sealedRoot(t, 'hardlink-state-root');
  const paths = deriveDistributedLocalStateRootPaths(config);
  writeFileSync(paths.markerPath, JSON.stringify(marker));
  linkSync(paths.markerPath, join(root, 'marker-hardlink-copy'));

  assert.throws(
    () => deriveDistributedLocalStateRootPaths(config),
    /exactly one filesystem link/
  );
});

test('rejects a directory occupying a derived regular-file path', (t) => {
  const { config } = sealedRoot(t, 'wrong-kind-state-root');
  const paths = deriveDistributedLocalStateRootPaths(config);
  mkdirSync(paths.stateDirectory);
  mkdirSync(paths.databasePath);

  assert.throws(
    () => deriveDistributedLocalStateRootPaths(config),
    /regular non-symbolic file/
  );
});

test('rejects a symbolic-link or junction alias as the approved root', (t) => {
  const target = temporaryRoot(t, 'linked-root-target');
  const parent = temporaryRoot(t, 'linked-root-parent');
  const alias = join(parent, 'root-alias');
  try {
    symlinkSync(
      target,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (['EACCES', 'EPERM'].includes(error.code)) {
      t.skip(`Platform denied symbolic-link creation: ${error.code}`);
      return;
    }
    throw error;
  }

  assert.throws(
    () => createDistributedLocalStateRootConfig(configInput(alias)),
    /ordinary non-symbolic directory|symbolic link|reparse-point/
  );
});
