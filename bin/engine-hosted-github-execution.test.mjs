import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  admitHostedGithubUnit,
  executeHostedTestLane,
  loadHostedReceiptDirectory,
  reconcileHostedGithubExecution,
  sealHostedGithubUnitReceipt,
  verifyHostedAdmissionDecision,
  verifyHostedGithubPlanContext,
  verifyHostedUnitReceipt,
} from '../tools/validation-engine/runtime/hosted-github-execution.mjs';
import { createHostedGithubPlan } from '../tools/validation-engine/runtime/hosted-github-plan.mjs';
import { createHostedTestInventory } from '../tools/validation-engine/runtime/hosted-test-inventory.mjs';
import {
  canonicalJsonSha256,
  createRunScopedLedger,
  createSuccessReceipt,
  recordSuccessfulWork,
  workKeySha256,
} from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const temporary = new Set();
const hash = (value) => createHash('sha256').update(value).digest('hex');

test.afterEach(() => {
  for (const directory of temporary)
    rmSync(directory, { recursive: true, force: true });
  temporary.clear();
});

function write(root, file, contents) {
  const absolute = path.join(root, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function command(root, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', root, ...args], {
    ...(encoding === null ? {} : { encoding }),
    windowsHide: true,
  });
}

function fixture({ zeroCaseNativeFile = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'hosted-github-execution-'));
  temporary.add(root);
  for (const directory of [
    'server',
    'src',
    'bin',
    'scripts',
    'deploy',
    'packaging',
    'cypress',
    'gen-docs',
  ])
    mkdirSync(path.join(root, directory), { recursive: true });
  write(
    root,
    'package.json',
    JSON.stringify({
      scripts: {
        'security:council':
          'node scripts/check-workflow-boundaries.mjs && pnpm test:tooling && node bin/run-bash.mjs scripts/check-council-browser-boundaries.sh && node bin/run-bash.mjs scripts/check-council-server-boundaries.sh',
        'test:ci':
          'vitest run --reporter=default --reporter=junit --outputFile.junit=report.xml',
        'test:tooling': 'node bin/run-tooling-tests.mjs',
      },
    })
  );
  write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
  write(
    root,
    'vitest.config.mts',
    `import { engineVitestProjects } from './tools/validation-engine/runtime/vitest-binding.mjs';
    const include = [
      'server/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.vitest.test.ts',
    ];
    const exclude = ['node_modules/**', 'dist/**'];
    const alias = {
      'node:test': resolve(projectRoot, 'server/test/vitestNodeTest.ts'),
    };
    const config = {
      test: {
        projects: engineVitestProjects({
          include,
          exclude,
          workers: capacity.configuredWorkers,
        }),
      },
    };
    export { alias, config };
    `
  );
  write(root, 'server/test/vitestNodeTest.ts', 'export const test = true;\n');
  write(
    root,
    'gen-docs/package.json',
    JSON.stringify({
      scripts: {
        'test:security': 'node --test scripts/image-size-security.test.mjs',
      },
    })
  );
  write(
    root,
    'cypress.config.ts',
    "import { defineConfig } from 'cypress'; export default defineConfig({ e2e: {} });\n"
  );
  write(
    root,
    'bin/run-tooling-tests.mjs',
    `import { spawnSync } from 'node:child_process';
     const portableTests = ['bin/tool.test.mjs'];
     const posixOnlyTests = ['deploy/posix.test.mjs'];
     const tests = process.platform === 'win32'
       ? portableTests
       : [...portableTests, ...posixOnlyTests];
     const workers = 2;
     spawnSync(
       process.execPath,
       ['--test', \`--test-concurrency=\${workers}\`, ...tests],
       { stdio: 'inherit' }
     );
    `
  );
  write(root, 'server/native.test.ts', "import test from 'node:test';\n");
  write(root, 'src/unit.test.tsx', "import { test } from 'vitest';\n");
  write(
    root,
    'src/native.test.mjs',
    "import test from 'node:test'; import assert from 'node:assert/strict'; test('native one', () => assert.equal(1, 1));\n"
  );
  write(
    root,
    'server/native-two.test.mjs',
    zeroCaseNativeFile
      ? "import test from 'node:test'; void test;\n"
      : "import test from 'node:test'; import assert from 'node:assert/strict'; test('native two', () => assert.equal(2, 2));\n"
  );
  write(root, 'bin/tool.test.mjs', "import test from 'node:test';\n");
  write(root, 'deploy/posix.test.mjs', "import test from 'node:test';\n");
  write(
    root,
    'gen-docs/scripts/image-size-security.test.mjs',
    "import test from 'node:test'; test('docs security', () => {});\n"
  );
  write(root, 'cypress/e2e/login.cy.ts', "describe('login', () => {});\n");
  const workflowFiles = {
    ci: '.github/workflows/ci.yml',
    codeql: '.github/workflows/codeql.yml',
    cypress: '.github/workflows/cypress.yml',
    testDocs: '.github/workflows/test-docs.yml',
    docsLinks: '.github/workflows/docs-link-check.yml',
    helm: '.github/workflows/lint-helm-charts.yml',
  };
  for (const [name, file] of Object.entries(workflowFiles))
    write(
      root,
      file,
      `name: ${name}\nsteps:\n  - uses: actions/checkout@${'1'.repeat(40)}\n`
    );
  command(root, ['init', '--initial-branch=main']);
  command(root, ['config', 'user.name', 'Engine Test']);
  command(root, ['config', 'user.email', 'engine@example.invalid']);
  command(root, ['config', 'core.autocrlf', 'false']);
  command(root, ['add', '.']);
  command(root, ['commit', '-m', 'fixture']);
  write(
    root,
    'cypress/runtime-config/settings.json',
    JSON.stringify({
      clientId: 'engine-fixture',
      main: { applicationTitle: 'SeerrNG Engine Fixture' },
    })
  );
  write(root, 'node_modules/.pnpm/lock.yaml', 'lockfileVersion: 9.0\n');
  write(
    root,
    'gen-docs/node_modules/.pnpm/lock.yaml',
    'lockfileVersion: 9.0\n'
  );
  const eventFile = path.join(root, '.github-event.json');
  writeFileSync(
    eventFile,
    `${JSON.stringify({
      repository: {
        full_name: 'JohnCronk79/seerrng',
        default_branch: 'main',
      },
      pull_request: {
        base: { sha: 'f'.repeat(40) },
        head: { sha: 'e'.repeat(40) },
        body: 'Release note: engine fixture',
        title: 'Engine fixture pull request',
      },
    })}\n`
  );
  const candidate = {
    repository: 'JohnCronk79/seerrng',
    commit: command(root, ['rev-parse', 'HEAD']).trim(),
    tree: command(root, ['rev-parse', 'HEAD^{tree}']).trim(),
    lockSha256: hash(readFileSync(path.join(root, 'pnpm-lock.yaml'))),
    sourceSha256: hash(
      command(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], null)
    ),
  };
  const workflowHashes = Object.fromEntries(
    Object.entries(workflowFiles).map(([name, file]) => [
      name,
      hash(readFileSync(path.join(root, file))),
    ])
  );
  const plan = createHostedGithubPlan({
    candidate,
    event: {
      name: 'pull_request',
      runId: '12345',
      runAttempt: '1',
      executionSha: candidate.commit,
      headSha: 'e'.repeat(40),
      baseSha: 'f'.repeat(40),
      ref: 'refs/pull/42/merge',
      baseRef: 'main',
      actorType: 'User',
      pathFilterMode: 'changed-files',
    },
    changedFiles: ['.github/workflows/ci.yml'],
    workflowHashes,
    testInventory: createHostedTestInventory(root),
  });
  const environment = {
    ...process.env,
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: candidate.repository,
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: candidate.commit,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: eventFile,
    GITHUB_REF: 'refs/pull/42/merge',
    GITHUB_BASE_REF: 'main',
    CI: 'true',
    RUNNER_OS: process.platform,
    RUNNER_ARCH: process.arch,
    ImageOS: 'engine-fixture',
    ImageVersion: '1',
  };
  return { root, plan, environment };
}

