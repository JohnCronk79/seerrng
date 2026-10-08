import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adapterPath = join(root, 'vroom-application.json');
const acceptedPlanRoot = process.env.VROOM_PLAN_ROOT
  ? resolve(process.env.VROOM_PLAN_ROOT)
  : null;
const acceptedPlanCommit =
  '60382c643a9a24c9cd7158eeaba3401c38b2cafc';
const acceptedPlanTree = 'cf88faf28bdfd1628ba966f2899a45ff6f659f30';
// The accepted plan is not a runnable v3 contract. Set this only after Vroom
// publishes and independently accepts the implementation commit.
const intendedVroomV3ContractCommit = null;
const adapterSource = readFileSync(adapterPath, 'utf8');
const adapterData = JSON.parse(adapterSource);
const planTest = acceptedPlanRoot ? test : test.skip;
const slash = (value) => value.split(sep).join('/');

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

test('Seerr adapter is strict version 3 JSON with its executable pin pending', () => {
  recursivelyAssertJsonData(adapterData);
  assert.equal(adapterData.schema, 'vroom-application-adapter/v3');
  assert.equal(adapterData.apiVersion, 3);
  assert.equal(adapterData.vroomVersion, '0.0.1');
  assert.equal(adapterData.applicationId, 'seerrng');
  assert.equal(
    adapterData.policy.schema,
    'vroom-application-policy-profile/v3'
  );
  assert.deepEqual(adapterData.capabilities, {
    local: true,
    hosted: true,
    distributed: true,
  });
  assert.equal(intendedVroomV3ContractCommit, null);
  assert.doesNotMatch(
    adapterSource,
    /run-local-validation|callback|executor|validator/u
  );
  assert.doesNotMatch(adapterSource, /"(?:inventory|test)(?:Count|Total)"/u);
});

