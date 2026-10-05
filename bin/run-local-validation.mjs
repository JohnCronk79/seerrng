#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeStageContext } from '../tools/validation-engine/runtime/native-stage-context.mjs';
import { executeStagedValidation } from '../tools/validation-engine/runtime/staged-validation.mjs';
import {
  createPlan,
  executePlan,
  preflight,
  printPlan,
} from './local-validation.mjs';

const args = process.argv.slice(2);
const allowed = new Set(['--help', '-h', '--plan', '--json', '--tests-only']);
if (args.some((arg) => !allowed.has(arg))) {
  process.stderr.write('Unknown option. Use --help.\n');
  process.exitCode = 1;
} else if (args.includes('--help') || args.includes('-h')) {
  process.stdout
    .write(`Usage: node bin/run-local-validation.mjs [--tests-only] [--plan [--json]]

Runs the existing engine's staged native PR-parity gate: repository checks,
CodeQL, production builds, browser tests and applicable supplemental checks.
--tests-only  Run all discovered test suites once, preserving their native runner.
--plan        Print files, framework ownership, platform exclusions, and commands;
              do not create files or launch children.
--json        Machine-readable plan (requires --plan).
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
    if (args.includes('--json') && !args.includes('--plan'))
      throw new Error('--json requires --plan');
    const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
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
            derivedCoverageReferences: context.report.derivedCoverageReferences,
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