function scopeFromPlan(plan) {
  return {
    run: {
      provider: 'github-actions',
      repository: plan.candidate.repository,
      runId: plan.event.runId,
      runAttempt: plan.event.runAttempt,
    },
    candidate: {
      repository: plan.candidate.repository,
      commit: plan.candidate.commit,
      tree: plan.candidate.tree,
      sourceSha256: plan.candidate.sourceSha256,
    },
    planSha256: plan.planSha256,
  };
}

function reseal(value, sealField) {
  const unsigned = structuredClone(value);
  delete unsigned[sealField];
  return { ...unsigned, [sealField]: canonicalJsonSha256(unsigned) };
}

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function writeVitestJunit(
  root,
  plan,
  {
    files,
    zeroFile = null,
    failureFile = null,
    allSkippedFile = null,
    partialSkippedFile = null,
  } = {}
) {
  const lane = plan.testInventory.lanes.find((entry) => entry.id === 'vitest');
  files ??= lane.files;
  const suites = files.map((file) => {
    const tests = file === zeroFile ? 0 : file === partialSkippedFile ? 2 : 1;
    const failures = file === failureFile ? 1 : 0;
    const skipped =
      file === allSkippedFile || file === partialSkippedFile ? 1 : 0;
    const active = tests - skipped;
    const body = [
      ...(active
        ? [`<testcase classname="${xmlEscape(file)}" name="passes">`]
        : []),
      ...(failures ? ['<failure message="failed" />'] : []),
      ...(active ? ['</testcase>'] : []),
      ...(skipped
        ? [
            `<testcase classname="${xmlEscape(file)}" name="skipped"><skipped /></testcase>`,
          ]
        : []),
    ].join('');
    return `<testsuite name="${xmlEscape(file)}" tests="${tests}" failures="${failures}" errors="0" skipped="${skipped}">${body}</testsuite>`;
  });
  const total = files.reduce(
    (sum, file) =>
      sum + (file === zeroFile ? 0 : file === partialSkippedFile ? 2 : 1),
    0
  );
  const failures = files.filter((file) => file === failureFile).length;
  const report = path.join(root, 'report.xml');
  writeFileSync(
    report,
    `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="vitest tests" tests="${total}" failures="${failures}" errors="0">${suites.join('')}</testsuites>\n`
  );
  return report;
}

