#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { createNativeStageContext } from '../tools/validation-engine/runtime/native-stage-context.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { executeStagedValidation } from '../tools/validation-engine/runtime/staged-validation.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  createHostedGithubPlan,
  githubChangedFilesRange,
} from '../tools/validation-engine/runtime/hosted-github-plan.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import { createHostedTestInventory } from '../tools/validation-engine/runtime/hosted-test-inventory.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tooling cannot resolve the application's TS aliases.
import {
  admitHostedGithubUnit,
  executeHostedTestLane,
  loadHostedReceiptDirectory,
  readHostedGithubPlan,
  reconcileHostedGithubExecution,
  sealHostedGithubUnitReceipt,
  verifyHostedGithubPlanContext,
} from '../tools/validation-engine/runtime/hosted-github-execution.mjs';
import {
  createPlan,
  executePlan,
  preflight,
  printPlan,
} from './local-validation.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const git = (root, parameters, encoding = 'utf8') =>
  execFileSync('git', ['-C', root, ...parameters], {
    ...(encoding === null ? {} : { encoding }),
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
const nulPaths = (bytes) => bytes.toString('utf8').split('\0').filter(Boolean);

function hostedGithubInput(root) {
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('Hosted GitHub mode requires GitHub Actions');
  for (const name of [
    'GITHUB_EVENT_NAME',
    'GITHUB_EVENT_PATH',
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_RUN_ID',
    'GITHUB_SHA',
  ])
    if (!process.env[name]?.trim())
      throw new Error(`Hosted GitHub mode requires ${name}`);
  if (git(root, ['status', '--porcelain=v1', '--untracked-files=no']).trim())
    throw new Error('Hosted GitHub planning requires a clean tracked checkout');
  const payload = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')
  );
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!['pull_request', 'push'].includes(eventName))
    throw new Error(
      'Hosted CI orchestration supports pull_request and push only'
    );
  const executionSha = git(root, ['rev-parse', 'HEAD']).trim();
  if (executionSha !== process.env.GITHUB_SHA)
    throw new Error('Checked GitHub execution SHA does not match GITHUB_SHA');
  const pullRequest = payload.pull_request;
  const headSha =
    eventName === 'pull_request' ? pullRequest?.head?.sha : payload.after;
  const baseSha =
    eventName === 'pull_request' ? pullRequest?.base?.sha : payload.before;
  if (!/^[a-f0-9]{40}$/.test(headSha ?? ''))
    throw new Error('Exact GitHub head SHA is missing');
  if (!/^[a-f0-9]{40}$/.test(baseSha ?? ''))
    throw new Error('Exact GitHub base SHA is missing');
  let changedFiles;
  let pathFilterMode = 'changed-files';
  if (eventName === 'push' && /^0{40}$/.test(baseSha ?? '')) {
    pathFilterMode = 'run-all-new-branch';
    changedFiles = [];
  } else {
    const count = git(root, [
      'rev-list',
      '--count',
      `${baseSha}..${headSha}`,
    ]).trim();
    if (!/^\d+$/.test(count))
      throw new Error('Exact GitHub change commit count is unavailable');
    if (BigInt(count) > 1000n) {
      pathFilterMode = 'run-all-large-update';
      changedFiles = [];
    }
  }
  if (!changedFiles) {
    changedFiles = nulPaths(
      git(
        root,
        [
          'diff',
          '--name-only',
          '--diff-filter=ACDMRTUXB',
          '-z',
          githubChangedFilesRange(eventName, baseSha, headSha),
          '--',
        ],
        null
      )
    );
  }
  const workflowFiles = {
    ci: '.github/workflows/ci.yml',
    codeql: '.github/workflows/codeql.yml',
    cypress: '.github/workflows/cypress.yml',
    testDocs: '.github/workflows/test-docs.yml',
    docsLinks: '.github/workflows/docs-link-check.yml',
    helm: '.github/workflows/lint-helm-charts.yml',
  };
  const workflowHashes = Object.fromEntries(
    Object.entries(workflowFiles).map(([name, file]) => [
      name,
      hash(readFileSync(resolve(root, file))),
    ])
  );
  return {
    candidate: {
      repository: process.env.GITHUB_REPOSITORY,
      commit: executionSha,
      tree: git(root, ['rev-parse', 'HEAD^{tree}']).trim(),
      lockSha256: hash(readFileSync(resolve(root, 'pnpm-lock.yaml'))),
      sourceSha256: hash(
        git(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], null)
      ),
    },
    event: {
      name: eventName,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      executionSha,
      headSha,
      baseSha,
      ref: process.env.GITHUB_REF ?? null,
      baseRef:
        eventName === 'pull_request'
          ? (pullRequest?.base?.ref ?? process.env.GITHUB_BASE_REF ?? null)
          : null,
      actorType:
        eventName === 'pull_request' ? (pullRequest?.user?.type ?? null) : null,
      pathFilterMode,
    },
    changedFiles,
    workflowHashes,
    testInventory: createHostedTestInventory(root),
  };
}

