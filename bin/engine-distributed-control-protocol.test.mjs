// Copyright (c) snapetech and SeerrNG contributors.
/* eslint-disable no-relative-import-paths/no-relative-import-paths -- Focused native tests cannot resolve application aliases. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA,
  createAdaptiveTimingProfile,
  createDistributedAdaptiveSchedule,
} from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
import {
  DISTRIBUTED_EXECUTION_OPEN_ACK_SCHEMA,
  DISTRIBUTED_EXECUTION_OPEN_MANIFEST_SCHEMA,
  DISTRIBUTED_FLEET_PROBE_SCHEMA,
  DISTRIBUTED_FLEET_REPORT_SCHEMA,
  MAX_DISTRIBUTED_CONTROL_ADAPTERS,
  authenticateDistributedExecutionOpenAck,
  authenticateDistributedExecutionOpenManifest,
  authenticateDistributedFleetProbe,
  authenticateDistributedFleetReport,
  createDistributedExecutionOpenManifest,
  distributedControlReplayKeySha256,
  sealDistributedExecutionOpenAck,
  sealDistributedFleetProbe,
  sealDistributedFleetReport,
  verifyDistributedExecutionOpenAck,
  verifyDistributedExecutionOpenManifest,
  verifyDistributedFleetReport,
} from '../tools/validation-engine/runtime/distributed-control-protocol.mjs';
import {
  DISTRIBUTED_APP_SUBMISSION_SCHEMA,
  createDistributedControllerQueue,
  enqueueDistributedApp,
  sealDistributedAppSubmission,
  startNextDistributedApp,
} from '../tools/validation-engine/runtime/distributed-controller-queue.mjs';
import {
  DISTRIBUTED_TASK_CATALOG_SCHEMA,
  createDistributedExecutionBridge,
  createDistributedTaskCatalog,
} from '../tools/validation-engine/runtime/distributed-execution-bridge.mjs';
import {
  DISTRIBUTED_WORKER_CONFIG_SCHEMA,
  createDistributedBrokerHandoff,
  createDistributedWorkerConfig,
  distributedWorkerConcurrency,
  distributedWorkerRunsOnControllerHost,
} from '../tools/validation-engine/runtime/distributed-worker-config.mjs';
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const controllerId = 'controller-a';
const repositoryIdentitySha256 = hash('repository');
const configSha256 = hash('worker-config');
const agentVersion = '1.0.0';

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function auth(
  principalId,
  {
    issuedAtMs = 1_000,
    expiresAtMs = 10_000,
    nonce = `nonce-${principalId}-0001`,
  } = {}
) {
  return {
    algorithm: 'mtls-exporter-sha256',
    sessionId: `session-${principalId}`,
    principalId,
    keyId: `key-${principalId}`,
    nonce,
    issuedAtMs,
    expiresAtMs,
    proof: 'A'.repeat(43),
  };
}

const adapterIdentities = () => [
  {
    adapterId: 'cypress-native',
    adapterIdentitySha256: hash('adapter-cypress-native'),
  },
  {
    adapterId: 'node-native',
    adapterIdentitySha256: hash('adapter-node-native'),
  },
];

function probeInput(overrides = {}) {
  return {
    schema: DISTRIBUTED_FLEET_PROBE_SCHEMA,
    controllerId,
    configRevision: 7,
    configSha256,
    challengeNonce: 'challenge-nonce-0001',
    issuedAtMs: 1_000,
    expiresAtMs: 10_000,
    auth: auth(controllerId),
    ...overrides,
  };
}

function reportInput(probe, overrides = {}) {
  return {
    schema: DISTRIBUTED_FLEET_REPORT_SCHEMA,
    probeSha256: probe.probeSha256,
    controllerId,
    configRevision: probe.configRevision,
    configSha256: probe.configSha256,
    challengeNonce: probe.challengeNonce,
    workerId: 'worker-local',
    machineIdentitySha256: hash('worker-local-identity'),
    instanceId: 'worker-local-boot-1',
    agentVersion,
    platform: 'win32',
    architecture: 'x64',
    logicalCpuCapacity: 12,
    maxSafeN: 12,
    safeAvailableN: 10,
    totalMemoryMiB: 32_768,
    availableMemoryMiB: 24_576,
    loadPermille: 125,
    performanceProfileSha256: hash('worker-performance-profile'),
    performanceScorePermille: 1_250,
    adapters: adapterIdentities().toReversed(),
    observedAtMs: 1_500,
    sentAtMs: 1_600,
    auth: auth('worker-local', {
      issuedAtMs: 1_100,
      expiresAtMs: 9_000,
    }),
    ...overrides,
  };
}

function fleetExpectations(probe) {
  return {
    expectedProbe: probe,
    expectedProbeSha256: probe.probeSha256,
    expectedWorkerId: 'worker-local',
    expectedMachineIdentitySha256: hash('worker-local-identity'),
    expectedAgentVersion: agentVersion,
    expectedAdapters: adapterIdentities(),
    expectedPerformanceProfileSha256: hash('worker-performance-profile'),
    expectedPerformanceScorePermille: 1_250,
  };
}

function workerConfig() {
  return createDistributedWorkerConfig({
    schema: DISTRIBUTED_WORKER_CONFIG_SCHEMA,
    revision: 7,
    controllerId,
    controllerWorkerId: 'worker-local',
    workers: [
      {
        id: 'worker-local',
        address: 'https://worker-local.example.test',
        enabled: true,
        identitySha256: hash('worker-local-identity'),
        n: 2,
      },
      {
        id: 'worker-remote',
        address: 'https://worker-remote.example.test',
        enabled: true,
        identitySha256: hash('worker-remote-identity'),
        n: 'auto',
      },
    ],
  });
}

function schedulingNode(config, id, threads, score) {
  return {
    id,
    scope: {
      environment: 'linux-x64',
      nodeId: id,
    },
    adapterIds: adapterIdentities().map((entry) => entry.adapterId),
    effectiveLogicalThreads: threads,
    concurrency: distributedWorkerConcurrency(config, id),
    runsOnControllerHost: distributedWorkerRunsOnControllerHost(config, id),
    currentLoadPermille: 0,
    benchmark: { valid: true, performanceScorePermille: score },
  };
}

function scheduledTests() {
  return [
    {
      id: 'unit/a.test.ts',
      fingerprint: 'unit-a-v1',
      applicationId: 'seerrng',
      laneId: 'unit',
      adapterId: 'node-native',
      repositoryIdentitySha256,
      dependencies: [],
    },
    {
      id: 'e2e/b.cy.ts',
      fingerprint: 'e2e-b-v1',
      applicationId: 'seerrng',
      laneId: 'cypress',
      adapterId: 'cypress-native',
      repositoryIdentitySha256,
      dependencies: ['unit/a.test.ts'],
    },
  ];
}

function catalogTasks() {
  return [
    {
      testId: 'e2e/b.cy.ts',
      taskId: 'task-e2e-b',
      unitId: 'browser-tests',
      caseId: 'e2e-b',
      timeoutMs: 120_000,
      maxAttempts: 2,
      adapterPayload: {
        command: 'must-not-enter-open-manifest',
        specs: ['e2e/b.cy.ts'],
      },
      expectedEvidence: [
        {
          evidenceId: 'cypress-result',
          schema: 'cypress-result-v1',
          mediaType: 'application/json',
          required: true,
        },
      ],
    },
    {
      testId: 'unit/a.test.ts',
      taskId: 'task-unit-a',
      unitId: 'unit-tests',
      caseId: 'unit-a',
      timeoutMs: 60_000,
      maxAttempts: 2,
      adapterPayload: {
        command: 'must-not-enter-open-manifest',
        files: ['unit/a.test.ts'],
      },
      expectedEvidence: [
        {
          evidenceId: 'node-result',
          schema: 'node-result-v1',
          mediaType: 'application/json',
          required: true,
        },
      ],
    },
  ];
}

function bridgeFixture() {
  const config = workerConfig();
  const brokerHandoff = createDistributedBrokerHandoff(config);
  const profile = createAdaptiveTimingProfile();
  assert.equal(profile.schema, DISTRIBUTED_ADAPTIVE_PROFILE_SCHEMA);
  const schedule = createDistributedAdaptiveSchedule({
    tests: scheduledTests(),
    nodes: [
      schedulingNode(config, 'worker-local', 4, 1_000),
      schedulingNode(config, 'worker-remote', 2, 800),
    ],
    profile,
  });
  const taskCatalog = createDistributedTaskCatalog({
    schema: DISTRIBUTED_TASK_CATALOG_SCHEMA,
    applicationId: schedule.applicationId,
    repositoryIdentitySha256: schedule.repositoryIdentitySha256,
    testInventorySha256: schedule.testInventorySha256,
    scheduleSha256: schedule.scheduleSha256,
    adapters: adapterIdentities(),
    tasks: catalogTasks(),
  });
  const submission = sealDistributedAppSubmission({
    schema: DISTRIBUTED_APP_SUBMISSION_SCHEMA,
    controllerId,
    submissionId: 'submission-seerrng-1',
    applicationId: schedule.applicationId,
    testSuiteId: 'full-suite',
    repositoryIdentitySha256: schedule.repositoryIdentitySha256,
    revisionIdentitySha256: hash('candidate-revision'),
    inventoryIdentitySha256: schedule.testInventorySha256,
    taskCatalogIdentitySha256: taskCatalog.catalogSha256,
    adapters: adapterIdentities(),
    profileIdentitySha256: schedule.profileSha256,
    cacheIdentitySha256: hash('cache-namespace'),
    evidenceIdentitySha256: hash('evidence-namespace'),
    resultsIdentitySha256: hash('results-namespace'),
    failureIdentitySha256: hash('failure-namespace'),
    planSha256: schedule.scheduleSha256,
  });
  let queue = createDistributedControllerQueue({ controllerId });
  queue = enqueueDistributedApp(queue, submission);
  queue = startNextDistributedApp(queue, {
    executionId: 'execution-seerrng-1',
    startedAtMs: 1_000,
  });
  const bridge = createDistributedExecutionBridge({
    queue,
    schedule,
    taskCatalog,
    brokerHandoff,
  });
  const bridgeExpectations = {
    expectedBridgeSha256: bridge.bridgeSha256,
    queue,
    schedule,
    taskCatalog,
    brokerHandoff,
  };
  return { bridge, bridgeExpectations, config };
}

function manifestFixture() {
  const selected = bridgeFixture();
  const workerId = selected.bridge.assignments[0].assignedWorkerId;
  const sourceWorkspaceIdentitySha256 = hash('workspace-proof');
  const manifest = createDistributedExecutionOpenManifest({
    bridge: selected.bridge,
    bridgeExpectations: selected.bridgeExpectations,
    workerId,
    sourceWorkspaceIdentitySha256,
    issuedAtMs: 2_000,
    expiresAtMs: 10_000,
    auth: auth(controllerId, { issuedAtMs: 2_000, expiresAtMs: 10_000 }),
  });
  const manifestExpectations = {
    bridge: selected.bridge,
    bridgeExpectations: selected.bridgeExpectations,
    expectedManifestSha256: manifest.manifestSha256,
    expectedSourceWorkspaceIdentitySha256: sourceWorkspaceIdentitySha256,
    expectedWorkerId: workerId,
  };
  return { ...selected, manifest, manifestExpectations, workerId };
}

function rehash(value, key) {
  const unsigned = { ...value };
  delete unsigned[key];
  value[key] = canonicalJsonSha256(unsigned);
  return value;
}

test('fleet probe and report bind config, challenge, capacity, identity and adapters', () => {
  const probe = sealDistributedFleetProbe(probeInput());
  let observedProbe;
  const authenticatedProbe = authenticateDistributedFleetProbe(probe, {
    expectedProbeSha256: probe.probeSha256,
    expectedControllerId: controllerId,
    expectedConfigRevision: 7,
    expectedConfigSha256: configSha256,
    nowMs: 1_700,
    verifyProof: (evidence) => {
      observedProbe = evidence;
      return true;
    },
  });
  assert.deepEqual(authenticatedProbe, probe);
  assert.match(observedProbe.signingSha256, /^[a-f0-9]{64}$/);
  assert.match(observedProbe.replayKeySha256, /^[a-f0-9]{64}$/);

  const report = sealDistributedFleetReport(reportInput(probe));
  const authenticatedReport = authenticateDistributedFleetReport(report, {
    ...fleetExpectations(probe),
    nowMs: 1_700,
    verifyProof: () => true,
  });
  assert.equal(authenticatedReport.workerId, 'worker-local');
  assert.equal(authenticatedReport.safeAvailableN, 10);
  assert.deepEqual(
    authenticatedReport.adapters.map((entry) => entry.adapterId),
    ['cypress-native', 'node-native']
  );
  assert(Object.isFrozen(authenticatedReport.adapters));
});

test('fleet contracts reject duplicates, unknown fields, drift, future time and async proof', () => {
  const probe = sealDistributedFleetProbe(probeInput());
  const duplicateAdapters = adapterIdentities();
  duplicateAdapters.push({ ...duplicateAdapters[0] });
  assert.throws(
    () =>
      sealDistributedFleetReport(
        reportInput(probe, { adapters: duplicateAdapters })
      ),
    /duplicate adapter/
  );
  const unknown = { ...probeInput(), surprise: true };
  assert.throws(() => sealDistributedFleetProbe(unknown), /exact field set/);

  const drifted = sealDistributedFleetReport(
    reportInput(probe, { configRevision: 8 })
  );
  assert.throws(
    () => verifyDistributedFleetReport(drifted, fleetExpectations(probe)),
    /not bound to its exact probe/
  );
  assert.throws(
    () =>
      verifyDistributedFleetReport(
        sealDistributedFleetReport(reportInput(probe)),
        {
          ...fleetExpectations(probe),
          expectedAdapters: [
            adapterIdentities()[0],
            {
              ...adapterIdentities()[1],
              adapterIdentitySha256: hash('different-adapter-code'),
            },
          ],
        }
      ),
    /adapter identities drifted/
  );
  for (const overrides of [
    { performanceProfileSha256: hash('untrusted-performance-profile') },
    { performanceScorePermille: 9_999 },
  ])
    assert.throws(
      () =>
        verifyDistributedFleetReport(
          sealDistributedFleetReport(reportInput(probe, overrides)),
          fleetExpectations(probe)
        ),
      /performance calibration is not trusted/
    );

  const future = sealDistributedFleetReport(reportInput(probe));
  assert.throws(
    () =>
      authenticateDistributedFleetReport(future, {
        ...fleetExpectations(probe),
        nowMs: 1_550,
        verifyProof: () => true,
      }),
    /future/
  );
  assert.throws(
    () =>
      authenticateDistributedFleetReport(future, {
        ...fleetExpectations(probe),
        nowMs: 1_700,
        verifyProof: async () => true,
      }),
    /synchronous/
  );
  assert.throws(
    () =>
      authenticateDistributedFleetReport(future, {
        ...fleetExpectations(probe),
        nowMs: 9_001,
        verifyProof: () => true,
      }),
    /expired/
  );
  assert.throws(
    () =>
      authenticateDistributedFleetReport(future, {
        ...fleetExpectations(probe),
        nowMs: 1_700,
        verifyProof: () => false,
      }),
    /proof was rejected/
  );
});

test('fleet limits reject excessive adapters and unsafe capacity claims', () => {
  const probe = sealDistributedFleetProbe(probeInput());
  const tooMany = Array.from(
    { length: MAX_DISTRIBUTED_CONTROL_ADAPTERS + 1 },
    (_, index) => ({
      adapterId: `adapter-${index}`,
      adapterIdentitySha256: hash(`adapter-${index}`),
    })
  );
  assert.throws(
    () => sealDistributedFleetReport(reportInput(probe, { adapters: tooMany })),
    /exceeds 256 adapters/
  );
  assert.throws(
    () =>
      sealDistributedFleetReport(
        reportInput(probe, { maxSafeN: 13, safeAvailableN: 13 })
      ),
    /Maximum safe N/
  );
  assert.throws(
    () =>
      sealDistributedFleetReport(
        reportInput(probe, { availableMemoryMiB: 32_769 })
      ),
    /Available memory MiB/
  );
});

test('execution-open manifest is an exact command-free worker subset reconstructed from the bridge', () => {
  const selected = manifestFixture();
  assert.equal(
    selected.manifest.schema,
    DISTRIBUTED_EXECUTION_OPEN_MANIFEST_SCHEMA
  );
  assert(
    selected.manifest.tasks.every(
      (task) => task.assignment.workerId === selected.workerId
    )
  );
  assert(
    selected.manifest.assignments.every(
      (assignment) => assignment.assignedWorkerId === selected.workerId
    )
  );
  const serialized = JSON.stringify(selected.manifest);
  assert.equal(serialized.includes('adapterPayload'), false);
  assert.equal(serialized.includes('must-not-enter-open-manifest'), false);
  assert.equal(serialized.includes('secret'), false);

  const verified = verifyDistributedExecutionOpenManifest(
    selected.manifest,
    selected.manifestExpectations
  );
  assert.equal(verified.manifestSha256, selected.manifest.manifestSha256);
  const authenticated = authenticateDistributedExecutionOpenManifest(
    selected.manifest,
    {
      ...selected.manifestExpectations,
      nowMs: 3_000,
      verifyProof: () => true,
    }
  );
  assert.equal(authenticated.bridgeSha256, selected.bridge.bridgeSha256);
  assert.deepEqual(authenticated.binding, selected.bridge.binding);
  assert.deepEqual(authenticated.source, selected.bridge.source);
});

test('execution-open manifest rejects external-hash mismatch, unknown fields and attacker rehashing', () => {
  const selected = manifestFixture();
  assert.throws(
    () =>
      verifyDistributedExecutionOpenManifest(selected.manifest, {
        ...selected.manifestExpectations,
        expectedManifestSha256: hash('wrong-manifest'),
      }),
    /trusted hash/
  );
  const unknown = structuredClone(selected.manifest);
  unknown.command = 'arbitrary-command';
  assert.throws(
    () =>
      verifyDistributedExecutionOpenManifest(
        unknown,
        selected.manifestExpectations
      ),
    /exact field set/
  );
  const tampered = structuredClone(selected.manifest);
  tampered.candidate.candidateSha256 = hash('attacker-candidate');
  rehash(tampered, 'manifestSha256');
  assert.throws(
    () =>
      verifyDistributedExecutionOpenManifest(tampered, {
        ...selected.manifestExpectations,
        expectedManifestSha256: tampered.manifestSha256,
      }),
    /verified bridge/
  );
});

test('execution-open acknowledgement binds worker instance, agent, manifest and exact sets', () => {
  const selected = manifestFixture();
  const machineIdentitySha256 =
    selected.manifest.workerPolicy.machineIdentitySha256;
  const acknowledgement = sealDistributedExecutionOpenAck({
    manifest: selected.manifest,
    manifestExpectations: selected.manifestExpectations,
    machineIdentitySha256,
    instanceId: 'worker-instance-1',
    agentVersion,
    acceptedAtMs: 3_000,
    auth: auth(selected.workerId, {
      issuedAtMs: 2_500,
      expiresAtMs: 8_000,
    }),
  });
  const expectations = {
    manifest: selected.manifest,
    manifestExpectations: selected.manifestExpectations,
    expectedAckSha256: acknowledgement.ackSha256,
    expectedMachineIdentitySha256: machineIdentitySha256,
    expectedInstanceId: 'worker-instance-1',
    expectedAgentVersion: agentVersion,
  };
  assert.equal(acknowledgement.schema, DISTRIBUTED_EXECUTION_OPEN_ACK_SCHEMA);
  assert.equal(
    verifyDistributedExecutionOpenAck(acknowledgement, expectations)
      .manifestSha256,
    selected.manifest.manifestSha256
  );
  assert.equal(
    authenticateDistributedExecutionOpenAck(acknowledgement, {
      ...expectations,
      nowMs: 3_100,
      verifyProof: () => true,
    }).status,
    'accepted'
  );

  const tampered = structuredClone(acknowledgement);
  tampered.instanceId = 'different-instance';
  rehash(tampered, 'ackSha256');
  assert.throws(
    () =>
      verifyDistributedExecutionOpenAck(tampered, {
        ...expectations,
        expectedAckSha256: tampered.ackSha256,
      }),
    /does not match its manifest/
  );
});

test('replay identity is stable for one auth tuple but enforcement remains external', () => {
  const probe = sealDistributedFleetProbe(probeInput());
  const changedContent = sealDistributedFleetProbe(
    probeInput({ configRevision: 8 })
  );
  assert.notEqual(probe.probeSha256, changedContent.probeSha256);
  assert.equal(
    distributedControlReplayKeySha256(probe),
    distributedControlReplayKeySha256(changedContent)
  );
  const differentNonce = sealDistributedFleetProbe(
    probeInput({
      auth: auth(controllerId, { nonce: 'different-auth-nonce-0002' }),
    })
  );
  assert.notEqual(
    distributedControlReplayKeySha256(probe),
    distributedControlReplayKeySha256(differentNonce)
  );
  const rotatedCredential = sealDistributedFleetProbe(
    probeInput({
      auth: {
        ...auth(controllerId),
        algorithm: 'ed25519',
        keyId: 'rotated-controller-key',
      },
    })
  );
  assert.equal(
    distributedControlReplayKeySha256(probe),
    distributedControlReplayKeySha256(rotatedCredential)
  );
});
