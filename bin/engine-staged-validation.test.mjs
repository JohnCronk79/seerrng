// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStagedValidation,
  executeStagedValidation,
} from '../tools/validation-engine/runtime/staged-validation.mjs';

const sha = 'a'.repeat(64);
const candidate = {
  repository: 'JohnCronk79/seerrng',
  commit: 'b'.repeat(40),
  tree: 'c'.repeat(40),
  lockSha256: 'd'.repeat(64),
  sourceSha256: sha,
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
  codeqlPlan: { sourceIdentity: { sha256: sha } },
  buildBrowserPlan: {
    candidate,
    configuredWorkers: 24,
    specs: ['cypress/e2e/example.cy.ts'],
  },
});

test('existing coordinator binds four exclusive ordered native stages', () => {
  const binding = createStagedValidation(input());
  assert.deepEqual(
    binding.plan.lanes.map(({ id, dependsOn }) => ({ id, dependsOn })),
    [
      { id: 'repository', dependsOn: [] },
      { id: 'codeql', dependsOn: ['repository'] },
      { id: 'build', dependsOn: ['codeql'] },
      { id: 'browser', dependsOn: ['build'] },
    ]
  );
  assert.equal(binding.plan.maxSlots, 24);
  assert.ok(binding.plan.units.every((unit) => unit.slots === 24));
  assert.equal(binding.resultReuse, false);
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

test('failed or zero-active repository suite blocks all later expensive stages', async () => {
  for (const result of [
    { status: 'failed', cases: { passed: 1, failed: 1, skipped: 0 } },
    { status: 'passed', cases: { passed: 0, failed: 0, skipped: 4 } },
  ]) {
    let nativeStarts = 0;
    const report = await executeStagedValidation(
      createStagedValidation(input()),
      {
        executeRepository: async () => result,
        run: async () => {
          nativeStarts++;
          throw new Error('Must not start');
        },
        readFile: async () => '',
        writeArtifact: async () => {},
        verifySource: async () => {},
      }
    );
    assert.equal(report.status, 'failed');
    assert.equal(report.ok, false);
    assert.equal(nativeStarts, 0);
    assert.deepEqual(
      report.results.slice(1).map((unit) => unit.status),
      ['blocked', 'blocked', 'blocked']
    );
  }
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
