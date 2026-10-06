// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tests cannot resolve application TS aliases.
import {
  createHostedGithubPlan,
  githubChangedFilesRange,
  reconcileHostedGithubNeeds,
} from '../tools/validation-engine/runtime/hosted-github-plan.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tests cannot resolve application TS aliases.
import { createHostedTestInventory } from '../tools/validation-engine/runtime/hosted-test-inventory.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tests cannot resolve application TS aliases.
import {
  createStagedValidation,
  executeStagedValidation,
} from '../tools/validation-engine/runtime/staged-validation.mjs';

const sha = 'a'.repeat(64);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const hostedTestInventory = createHostedTestInventory(repositoryRoot);
const candidate = {
  repository: 'JohnCronk79/seerrng',
  commit: 'b'.repeat(40),
  tree: 'c'.repeat(40),
  lockSha256: 'd'.repeat(64),
  sourceSha256: sha,
};
const workflowHashes = {
  ci: '1'.repeat(64),
  codeql: '2'.repeat(64),
  cypress: '3'.repeat(64),
  testDocs: '4'.repeat(64),
  docsLinks: '5'.repeat(64),
  helm: '6'.repeat(64),
};
const githubEvent = (overrides = {}) => ({
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
  ...overrides,
});
const hostedInput = (overrides = {}) => ({
  candidate,
  event: githubEvent(),
  changedFiles: ['tools/validation-engine/runtime/staged-validation.mjs'],
  workflowHashes,
  testInventory: hostedTestInventory,
  ...overrides,
});
const githubNeeds = (plan) =>
  Object.fromEntries([
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
      { result: unit.applicable ? 'success' : 'skipped', outputs: {} },
    ]),
  ]);