async function createUnitTestEvidence({ root, plan, environment, receiptDir }) {
  const nodeReport = path.join(root, 'seerrng-engine-node-tests.json');
  await executeHostedTestLane({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    laneId: 'node-test-mjs',
    receiptDir,
    reportFile: nodeReport,
    environment,
    stdout: { write() {} },
    stderr: { write() {} },
  });
  return {
    junit: writeVitestJunit(root, plan),
    node: nodeReport,
  };
}

test('hosted admission reuses only its exact completed successful unit', async () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  verifyHostedGithubPlanContext(root, plan, { environment });
  const first = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    environment,
  });
  const { admission } = first;
  assert.equal(admission.caseId, 'default');
  assert.equal(first.decision.action, 'execute');
  assert.equal(first.decision.reusableSuccessReceiptSha256, null);
  assert.equal(verifyHostedAdmissionDecision(first.decision), first.decision);
  const unitEvidence = await createUnitTestEvidence({
    root,
    plan,
    environment,
    receiptDir,
  });
  const { receipt } = sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    jobStatus: 'success',
    evidenceFiles: [unitEvidence.junit, unitEvidence.node],
    environment,
  });
  assert.equal(receipt.jobStatus, 'success');
  assert.equal(receipt.successReceipt.outcome.completed, true);
  assert.equal(verifyHostedUnitReceipt(receipt), receipt);
  const second = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    environment,
  });
  assert.equal(second.admission.admissionSha256, admission.admissionSha256);
  assert.equal(second.decision.action, 'reuse-success');
  assert.equal(
    second.decision.reusableSuccessReceiptSha256,
    receipt.successReceipt.receiptSha256
  );
  assert.equal(
    second.decision.reusableHostedUnitReceiptSha256,
    receipt.receiptSha256
  );
  const tampered = structuredClone(receipt);
  tampered.evidence[0].bytes += 1;
  assert.throws(
    () => verifyHostedUnitReceipt(tampered),
    /seal or schema is invalid/
  );
  const tamperedDecision = structuredClone(second.decision);
  tamperedDecision.action = 'execute';
  assert.throws(
    () => verifyHostedAdmissionDecision(tamperedDecision),
    /seal or schema is invalid/
  );
});

