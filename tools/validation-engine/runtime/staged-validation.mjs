// Copyright (c) snapetech and SeerrNG contributors.
// Bind native stages to the existing reviewed coordinator; never spawn here.
import { createHash } from 'node:crypto';
import {
  executeCypressStage,
  executeProductionBuild,
} from './build-browser-stage.mjs';
import { validateCodeqlOutputs } from './codeql-stage.mjs';
import { coordinate, preparePlan } from './controller.mjs';
import { readNodeTapHierarchy } from './node-tap-hierarchy.mjs';
import { acceptSupplementalNativeCases } from './pr-check-stages.mjs';

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stages = ['repository', 'codeql', 'build', 'browser'];
const zero = () => ({ passed: 0, failed: 0, skipped: 0 });
const seal = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(seal);
    Object.freeze(value);
  }
  return value;
};
const counts = (value) => {
  if (
    !value ||
    !['passed', 'failed', 'skipped'].every(
      (key) => Number.isSafeInteger(value[key]) && value[key] >= 0
    ) ||
    !Number.isSafeInteger(value.passed + value.failed + value.skipped)
  )
    throw new Error('Native stage requires safe actual case counts');
  return { passed: value.passed, failed: value.failed, skipped: value.skipped };
};

export function createStagedValidation({
  runId,
  candidate,
  executionEnvironmentSha256,
  capacity,
  repositoryPlan,
  codeqlPlan,
  buildBrowserPlan,
  prChecks = [],
}) {
  if (!/^[a-f0-9]{64}$/.test(candidate?.sourceSha256 ?? ''))
    throw new Error('Actual source manifest is required, not HEAD alone');
  const workers = capacity?.configuredWorkers;
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 256)
    throw new Error('Invalid effective worker budget');
  if (!repositoryPlan?.inventory?.length || !repositoryPlan.steps?.length)
    throw new Error(
      'Discovered repository tests and native steps are required'
    );
  if (
    codeqlPlan?.sourceIdentity?.sha256 !== candidate.sourceSha256 ||
    buildBrowserPlan?.candidate?.sourceSha256 !== candidate.sourceSha256 ||
    ['repository', 'commit', 'tree', 'lockSha256'].some(
      (key) => buildBrowserPlan?.candidate?.[key] !== candidate[key]
    ) ||
    buildBrowserPlan?.configuredWorkers !== workers
  )
    throw new Error(
      'All native stages must bind the same candidate and budget'
    );
  if (!Array.isArray(prChecks))
    throw new Error('Explicit PR applicability required');
  const ids = new Set();
  const pending = [];
  const bindings = new Map();
  const lanes = stages.map((id, ordinal) => ({
    id,
    kind: id === 'build' ? 'compile' : 'check',
    required: true,
    dependsOn: ordinal ? [stages[ordinal - 1]] : [],
    prerequisites: [],
  }));
  const units = stages.map((stage) => {
    const id = `native-${stage}`;
    bindings.set(id, { stage, primary: true });
    return {
      id,
      lane: stage,
      slots: workers,
      reads: ['source-manifest'],
      writes: [stage === 'browser' ? 'scratch-browser' : `scratch-${stage}`],
      files:
        stage === 'repository'
          ? repositoryPlan.inventory
              .filter((file) => file.selected)
              .map((file) => file.file)
          : stage === 'browser'
            ? [...buildBrowserPlan.specs]
            : [],
      dependsOn: [],
    };
  });
  for (const check of prChecks) {
    if (!check?.id || ids.has(check.id))
      throw new Error('Duplicate or missing PR check ID');
    ids.add(check.id);
    if (!stages.includes(check.stage))
      throw new Error('Unknown PR check stage');
    if (
      ![
        'ready',
        'prerequisite-blocked',
        'not-applicable',
        'github-native-pending',
      ].includes(check.status) ||
      typeof check.required !== 'boolean'
    )
      throw new Error('Explicit PR check status/authority is required');
    if (check.status !== 'ready') {
      if (!check.reason?.trim())
        throw new Error('Unexecuted check needs trigger/prerequisite evidence');
      pending.push(structuredClone(check));
      if (check.status === 'prerequisite-blocked' && check.required)
        lanes
          .find((lane) => lane.id === check.stage)
          .prerequisites.push({
            id: check.id,
            status: 'pending',
            reason: check.reason,
          });
      continue;
    }
    if (!check.commands?.length)
      throw new Error('Ready check needs native commands');
    const id = `pr-${check.id}`;
    bindings.set(id, { stage: check.stage, check: structuredClone(check) });
    units.push({
      id,
      lane: check.stage,
      slots: workers,
      reads: ['source-manifest'],
      writes: [`scratch-${check.stage}`],
      files: [...(check.files ?? [])],
      dependsOn: [`native-${check.stage}`],
    });
  }
  const plan = preparePlan({
    runId,
    candidate,
    executionEnvironmentSha256,
    maxSlots: workers,
    lanes,
    units,
  });
  return {
    plan,
    bindings,
    repositoryPlan: seal(structuredClone(repositoryPlan)),
    codeqlPlan: seal(structuredClone(codeqlPlan)),
    buildBrowserPlan: seal(structuredClone(buildBrowserPlan)),
    applicability: seal(pending),
    capacity: seal(structuredClone(capacity)),
    limitation:
      'Slot reservations are budgets, not measured operating-system threads.',
    resultReuse: false,
  };
}