const canonicalJson = (value) => {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
const rehashPlan = (plan) => {
  const copy = structuredClone(plan);
  delete copy.planSha256;
  return createHash('sha256').update(canonicalJson(copy)).digest('hex');
};
const input = () => ({
  runId: 'stage-regression',
  candidate,
  executionEnvironmentSha256: 'e'.repeat(64),
  capacity: { configuredWorkers: 24, effectiveLogicalCpus: 12 },
  repositoryPlan: {
    inventory: [{ file: 'server/example.test.ts', selected: true }],
    steps: [{ name: 'native repository suite' }],
  },
  codeqlPlan: {
    sourceIdentity: { sha256: sha },
    artifacts: [],
    steps: [{ id: 'codeql-probe' }],
  },
  buildBrowserPlan: {
    candidate,
    configuredWorkers: 24,
    specs: ['cypress/e2e/example.cy.ts'],
    build: [{ id: 'production-build' }],
  },
});

test('existing coordinator binds four exclusive ordered native stages', () => {
  const binding = createStagedValidation(input());
  assert.deepEqual(
    binding.plan.lanes.map(({ id, dependsOn, after }) => ({
      id,
      dependsOn,
      after,
    })),
    [
      { id: 'repository', dependsOn: [], after: [] },
      { id: 'codeql', dependsOn: [], after: ['repository'] },
      { id: 'build', dependsOn: [], after: ['codeql'] },
      { id: 'browser', dependsOn: [], after: ['build'] },
    ]
  );
  assert.equal(binding.plan.maxSlots, 24);
  assert.ok(binding.plan.units.every((unit) => unit.slots === 24));
  assert.equal(binding.resultReuse, false);
  assert.deepEqual(
    binding.plan.units.find((unit) => unit.id === 'native-browser').dependsOn,
    ['native-build']
  );
});

test('capacity follows supplied Actions budget, not hardcoded local24', () => {
  const options = input();
  options.capacity = { configuredWorkers: 4, effectiveLogicalCpus: 4 };
  options.buildBrowserPlan.configuredWorkers = 4;
  assert.equal(createStagedValidation(options).plan.maxSlots, 4);
});

test('worker upper bound agrees with existing CPU override contract', () => {
  const options = input();
  options.capacity.configuredWorkers = 256;
  options.buildBrowserPlan.configuredWorkers = 256;
  assert.equal(createStagedValidation(options).plan.maxSlots, 256);
  options.capacity.configuredWorkers = 257;
  assert.throws(() => createStagedValidation(options), /worker budget/);
});

test('mixed source snapshots and invented empty test discovery are refused', () => {
  const mixed = input();
  mixed.codeqlPlan.sourceIdentity.sha256 = 'f'.repeat(64);
  assert.throws(() => createStagedValidation(mixed), /same candidate/);
  const empty = input();
  empty.repositoryPlan.inventory = [];
  assert.throws(() => createStagedValidation(empty), /Discovered repository/);
});

test('required missing tool blocks that stage, GitHub metadata stays separately pending', () => {
  const options = input();
  options.prChecks = [
    {
      id: 'plugin',
      stage: 'build',
      required: true,
      status: 'prerequisite-blocked',
      reason: 'Verified .NET9 missing',
    },
    {
      id: 'title',
      stage: 'repository',
      required: true,
      status: 'github-native-pending',
      reason: 'No published PR exists',
    },
  ];
  const binding = createStagedValidation(options);
  assert.equal(binding.plan.lanes[2].prerequisites[0].id, 'plugin');
  assert.equal(binding.plan.lanes[0].prerequisites.length, 0);
  assert.equal(binding.applicability.length, 2);
});

test('failed or zero-active repository suite retains failure while independent stages still attempt execution', async () => {
  for (const result of [
    { status: 'failed', cases: { passed: 1, failed: 1, skipped: 0 } },
    { status: 'passed', cases: { passed: 0, failed: 0, skipped: 4 } },
  ]) {
    const nativeStarts = [];
    const report = await executeStagedValidation(
      createStagedValidation(input()),
      {
        executeRepository: async () => result,
        run: async (command) => {
          nativeStarts.push(command.id);
          throw new Error('Focused fixture rejects native invocation');
        },
        readFile: async () => '',
        writeArtifact: async () => {},
        verifySource: async () => {},
      }
    );
    assert.equal(report.status, 'failed');
    assert.equal(report.ok, false);
    assert.deepEqual(nativeStarts, ['codeql-probe', 'production-build']);
    assert.deepEqual(
      report.results.map((unit) => unit.status),
      ['failed', 'failed', 'failed', 'blocked']
    );
  }
});

test('independent supplemental checks continue sequentially after primary and supplemental failures', async () => {
  const options = input();
  options.prChecks = ['first', 'second'].map((id) => ({
    id,
    stage: 'repository',
    required: true,
    status: 'ready',
    commands: [{ id }],
  }));
  const binding = createStagedValidation(options);
  assert.deepEqual(
    binding.plan.units.find((unit) => unit.id === 'pr-first').after,
    ['native-repository']
  );
  assert.deepEqual(
    binding.plan.units.find((unit) => unit.id === 'pr-second').after,
    ['pr-first']
  );
  const calls = [];
  const report = await executeStagedValidation(binding, {
    executeRepository: async () => ({
      status: 'failed',
      cases: { passed: 1, failed: 1, skipped: 0 },
    }),
    run: async (command) => {
      calls.push(command.id);
      if (command.id !== 'second')
        throw new Error('Focused native failure fixture');
      return {
        status: 'passed',
        exitCode: 0,
        wallMs: 1,
        lifecycle: { completed: true },
      };
    },
    readFile: async () => '',
    writeArtifact: async () => {},
    verifySource: async () => {},
  });
  assert.deepEqual(calls, [
    'first',
    'second',
    'codeql-probe',
    'production-build',
  ]);
  assert.equal(
    report.results.find((unit) => unit.id === 'pr-first').status,
    'failed'
  );
  assert.equal(
    report.results.find((unit) => unit.id === 'pr-second').status,
    'passed'
  );
  assert.equal(report.ok, false);
  assert.equal(report.status, 'failed');
});

test('changed source or boundary rejects every later native admission', async () => {
  let changed = false;
  let starts = 0;
  await assert.rejects(
    executeStagedValidation(createStagedValidation(input()), {
      executeRepository: async () => {
        changed = true;
        return {
          status: 'failed',
          cases: { passed: 1, failed: 1, skipped: 0 },
        };
      },
      run: async () => {
        starts++;
        throw new Error('No unsafe native starts');
      },
      readFile: async () => '',
      writeArtifact: async () => {},
      verifySource: async () => {
        if (changed) throw new Error('Frozen source/boundary changed');
      },
    }),
    /Frozen source\/boundary changed/
  );
  assert.equal(starts, 0);
});

test('infrastructure failure retains partial repository evidence without claiming complete case execution', async () => {
  const partial = {
    completed: false,
    caseLedgers: [{ counts: { passed: 3, failed: 0, skipped: 1 } }],
    commands: [{ status: 'timed-out' }],
    unexecutedSteps: [{ name: 'Tooling', reason: 'Earlier timeout' }],
    resultReuse: false,
  };
  let restored = false;
  const report = await executeStagedValidation(
    createStagedValidation(input()),
    {
      executeRepository: async () => {
        throw Object.assign(new Error('Native owner timed out'), {
          repositoryEvidence: partial,
        });
      },
      withRepositoryIsolation: async (operation) => {
        try {
          return await operation();
        } finally {
          restored = true;
        }
      },
      run: async () => {
        throw new Error('Focused later-stage failure');
      },
      readFile: async () => '',
      writeArtifact: async () => {},
      verifySource: async () => {},
    }
  );
  assert.equal(restored, true);
  assert.equal(report.status, 'failed');
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.nativeEvidence['native-repository'].repositoryEvidence,
    partial
  );
  assert.equal(report.results[0].caseAttempts, null);
});