test('admission binds narrow generated setup and ignores caches and secrets', () => {
  const { root, plan, environment } = fixture();
  const baseline = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir: path.join(root, 'receipts-baseline'),
    environment,
  }).admission;

  write(root, 'node_modules/.cache/bundler/state.bin', 'cache noise\n');
  write(root, '.next/cache/webpack/state.bin', 'build cache noise\n');
  write(root, 'cypress/runtime-config/logs/cypress.log', 'runtime log\n');
  writeFileSync(
    path.join(root, '.git/description'),
    'irrelevant git metadata\n'
  );
  const noisy = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir: path.join(root, 'receipts-noise'),
    environment: {
      ...environment,
      CYPRESS_RECORD_KEY: 'must-not-enter-a-receipt',
      STORE_PATH: '/irrelevant/pnpm/store',
    },
  }).admission;
  assert.equal(noisy.workKeySha256, baseline.workKeySha256);
  assert.equal(
    noisy.identity.setup.configSha256,
    baseline.identity.setup.configSha256
  );

  const differentTimezone = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir: path.join(root, 'receipts-timezone'),
    environment: { ...environment, TZ: 'Pacific/Kiritimati' },
  }).admission;
  assert.notEqual(differentTimezone.workKeySha256, baseline.workKeySha256);

  write(
    root,
    'cypress/runtime-config/settings.json',
    JSON.stringify({
      clientId: 'changed-after-admission',
      main: { applicationTitle: 'Changed behavior' },
    })
  );
  const changedSettings = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir: path.join(root, 'receipts-settings'),
    environment,
  }).admission;
  assert.notEqual(changedSettings.workKeySha256, baseline.workKeySha256);
  assert.notEqual(
    changedSettings.identity.setup.configSha256,
    baseline.identity.setup.configSha256
  );
});

test('sealed admission snapshot is stable but changed behavior cannot reuse it', () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  const admitted = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir,
    environment,
  });
  write(root, '.next/cache/build-output.bin', 'normal build output\n');
  write(
    root,
    'cypress/runtime-config/logs/server.log',
    'normal runtime output\n'
  );
  const sealed = sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'cypress-run',
    receiptDir,
    jobStatus: 'success',
    environment: { ...environment, STORE_PATH: '/post-install/store' },
  });
  assert.equal(sealed.receipt.workKeySha256, admitted.admission.workKeySha256);

  write(
    root,
    'cypress/runtime-config/settings.json',
    JSON.stringify({ clientId: 'adversarial-change' })
  );
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'cypress-run',
        receiptDir,
        environment,
      }),
    /does not match current work identity/
  );
});

test('admission binds the installed dependency lock for the executing workspace', () => {
  const { root, plan, environment } = fixture();
  const docsBefore = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'test-docs-build',
    receiptDir: path.join(root, 'receipts-docs-before'),
    environment,
  }).admission;
  const rootBefore = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir: path.join(root, 'receipts-root-before'),
    environment,
  }).admission;

  write(
    root,
    'gen-docs/node_modules/.pnpm/lock.yaml',
    'lockfileVersion: 9.0\nsettings: changed\n'
  );
  const docsAfter = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'test-docs-build',
    receiptDir: path.join(root, 'receipts-docs-after'),
    environment,
  }).admission;
  const rootAfter = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir: path.join(root, 'receipts-root-after'),
    environment,
  }).admission;

  assert.notEqual(docsAfter.workKeySha256, docsBefore.workKeySha256);
  assert.equal(rootAfter.workKeySha256, rootBefore.workKeySha256);
});

test('release-note reuse binds the exact event text used by the native step', () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir,
    environment,
  });
  sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir,
    jobStatus: 'success',
    environment,
  });
  const payload = JSON.parse(
    readFileSync(environment.GITHUB_EVENT_PATH, 'utf8')
  );
  payload.pull_request.body = 'A changed release-note decision';
  writeFileSync(environment.GITHUB_EVENT_PATH, `${JSON.stringify(payload)}\n`);
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'ci-release-notes',
        receiptDir,
        environment,
      }),
    /does not match current work identity/
  );
});

test('hosted reuse is default-deny outside the fully proved unit job', () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir,
    environment,
  });
  sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-release-notes',
    receiptDir,
    jobStatus: 'success',
    environment,
  });
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: 'ci-release-notes',
        receiptDir,
        environment,
      }),
    /not reusable: unit-not-proven-safe-for-result-reuse/
  );
});