function writeHostedPlanOutputs(plan, planFile) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('Hosted GitHub planning requires GITHUB_OUTPUT');
  if (!planFile) throw new Error('Hosted GitHub planning requires --plan-file');
  writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  const byWorkflow = Object.fromEntries(
    plan.units.map((unit) => [unit.workflow, unit.applicable])
  );
  const values = {
    planSha256: plan.planSha256,
    runId: plan.event.runId,
    runAttempt: plan.event.runAttempt,
    executionSha: plan.event.executionSha,
    headSha: plan.event.headSha,
    codeql: byWorkflow.codeql,
    cypress: byWorkflow.cypress,
    testDocs: byWorkflow.testDocs,
    docsLinks: byWorkflow.docsLinks,
    helm: byWorkflow.helm,
  };
  appendFileSync(
    output,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  );
}

function writeHostedAdmissionOutputs(decision) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output)
    throw new Error('Hosted GitHub admission requires GITHUB_OUTPUT');
  const reused = decision.action === 'reuse-success';
  appendFileSync(
    output,
    `${[
      ['action', decision.action],
      ['execute', String(!reused)],
      ['reuseSuccess', String(reused)],
      ['decisionSha256', decision.decisionSha256],
      [
        'reusableSuccessReceiptSha256',
        decision.reusableSuccessReceiptSha256 ?? '',
      ],
      [
        'reusableHostedUnitReceiptSha256',
        decision.reusableHostedUnitReceiptSha256 ?? '',
      ],
    ]
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`
  );
}

const flagOptions = new Set([
  '--help',
  '-h',
  '--plan',
  '--json',
  '--tests-only',
  '--github-plan',
  '--github-admit',
  '--github-receipt',
  '--github-run-test-lane',
  '--github-reconcile',
]);
const valueOptions = new Set([
  '--case',
  '--expected-plan-sha256',
  '--job-status',
  '--lane',
  '--plan-file',
  '--receipt-dir',
  '--report-file',
  '--unit',
]);
const repeatedValueOptions = new Set(['--evidence']);

const optionContracts = {
  'local-full': {
    label: 'Local full mode',
    allowed: new Set(),
    requiredValues: [],
  },
  'local-tests-only': {
    label: 'Local tests-only mode',
    allowed: new Set(['--tests-only']),
    requiredValues: [],
  },
  'local-plan': {
    label: 'Local plan mode',
    allowed: new Set(['--plan', '--tests-only', '--json']),
    requiredValues: [],
  },
  'github-plan': {
    label: 'GitHub plan mode',
    allowed: new Set(['--github-plan', '--plan-file', '--json']),
    requiredValues: ['--plan-file'],
  },
  'github-admit': {
    label: 'GitHub admission mode',
    allowed: new Set([
      '--github-admit',
      '--unit',
      '--case',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--json',
    ]),
    requiredValues: [
      '--unit',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
    ],
  },
  'github-run-test-lane': {
    label: 'GitHub test-lane mode',
    allowed: new Set([
      '--github-run-test-lane',
      '--unit',
      '--case',
      '--lane',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--report-file',
      '--json',
    ]),
    requiredValues: [
      '--unit',
      '--lane',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--report-file',
    ],
  },
  'github-receipt': {
    label: 'GitHub receipt mode',
    allowed: new Set([
      '--github-receipt',
      '--unit',
      '--case',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--job-status',
      '--evidence',
      '--json',
    ]),
    requiredValues: [
      '--unit',
      '--plan-file',
      '--expected-plan-sha256',
      '--receipt-dir',
      '--job-status',
    ],
  },
  'github-reconcile': {
    label: 'GitHub reconciliation mode',
    allowed: new Set([
      '--github-reconcile',
      '--plan-file',
      '--receipt-dir',
      '--json',
    ]),
    requiredValues: ['--plan-file', '--receipt-dir'],
  },
};