test('missing lifecycle/source/native executor callbacks fail before admission', async () => {
  await assert.rejects(
    executeStagedValidation(createStagedValidation(input()), {}),
    /executors, artifact and source guards/
  );
});

test('repository-only isolation surrounds execution and restores before source guards', async () => {
  const calls = [];
  let isolated = false;
  const report = await executeStagedValidation(
    createStagedValidation(input()),
    {
      executeRepository: async () => {
        assert.equal(isolated, true);
        calls.push('repository');
        return {
          status: 'failed',
          cases: { passed: 1, failed: 1, skipped: 0 },
        };
      },
      withRepositoryIsolation: async (operation, admission) => {
        assert.deepEqual(admission.candidate, candidate);
        assert.match(admission.unitId, /repository/);
        isolated = true;
        calls.push('isolate');
        try {
          return await operation();
        } finally {
          isolated = false;
          calls.push('restore');
        }
      },
      run: async () => {
        throw new Error('Later stages must not start');
      },
      readFile: async () => '',
      writeArtifact: async () => {},
      verifySource: async () => {
        assert.equal(isolated, false);
        calls.push('guard');
      },
    }
  );
  assert.equal(report.status, 'failed');
  assert.deepEqual(calls.slice(0, 5), [
    'guard',
    'isolate',
    'repository',
    'restore',
    'guard',
  ]);
});

test('repository isolation restoration is awaited on native rejection', async () => {
  let restored = false;
  const report = await executeStagedValidation(
    createStagedValidation(input()),
    {
      executeRepository: async () => {
        throw new Error('Native failed');
      },
      withRepositoryIsolation: async (operation) => {
        try {
          return await operation();
        } finally {
          await Promise.resolve();
          restored = true;
        }
      },
      run: async () => {
        throw new Error('Must not start');
      },
      readFile: async () => '',
      writeArtifact: async () => {},
      verifySource: async () => {},
    }
  );
  assert.equal(report.status, 'failed');
  assert.equal(restored, true);
});

test('unsupported, duplicate and unproved applicability is rejected', () => {
  for (const prChecks of [
    [{ id: 'x', stage: 'not-a-stage', required: true, status: 'ready' }],
    [{ id: 'x', stage: 'build', required: true, status: 'not-applicable' }],
    [{ id: 'x', stage: 'build', required: true, status: 'passed' }],
    [
      {
        id: 'x',
        stage: 'build',
        required: true,
        status: 'ready',
        commands: [],
      },
    ],
  ]) {
    assert.throws(() => createStagedValidation({ ...input(), prChecks }));
  }
});