test('Cypress push success is not reusable without a bound dashboard mode', () => {
  const { root, plan, environment } = fixture();
  const baseSha = 'd'.repeat(40);
  const pushPlan = createHostedGithubPlan({
    candidate: plan.candidate,
    event: {
      name: 'push',
      runId: plan.event.runId,
      runAttempt: plan.event.runAttempt,
      executionSha: plan.candidate.commit,
      headSha: plan.candidate.commit,
      baseSha,
      ref: 'refs/heads/main',
      baseRef: null,
      actorType: null,
      pathFilterMode: 'changed-files',
    },
    changedFiles: ['.github/workflows/cypress.yml'],
    workflowHashes: plan.workflowHashes,
    testInventory: plan.testInventory,
  });
  writeFileSync(
    environment.GITHUB_EVENT_PATH,
    `${JSON.stringify({
      repository: {
        full_name: plan.candidate.repository,
        default_branch: 'main',
      },
      before: baseSha,
      after: plan.candidate.commit,
      head_commit: { message: 'Push Cypress baseline' },
    })}\n`
  );
  const pushEnvironment = {
    ...environment,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
  };
  delete pushEnvironment.GITHUB_BASE_REF;
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan: pushPlan,
    expectedPlanSha256: pushPlan.planSha256,
    unitId: 'cypress-run',
    receiptDir,
    environment: pushEnvironment,
  });
  sealHostedGithubUnitReceipt({
    root,
    plan: pushPlan,
    expectedPlanSha256: pushPlan.planSha256,
    unitId: 'cypress-run',
    receiptDir,
    jobStatus: 'success',
    environment: pushEnvironment,
  });
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan: pushPlan,
        expectedPlanSha256: pushPlan.planSha256,
        unitId: 'cypress-run',
        receiptDir,
        environment: pushEnvironment,
      }),
    /not reusable: cypress-dashboard-secret-presence-is-step-scoped/
  );
});

test('reuse rejects incomplete, failed, and tampered finalized artifacts', async () => {
  for (const mode of [
    'missing-receipt',
    'missing-ledger',
    'failed',
    'tampered',
    'resealed-case-results',
  ]) {
    const { root, plan, environment } = fixture();
    const receiptDir = path.join(root, 'receipts');
    const admitted = admitHostedGithubUnit({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-unit-test',
      receiptDir,
      environment,
    });
    const unitEvidence =
      mode === 'failed'
        ? null
        : await createUnitTestEvidence({
            root,
            plan,
            environment,
            receiptDir,
          });
    const sealed = sealHostedGithubUnitReceipt({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-unit-test',
      receiptDir,
      jobStatus: mode === 'failed' ? 'failure' : 'success',
      evidenceFiles: unitEvidence
        ? [unitEvidence.junit, unitEvidence.node]
        : [],
      environment,
    });
    if (mode === 'missing-receipt') rmSync(sealed.paths.receipt);
    if (mode === 'missing-ledger') rmSync(sealed.paths.ledger);
    if (mode === 'tampered') {
      const receipt = JSON.parse(readFileSync(sealed.paths.receipt, 'utf8'));
      receipt.evidence.push({ name: 'forged', bytes: 1, sha256: hash('x') });
      writeFileSync(sealed.paths.receipt, `${JSON.stringify(receipt)}\n`);
    }
    if (mode === 'resealed-case-results') {
      const receipt = JSON.parse(readFileSync(sealed.paths.receipt, 'utf8'));
      receipt.caseResults.lanes[0].files[0] = 'src/forged.test.ts';
      writeFileSync(
        sealed.paths.receipt,
        `${JSON.stringify(reseal(receipt, 'receiptSha256'))}\n`
      );
    }
    assert.throws(
      () =>
        admitHostedGithubUnit({
          root,
          plan,
          expectedPlanSha256: plan.planSha256,
          unitId: 'ci-unit-test',
          receiptDir,
          environment,
        }),
      mode === 'missing-receipt'
        ? /lacks its completed unit receipt/
        : mode === 'tampered'
          ? /seal or schema is invalid/
          : mode === 'resealed-case-results'
            ? /does not match the planned inventory/
            : /finalized without a reusable completed success/,
      mode
    );
    assert.equal(admitted.decision.action, 'execute');
  }
});

