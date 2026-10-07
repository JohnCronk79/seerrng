// Copyright (c) snapetech and SeerrNG contributors.
// Terminal production lifecycle for the contained Linux distributed gate.
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, normalize, resolve } from 'node:path';

import {
  createAdaptiveTimingObservation,
  distributedAdaptivePolicySha256,
  updateAdaptiveTimingProfileBatch,
} from './distributed-adaptive-scheduler.mjs';
import {
  persistAdaptiveTimingProfileFile,
  readAdaptiveTimingProfileFile,
} from './distributed-adaptive-timing-profile-store.mjs';
import { createSupportedApplicationListing } from './distributed-linux-config.mjs';
import { resolveActiveLinuxConfig } from './distributed-linux-management.mjs';
import { reconcileDistributedLinuxRunEvidence } from './distributed-linux-run-reconciliation.mjs';
import { executeDistributedLinuxStagedValidation } from './distributed-linux-staged-bridge.mjs';
import { createNativeStageContext } from './native-stage-context.mjs';
import { canonicalJsonSha256 } from './run-scoped-ledger.mjs';

const HASH64 = /^[a-f0-9]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTAINED_RUN_VERIFICATION = 'contained-run-verification.json';
const OPTION_KEYS = Object.freeze([
  'activeConfigMarkerPath',
  'applicationEntryId',
  'containment',
  'evidenceDirectory',
  'nativeContextOptions',
  'runAttempt',
  'runId',
  'runtimeApplicationKey',
  'signal',
  'sourceRoot',
  'timingPolicy',
  'timingProfilePath',
]);
const CONTAINMENT_KEYS = Object.freeze([
  'verifyDockerFixture',
  'verifyGitHistory',
  'verifyNetworkBoundary',
  'withDistributedNetwork',
  'withRepositoryIsolation',
]);
const NATIVE_CONTAINMENT_KEYS = Object.freeze([
  'verifyDockerFixture',
  'verifyGitHistory',
  'verifyNetworkBoundary',
  'withRepositoryIsolation',
]);

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

function exactKeys(value, allowed, label) {
  plainObject(value, label);
  const accepted = new Set(allowed);
  const unexpected = Reflect.ownKeys(value).filter(
    (key) => typeof key !== 'string' || !accepted.has(key)
  );
  if (unexpected.length)
    throw new Error(`${label} contains unsupported fields`);
  return value;
}

function text(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.normalize('NFC') !== value
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function token(value, label) {
  const normalized = text(value, label);
  if (!TOKEN.test(normalized)) throw new Error(`Exact ${label} is required`);
  return normalized;
}

function absolutePath(value, label) {
  const path = text(value, label);
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  return normalize(path);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !HASH64.test(value))
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requiredCallback(value, label) {
  if (typeof value !== 'function')
    throw new Error(`${label} must be an explicit callback`);
  return value;
}

function normalizeOptions(value) {
  exactKeys(value, OPTION_KEYS, 'distributed Linux production options');
  const containmentValue = exactKeys(
    value.containment,
    CONTAINMENT_KEYS,
    'distributed Linux containment callbacks'
  );
  const containment = Object.fromEntries(
    CONTAINMENT_KEYS.map((name) => [
      name,
      requiredCallback(containmentValue[name], `Containment ${name}`),
    ])
  );
  const nativeContextOptions = exactKeys(
    value.nativeContextOptions ?? {},
    [
      'inherited',
      'prerequisiteReferences',
      'reviewedPrMetadata',
      'scratchParent',
      'stderr',
      'stdout',
    ],
    'native context options'
  );
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal))
    throw new Error('Production runner signal must be an AbortSignal');
  const timingPolicy = structuredClone(
    plainObject(value.timingPolicy ?? {}, 'adaptive timing policy')
  );
  return Object.freeze({
    activeConfigMarkerPath: absolutePath(
      value.activeConfigMarkerPath,
      'Active config marker path'
    ),
    applicationEntryId: text(value.applicationEntryId, 'application entry ID'),
    containment: Object.freeze(containment),
    evidenceDirectory: absolutePath(
      value.evidenceDirectory,
      'Production evidence directory'
    ),
    nativeContextOptions: { ...nativeContextOptions },
    runAttempt: positiveInteger(value.runAttempt ?? 1, 'Run attempt'),
    runId: token(value.runId, 'production run ID'),
    runtimeApplicationKey: token(
      value.runtimeApplicationKey,
      'runtime application key'
    ),
    signal: value.signal,
    sourceRoot: absolutePath(value.sourceRoot, 'Source root'),
    timingPolicy,
    timingProfilePath: absolutePath(
      value.timingProfilePath,
      'Adaptive timing profile path'
    ),
  });
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const descriptor = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeDurableEvidenceFile(path, bytesValue) {
  const bytes = Buffer.isBuffer(bytesValue)
    ? bytesValue
    : Buffer.from(bytesValue);
  let descriptor = null;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600
    );
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    syncDirectory(dirname(path));
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    try {
      unlinkSync(path);
    } catch {
      // The exclusive create may have failed before this path existed.
    }
    throw error;
  }
  return Object.freeze({ bytes: bytes.length, sha256: sha256(bytes) });
}