test('hosted GitHub plan is deterministic and binds the staged native DAG', () => {
  const first = createHostedGithubPlan(
    hostedInput({
      changedFiles: [
        'bin/run-local-validation.mjs',
        'tools/validation-engine/runtime/staged-validation.mjs',
      ],
    })
  );
  const reorderedHashes = Object.fromEntries(
    Object.entries(workflowHashes).reverse()
  );
  const second = createHostedGithubPlan(
    hostedInput({
      changedFiles: [
        'tools/validation-engine/runtime/staged-validation.mjs',
        'bin/run-local-validation.mjs',
      ],
      workflowHashes: reorderedHashes,
    })
  );

  assert.equal(first.schema, 'seerrng-hosted-github-plan/v3');
  assert.equal(first.planSha256, second.planSha256);
  assert.deepEqual(first, second);
  assert.equal(first.resultReuse, false);
  assert.equal(first.units.length, 10);
  assert.deepEqual(
    first.units.map(({ id, stage, dependsOn }) => ({ id, stage, dependsOn })),
    [
      {
        id: 'ci-release-notes',
        stage: 'repository',
        dependsOn: ['engine-plan'],
      },
      {
        id: 'ci-i18n',
        stage: 'repository',
        dependsOn: ['engine-plan'],
      },
      {
        id: 'ci-unit-test',
        stage: 'repository',
        dependsOn: ['engine-plan'],
      },
      {
        id: 'docs-links',
        stage: 'repository',
        dependsOn: ['engine-plan'],
      },
      {
        id: 'codeql-analyze',
        stage: 'codeql',
        dependsOn: [
          'ci-release-notes',
          'ci-i18n',
          'ci-unit-test',
          'docs-links',
        ],
      },
      {
        id: 'ci-jellyfin-plugin',
        stage: 'build',
        dependsOn: ['codeql-analyze'],
      },
      {
        id: 'ci-test',
        stage: 'build',
        dependsOn: ['codeql-analyze'],
      },
      {
        id: 'test-docs-build',
        stage: 'build',
        dependsOn: ['codeql-analyze'],
      },
      {
        id: 'helm-lint-test',
        stage: 'build',
        dependsOn: ['codeql-analyze'],
      },
      {
        id: 'cypress-run',
        stage: 'browser',
        dependsOn: [
          'ci-jellyfin-plugin',
          'ci-test',
          'test-docs-build',
          'helm-lint-test',
        ],
      },
    ]
  );
  assert.deepEqual(
    first.units
      .filter(({ testLanes }) => testLanes.length)
      .map(({ id, testLanes }) => ({ id, testLanes })),
    [
      { id: 'ci-i18n', testLanes: ['tooling'] },
      {
        id: 'ci-unit-test',
        testLanes: ['vitest', 'node-test-mjs'],
      },
      { id: 'test-docs-build', testLanes: ['docs-security'] },
      { id: 'cypress-run', testLanes: ['cypress'] },
    ]
  );
  assert.deepEqual(
    first.units.filter((unit) => !unit.applicable).map((unit) => unit.id),
    ['helm-lint-test']
  );
  assert.deepEqual(
    first.externalMetadata.map((entry) => entry.id),
    ['github-pr-title', 'github-pr-template', 'github-merge-conflict-state']
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.units[0]), true);
});