function parseOptions(args) {
  const flags = new Set();
  const values = new Map();
  const repeated = new Map();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (flagOptions.has(option)) {
      if (flags.has(option)) throw new Error(`Duplicate option: ${option}`);
      flags.add(option);
      continue;
    }
    if (valueOptions.has(option) || repeatedValueOptions.has(option)) {
      const value = args[++index];
      if (!value || value.startsWith('-'))
        throw new Error(`Missing value for ${option}`);
      if (repeatedValueOptions.has(option)) {
        const entries = repeated.get(option) ?? [];
        if (entries.includes(value))
          throw new Error(`Duplicate value for ${option}: ${value}`);
        entries.push(value);
        repeated.set(option, entries);
      } else {
        if (values.has(option)) throw new Error(`Duplicate option: ${option}`);
        values.set(option, value);
      }
      continue;
    }
    throw new Error(`Unknown option: ${option}`);
  }
  return { flags, values, repeated };
}

function validateOptions(options) {
  const helpAliases = ['--help', '-h'].filter((option) =>
    options.flags.has(option)
  );
  if (helpAliases.length > 1) throw new Error('Duplicate option: --help');

  const names = new Set([
    ...options.flags,
    ...options.values.keys(),
    ...options.repeated.keys(),
  ]);
  if (helpAliases.length) {
    if (names.size !== 1)
      throw new Error('Help mode cannot be combined with other options');
    return { name: 'help', hostedOption: null };
  }

  const hostedModes = [
    '--github-plan',
    '--github-admit',
    '--github-run-test-lane',
    '--github-receipt',
    '--github-reconcile',
  ].filter((option) => options.flags.has(option));
  if (hostedModes.length > 1)
    throw new Error('Choose exactly one hosted GitHub mode');

  const hostedOption = hostedModes[0] ?? null;
  const name = hostedOption
    ? hostedOption.slice(2)
    : options.flags.has('--plan')
      ? 'local-plan'
      : options.flags.has('--tests-only')
        ? 'local-tests-only'
        : 'local-full';
  const contract = optionContracts[name];
  for (const option of names)
    if (!contract.allowed.has(option))
      throw new Error(`${contract.label} does not accept ${option}`);
  for (const option of contract.requiredValues)
    if (!options.values.has(option))
      throw new Error(`${contract.label} requires ${option}`);
  return { name, hostedOption };
}

let options;
let selectedMode;
try {
  options = parseOptions(process.argv.slice(2));
  selectedMode = validateOptions(options);
} catch (error) {
  options = undefined;
  selectedMode = undefined;
  process.stderr.write(`${error.message}. Use --help.\n`);
  process.exitCode = 1;
}
const has = (option) => options?.flags.has(option) ?? false;
const value = (option) => options?.values.get(option);
const repeated = (option) => options?.repeated.get(option) ?? [];
const requiredValue = (option) => {
  const result = value(option);
  if (!result) throw new Error(`Hosted mode requires ${option}`);
  return result;
};