function readEvidenceFile(path) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error(`Evidence is not a regular file: ${basename(path)}`);
  return readFileSync(path);
}

function dependencies(overrides) {
  const value = plainObject(overrides, 'production runner dependencies');
  const resolved = {
    createApplicationListing: createSupportedApplicationListing,
    createNativeContext: createNativeStageContext,
    createTimingObservation: createAdaptiveTimingObservation,
    executeStagedValidation: executeDistributedLinuxStagedValidation,
    persistTimingProfile: persistAdaptiveTimingProfileFile,
    readEvidenceFile,
    readTimingProfile: readAdaptiveTimingProfileFile,
    reconcileEvidence: reconcileDistributedLinuxRunEvidence,
    resolveActiveConfig: resolveActiveLinuxConfig,
    updateTimingProfileBatch: updateAdaptiveTimingProfileBatch,
    writeEvidenceFile: writeDurableEvidenceFile,
    ...value,
  };
  for (const name of [
    'createApplicationListing',
    'createNativeContext',
    'createTimingObservation',
    'executeStagedValidation',
    'persistTimingProfile',
    'readEvidenceFile',
    'readTimingProfile',
    'reconcileEvidence',
    'resolveActiveConfig',
    'updateTimingProfileBatch',
    'writeEvidenceFile',
  ])
    requiredCallback(resolved[name], `Production dependency ${name}`);
  return resolved;
}

function evidencePaths(directory) {
  const file = (name) => resolve(directory, name);
  return Object.freeze({
    failure: file('failure.json'),
    containedRunVerification: file(CONTAINED_RUN_VERIFICATION),
    processLedger: file('native-command-receipts.jsonl'),
    processLedgerSummary: file('native-process-ledger.json'),
    reconciliation: file('independent-reconciliation.json'),
    result: file('staged-validation-result.json'),
    timingObservations: file('adaptive-timing-observations.json'),
    timingProfileUpdate: file('adaptive-timing-profile-update.json'),
    timings: file('timings.json'),
  });
}