test('a success for one planned case cannot reuse a distinct case', () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'codeql-analyze',
    caseId: 'actions',
    receiptDir,
    environment,
  });
  sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'codeql-analyze',
    caseId: 'actions',
    receiptDir,
    jobStatus: 'success',
    environment,
  });
  const distinct = admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'codeql-analyze',
    caseId: 'javascript',
    receiptDir,
    environment,
  });
  assert.equal(distinct.decision.action, 'execute');
  assert.equal(distinct.decision.reusableSuccessReceiptSha256, null);
});

test('hosted admission rejects a different attempt and plan hash', () => {
  const { root, plan, environment } = fixture();
  assert.throws(
    () =>
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: '0'.repeat(64),
        unitId: 'ci-release-notes',
        receiptDir: path.join(root, 'receipts'),
        environment,
      }),
    /expected-plan hash mismatch/
  );
  assert.throws(
    () =>
      verifyHostedGithubPlanContext(root, plan, {
        environment: { ...environment, GITHUB_RUN_ATTEMPT: '2' },
      }),
    /GITHUB_RUN_ATTEMPT/
  );
});

test('engine executes the complete omitted native Node lane at exactly GitHub N', async () => {
  const { root, plan, environment } = fixture();
  const reportFile = path.join(root, 'seerrng-engine-node-tests.json');
  const receiptDir = path.join(root, 'receipts');
  await assert.rejects(
    executeHostedTestLane({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-unit-test',
      laneId: 'node-test-mjs',
      receiptDir: path.join(root, 'missing-admission'),
      reportFile,
      environment,
      stdout: { write() {} },
      stderr: { write() {} },
    }),
    /Missing hosted admission/
  );
  await assert.rejects(
    executeHostedTestLane({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-i18n',
      laneId: 'node-test-mjs',
      receiptDir,
      reportFile,
      environment,
      stdout: { write() {} },
      stderr: { write() {} },
    }),
    /not assigned/
  );
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    environment,
  });
  const result = await executeHostedTestLane({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    laneId: 'node-test-mjs',
    receiptDir,
    reportFile,
    environment,
    stdout: { write() {} },
    stderr: { write() {} },
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.unitId, 'ci-unit-test');
  assert.equal(result.caseId, 'default');
  assert.equal(result.files.length, 2);
  assert.equal(result.capacity.githubActions, true);
  assert.equal(
    result.capacity.configuredWorkers,
    result.capacity.effectiveLogicalCpus
  );
  assert.equal(result.caseLedger.counts.failed, 0);
  assert.ok(result.caseLedger.counts.passed >= 2);
  assert.deepEqual(
    result.caseLedger.reports.map(({ file }) => file),
    result.files
  );
  assert.ok(
    result.caseLedger.reports.every(
      ({ tests, reportSha256 }) =>
        tests > 0 && /^[a-f0-9]{64}$/.test(reportSha256)
    )
  );
  assert.equal(
    JSON.parse(readFileSync(reportFile, 'utf8')).inventorySha256,
    plan.testInventory.inventorySha256
  );
  const junit = writeVitestJunit(root, plan);
  const sealed = sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    jobStatus: 'success',
    evidenceFiles: [junit, reportFile],
    environment,
  });
  assert.deepEqual(
    sealed.receipt.caseResults.lanes.map((lane) => lane.proof),
    ['junit-file-closure', 'engine-json-per-file-closure']
  );
  assert.deepEqual(
    sealed.receipt.caseResults.lanes[0].files,
    plan.testInventory.lanes.find((lane) => lane.id === 'vitest').files
  );
  assert.deepEqual(
    sealed.receipt.caseResults.lanes[1].files,
    plan.testInventory.lanes.find((lane) => lane.id === 'node-test-mjs').files
  );
});

test('engine rejects a planned native Node file with no observed cases', async () => {
  const { root, plan, environment } = fixture({ zeroCaseNativeFile: true });
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    environment,
  });
  await assert.rejects(
    executeHostedTestLane({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-unit-test',
      laneId: 'node-test-mjs',
      receiptDir,
      reportFile: path.join(root, 'seerrng-engine-node-tests.json'),
      environment,
      stdout: { write() {} },
      stderr: { write() {} },
    }),
    /server\/native-two\.test\.mjs: .*no observed registered test cases/
  );
});