test('hosted GitHub applicability matches native event, branch and path filters', () => {
  const applicableIds = (options) =>
    createHostedGithubPlan(options)
      .units.filter((unit) => unit.applicable)
      .map((unit) => unit.id);
  const botDocs = hostedInput({
    event: githubEvent({ actorType: 'Bot' }),
    changedFiles: ['docs/maintainers/example.md'],
  });
  assert.deepEqual(applicableIds(botDocs), [
    'ci-i18n',
    'ci-unit-test',
    'docs-links',
    'ci-jellyfin-plugin',
    'ci-test',
    'test-docs-build',
  ]);

  const engineMarkdown = hostedInput({
    event: githubEvent({ actorType: 'Bot' }),
    changedFiles: ['tools/validation-engine/README.md'],
  });
  assert.deepEqual(applicableIds(engineMarkdown), [
    'ci-i18n',
    'ci-unit-test',
    'docs-links',
    'codeql-analyze',
    'ci-jellyfin-plugin',
    'ci-test',
    'test-docs-build',
    'cypress-run',
  ]);

  const charts = hostedInput({ changedFiles: ['charts/seerrng/values.yaml'] });
  assert.deepEqual(applicableIds(charts), [
    'ci-release-notes',
    'ci-i18n',
    'ci-unit-test',
    'codeql-analyze',
    'ci-jellyfin-plugin',
    'ci-test',
    'helm-lint-test',
  ]);

  const centralCaller = hostedInput({
    changedFiles: ['.github/workflows/ci.yml'],
  });
  assert.deepEqual(applicableIds(centralCaller), [
    'ci-release-notes',
    'ci-i18n',
    'ci-unit-test',
    'docs-links',
    'codeql-analyze',
    'ci-jellyfin-plugin',
    'ci-test',
    'test-docs-build',
    'helm-lint-test',
    'cypress-run',
  ]);

  for (const [pathFilterMode, baseSha] of [
    ['run-all-large-update', 'f'.repeat(40)],
    ['run-all-new-branch', '0'.repeat(40)],
  ]) {
    const fallbackPush = hostedInput({
      event: githubEvent({
        name: 'push',
        headSha: candidate.commit,
        baseSha,
        ref: 'refs/heads/main',
        baseRef: null,
        actorType: null,
        pathFilterMode,
      }),
      changedFiles: [],
    });
    assert.deepEqual(
      applicableIds(fallbackPush),
      [
        'ci-release-notes',
        'ci-i18n',
        'ci-unit-test',
        'docs-links',
        'codeql-analyze',
        'ci-jellyfin-plugin',
        'ci-test',
        'test-docs-build',
        'helm-lint-test',
        'cypress-run',
      ],
      pathFilterMode
    );
  }
  const largePullRequest = hostedInput({
    event: githubEvent({ pathFilterMode: 'run-all-large-update' }),
    changedFiles: [],
  });
  assert.deepEqual(applicableIds(largePullRequest), [
    'ci-release-notes',
    'ci-i18n',
    'ci-unit-test',
    'docs-links',
    'codeql-analyze',
    'ci-jellyfin-plugin',
    'ci-test',
    'test-docs-build',
    'helm-lint-test',
    'cypress-run',
  ]);
  assert.throws(
    () =>
      createHostedGithubPlan(
        hostedInput({
          event: githubEvent({
            name: 'push',
            headSha: candidate.commit,
            baseSha: '0'.repeat(40),
            ref: 'refs/heads/main',
            baseRef: null,
            actorType: null,
          }),
        })
      ),
    /new-branch path fallback/
  );
  assert.throws(
    () =>
      createHostedGithubPlan(
        hostedInput({
          event: githubEvent({ pathFilterMode: 'run-all-new-branch' }),
        })
      ),
    /Pull requests require a valid changed-file mode/
  );

  const slashBranch = hostedInput({
    event: githubEvent({ baseRef: 'release/next' }),
  });
  assert.deepEqual(applicableIds(slashBranch), []);
});

test('hosted changed-file ranges preserve native PR and push diff semantics', () => {
  const base = '1'.repeat(40);
  const head = '2'.repeat(40);
  assert.equal(
    githubChangedFilesRange('pull_request', base, head),
    `${base}...${head}`
  );
  assert.equal(githubChangedFilesRange('push', base, head), `${base}..${head}`);
  assert.throws(
    () => githubChangedFilesRange('schedule', base, head),
    /pull_request and push only/
  );
  assert.throws(
    () => githubChangedFilesRange('push', 'bad', head),
    /diff endpoints/
  );
});

test('hosted GitHub plan binds tested execution separately from PR branch head', () => {
  const pullRequest = createHostedGithubPlan(hostedInput());
  assert.equal(pullRequest.event.executionSha, candidate.commit);
  assert.notEqual(pullRequest.event.headSha, pullRequest.event.executionSha);
  assert.throws(
    () =>
      createHostedGithubPlan(
        hostedInput({
          event: githubEvent({ executionSha: 'f'.repeat(40) }),
        })
      ),
    /execution identity must bind the candidate/
  );
  assert.throws(
    () =>
      createHostedGithubPlan(
        hostedInput({
          event: githubEvent({
            name: 'push',
            ref: 'refs/heads/main',
            baseRef: null,
            actorType: null,
          }),
        })
      ),
    /Push head and execution identities must match/
  );
});

