import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createHostedTestInventory } from '../tools/validation-engine/runtime/hosted-test-inventory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adapterPath = join(root, 'vroom-application.json');
const contractRoot = process.env.VROOM_CONTRACT_ROOT
  ? resolve(process.env.VROOM_CONTRACT_ROOT)
  : null;
const expectedContractCommit =
  'b4f9b1534c19e6a95dc88ebed72722b09d26c4ea';
const expectedContractTree = 'd2a5a0d98753166b33101937e4aca4bb981db05c';
const adapterSource = readFileSync(adapterPath, 'utf8');
const adapterData = JSON.parse(adapterSource);
const contractTest = contractRoot ? test : test.skip;
const slash = (value) => value.split(sep).join('/');

async function contract() {
  return import(
    pathToFileURL(
      join(contractRoot, 'tools/validation-engine/index.mjs')
    ).href
  );
}

function globExpression(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      index += 1;
      if (pattern[index + 1] === '/') {
        index += 1;
        source += '(?:.*/)?';
      } else source += '.*';
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  }
  return new RegExp(`${source}$`, 'u');
}

function matcher(declaration) {
  const include = declaration.include.map(globExpression);
  const exclude = declaration.exclude.map(globExpression);
  return (file) =>
    include.some((expression) => expression.test(file)) &&
    !exclude.some((expression) => expression.test(file));
}

function filesUnder(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Unexpected symlink in test scope: ${absolute}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(slash(relative(root, absolute)));
    }
  };
  visit(directory);
  return files;
}

function recursivelyAssertJsonData(value) {
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value))
    return;
  assert.equal(typeof value, 'object');
  if (Array.isArray(value)) {
    for (const item of value) recursivelyAssertJsonData(item);
    return;
  }
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  for (const item of Object.values(value)) recursivelyAssertJsonData(item);
}

test('Seerr adapter is strict JSON data with no executable consumer surface', () => {
  recursivelyAssertJsonData(adapterData);
  assert.equal(adapterData.schema, 'vroom-application-adapter/v2');
  assert.equal(adapterData.apiVersion, 2);
  assert.equal(adapterData.vroomVersion, '0.0.1');
  assert.equal(adapterData.applicationId, 'seerrng');
  assert.deepEqual(adapterData.capabilities, {
    local: true,
    hosted: true,
    distributed: true,
  });
  assert.doesNotMatch(adapterSource, /run-local-validation|callback|executor|validator/u);
  assert.doesNotMatch(adapterSource, /"(?:inventory|test)(?:Count|Total)"/u);
});