test('unit success rejects incomplete or tampered native evidence', async () => {
  const scenarios = [
    {
      name: 'missing Vitest suite',
      mutate({ root, plan }) {
        const files = plan.testInventory.lanes.find(
          (lane) => lane.id === 'vitest'
        ).files;
        writeVitestJunit(root, plan, { files: files.slice(1) });
      },
      message: /does not close the planned file set/,
    },
    {
      name: 'duplicate Vitest suite',
      mutate({ root, plan }) {
        const files = plan.testInventory.lanes.find(
          (lane) => lane.id === 'vitest'
        ).files;
        writeVitestJunit(root, plan, { files: [files[0], files[0]] });
      },
      message: /does not close the planned file set/,
    },
    {
      name: 'extra Vitest suite',
      mutate({ root, plan }) {
        const files = plan.testInventory.lanes.find(
          (lane) => lane.id === 'vitest'
        ).files;
        writeVitestJunit(root, plan, {
          files: [...files, 'src/unplanned.test.ts'],
        });
      },
      message: /does not close the planned file set/,
    },
    {
      name: 'zero-test Vitest suite',
      mutate({ root, plan }) {
        const file = plan.testInventory.lanes.find(
          (lane) => lane.id === 'vitest'
        ).files[0];
        writeVitestJunit(root, plan, { zeroFile: file });
      },
      message: /not a complete success/,
    },
    {
      name: 'all-skipped Vitest suite',
      mutate({ root, plan }) {
        const file = plan.testInventory.lanes.find(
          (lane) => lane.id === 'vitest'
        ).files[0];
        writeVitestJunit(root, plan, { allSkippedFile: file });
      },
      message: /not a complete success/,
    },
    {
      name: 'failed Vitest suite',
      mutate({ root, plan }) {
        const file = plan.testInventory.lanes.find(
          (lane) => lane.id === 'vitest'
        ).files[0];
        writeVitestJunit(root, plan, { failureFile: file });
      },
      message: /failed or errored tests/,
    },
    {
      name: 'tampered native Node result',
      mutate({ node }) {
        const result = JSON.parse(readFileSync(node, 'utf8'));
        result.unitId = 'forged-unit';
        writeFileSync(node, `${JSON.stringify(result)}\n`);
      },
      message: /not bound to its admission/,
    },
  ];

  for (const scenario of scenarios) {
    const { root, plan, environment } = fixture();
    const receiptDir = path.join(root, 'receipts');
    admitHostedGithubUnit({
      root,
      plan,
      expectedPlanSha256: plan.planSha256,
      unitId: 'ci-unit-test',
      receiptDir,
      environment,
    });
    const evidence = await createUnitTestEvidence({
      root,
      plan,
      environment,
      receiptDir,
    });
    scenario.mutate({ root, plan, ...evidence });
    assert.throws(
      () =>
        sealHostedGithubUnitReceipt({
          root,
          plan,
          expectedPlanSha256: plan.planSha256,
          unitId: 'ci-unit-test',
          receiptDir,
          jobStatus: 'success',
          evidenceFiles: [evidence.junit, evidence.node],
          environment,
        }),
      scenario.message,
      scenario.name
    );
  }
});

test('unit success seals active and skipped Vitest counts', async () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  admitHostedGithubUnit({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    environment,
  });
  const evidence = await createUnitTestEvidence({
    root,
    plan,
    environment,
    receiptDir,
  });
  const file = plan.testInventory.lanes.find((lane) => lane.id === 'vitest')
    .files[0];
  writeVitestJunit(root, plan, { partialSkippedFile: file });
  const sealed = sealHostedGithubUnitReceipt({
    root,
    plan,
    expectedPlanSha256: plan.planSha256,
    unitId: 'ci-unit-test',
    receiptDir,
    jobStatus: 'success',
    evidenceFiles: [evidence.junit, evidence.node],
    environment,
  });
  const result = sealed.receipt.caseResults.lanes.find(
    (lane) => lane.id === 'vitest'
  );
  assert.equal(result.skipped, 1);
  assert.equal(result.active + result.skipped, result.tests);
  assert.equal(result.active, result.fileCount);
});