function createFreshEvidenceDirectory(directory) {
  const parent = dirname(directory);
  const parentMetadata = lstatSync(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink())
    throw new Error('Production evidence parent must be a real directory');
  const realParent = realpathSync(parent);
  mkdirSync(directory, { mode: 0o700 });
  if (realpathSync(dirname(directory)) !== realParent)
    throw new Error('Production evidence parent changed during creation');
  syncDirectory(parent);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJson(deps, path, value) {
  return deps.writeEvidenceFile(path, jsonBytes(value));
}

function readJson(deps, path, label) {
  const bytes = deps.readEvidenceFile(path);
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function resolveApplication(active, entryId, createApplicationListing) {
  plainObject(active, 'active controller configuration');
  if (active.role !== 'controller')
    throw new Error(
      'Production validation requires an active controller config'
    );
  const listing = createApplicationListing(active.config);
  if (!Array.isArray(listing?.applications))
    throw new Error('Active controller application listing is invalid');
  const matches = listing.applications.filter(
    (application) => application.entryId === entryId
  );
  if (matches.length !== 1)
    throw new Error(
      `Active controller config must contain exactly one ${entryId} application entry`
    );
  const { applicationId, name, profilePath } = matches[0];
  return structuredClone({ entryId, applicationId, name, profilePath });
}

function requiredPendingMetadata(context, result) {
  const pending = [
    ...(Array.isArray(context.pendingMetadata) ? context.pendingMetadata : []),
    ...(Array.isArray(result.pendingRequired) ? result.pendingRequired : []),
  ];
  return pending.filter((entry) => entry?.required !== false);
}

function repositoryEvidenceFromResult(result) {
  const values = Object.values(
    plainObject(result.nativeEvidence, 'native stage evidence')
  )
    .map((entry) => entry?.repositoryEvidence)
    .filter((entry) => entry !== undefined);
  if (values.length !== 1)
    throw new Error(
      'Production result must contain exactly one distributed repository evidence record'
    );
  return plainObject(values[0], 'distributed repository evidence');
}

function timingEvidence(result, repositoryEvidence, runId) {
  if (!Array.isArray(result.lanes) || !Array.isArray(result.results))
    throw new Error('Production result has no complete four-stage timing data');
  const stageIds = new Set(result.lanes.map(({ id }) => id));
  for (const required of ['repository', 'codeql', 'build', 'browser'])
    if (!stageIds.has(required))
      throw new Error(`Production result is missing ${required} stage timing`);
  const shards = Array.isArray(repositoryEvidence.shards)
    ? repositoryEvidence.shards.map((shard) => ({
        nodeId: shard.nodeId,
        shardId: shard.shardId,
        status: shard.status,
        threadSlotId: shard.threadSlotId,
        wallMs: shard.wallMs,
      }))
    : [];
  const nodeTotals = new Map();
  for (const shard of shards) {
    const prior = nodeTotals.get(shard.nodeId) ?? {
      nodeId: shard.nodeId,
      shardCount: 0,
      shardWallMs: 0,
    };
    prior.shardCount += 1;
    prior.shardWallMs += shard.wallMs;
    nodeTotals.set(shard.nodeId, prior);
  }
  return {
    schema: 'seerrng-distributed-linux-production-timings/v1',
    runId,
    totalWallMs: result.stats?.wallMs,
    stages: result.lanes.map((lane) => ({
      id: lane.id,
      spanWallMs: lane.spanWallMs,
      status: lane.status,
      unitWallMs: lane.unitWallMs,
      unitsExecuted: lane.unitsExecuted,
    })),
    units: result.results.map((unit) => ({
      endOffsetMs: unit.endOffsetMs,
      id: unit.id,
      lane: unit.lane,
      startOffsetMs: unit.startOffsetMs,
      status: unit.status,
      wallMs: unit.wallMs,
    })),
    distributed: {
      nodeTotals: [...nodeTotals.values()].toSorted((left, right) =>
        left.nodeId.localeCompare(right.nodeId)
      ),
      reportWallMs: repositoryEvidence.report?.wallMs,
      shards,
    },
    resultReuse: false,
  };
}

function copyProcessLedger(context, deps, paths) {
  const summary = plainObject(
    context.describeNativeProcessReceipts(),
    'native process receipt ledger'
  );
  const sourcePath = absolutePath(
    summary.file,
    'Native process receipt ledger'
  );
  const bytes = deps.readEvidenceFile(sourcePath);
  const sourceSha256 = sha256(bytes);
  if (summary.sha256 !== sourceSha256)
    throw new Error('Native process receipt ledger changed before collection');
  if (
    summary.cleanupVerified !== true ||
    !Array.isArray(summary.pending) ||
    summary.pending.length !== 0
  )
    throw new Error('Native process receipt ledger is not closed');
  const ledgerReceipt = deps.writeEvidenceFile(paths.processLedger, bytes);
  const durableSummary = {
    schema: 'seerrng-distributed-linux-process-ledger/v1',
    records: summary.records,
    pending: [],
    cleanupVerified: true,
    sourceSha256,
    evidenceSha256: ledgerReceipt.sha256,
    evidenceFile: paths.processLedger,
  };
  const receipt = writeJson(deps, paths.processLedgerSummary, durableSummary);
  return { durableSummary, receipt };
}

function positiveDuration(value, label) {
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be a finite nonnegative duration`);
  return Math.max(1, Math.ceil(value));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deriveTimingObservations({
  application,
  activeConfig,
  createTimingObservation,
  reconciliation,
  result,
  runAttempt,
  runId,
  runtimeApplicationKey,
  sourceProfile,
  timingPolicy,
}) {
  const evidence = plainObject(
    reconciliation.repositoryEvidence,
    'reconciled repository evidence'
  );
  if (evidence.completed !== true)
    throw new Error('Reconciled repository evidence is incomplete');
  const catalog = plainObject(evidence.catalog, 'reconciled catalog');
  const schedule = plainObject(evidence.schedule, 'reconciled schedule');
  const report = plainObject(evidence.report, 'reconciled shard report');
  if (report.status !== 'passed')
    throw new Error('Reconciled shard report did not pass');
  if (
    !Array.isArray(catalog.tasks) ||
    catalog.tasks.length === 0 ||
    !Array.isArray(schedule.threadSlots) ||
    !Array.isArray(schedule.nodes) ||
    !Array.isArray(evidence.shards)
  )
    throw new Error('Reconciled repository evidence has no timing inventory');

  const tasks = new Map(
    catalog.tasks.map((task) => [text(task.taskId, 'catalog task ID'), task])
  );
  if (tasks.size !== catalog.tasks.length)
    throw new Error('Reconciled catalog contains duplicate task identities');
  const nodes = new Map(
    schedule.nodes.map((node) => [text(node.nodeId, 'schedule node ID'), node])
  );
  if (nodes.size !== schedule.nodes.length)
    throw new Error('Reconciled schedule contains duplicate node identities');
  const assignments = new Map();
  for (const slot of schedule.threadSlots)
    for (const scheduled of slot.tests ?? []) {
      const id = text(scheduled.id, 'scheduled task ID');
      if (assignments.has(id))
        throw new Error('Reconciled schedule duplicates a task assignment');
      assignments.set(id, {
        nodeId: slot.nodeId,
        scheduled,
        threadSlotId: slot.threadSlotId,
      });
    }
  const shards = new Map(
    evidence.shards.map((shard) => [
      text(shard.shardId, 'reconciled shard ID'),
      shard,
    ])
  );
  if (shards.size !== evidence.shards.length)
    throw new Error('Reconciled evidence duplicates a shard result');
  const expectedIds = [...tasks.keys()].toSorted(compareText);
  for (const actual of [assignments, shards])
    if (
      actual.size !== expectedIds.length ||
      [...actual.keys()]
        .toSorted(compareText)
        .some((id, index) => id !== expectedIds[index])
    )
      throw new Error(
        'Reconciled timing inventory does not close exactly once'
      );

  const profileSha256 = canonicalJsonSha256(sourceProfile);
  if (schedule.profileSha256 !== profileSha256)
    throw new Error('Reconciled schedule belongs to another timing profile');
  const policySha256 = distributedAdaptivePolicySha256(timingPolicy);
  if (schedule.policySha256 !== policySha256)
    throw new Error('Reconciled schedule belongs to another timing policy');
  const repositoryIdentitySha256 = digest(
    schedule.repositoryIdentitySha256,
    'Schedule repository identity'
  );
  const candidateSha256 = digest(
    catalog.candidate?.candidateSha256,
    'Catalog candidate identity'
  );
  const reconciliationSha256 = canonicalJsonSha256(reconciliation);
  const source = {
    applicationIsolationKeySha256: canonicalJsonSha256({
      schema: 'seerrng-distributed-linux-application-isolation/v1',
      activeConfig,
      application,
      runtimeApplicationKey,
    }),
    brokerReconciliationInputSha256: canonicalJsonSha256({
      schema: 'seerrng-distributed-linux-reconciliation-input/v1',
      catalogSha256: catalog.catalogSha256,
      reportSha256: report.reportSha256,
      scheduleSha256: schedule.scheduleSha256,
    }),
    candidateSha256,
    executionBridgeSha256: canonicalJsonSha256({
      schema: 'seerrng-distributed-linux-execution-bridge/v1',
      applicationEntryId: application.entryId,
      candidateSha256,
      repositoryIdentitySha256,
      runId,
      runtimeApplicationKey,
    }),
    executionId: runId,
    policySha256,
    profileSha256,
    revision: text(result.candidate?.commit, 'candidate revision'),
    runAttempt,
    scheduleTestInventorySha256: digest(
      schedule.testInventorySha256,
      'Schedule test inventory identity'
    ),
    scheduleSha256: digest(schedule.scheduleSha256, 'Schedule identity'),
    submissionSha256: canonicalJsonSha256({
      schema: 'seerrng-distributed-linux-schedule-submission/v1',
      applicationId: schedule.applicationId,
      runId,
      scheduleSha256: schedule.scheduleSha256,
      testInventorySha256: schedule.testInventorySha256,
    }),
    terminalReconciliationSha256: reconciliationSha256,
  };
  const groups = new Map();
  for (const id of expectedIds) {
    const task = tasks.get(id);
    const assignment = assignments.get(id);
    const shard = shards.get(id);
    if (
      shard.status !== 'passed' ||
      shard.nodeId !== assignment.nodeId ||
      shard.threadSlotId !== assignment.threadSlotId ||
      task.adapterId !== assignment.scheduled.adapterId
    )
      throw new Error('Reconciled shard timing changed its sealed assignment');
    const node = plainObject(
      nodes.get(assignment.nodeId),
      `schedule node ${assignment.nodeId}`
    );
    if (
      node.scope?.nodeId !== node.nodeId ||
      !Number.isSafeInteger(node.admittedThreads) ||
      node.admittedThreads < 1 ||
      !Number.isSafeInteger(node.performanceScorePermille) ||
      node.performanceScorePermille < 1
    )
      throw new Error('Reconciled node timing capacity is invalid');
    const scope = {
      applicationId: text(schedule.applicationId, 'schedule application ID'),
      laneId: text(assignment.scheduled.laneId, 'scheduled lane ID'),
      adapterId: text(task.adapterId, 'catalog adapter ID'),
      repositoryIdentitySha256,
      environment: text(node.scope.environment, 'node timing environment'),
      nodeId: text(node.nodeId, 'node timing ID'),
      selectedN: node.admittedThreads,
    };
    const key = canonicalJsonSha256(scope);
    const group = groups.get(key) ?? {
      benchmark: {
        valid: true,
        performanceScorePermille: node.performanceScorePermille,
      },
      inventory: [],
      results: [],
      scope,
    };
    group.inventory.push({ id, fingerprint: assignment.scheduled.fingerprint });
    group.results.push({
      durationMs: positiveDuration(
        shard.result?.wallMs ?? shard.wallMs,
        `Shard ${id} duration`
      ),
      fingerprint: assignment.scheduled.fingerprint,
      status: 'passed',
      testId: id,
    });
    groups.set(key, group);
  }
  return [...groups.entries()]
    .toSorted(([left], [right]) => compareText(left, right))
    .map(([, group]) =>
      createTimingObservation({
        schema: 'seerrng-distributed-adaptive-observation/v2',
        source,
        scope: group.scope,
        valid: true,
        complete: true,
        status: 'passed',
        benchmark: group.benchmark,
        inventory: group.inventory,
        results: group.results,
      })
    );
}

function createFailure(error, runId) {
  return {
    schema: 'seerrng-distributed-linux-production-failure/v1',
    runId,
    status: 'failed',
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
  };
}

function assertGreenResult(result, context) {
  if (result?.ok !== true || result.status !== 'passed')
    throw new Error('Distributed four-stage validation did not pass');
  const pending = requiredPendingMetadata(context, result);
  if (pending.length)
    throw new Error('Distributed validation retains required pending metadata');
}

/**
 * Run one fresh, contained four-stage distributed validation lifecycle. The
 * independent reconciler is required and receives only durable evidence paths.
 */
export async function executeDistributedLinuxProductionRun(
  optionsValue,
  dependencyOverrides = {}
) {
  const options = normalizeOptions(optionsValue);
  const deps = dependencies(dependencyOverrides);
  createFreshEvidenceDirectory(options.evidenceDirectory);
  const paths = evidencePaths(options.evidenceDirectory);
  let context = null;
  let cleanupAttempted = false;

  const cleanup = async (error) => {
    if (!context || cleanupAttempted) return;
    cleanupAttempted = true;
    await context.cleanup(error);
  };

  try {
    const active = await deps.resolveActiveConfig(
      options.activeConfigMarkerPath,
      { expectedRole: 'controller' }
    );
    const application = resolveApplication(
      active,
      options.applicationEntryId,
      deps.createApplicationListing
    );
    const sourceProfile = await deps.readTimingProfile(
      options.timingProfilePath
    );
    const sourceProfileSha256 = canonicalJsonSha256(sourceProfile);

    context = await deps.createNativeContext(options.sourceRoot, {
      ...options.nativeContextOptions,
      signal: options.signal,
      ...Object.fromEntries(
        NATIVE_CONTAINMENT_KEYS.map((name) => [name, options.containment[name]])
      ),
    });
    if (typeof context?.cleanup !== 'function')
      throw new Error('Native context must provide cleanup');
    if (
      !Array.isArray(context.report?.blockedRequired) ||
      context.report.blockedRequired.length !== 0
    )
      throw new Error('Native context retains blocked required prerequisites');
    if (typeof context.describeNativeProcessReceipts !== 'function')
      throw new Error('Native context must expose its process receipt ledger');

    const result = await deps.executeStagedValidation(
      context,
      {
        application: {
          runtimeApplicationKey: options.runtimeApplicationKey,
          supportedApplication: application,
        },
        controller: {
          config: active.config,
          policy: options.timingPolicy,
          runId: options.runId,
          timingProfile: sourceProfile,
        },
      },
      { withDistributedNetwork: options.containment.withDistributedNetwork }
    );

    const repositoryEvidence = repositoryEvidenceFromResult(result);
    const timings = timingEvidence(result, repositoryEvidence, options.runId);
    const resultReceipt = writeJson(deps, paths.result, result);
    const timingsReceipt = writeJson(deps, paths.timings, timings);
    const ledgerCollection = copyProcessLedger(context, deps, paths);
    assertGreenResult(result, context);

    await cleanup(null);

    const reconciliation = await deps.reconcileEvidence({
      evidenceDirectory: options.evidenceDirectory,
      files: Object.freeze({
        processLedger: paths.processLedger,
        processLedgerSummary: paths.processLedgerSummary,
        result: paths.result,
        timings: paths.timings,
      }),
      expected: Object.freeze({
        activeConfigPath: active.configPath,
        applicationEntryId: application.entryId,
        profileSha256: sourceProfileSha256,
        runId: options.runId,
        runtimeApplicationKey: options.runtimeApplicationKey,
      }),
    });
    if (reconciliation?.ok !== true || reconciliation.status !== 'passed')
      throw new Error(
        'Independent durable-evidence reconciliation did not pass'
      );
    plainObject(
      reconciliation.repositoryEvidence,
      'independently reconciled repository evidence'
    );
    const reconciliationReceipt = writeJson(
      deps,
      paths.reconciliation,
      reconciliation
    );
    const durableReconciliation = readJson(
      deps,
      paths.reconciliation,
      'Independent reconciliation receipt'
    );
    if (
      sha256(durableReconciliation.bytes) !== reconciliationReceipt.sha256 ||
      canonicalJsonSha256(durableReconciliation.value) !==
        canonicalJsonSha256(reconciliation)
    )
      throw new Error('Independent reconciliation receipt failed readback');

    const observations = deriveTimingObservations({
      application,
      activeConfig: active.config,
      createTimingObservation: deps.createTimingObservation,
      reconciliation: durableReconciliation.value,
      result,
      runAttempt: options.runAttempt,
      runId: options.runId,
      runtimeApplicationKey: options.runtimeApplicationKey,
      sourceProfile,
      timingPolicy: options.timingPolicy,
    });
    if (observations.length === 0)
      throw new Error('Reconciled run produced no timing observations');
    const observationsReceipt = writeJson(deps, paths.timingObservations, {
      schema: 'seerrng-distributed-linux-timing-observations/v1',
      runId: options.runId,
      observations,
    });
    const expectations = observations.map((observation) => ({
      expectedObservationSha256: observation.observationSha256,
    }));
    const timingUpdate = deps.updateTimingProfileBatch(
      sourceProfile,
      observations,
      expectations,
      options.timingPolicy
    );
    if (
      timingUpdate?.accepted !== true ||
      timingUpdate.observationCount !== observations.length
    )
      throw new Error(
        `Adaptive timing profile batch was not accepted: ${timingUpdate?.reason ?? 'unknown'}`
      );
    const updatedProfileSha256 = canonicalJsonSha256(timingUpdate.profile);
    await deps.persistTimingProfile(
      options.timingProfilePath,
      timingUpdate.profile
    );
    const persistedProfile = await deps.readTimingProfile(
      options.timingProfilePath
    );
    if (canonicalJsonSha256(persistedProfile) !== updatedProfileSha256)
      throw new Error('Persisted adaptive timing profile failed readback');
    const timingProfileUpdateReceipt = writeJson(
      deps,
      paths.timingProfileUpdate,
      {
        schema: 'seerrng-distributed-linux-timing-profile-update/v1',
        runId: options.runId,
        accepted: true,
        observationCount: observations.length,
        updatedTests: timingUpdate.updatedTests,
        sourceProfileSha256,
        updatedProfileSha256,
        profilePath: options.timingProfilePath,
      }
    );

    const marker = {
      schema: 'seerrng-distributed-linux-contained-run-success/v1',
      runId: options.runId,
      status: 'passed',
      ok: true,
      resultSha256: resultReceipt.sha256,
      timingsSha256: timingsReceipt.sha256,
      processLedgerSha256: ledgerCollection.receipt.sha256,
      reconciliationSha256: reconciliationReceipt.sha256,
      observationsSha256: observationsReceipt.sha256,
      timingProfileUpdateSha256: timingProfileUpdateReceipt.sha256,
      updatedProfileSha256,
      resultReuse: false,
    };
    writeJson(deps, paths.containedRunVerification, marker);

    return Object.freeze({
      activeConfigPath: active.configPath,
      application: Object.freeze(application),
      evidenceDirectory: options.evidenceDirectory,
      files: Object.freeze({
        containedRunVerification: paths.containedRunVerification,
        processLedger: paths.processLedger,
        processLedgerSummary: paths.processLedgerSummary,
        reconciliation: paths.reconciliation,
        result: paths.result,
        timingObservations: paths.timingObservations,
        timingProfile: options.timingProfilePath,
        timingProfileUpdate: paths.timingProfileUpdate,
        timings: paths.timings,
      }),
      ok: true,
      runId: options.runId,
      status: 'passed',
      timingUpdate: Object.freeze({
        observationCount: observations.length,
        sourceProfileSha256,
        updatedProfileSha256,
        updatedTests: timingUpdate.updatedTests,
      }),
    });
  } catch (caught) {
    let error = caught instanceof Error ? caught : new Error(String(caught));
    error.preserveTemporary = true;
    if (!cleanupAttempted && context) {
      try {
        await cleanup(error);
      } catch (cleanupError) {
        error = new AggregateError(
          [error, cleanupError],
          'Production validation and native cleanup both failed'
        );
      }
    }
    try {
      writeJson(deps, paths.failure, createFailure(error, options.runId));
    } catch (evidenceError) {
      error = new AggregateError(
        [error, evidenceError],
        'Production validation failed and failure evidence could not be saved'
      );
    }
    throw error;
  }
}