test('hosted GitHub reconciliation accepts only exact current-run needs', () => {
  const plan = createHostedGithubPlan(hostedInput());
  const report = reconcileHostedGithubNeeds(plan, githubNeeds(plan));
  assert.equal(report.schema, 'seerrng-hosted-github-reconciliation/v2');
  assert.equal(report.status, 'passed');
  assert.equal(report.ok, true);
  assert.equal(report.scope, 'native-jobs');
  assert.equal(report.complete, false);
  assert.equal(report.externalMetadataStatus, 'external-not-reconciled');
  assert.equal(report.planSha256, plan.planSha256);
  assert.deepEqual(report.jobs, {
    expected: 10,
    applicable: 9,
    succeeded: 9,
    skipped: 1,
  });
  assert.deepEqual(
    report.stages.map(({ id, expected, succeeded, skipped, status }) => ({
      id,
      expected,
      succeeded,
      skipped,
      status,
    })),
    [
      {
        id: 'repository',
        expected: 4,
        succeeded: 4,
        skipped: 0,
        status: 'passed',
      },
      {
        id: 'codeql',
        expected: 1,
        succeeded: 1,
        skipped: 0,
        status: 'passed',
      },
      {
        id: 'build',
        expected: 4,
        succeeded: 3,
        skipped: 1,
        status: 'passed',
      },
      {
        id: 'browser',
        expected: 1,
        succeeded: 1,
        skipped: 0,
        status: 'passed',
      },
    ]
  );
  assert.equal(report.resultReuse, false);
  assert.equal(Object.isFrozen(report), true);

  const pushPlan = createHostedGithubPlan(
    hostedInput({
      event: githubEvent({
        name: 'push',
        headSha: candidate.commit,
        ref: 'refs/heads/main',
        baseRef: null,
        actorType: null,
      }),
    })
  );
  const pushReport = reconcileHostedGithubNeeds(
    pushPlan,
    githubNeeds(pushPlan)
  );
  assert.equal(pushReport.complete, true);
  assert.equal(pushReport.externalMetadataStatus, 'not-applicable');
});

test('hosted GitHub reconciliation rejects incomplete, stale and nonpassing needs', () => {
  const plan = createHostedGithubPlan(hostedInput());
  const mutation = (change) => {
    const needs = structuredClone(githubNeeds(plan));
    change(needs);
    return needs;
  };

  assert.throws(
    () =>
      reconcileHostedGithubNeeds(
        plan,
        mutation((needs) => delete needs['unit-test'])
      ),
    /needs set mismatch/
  );
  assert.throws(
    () =>
      reconcileHostedGithubNeeds(
        plan,
        mutation((needs) => {
          needs.unplanned = { result: 'success', outputs: {} };
        })
      ),
    /needs set mismatch/
  );
  for (const result of ['failure', 'cancelled', 'skipped'])
    assert.throws(
      () =>
        reconcileHostedGithubNeeds(
          plan,
          mutation((needs) => {
            needs['unit-test'].result = result;
          })
        ),
      /unit-test expected success/
    );
  assert.throws(
    () =>
      reconcileHostedGithubNeeds(
        plan,
        mutation((needs) => {
          needs.helm.result = 'success';
        })
      ),
    /helm expected skipped/
  );
  for (const field of [
    'planSha256',
    'runId',
    'runAttempt',
    'executionSha',
    'headSha',
  ])
    assert.throws(
      () =>
        reconcileHostedGithubNeeds(
          plan,
          mutation((needs) => {
            needs['engine-plan'].outputs[field] = 'stale';
          })
        ),
      new RegExp(`Stale or unbound engine-plan ${field}`)
    );
  assert.throws(
    () =>
      reconcileHostedGithubNeeds(
        plan,
        mutation((needs) => {
          needs['engine-plan'].result = 'cancelled';
        })
      ),
    /engine-plan did not succeed/
  );
});

test('hosted GitHub reconciliation rejects duplicate planned needs bindings', () => {
  const plan = structuredClone(createHostedGithubPlan(hostedInput()));
  plan.units[1].needsKey = plan.units[0].needsKey;
  plan.planSha256 = rehashPlan(plan);
  assert.throws(
    () => reconcileHostedGithubNeeds(plan, githubNeeds(plan)),
    /Duplicate hosted validation unit binding/
  );
});