test('reconciliation requires every planned unit case and its success ledger', async () => {
  const { root, plan, environment } = fixture();
  const receiptDir = path.join(root, 'receipts');
  for (const unit of plan.units) {
    assert.equal(unit.applicable, true, unit.id);
    for (const caseId of unit.cases) {
      admitHostedGithubUnit({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: unit.id,
        caseId,
        receiptDir,
        environment,
      });
      const unitEvidence =
        unit.id === 'ci-unit-test'
          ? await createUnitTestEvidence({
              root,
              plan,
              environment,
              receiptDir,
            })
          : null;
      sealHostedGithubUnitReceipt({
        root,
        plan,
        expectedPlanSha256: plan.planSha256,
        unitId: unit.id,
        caseId,
        receiptDir,
        jobStatus: 'success',
        evidenceFiles: unitEvidence
          ? [unitEvidence.junit, unitEvidence.node]
          : [],
        environment,
      });
    }
  }
  const needs = Object.fromEntries([
    [
      'engine-plan',
      {
        result: 'success',
        outputs: {
          planSha256: plan.planSha256,
          runId: plan.event.runId,
          runAttempt: plan.event.runAttempt,
          executionSha: plan.event.executionSha,
          headSha: plan.event.headSha,
        },
      },
    ],
    ...plan.units.map((unit) => [
      unit.needsKey,
      { result: 'success', outputs: {} },
    ]),
  ]);
  const evidence = loadHostedReceiptDirectory(receiptDir);
  assert.equal(evidence.admissions.length, 11);
  const report = reconcileHostedGithubExecution(plan, needs, evidence);
  assert.equal(report.status, 'passed');
  assert.equal(report.receipts.expected, 11);
  assert.equal(report.receipts.succeeded, 11);
  assert.equal(report.receipts.ledgerEntries, 11);
  assert.throws(
    () =>
      reconcileHostedGithubExecution(plan, needs, {
        ...evidence,
        receipts: evidence.receipts.slice(1),
      }),
    /receipt set does not close/
  );
  assert.throws(
    () =>
      reconcileHostedGithubExecution(plan, needs, {
        ...evidence,
        admissions: evidence.admissions.slice(1),
      }),
    /admission set does not close/
  );
  assert.throws(
    () =>
      reconcileHostedGithubExecution(plan, needs, {
        ...evidence,
        ledgers: [evidence.ledgers[1], ...evidence.ledgers.slice(1)],
      }),
    /duplicate work key/
  );

  const targetAdmission = evidence.admissions[0];
  const targetLedgerIndex = evidence.ledgers.findIndex(
    (ledger) =>
      ledger.entries[0]?.workKeySha256 === targetAdmission.workKeySha256
  );
  const alternateSuccess = createSuccessReceipt({
    identity: targetAdmission.identity,
    evidence: {
      resultSha256: '1'.repeat(64),
      stdoutSha256: '2'.repeat(64),
      stderrSha256: '3'.repeat(64),
      artifactManifestSha256: '4'.repeat(64),
      caseResultsSha256: '5'.repeat(64),
    },
  });
  const mismatchedLedger = recordSuccessfulWork(
    createRunScopedLedger(scopeFromPlan(plan)),
    alternateSuccess
  );
  const mismatchedLedgers = [...evidence.ledgers];
  mismatchedLedgers[targetLedgerIndex] = mismatchedLedger;
  assert.throws(
    () =>
      reconcileHostedGithubExecution(plan, needs, {
        ...evidence,
        ledgers: mismatchedLedgers,
      }),
    /run ledger failed binding/
  );

  const forgedAdmission = structuredClone(targetAdmission);
  forgedAdmission.identity.unit.definitionSha256 = '6'.repeat(64);
  forgedAdmission.workKeySha256 = workKeySha256(forgedAdmission.identity);
  const resealedAdmission = reseal(forgedAdmission, 'admissionSha256');
  const forgedAdmissions = [...evidence.admissions];
  forgedAdmissions[0] = resealedAdmission;
  assert.throws(
    () =>
      reconcileHostedGithubExecution(plan, needs, {
        ...evidence,
        admissions: forgedAdmissions,
      }),
    /does not match planned unit\/case/
  );
});