if (!options) {
  // The parse error above is the complete fail-closed result.
} else if (selectedMode.name === 'help') {
  process.stdout
    .write(`Usage: node bin/run-local-validation.mjs [--tests-only] [--plan [--json]]
       node bin/run-local-validation.mjs --github-plan --plan-file FILE [--json]
       node bin/run-local-validation.mjs --github-admit --unit ID [--case ID] --plan-file FILE --expected-plan-sha256 SHA --receipt-dir DIR [--json]
       node bin/run-local-validation.mjs --github-run-test-lane --unit ID [--case ID] --lane ID --plan-file FILE --expected-plan-sha256 SHA --receipt-dir DIR --report-file FILE [--json]
       node bin/run-local-validation.mjs --github-receipt --unit ID [--case ID] --plan-file FILE --expected-plan-sha256 SHA --receipt-dir DIR --job-status STATUS [--evidence FILE ...] [--json]
       node bin/run-local-validation.mjs --github-reconcile --plan-file FILE --receipt-dir DIR [--json]

Runs the existing engine's staged native PR-parity gate: repository checks,
CodeQL, production builds, browser tests and applicable supplemental checks.
--tests-only  Run all discovered test suites once, preserving their native runner.
--plan        Print files, framework ownership, platform exclusions, and commands;
              do not create files or launch children.
--github-plan Create the current-run GitHub plan and native-job selections.
--github-admit
              Bind one native job/case to the immutable current-attempt plan.
--github-run-test-lane
              Run an engine-assigned native test lane with its sealed worker budget.
--github-receipt
              Seal one native job/case result and its current-attempt ledger entry.
--github-reconcile
              Verify native needs and complete sealed receipts against the plan.
--json        Machine-readable local plan, hosted plan, or hosted result.
--help        Show help without reading the project or creating files.

Does not install dependencies, apply live migrations, or edit GitHub workflows.
Native, Vitest-only, tooling and CI commands retain their existing behavior.
Builds and fixture migrations use an owned disposable source/configuration copy.
Missing native tools, unproven isolation and pending GitHub checks are incomplete;
failures, partial output closure and zero active tests fail closed.\n`);
} else {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  let context;
  let failure;
  try {
    const hostedMode = selectedMode.hostedOption;
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    if (hostedMode) {
      if (hostedMode === '--github-plan') {
        const plan = createHostedGithubPlan(hostedGithubInput(root));
        writeHostedPlanOutputs(plan, requiredValue('--plan-file'));
        process.stdout.write(
          has('--json')
            ? `${JSON.stringify(plan, null, 2)}\n`
            : `Hosted GitHub plan ${plan.planSha256}: ${plan.units.filter((unit) => unit.applicable).length}/${plan.units.length} native jobs selected.\n`
        );
      } else {
        const planFile = requiredValue('--plan-file');
        const plan = readHostedGithubPlan(planFile);
        if (hostedMode === '--github-admit') {
          const result = admitHostedGithubUnit({
            root,
            plan,
            expectedPlanSha256: requiredValue('--expected-plan-sha256'),
            unitId: requiredValue('--unit'),
            caseId: value('--case'),
            receiptDir: requiredValue('--receipt-dir'),
          });
          writeHostedAdmissionOutputs(result.decision);
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(
                  {
                    admission: result.admission,
                    decision: result.decision,
                  },
                  null,
                  2
                )}\n`
              : `Admitted ${result.admission.unitId}/${result.admission.caseId} for hosted plan ${plan.planSha256}: ${result.decision.action}.\n`
          );
        } else if (hostedMode === '--github-run-test-lane') {
          const result = await executeHostedTestLane({
            root,
            plan,
            expectedPlanSha256: requiredValue('--expected-plan-sha256'),
            unitId: requiredValue('--unit'),
            caseId: value('--case'),
            laneId: requiredValue('--lane'),
            receiptDir: requiredValue('--receipt-dir'),
            reportFile: requiredValue('--report-file'),
          });
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(result, null, 2)}\n`
              : `Hosted ${result.laneId} passed: ${result.counts.active}/${result.counts.total} active tests.\n`
          );
        } else if (hostedMode === '--github-receipt') {
          const result = sealHostedGithubUnitReceipt({
            root,
            plan,
            expectedPlanSha256: requiredValue('--expected-plan-sha256'),
            unitId: requiredValue('--unit'),
            caseId: value('--case'),
            receiptDir: requiredValue('--receipt-dir'),
            jobStatus: requiredValue('--job-status'),
            evidenceFiles: repeated('--evidence'),
          });
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(result.receipt, null, 2)}\n`
              : `Sealed ${result.receipt.unitId}/${result.receipt.caseId}: ${result.receipt.jobStatus}.\n`
          );
        } else {
          verifyHostedGithubPlanContext(root, plan);
          const expectedPlan = process.env.SEERRNG_ENGINE_EXPECTED_PLAN_SHA256;
          if (expectedPlan !== plan.planSha256)
            throw new Error(
              'Hosted GitHub plan artifact does not match engine-plan output'
            );
          let needs;
          try {
            needs = JSON.parse(process.env.SEERRNG_ENGINE_NEEDS_JSON ?? '');
          } catch {
            throw new Error(
              'Hosted GitHub reconciliation requires valid needs JSON'
            );
          }
          const evidence = loadHostedReceiptDirectory(
            requiredValue('--receipt-dir')
          );
          const result = reconcileHostedGithubExecution(plan, needs, evidence);
          const externalSummary = result.complete
            ? ''
            : ' External PR metadata remains outside this native result.';
          process.stdout.write(
            has('--json')
              ? `${JSON.stringify(result, null, 2)}\n`
              : `Hosted engine validation ${result.status}: ${result.receipts.succeeded} sealed cases passed and ${result.jobs.skipped} jobs were inapplicable.${externalSummary}\n`
          );
        }
      }
    } else {
      preflight(root, { testsOnly: has('--tests-only') });
      const plan = createPlan(root, {
        testsOnly: has('--tests-only'),
        canonicalTypescript: !has('--tests-only'),
      });
      if (has('--plan')) {
        if (!has('--tests-only'))
          plan.stagedCoverage = {
            stages: ['repository', 'codeql', 'build', 'browser'],
            supplementalScope: 'full',
            executionPrerequisites: [
              'owned actual-working-byte source snapshot',
              'read-only installed dependencies matching the source lockfile',
              'verified native tool versions and pack closures',
              'actual OS browser/provider network boundary',
              'verified isolated Docker fixture prerequisites where required',
            ],
            githubMetadata: 'pending until an actual PR exists',
            status: 'planned-only; no prerequisite execution or result reuse',
          };
        if (has('--json'))
          process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        else {
          printPlan(plan);
          if (plan.stagedCoverage)
            process.stdout.write(
              '\nFull gate also stages CodeQL, builds, browser and supplemental native checks.\nPrerequisites are verified only on execution; GitHub PR metadata remains pending.\n'
            );
        }
      } else {
        printPlan(plan, process.stdout, { details: false });
        process.on('SIGINT', interrupt);
        process.on('SIGTERM', interrupt);
        if (has('--tests-only')) {
          const totals = await executePlan(plan, { signal: controller.signal });
          for (const [lane, count] of totals)
            process.stdout.write(
              `${lane}: ${count.total} tests, ${count.active} active\n`
            );
          process.stdout.write('\nLocal tests passed.\n');
        } else {
          context = await createNativeStageContext(root, {
            signal: controller.signal,
          });
          if (context.report.blockedRequired.length) {
            for (const blocker of context.report.blockedRequired)
              process.stderr.write(`${blocker.id}: ${blocker.reason}\n`);
            process.stderr.write(
              `\nFull validation incomplete; no full stages executed. Preparation evidence: ${context.report.artifacts}\n`
            );
            failure = { preserveTemporary: true };
            process.exitCode = 1;
          } else {
            const result = await executeStagedValidation(
              context.binding,
              context.options
            );
            const pendingRequired = context.pendingMetadata.filter(
              (check) => check.required
            );
            const complete = result.ok && pendingRequired.length === 0;
            const report = {
              ...result,
              status: complete
                ? 'passed'
                : result.ok
                  ? 'incomplete'
                  : result.status,
              ok: complete,
              pendingGithubMetadata: context.pendingMetadata,
              derivedArtifacts: context.derivedArtifacts,
              derivedCoverageReferences:
                context.report.derivedCoverageReferences,
              candidate: context.snapshot.candidate,
            };
            const reportPath = resolve(
              context.snapshot.scratchRoot,
              'native-validation-result.json'
            );
            writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
              flag: 'wx',
            });
            process.stdout.write(
              `\nFull native validation ${report.status}. Actual execution evidence: ${reportPath}\n`
            );
            // Retain completed evidence as well as failures; explicit owned cleanup
            // is available through the context API after durable evidence handoff.
            failure = { preserveTemporary: true };
            if (!complete) process.exitCode = 1;
          }
        }
      }
    }
  } catch (error) {
    failure = context ? { ...error, preserveTemporary: true } : error;
    process.stderr.write(`${error.message}\n`);
    if (error.scratchRoot)
      process.stderr.write(
        `Preparation evidence retained: ${error.scratchRoot}\n`
      );
    process.exitCode = controller.signal.aborted ? 130 : error.exitCode || 1;
  } finally {
    if (context) {
      try {
        await context.cleanup(failure);
      } catch (error) {
        process.stderr.write(
          `Post-validation source guard: ${error.message}\n`
        );
        process.exitCode ||= 1;
      }
    }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