planTest(
  'accepted Vroom plan provenance is exact and is not misreported as a v3 runtime',
  () => {
    const head = execFileSync(
      'git',
      ['-C', acceptedPlanRoot, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' }
    ).trim();
    assert.equal(head, acceptedPlanCommit);
    const tree = execFileSync(
      'git',
      ['-C', acceptedPlanRoot, 'rev-parse', 'HEAD^{tree}'],
      { encoding: 'utf8' }
    ).trim();
    assert.equal(tree, acceptedPlanTree);
    const status = execFileSync(
      'git',
      [
        '-C',
        acceptedPlanRoot,
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(status, '', 'accepted Vroom plan worktree must be clean');
    const plan = readFileSync(
      join(
        acceptedPlanRoot,
        'tools',
        'validation-engine',
        'Mode 3 Full Adapter-Owned Execution Plan.txt'
      ),
      'utf8'
    );
    assert.match(plan, /Status:\s+Accepted design checkpoint\./u);
    assert.match(plan, /vroom-application-adapter\/v3/u);
    assert.match(plan, /Seerr adapter commit:\s+75969bc82d0adaf/u);
    const currentContract = readFileSync(
      join(
        acceptedPlanRoot,
        'tools',
        'validation-engine',
        'runtime',
        'application-policy-profile.mjs'
      ),
      'utf8'
    );
    assert.match(currentContract, /vroom-application-policy-profile\/v2/u);
    assert.doesNotMatch(
      currentContract,
      /vroom-application-policy-profile\/v3/u
    );
    assert.equal(intendedVroomV3ContractCommit, null);
  }
);

test('all four closed command recipe families remain declared', () => {
  const recipes = adapterData.policy.stages.units
    .filter((unit) => unit.kind === 'command-sequence')
    .map((unit) => [unit.id, unit.recipe, unit.commands.length]);
  assert.deepEqual(recipes, [
    ['ci-jellyfin-plugin', 'dotnet-container-smoke', 2],
    ['ci-release-notes', 'git-release-validation', 2],
    ['docs-links', 'link-validation', 1],
    ['helm-lint-test', 'helm-chart-validation', 5],
  ]);
});

test('every recipe tool has a bounded anchored version pattern', () => {
  const recipeTools = adapterData.policy.dependencies.tools.filter(
    (tool) => tool.kind === 'recipe-tool'
  );
  assert.ok(recipeTools.length > 0);
  for (const tool of recipeTools) {
    assert.ok(tool.versionPattern.startsWith('^'), tool.id);
    assert.ok(tool.versionPattern.endsWith('$'), tool.id);
    assert.doesNotThrow(() => new RegExp(tool.versionPattern, 'u'), tool.id);
  }
});

test('every current candidate has exactly one adapter group owner', () => {
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

  assert.equal(
    candidateOwners.get('src/styles/buttonGeometry.test.mjs'),
    'node-mjs'
  );
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

test('atomic consumer scripts expose no hidden or duplicate execution', () => {
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json')));
  const packageScripts = rootManifest.scripts;
  assert.equal(
    packageScripts['security:council:workflow'],
    'node scripts/check-workflow-boundaries.mjs'
  );
  assert.equal(
    packageScripts['security:council:browser'],
    'node bin/run-bash.mjs scripts/check-council-browser-boundaries.sh'
  );
  assert.equal(
    packageScripts['security:council:server'],
    'node bin/run-bash.mjs scripts/check-council-server-boundaries.sh'
  );
  assert.equal(
    packageScripts['current-batch:contract'],
    'node bin/check-current-batch-contract.js'
  );
  assert.equal(
    packageScripts['ui-style:contract'],
    'node bin/check-refreshed-ui-style.js'
  );
  assert.equal(
    packageScripts['security:council'],
    'pnpm security:council:workflow && pnpm test:tooling && pnpm security:council:browser && pnpm security:council:server'
  );
  assert.equal(
    packageScripts['current-batch:check'],
    'pnpm current-batch:contract && pnpm ui-style:check'
  );
  assert.equal(
    packageScripts['ui-style:check'],
    'pnpm ui-style:contract && node --test src/styles/buttonGeometry.test.mjs'
  );

  const declaredScripts = new Map(
    adapterData.policy.repository.scripts.map((script) => [script.id, script])
  );
  assert.equal(declaredScripts.get('production-build').name, 'build:compile');
  const rootAdapterTargets = new Set(
    [...declaredScripts.values()]
      .filter((script) => script.workspaceId === 'root')
      .map((script) => script.name)
  );
  for (const forbidden of [
    'build',
    'current-batch:check',
    'security:council',
    'ui-style:check',
  ])
    assert.equal(rootAdapterTargets.has(forbidden), false, forbidden);

  const targetedBodies = [...rootAdapterTargets]
    .filter((name) => Object.hasOwn(packageScripts, name))
    .map((name) => packageScripts[name])
    .join('\n');
  assert.doesNotMatch(targetedBodies, /buttonGeometry\.test\.mjs/u);
  assert.doesNotMatch(
    targetedBodies,
    /\bpnpm (?:build|current-batch:check|security:council|ui-style:check)\b/u
  );
});

test('unit graph, outputs, and repository-group ownership are exact', () => {
  const units = adapterData.policy.stages.units;
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const stageOrder = new Map([
    ['repository', 0],
    ['codeql', 1],
    ['build', 2],
    ['browser', 3],
  ]);
  const expectedDependencies = new Map([
    ['ci-security-workflow-boundaries', ['ci-i18n']],
    ['ci-security-tooling', ['ci-security-workflow-boundaries']],
    ['ci-security-browser-boundaries', ['ci-security-tooling']],
    ['ci-security-server-boundaries', ['ci-security-browser-boundaries']],
    ['current-batch-contract', ['ci-i18n']],
    ['ui-style-contract', ['current-batch-contract']],
    ['ci-test-format', ['ci-test-lint']],
    ['ci-test-build', ['ci-test-format', 'ui-style-contract']],
    ['ci-test-bundle', ['ci-test-build']],
    ['test-docs-generate', ['test-docs-security']],
    ['test-docs-build', ['test-docs-generate']],
    ['cypress-run', ['ci-test-bundle']],
    ['playwright-run', ['ci-test-bundle']],
  ]);

  for (const unit of units) {
    assert.ok(Array.isArray(unit.dependsOn), unit.id + ' dependsOn');
    assert.ok(Array.isArray(unit.after), unit.id + ' after');
    assert.deepEqual(unit.dependsOn, [...unit.dependsOn].sort(), unit.id);
    assert.deepEqual(unit.after, [...unit.after].sort(), unit.id);
    assert.equal(new Set(unit.dependsOn).size, unit.dependsOn.length, unit.id);
    assert.equal(new Set(unit.after).size, unit.after.length, unit.id);
    assert.deepEqual(
      unit.dependsOn,
      expectedDependencies.get(unit.id) ?? [],
      unit.id + ' dependsOn'
    );
    assert.deepEqual(
      unit.after,
      unit.id === 'playwright-run' ? ['cypress-run'] : [],
      unit.id + ' after'
    );
    for (const predecessor of [...unit.dependsOn, ...unit.after]) {
      assert.notEqual(predecessor, unit.id);
      assert.ok(unitsById.has(predecessor), predecessor);
      assert.ok(
        stageOrder.get(unitsById.get(predecessor).stage) <=
          stageOrder.get(unit.stage),
        unit.id + ' references later stage ' + predecessor
      );
    }
    assert.deepEqual(
      unit.dependsOn.filter((id) => unit.after.includes(id)),
      [],
      unit.id + ' overlapping edges'
    );
  }

  const active = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (active.has(id)) assert.fail('dependency cycle at ' + id);
    if (visited.has(id)) return;
    active.add(id);
    const unit = unitsById.get(id);
    for (const predecessor of [...unit.dependsOn, ...unit.after])
      visit(predecessor);
    active.delete(id);
    visited.add(id);
  };
  for (const unit of units) visit(unit.id);

  const groupOwners = new Map(
    adapterData.policy.repository.groups.map((group) => [group.id, []])
  );
  for (const unit of units.filter((entry) => entry.kind === 'group')) {
    assert.ok(groupOwners.has(unit.groupId), unit.groupId);
    groupOwners.get(unit.groupId).push(unit.id);
  }
  assert.deepEqual(Object.fromEntries(groupOwners), {
    cypress: ['cypress-run'],
    'docs-security': ['test-docs-security'],
    'node-mjs': ['ci-unit-node'],
    playwright: ['playwright-run'],
    tooling: ['ci-security-tooling'],
    vitest: ['ci-unit-vitest'],
    'vroom-conformance': ['vroom-conformance'],
  });

  for (const unit of units)
    if (unit.kind === 'script')
      assert.ok(Array.isArray(unit.requiredOutputs), unit.id);
  assert.deepEqual(unitsById.get('ci-test-build').requiredOutputs, [
    { kind: 'file', path: '.next/BUILD_ID', nonEmpty: true },
    { kind: 'file', path: 'dist/index.js', nonEmpty: true },
  ]);
  for (const unit of units)
    if (unit.kind === 'script' && unit.id !== 'ci-test-build')
      assert.deepEqual(unit.requiredOutputs, [], unit.id);
});

test('CodeQL fields and the shared browser service are fully typed', () => {
  const tools = new Map(
    adapterData.policy.dependencies.tools.map((tool) => [tool.id, tool])
  );
  const units = new Map(
    adapterData.policy.stages.units.map((unit) => [unit.id, unit])
  );
  assert.deepEqual(tools.get('codeql-cli'), {
    id: 'codeql-cli',
    kind: 'recipe-tool',
    role: 'codeql',
    versionPattern: '^CodeQL command-line toolchain release 2\\.27\\.1\\.$',
  });
  const codeqlPattern = new RegExp(
    tools.get('codeql-cli').versionPattern,
    'u'
  );
  assert.match('CodeQL command-line toolchain release 2.27.1.', codeqlPattern);
  assert.doesNotMatch(
    'CodeQL command-line toolchain release 2.27.10.',
    codeqlPattern
  );
  assert.deepEqual(units.get('codeql-actions'), {
    id: 'codeql-actions',
    kind: 'codeql',
    stage: 'codeql',
    serviceId: null,
    timeoutId: 'codeql',
    dependsOn: [],
    after: [],
    toolId: 'codeql-cli',
    language: 'actions',
    querySuite: 'security-and-quality',
    queryPackId: 'codeql-actions',
    modelPackIds: [],
  });
  assert.deepEqual(units.get('codeql-javascript'), {
    id: 'codeql-javascript',
    kind: 'codeql',
    stage: 'codeql',
    serviceId: null,
    timeoutId: 'codeql',
    dependsOn: [],
    after: [],
    toolId: 'codeql-cli',
    language: 'javascript-typescript',
    querySuite: 'security-and-quality',
    queryPackId: 'codeql-javascript',
    modelPackIds: ['codeql-models'],
  });

  assert.deepEqual(adapterData.policy.stages.services, [
    {
      id: 'browser-app',
      prepareScriptId: 'browser-prepare',
      startScriptId: 'browser-start',
      readiness: [
        { path: '/api/v1/status/ready', status: 204 },
        { path: '/login', status: 200 },
      ],
      timeoutId: 'service',
    },
  ]);
  for (const unit of units.values()) {
    if (['cypress-run', 'playwright-run'].includes(unit.id))
      assert.equal(unit.serviceId, 'browser-app', unit.id);
    else assert.equal(unit.serviceId, null, unit.id);
  }
  assert.deepEqual(units.get('cypress-run').dependsOn, ['ci-test-bundle']);
  assert.deepEqual(units.get('cypress-run').after, []);
  assert.deepEqual(units.get('playwright-run').dependsOn, ['ci-test-bundle']);
  assert.deepEqual(units.get('playwright-run').after, ['cypress-run']);
});

test('consumer code maps only generic Vroom service variables', () => {
  const prepare = readFileSync(
    join(root, 'server', 'scripts', 'prepareTestDb.ts'),
    'utf8'
  );
  const start = readFileSync(
    join(root, 'bin', 'run-cypress-start.mjs'),
    'utf8'
  );
  assert.match(
    prepare,
    /process\.env\.VROOM_FIXTURE_ROOT \|\|\s+process\.env\.CONFIG_DIRECTORY/u
  );
  assert.match(
    start,
    /process\.env\.VROOM_FIXTURE_ROOT \?\?\s+process\.env\.CONFIG_DIRECTORY/u
  );
  assert.match(
    start,
    /process\.env\.VROOM_SERVICE_PORT \?\? process\.env\.PORT/u
  );
  assert.match(start, /CONFIG_DIRECTORY: fixtureRoot/u);
  assert.match(
    start,
    /\.\.\.\(servicePort \? \{ PORT: servicePort \} : \{\}\)/u
  );
  assert.doesNotMatch(adapterSource, /CONFIG_DIRECTORY|SEERR_EXTERNAL_CONFIG/u);
});

test('hosted ownership names atomic units and derives the new case cap', () => {
  const jobs = Object.fromEntries(
    adapterData.policy.hosted.workflows.flatMap((workflow) =>
      workflow.jobs.map((job) => [
        workflow.id + '/' + job.id,
        job.unitIds,
      ])
    )
  );
  assert.deepEqual(jobs['ci/i18n'], [
    'ci-i18n',
    'ci-security-workflow-boundaries',
    'ci-security-tooling',
    'ci-security-browser-boundaries',
    'ci-security-server-boundaries',
  ]);
  assert.deepEqual(jobs['ci/test'], [
    'ci-test-lint',
    'ci-test-format',
    'current-batch-contract',
    'ui-style-contract',
    'ci-test-build',
    'ci-test-bundle',
  ]);
  assert.deepEqual(jobs['test-docs/test-build'], [
    'test-docs-security',
    'test-docs-generate',
    'test-docs-build',
  ]);

  const hostedUnitIds = Object.values(jobs).flat();
  for (const forbidden of ['ci-security-council', 'current-batch'])
    assert.equal(hostedUnitIds.includes(forbidden), false, forbidden);
  const knownUnits = new Set(
    adapterData.policy.stages.units.map((unit) => unit.id)
  );
  for (const unitId of hostedUnitIds) assert.ok(knownUnits.has(unitId), unitId);
  for (const filter of adapterData.policy.hosted.filters)
    for (const unitId of filter.unitIds)
      assert.ok(knownUnits.has(unitId), filter.id + ': ' + unitId);

  const shards = new Map(
    adapterData.policy.timing.shards.map((entry) => [
      entry.unitId,
      entry.count,
    ])
  );
  const hostedCases = hostedUnitIds.reduce(
    (total, unitId) => total + (shards.get(unitId) ?? 1),
    0
  );
  assert.equal(hostedCases, adapterData.policy.timing.maximumConcurrentCases);
  assert.equal(hostedCases, 35);
});