export async function executeStagedValidation(binding, options) {
  const {
    executeRepository,
    run,
    readFile,
    writeArtifact,
    verifySource,
    signal,
  } = options;
  if (
    [executeRepository, run, readFile, writeArtifact, verifySource].some(
      (fn) => typeof fn !== 'function'
    )
  )
    throw new Error(
      'Existing native executors, artifact and source guards are required'
    );
  const evidence = new Map();
  let buildReceipt;
  const nativeRun = async (command, executionOptions) => {
    const receipt = await run(command, executionOptions);
    if (
      receipt?.status !== 'passed' ||
      receipt.exitCode !== 0 ||
      receipt.signal ||
      receipt.aborted ||
      receipt.timedOut ||
      receipt.lifecycle?.completed !== true ||
      !Number.isFinite(receipt.wallMs) ||
      receipt.wallMs < 0
    )
      throw Object.assign(
        new Error(
          `Incomplete native execution receipt: ${command.id ?? command.name}`
        ),
        { receipt }
      );
    return receipt;
  };
  const executor = async (unit, context) => {
    const owner = binding.bindings.get(unit.id);
    if (!owner) throw new Error('Unbound stage unit');
    await verifySource(binding.plan.candidate);
    let result;
    let cases = zero();
    if (owner.check) {
      const receipts = [];
      const caseLedgers = [];
      let failure;
      for (const command of owner.check.commands) {
        try {
          const receipt = await nativeRun(command, { signal });
          receipts.push(receipt);
          const ledger = acceptSupplementalNativeCases(command, receipt, {
            readNodeTapHierarchy,
          });
          if (ledger) {
            caseLedgers.push(ledger);
            for (const key of Object.keys(cases))
              cases[key] += ledger.counts[key];
            counts(cases);
          }
        } catch (error) {
          receipts.push(
            error.receipt ?? { status: 'failed', reason: error.message }
          );
          failure = error;
          break;
        }
      }
      const failed =
        !!failure ||
        receipts.some(
          (receipt) =>
            receipt.status !== 'passed' ||
            receipt.exitCode !== 0 ||
            receipt.lifecycle?.completed !== true
        );
      result = {
        status: failed ? 'failed' : 'passed',
        required: owner.check.required,
        advisory: !owner.check.required,
        reason: failure?.message ?? null,
        commands: receipts,
        caseLedgers,
      };
    } else if (owner.stage === 'repository') {
      result = await executeRepository(binding.repositoryPlan, { signal });
      cases = counts(result.cases);
      if (cases.passed + cases.failed < 1)
        throw new Error('Repository suite executed zero active cases');
    } else if (owner.stage === 'codeql') {
      for (const artifact of binding.codeqlPlan.artifacts)
        await writeArtifact(artifact);
      const commandResults = [];
      for (const command of binding.codeqlPlan.steps)
        commandResults.push(await nativeRun(command, { signal }));
      result = await validateCodeqlOutputs(binding.codeqlPlan, {
        commandResults,
        readFile,
      });
    } else if (owner.stage === 'build') {
      result = buildReceipt = await executeProductionBuild(
        binding.buildBrowserPlan,
        { run: nativeRun, verifySource, signal }
      );
    } else {
      result = await executeCypressStage(
        binding.buildBrowserPlan,
        buildReceipt,
        { ...options, run: nativeRun, verifySource, signal }
      );
      cases = counts({
        passed: result.counts.passed,
        failed: result.counts.failed,
        skipped: result.counts.pending + result.counts.skipped,
      });
    }
    if (!result || !['passed', 'failed'].includes(result.status))
      throw new Error('Native stage did not provide an execution result');
    await verifySource(binding.plan.candidate);
    evidence.set(unit.id, result);
    return {
      ...context,
      status: result.advisory ? 'passed' : result.status,
      reason:
        result.advisory && result.status === 'failed'
          ? 'Advisory native check failed; retained separately'
          : result.reason,
      cases,
      evidenceSha256: digest(result),
      cpuMs: null,
    };
  };
  let coordinated;
  try {
    coordinated = await coordinate(binding.plan, {
      execute: true,
      includeCompile: true,
      allowDeclaredWrites: true,
      executor,
      signal,
    });
  } finally {
    // A failed/aborted native stage must not evade the post-source guard.
    await verifySource(binding.plan.candidate);
  }
  const pendingRequired = binding.applicability.filter(
    (check) => check.required && check.status !== 'not-applicable'
  );
  return {
    ...coordinated,
    localStatus: coordinated.status,
    status:
      coordinated.status === 'passed' && pendingRequired.length
        ? 'incomplete'
        : coordinated.status,
    ok: coordinated.ok && pendingRequired.length === 0,
    pendingRequired,
    applicability: binding.applicability,
    nativeEvidence: Object.fromEntries(evidence),
    capacity: binding.capacity,
    resultReuse: false,
  };
}
