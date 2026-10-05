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
  reconcileHostedGithubNeeds,
} from '../tools/validation-engine/runtime/hosted-github-plan.mjs';
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
  };
}

function writeHostedPlanOutputs(plan) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error('Hosted GitHub planning requires GITHUB_OUTPUT');
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

const args = process.argv.slice(2);
const allowed = new Set([
  '--help',
  '-h',
  '--plan',
  '--json',
  '--tests-only',
  '--github-plan',
  '--github-reconcile',
]);
if (args.some((arg) => !allowed.has(arg))) {
  process.stderr.write('Unknown option. Use --help.\n');
  process.exitCode = 1;
} else if (args.includes('--help') || args.includes('-h')) {
  process.stdout
    .write(`Usage: node bin/run-local-validation.mjs [--tests-only] [--plan [--json]]
       node bin/run-local-validation.mjs --github-plan [--json]
       node bin/run-local-validation.mjs --github-reconcile [--json]

Runs the existing engine's staged native PR-parity gate: repository checks,
CodeQL, production builds, browser tests and applicable supplemental checks.
--tests-only  Run all discovered test suites once, preserving their native runner.
--plan        Print files, framework ownership, platform exclusions, and commands;
              do not create files or launch children.
--github-plan Create the current-run GitHub plan and native-job selections.
--github-reconcile
              Verify current-run GitHub needs against the exact hosted plan.
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
    const githubPlan = args.includes('--github-plan');
    const githubReconcile = args.includes('--github-reconcile');
    if (githubPlan && githubReconcile)
      throw new Error('Choose one hosted GitHub mode');
    if (
      (githubPlan || githubReconcile) &&
      (args.includes('--plan') || args.includes('--tests-only'))
    )
      throw new Error(
        'Hosted GitHub modes cannot be combined with local modes'
      );
    if (
      args.includes('--json') &&
      !args.includes('--plan') &&
      !githubPlan &&
      !githubReconcile
    )
      throw new Error('--json requires a plan or reconciliation mode');
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
    if (githubPlan || githubReconcile) {
      const plan = createHostedGithubPlan(hostedGithubInput(root));
      if (githubPlan) {
        writeHostedPlanOutputs(plan);
        process.stdout.write(
          args.includes('--json')
            ? `${JSON.stringify(plan, null, 2)}\n`
            : `Hosted GitHub plan ${plan.planSha256}: ${plan.units.filter((unit) => unit.applicable).length}/${plan.units.length} native jobs selected.\n`
        );
      } else {
        const expectedPlan = process.env.SEERRNG_ENGINE_EXPECTED_PLAN_SHA256;
        if (expectedPlan !== plan.planSha256)
          throw new Error(
            'Hosted GitHub plan changed before reconciliation; rerun all jobs because failed-job result reuse is disabled'
          );
        let needs;
        try {
          needs = JSON.parse(process.env.SEERRNG_ENGINE_NEEDS_JSON ?? '');
        } catch {
          throw new Error(
            'Hosted GitHub reconciliation requires valid needs JSON'
          );
        }
        const result = reconcileHostedGithubNeeds(plan, needs);
        const externalSummary = result.complete
          ? ''
          : ' External PR metadata remains outside this native result.';
        process.stdout.write(
          args.includes('--json')
            ? `${JSON.stringify(result, null, 2)}\n`
            : `Hosted GitHub native validation ${result.status}: ${result.jobs.succeeded} jobs passed and ${result.jobs.skipped} were inapplicable.${externalSummary}\n`
        );
      }
    } else {
      preflight(root, { testsOnly: args.includes('--tests-only') });
      const plan = createPlan(root, {
        testsOnly: args.includes('--tests-only'),
        canonicalTypescript: !args.includes('--tests-only'),
      });
      if (args.includes('--plan')) {
        if (!args.includes('--tests-only'))
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
        if (args.includes('--json'))
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
        if (args.includes('--tests-only')) {
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