contractTest('adapter loads through the exact accepted Vroom contract', async () => {
  const head = execFileSync('git', ['-C', contractRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  assert.equal(head, expectedContractCommit);
  const tree = execFileSync(
    'git',
    ['-C', contractRoot, 'rev-parse', 'HEAD^{tree}'],
    { encoding: 'utf8' }
  ).trim();
  assert.equal(tree, expectedContractTree);
  const status = execFileSync(
    'git',
    ['-C', contractRoot, 'status', '--porcelain=v1', '--untracked-files=all'],
    { encoding: 'utf8' }
  );
  assert.equal(status, '', 'pinned Vroom contract worktree must be clean');
  const api = await contract();
  const adapter = await api.loadApplicationAdapter('vroom-application.json', {
    root,
  });
  assert.equal(adapter.schema, api.APPLICATION_ADAPTER_SCHEMA);
  assert.equal(adapter.apiVersion, api.APPLICATION_ADAPTER_API_VERSION);
  assert.equal(adapter.policy.schema, api.APPLICATION_POLICY_SCHEMA);
  assert.equal(adapter.vroomVersion, api.VROOM_ENGINE_VERSION);
  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(Object.isFrozen(adapter.policy.stages.units), true);
});

contractTest('all four closed command recipe families conform', async () => {
  const { defineApplicationAdapter } = await contract();
  const adapter = defineApplicationAdapter(adapterData);
  const recipes = adapter.policy.stages.units
    .filter((unit) => unit.kind === 'command-sequence')
    .map((unit) => [unit.id, unit.recipe, unit.commands.length]);
  assert.deepEqual(recipes, [
    ['ci-jellyfin-plugin', 'dotnet-container-smoke', 2],
    ['ci-release-notes', 'git-release-validation', 2],
    ['docs-links', 'link-validation', 1],
    ['helm-lint-test', 'helm-chart-validation', 5],
  ]);
});

test('dynamic candidate ownership matches the audited Seerr inventory', () => {
  const repository = adapterData.policy.repository;
  const candidates = matcher(repository.testCandidates);
  const groups = new Map(
    repository.groups.map((group) => [group.id, matcher(group)])
  );
  const discovered = repository.testRoots
    .flatMap((testRoot) => filesUnder(join(root, testRoot)))
    .sort();
  const candidateOwners = new Map();
  for (const file of discovered) {
    const owners = [...groups]
      .filter(([, matches]) => matches(file))
      .map(([id]) => id);
    if (!candidates(file)) {
      assert.deepEqual(owners, [], `noncandidate group claim: ${file}`);
      continue;
    }
    assert.equal(owners.length, 1, `candidate ownership: ${file}`);
    candidateOwners.set(file, owners[0]);
  }
  for (const groupId of groups.keys())
    assert.ok(
      [...candidateOwners.values()].includes(groupId),
      `group selected no current candidates: ${groupId}`
    );

  const legacy = createHostedTestInventory(root, { platform: 'linux' });
  const expectedGroup = new Map([
    ['cypress', 'cypress'],
    ['docs-security', 'docs-security'],
    ['node-test-mjs', 'node-mjs'],
    ['playwright', 'playwright'],
    ['tooling', 'tooling'],
    ['vitest', 'vitest'],
  ]);
  const legacyOwners = new Map(
    legacy.lanes.flatMap((lane) =>
      lane.files.map((file) => [file, expectedGroup.get(lane.id)])
    )
  );
  legacyOwners.set(
    'test/vroom-application-adapter.test.mjs',
    'vroom-conformance'
  );
  assert.deepEqual([...candidateOwners.keys()].sort(), [...legacyOwners.keys()].sort());
  for (const [file, owner] of legacyOwners)
    assert.equal(candidateOwners.get(file), owner, `ownership changed: ${file}`);
});

test('future test paths preserve the audited discovery boundaries', () => {
  const repository = adapterData.policy.repository;
  const candidates = matcher(repository.testCandidates);
  const groups = new Map(
    repository.groups.map((group) => [group.id, matcher(group)])
  );
  const owners = (file) =>
    [...groups]
      .filter(([, matches]) => matches(file))
      .map(([id]) => id);

  const testExtensions = [
    'js',
    'ts',
    'cjs',
    'cts',
    'mjs',
    'mts',
    'jsx',
    'tsx',
  ];
  for (const testRoot of repository.testRoots) {
    for (const kind of ['test', 'spec'])
      for (const extension of testExtensions)
        assert.equal(
          candidates(`${testRoot}/future.${kind}.${extension}`),
          true,
          `${testRoot} ${kind}.${extension}`
        );
    for (const extension of ['js', 'ts', 'jsx', 'tsx'])
      assert.equal(
        candidates(`${testRoot}/future.cy.${extension}`),
        true,
        `${testRoot} cy.${extension}`
      );
    for (const unsupported of [
      'future.test.tjs',
      'future.spec.css',
      'future.cy.mjs',
    ])
      assert.equal(candidates(`${testRoot}/${unsupported}`), false);
  }

  for (const extension of ['js', 'ts', 'jsx', 'tsx']) {
    const cypress = `cypress/e2e/future.cy.${extension}`;
    assert.equal(candidates(cypress), true, cypress);
    assert.deepEqual(owners(cypress), ['cypress'], cypress);

    const playwright = `playwright/future.spec.${extension}`;
    assert.equal(candidates(playwright), true, playwright);
    assert.deepEqual(owners(playwright), ['playwright'], playwright);
  }

  for (const [file, owner] of [
    ['server/future.test.ts', 'vitest'],
    ['src/future.test.ts', 'vitest'],
    ['src/future.test.tsx', 'vitest'],
    ['server/future.test.mjs', 'node-mjs'],
    ['server/future.spec.mjs', 'node-mjs'],
    ['src/future.test.mjs', 'node-mjs'],
    ['src/future.spec.mjs', 'node-mjs'],
  ]) {
    assert.equal(candidates(file), true, file);
    assert.deepEqual(owners(file), [owner], file);
  }

  for (const file of [
    'server/future.test.tsx',
    'server/future.spec.ts',
    'cypress/future.cy.ts',
    'gen-docs/future.test.mjs',
  ]) {
    assert.equal(candidates(file), true, file);
    assert.deepEqual(owners(file), [], file);
  }
  assert.equal(candidates('server/future-helper.ts'), false);
  assert.deepEqual(owners('server/future-helper.ts'), []);
});

test('manifest, lock and workflow bindings remain source owned', () => {
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json')));
  const docsManifest = JSON.parse(
    readFileSync(join(root, 'gen-docs', 'package.json'))
  );
  assert.equal(rootManifest.packageManager, 'pnpm@10.24.0');
  for (const script of adapterData.policy.repository.scripts) {
    const manifest = script.workspaceId === 'root' ? rootManifest : docsManifest;
    assert.equal(typeof manifest.scripts?.[script.name], 'string', script.id);
  }
  const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  for (const [name, version] of [
    ['@playwright/test', '1.63.0'],
    ['cypress', '16.0.0'],
    ['vitest', '4.1.11'],
  ]) {
    assert.ok(lock.includes(`${name}@${version}`), `${name}@${version}`);
  }
  for (const workflow of adapterData.policy.hosted.workflows) {
    const source = readFileSync(join(root, workflow.path), 'utf8');
    for (const job of workflow.jobs)
      assert.match(source, new RegExp(`^  ${job.id}:`, 'mu'));
  }
});

contractTest(
  'hosted composites resolve explicitly to typed units and a derived case cap',
  async () => {
    const { defineApplicationAdapter } = await contract();
    const adapter = defineApplicationAdapter(adapterData);
    const jobs = Object.fromEntries(
      adapter.policy.hosted.workflows.flatMap((workflow) =>
        workflow.jobs.map((job) => [`${workflow.id}/${job.id}`, job.unitIds])
      )
    );
    assert.deepEqual(jobs['ci/i18n'], ['ci-i18n', 'ci-security-council']);
    assert.deepEqual(jobs['ci/test'], [
      'ci-test-build',
      'ci-test-bundle',
      'ci-test-format',
      'ci-test-lint',
    ]);
    assert.deepEqual(jobs['ci/unit-test'], ['ci-unit-node', 'ci-unit-vitest']);
    assert.deepEqual(jobs['codeql/analyze'], [
      'codeql-actions',
      'codeql-javascript',
    ]);
    assert.deepEqual(jobs['test-docs/test-build'], [
      'test-docs-build',
      'test-docs-generate',
      'test-docs-security',
    ]);

    const shards = new Map(
      adapter.policy.timing.shards.map((entry) => [entry.unitId, entry.count])
    );
    const hostedCases = Object.values(jobs)
      .flat()
      .reduce((total, unitId) => total + (shards.get(unitId) ?? 1), 0);
    assert.equal(hostedCases, adapter.policy.timing.maximumConcurrentCases);
    assert.equal(hostedCases, 30);
  }
);

contractTest('contract rejects compatibility and recipe drift', async () => {
  const { defineApplicationAdapter } = await contract();
  const wrongVersion = structuredClone(adapterData);
  wrongVersion.vroomVersion = '0.0.2';
  assert.throws(() => defineApplicationAdapter(wrongVersion), /exact Vroom version/u);

  const extraField = structuredClone(adapterData);
  extraField.callback = 'not-executable-but-still-unsupported';
  assert.throws(() => defineApplicationAdapter(extraField), /exact field set/u);

  const incompleteRecipe = structuredClone(adapterData);
  incompleteRecipe.policy.stages.units
    .find((unit) => unit.id === 'helm-lint-test')
    .commands.pop();
  assert.throws(
    () => defineApplicationAdapter(incompleteRecipe),
    /does not match its declared closed recipe/u
  );
});

contractTest(
  'Mode 3 preflights the adapter but does not consume it as execution policy',
  () => {
    const cli = readFileSync(join(contractRoot, 'bin', 'vroom-test.mjs'), 'utf8');
    assert.match(
      cli,
      /preflightRepository\(options\.root,\s*\{\s*policy: adapter\.policy,\s*testsOnly: true,/u
    );

    const mode3 = readFileSync(
      join(
        contractRoot,
        'tools',
        'validation-engine',
        'runtime',
        'distributed-mode3-executor.mjs'
      ),
      'utf8'
    );
    assert.match(mode3, /request\.adapter\?\.applicationId !== applicationId/u);
    assert.doesNotMatch(mode3, /adapter\?*\.policy|adapter\[['"]policy['"]\]/u);

    const runtime = join(
      contractRoot,
      'tools',
      'validation-engine',
      'runtime'
    );
    const shimImporters = readdirSync(runtime)
      .filter((name) => name.endsWith('.mjs'))
      .filter((name) =>
        readFileSync(join(runtime, name), 'utf8').includes(
          "./compat/seerrng-repository-test-plan-v1.mjs"
        )
      )
      .sort();
    assert.deepEqual(shimImporters, [
      'distributed-native-adapter.mjs',
      'native-stage-context.mjs',
    ]);
  }
);
