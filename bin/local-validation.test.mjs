import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  chunkArguments,
  createPlan,
  discoverTests,
  executePlan,
  expectedPackageBindings,
  frameworkOf,
  isolatedEnvironment,
  loadTypeScript,
  preflight,
  removeOwnedTemporaryDirectory,
  runCommand,
  startCommand,
  testCount,
  toolingOwnership,
  validateDependencyReference,
  validateGovernanceSources,
  validatePackageBindings,
  vitestConfigSource,
} from './local-validation.mjs';
import { parseToolingWorkers } from './run-tooling-tests.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import {
  createDistributedControllerFailureReport,
  createDistributedTaskFailureEvidence,
  verifyDistributedControllerFailure,
  verifyDistributedScheduleFailureReport,
  verifyDistributedTaskFailureEvidence,
} from '../tools/validation-engine/runtime/distributed-runtime.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native engine tests do not resolve application aliases.
import {
  createDistributedTaskManifest,
  DISTRIBUTED_TASK_MANIFEST_SCHEMA,
  readDistributedTaskManifest,
} from '../tools/validation-engine/runtime/distributed-task-manifest.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ts = loadTypeScript(root);
const sink = { write() {} };
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-validation-fixture-'));
  const write = (path, contents = '// fixture') => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), contents);
  };
  for (const scope of [
    'server',
    'src',
    'bin',
    'scripts',
    'deploy',
    'packaging',
  ])
    mkdirSync(join(directory, scope));
  write('package.json', '{}');
  write(
    'vitest.config.mts',
    'export default {plugins: [], test: {setupFiles: ["setup.ts"]}};'
  );
  write('node_modules/vitest/vitest.mjs');
  write('server/test/index.mts');
  write(
    'server/native.test.ts',
    'import test from "node:test"; test("native", () => {});'
  );
  write(
    'src/native.test.tsx',
    'import test from "node:test"; test("tsx", () => {});'
  );
  write(
    'src/component.test.ts',
    'import {test} from "vitest"; test("vitest", () => {});'
  );
  write(
    'src/style.test.mjs',
    'import test from "node:test"; test("style", () => {});'
  );
  write(
    'scripts/portable.test.mjs',
    'import test from "node:test"; test("tool", () => {});'
  );
  write(
    'deploy/posix.test.mjs',
    'import test from "node:test"; test("posix", () => {});'
  );
  write(
    'bin/run-tooling-tests.mjs',
    'const portableTests = ["scripts/portable.test.mjs"]; const posixOnlyTests = ["deploy/posix.test.mjs"]; const tests = process.platform === "win32" ? portableTests : [...portableTests, ...posixOnlyTests]; spawnSync(process.execPath, ["--test", ...tests], {});'
  );
  return {
    directory,
    write,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
};

function fakeDistributedTypeScript() {
  const identifier = (text) => ({ type: 'identifier', text, children: [] });
  const string = (text) => ({ type: 'string', text, children: [] });
  const text = (value) => ({
    type: 'text',
    children: [],
    getText: () => value,
  });
  const variable = (name, initializer) => ({
    type: 'variable',
    name: identifier(name),
    initializer,
    children: [],
  });
  const array = (entries) => ({
    type: 'array',
    elements: entries.map(string),
    children: [],
  });
  return {
    ScriptTarget: { Latest: 99 },
    SyntaxKind: { ImportKeyword: 1 },
    createSourceFile(file, source) {
      if (file === 'run-tooling-tests.mjs') {
        return {
          type: 'root',
          children: [
            variable('portableTests', array(['scripts/portable.test.mjs'])),
            variable('posixOnlyTests', array(['deploy/posix.test.mjs'])),
            variable(
              'tests',
              text(
                "process.platform === 'win32' ? portableTests : [...portableTests, ...posixOnlyTests]"
              )
            ),
            {
              type: 'call',
              expression: identifier('spawnSync'),
              arguments: [
                text('process.execPath'),
                text("['--test', `--test-concurrency=${workers}`, ...tests]"),
              ],
              children: [],
            },
          ],
        };
      }
      const imports = [
        ...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g),
      ].map((match) => ({
        type: 'import',
        moduleSpecifier: string(match[1]),
        children: [],
      }));
      return { type: 'root', children: imports };
    },
    forEachChild(node, visitor) {
      for (const child of node.children || []) visitor(child);
    },
    isArrayLiteralExpression: (node) => node?.type === 'array',
    isCallExpression: (node) => node?.type === 'call',
    isExportDeclaration: () => false,
    isIdentifier: (node) => node?.type === 'identifier',
    isImportDeclaration: (node) => node?.type === 'import',
    isStringLiteral: (node) => node?.type === 'string',
    isVariableDeclaration: (node) => node?.type === 'variable',
  };
}

function distributedDiscoveryFixture() {
  const result = fixture();
  result.write('.gitignore', 'node_modules/\n');
  result.write(
    'package.json',
    JSON.stringify({
      name: 'distributed-discovery-fixture',
      private: true,
      type: 'module',
      engines: { node: '>=18', pnpm: '>=9' },
      devDependencies: {
        '@swc/core': '*',
        semver: '*',
        'ts-node': '*',
        'tsconfig-paths': '*',
        typescript: '*',
        vitest: '*',
      },
    })
  );
  result.write('pnpm-lock.yaml', 'lockfileVersion: 9\n');
  for (const name of [
    'semver',
    'typescript',
    'vitest',
    'ts-node',
    'tsconfig-paths',
    '@swc/core',
  ])
    result.write(
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, version: '1.0.0', main: 'index.js' })
    );
  result.write('node_modules/semver/index.js', 'exports.satisfies=()=>true;\n');
  result.write(
    'node_modules/typescript/index.js',
    `module.exports=(${fakeDistributedTypeScript.toString()})();\n`
  );
  result.write(
    'bin/run-tooling-tests.mjs',
    "import {spawnSync} from 'node:child_process';\nconst workers=1;\nconst portableTests=['scripts/portable.test.mjs'];\nconst posixOnlyTests=['deploy/posix.test.mjs'];\nconst tests=process.platform==='win32'?portableTests:[...portableTests,...posixOnlyTests];\nconst result=spawnSync(process.execPath,['--test',`--test-concurrency=${workers}`,...tests],{stdio:'inherit'});\nprocess.exitCode=result.status??1;\n"
  );
  for (const args of [
    ['init', '--quiet'],
    ['config', 'user.name', 'Distributed Fixture'],
    ['config', 'user.email', 'fixture@example.invalid'],
    ['add', '--all'],
    ['commit', '--quiet', '-m', 'fixture'],
  ]) {
    const git = spawnSync('git', args, {
      cwd: result.directory,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(git.status, 0, git.stderr || git.error?.message);
  }
  return result;
}

test('AST classification ignores comments and text, accepts actual imports and rejects ambiguous suites', () => {
  assert.equal(
    frameworkOf(
      '/* import {test} from "vitest" */ import test from "node:test";',
      'x.test.ts',
      ts
    ),
    'node-ts'
  );
  assert.equal(
    frameworkOf('const {test} = require("node:test");', 'x.test.cjs', ts),
    'node-js'
  );
  assert.equal(frameworkOf('import("vitest");', 'x.test.ts', ts), 'vitest');
  assert.throws(
    () => frameworkOf('import "vitest"; import "node:test";', 'x.test.ts', ts),
    /Mixed/
  );
  assert.throws(
    () => frameworkOf('const label = "node:test";', 'x.test.ts', ts),
    /Unclassified/
  );
});

test('discovery accounts for every file once, includes TSX and new Node tests, and preserves platform ownership', () => {
  const f = fixture();
  try {
    f.write(
      'bin/new.test.mjs',
      'import test from "node:test"; test("new", () => {});'
    );
    const linux = discoverTests(f.directory, { platform: 'linux', ts });
    const windows = discoverTests(f.directory, { platform: 'win32', ts });
    assert.equal(linux.length, 7);
    assert.equal(new Set(linux.map(({ file }) => file)).size, 7);
    assert.equal(linux.filter(({ owner }) => owner === 'tooling').length, 2);
    assert.equal(linux.filter(({ owner }) => owner === 'node-ts').length, 2);
    assert.equal(windows.filter(({ selected }) => !selected).length, 1);
    assert.match(
      windows.find(({ file }) => file === 'deploy/posix.test.mjs').exclusion,
      /POSIX/
    );
    assert.equal(
      windows.find(({ file }) => file === 'bin/new.test.mjs').owner,
      'node-js'
    );
    f.write('server/unknown.test.ts', 'export const value = 1;');
    assert.throws(() => discoverTests(f.directory, { ts }), /Unclassified/);
  } finally {
    f.cleanup();
  }
});

test('tooling declarations fail closed for missing, duplicate, or dynamic ownership', () => {
  assert.throws(
    () => toolingOwnership('const portableTests = [];', ts),
    /Missing/
  );
  assert.throws(
    () =>
      toolingOwnership(
        'const portableTests = ["a"]; const posixOnlyTests = ["a"];',
        ts
      ),
    /Duplicate/
  );
  assert.throws(
    () =>
      toolingOwnership(
        'const portableTests = find(); const posixOnlyTests = ["a"];',
        ts
      ),
    /Unsupported/
  );
  const f = fixture();
  try {
    rmSync(join(f.directory, 'scripts/portable.test.mjs'));
    assert.throws(
      () => discoverTests(f.directory, { ts }),
      /Missing or incompatible tooling test/
    );
  } finally {
    f.cleanup();
  }
});

test('tooling worker options accept only one bounded concurrency argument', () => {
  assert.equal(parseToolingWorkers([]), undefined);
  for (const workers of [1, 2, 24, 256])
    assert.equal(parseToolingWorkers([`--workers=${workers}`]), workers);
  for (const args of [
    ['--workers=0'],
    ['--workers=257'],
    ['--workers=-1'],
    ['--workers=1.5'],
    ['--workers=01'],
    ['--workers=1e2'],
    ['--workers=1 '],
    ['--workers', '1'],
    ['--workers=1', '--workers=2'],
    ['--unknown'],
    ['--test-name-pattern=green'],
    ['--test-shard=1/2'],
    ['--test-concurrency=1'],
    [1],
    null,
  ])
    assert.throws(() => parseToolingWorkers(args), /Tooling/);
});

test('tooling concurrency recognition preserves exact platform inventory and rejects filters or duplicate launches', () => {
  const declarations =
    'const portableTests = ["a"]; const posixOnlyTests = ["b"]; const tests = process.platform === "win32" ? portableTests : [...portableTests, ...posixOnlyTests];';
  const legacy = 'spawnSync(process.execPath, ["--test", ...tests], {});';
  const bounded =
    'spawnSync(process.execPath, ["--test", `--test-concurrency=${workers}`, ...tests], {});';
  assert.deepEqual(
    toolingOwnership(declarations + bounded, ts),
    toolingOwnership(declarations + legacy, ts)
  );
  assert.deepEqual(
    toolingOwnership(
      readFileSync(join(root, 'bin/run-tooling-tests.mjs'), 'utf8'),
      ts
    ).get('posixOnlyTests').length,
    9
  );
  for (const changed of [
    bounded.replace('...tests', '...tests.filter(Boolean)'),
    bounded.replace('...tests', '...tests.slice(1)'),
    bounded.replace('...tests', '"--test-name-pattern=green", ...tests'),
    bounded.replace('...tests', '"--test-shard=1/2", ...tests'),
    bounded.replace('process.execPath', '"node"'),
    bounded + legacy,
  ])
    assert.throws(
      () => toolingOwnership(declarations + changed, ts),
      /Unsupported tooling execution selection/
    );
  assert.throws(
    () =>
      toolingOwnership(
        declarations.replace(
          '[...portableTests, ...posixOnlyTests]',
          'portableTests'
        ) + bounded,
        ts
      ),
    /Unsupported tooling execution selection/
  );
});

test('execution forwards the sealed worker budget only to tooling without changing test selection or caller descriptors', async () => {
  for (const workers of [undefined, 1, 24, 256]) {
    const steps = [
      {
        name: 'tooling fixture',
        command: process.execPath,
        args: ['bin/run-tooling-tests.mjs'],
        kind: 'tooling',
      },
      {
        name: 'native fixture',
        command: process.execPath,
        args: ['--test', '--test-concurrency=1', 'src/native.test.mjs'],
        kind: 'node-js',
      },
      {
        name: 'check fixture',
        command: process.execPath,
        args: ['bin/check-i18n.js'],
        kind: 'check',
      },
    ];
    const before = structuredClone(steps),
      observed = [];
    const totals = await executePlan(
      { root, steps },
      {
        workers,
        stdout: sink,
        stderr: sink,
        inherited: { ...process.env, NODE_OPTIONS: '--test-concurrency=999' },
        executor: async (step, { env }) => {
          assert.equal(env.NODE_OPTIONS, undefined);
          observed.push(step);
          return '# tests 1\n# pass 1\n# fail 0\n';
        },
      }
    );
    assert.deepEqual(
      observed[0].args,
      workers === undefined
        ? before[0].args
        : [...before[0].args, `--workers=${workers}`]
    );
    assert.deepEqual(observed[1].args, before[1].args);
    assert.deepEqual(observed[2].args, before[2].args);
    assert.deepEqual(steps, before);
    assert.equal(totals.get('tooling').active, 1);
    assert.equal(totals.get('node-js').active, 1);
  }
});

test('plan is read-only, partitions framework runs and preserves the original Vitest configuration', () => {
  const f = fixture();
  try {
    const before = readFileSync(join(f.directory, 'vitest.config.mts'), 'utf8');
    const plan = createPlan(f.directory, {
      testsOnly: true,
      ts,
      platform: 'linux',
    });
    assert.equal(plan.steps.length, 4);
    assert.deepEqual(plan.steps.find(({ kind }) => kind === 'node-ts').files, [
      'server/native.test.ts',
      'src/native.test.tsx',
    ]);
    assert.deepEqual(plan.steps.find(({ kind }) => kind === 'vitest').files, [
      'src/component.test.ts',
    ]);
    assert.equal(
      plan.steps.find(({ kind }) => kind === 'tooling').args[0],
      join(f.directory, 'bin/run-tooling-tests.mjs')
    );
    const generated = vitestConfigSource(
      join(f.directory, 'vitest.config.mts'),
      f.directory,
      ['src/component.test.ts']
    );
    assert.match(generated, /\.\.\.base/);
    assert.match(generated, /\.\.\.base\.test/);
    assert.match(generated, /passWithNoTests: false/);
    assert.match(generated, /Vitest projects need explicit ownership/);
    assert.equal(
      readFileSync(join(f.directory, 'vitest.config.mts'), 'utf8'),
      before
    );
    assert.equal(existsSync(join(f.directory, 'config')), false);
    rmSync(join(f.directory, 'src/component.test.ts'));
    assert.throws(
      () => createPlan(f.directory, { testsOnly: true, ts }),
      /zero-test execution lane: vitest/
    );
  } finally {
    f.cleanup();
  }
});

test('canonical engine binding uses the existing CI adapter once without changing ordinary native commands', () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        createPlan(f.directory, {
          testsOnly: true,
          ts,
          canonicalTypescript: true,
        }),
      /required file/
    );
    f.write('server/test/vitestNodeTest.ts', 'export const test = () => {};');
    f.write(
      'vitest.config.mts',
      "export default {resolve: {alias: {'node:test': resolve(projectRoot, 'server/test/vitestNodeTest.ts')}}, test: {}};"
    );
    const plan = createPlan(f.directory, {
      testsOnly: true,
      ts,
      canonicalTypescript: true,
    });
    assert.equal(plan.steps.filter(({ kind }) => kind === 'node-ts').length, 0);
    assert.deepEqual(plan.steps.find(({ kind }) => kind === 'vitest').files, [
      'server/native.test.ts',
      'src/component.test.ts',
      'src/native.test.tsx',
    ]);
    assert.equal(
      new Set(plan.steps.flatMap(({ files = [] }) => files)).size,
      plan.inventory.filter(({ selected }) => selected).length
    );
    assert.equal(
      plan.steps
        .flatMap(({ files = [] }) => files)
        .includes('deploy/posix.test.mjs'),
      process.platform !== 'win32'
    );
    assert.equal(
      plan.inventory.filter(({ originalOwner }) => originalOwner === 'node-ts')
        .length,
      2
    );
    assert.equal(
      createPlan(f.directory, { testsOnly: true, ts }).steps.filter(
        ({ kind }) => kind === 'node-ts'
      ).length,
      1
    );
    f.write('vitest.config.mts', 'export default {};');
    assert.throws(
      () =>
        createPlan(f.directory, {
          testsOnly: true,
          ts,
          canonicalTypescript: true,
        }),
      /native node:test adapter/
    );
  } finally {
    f.cleanup();
  }
});

test('external dependency references require actual read-only mount and exact source/installed locks', () => {
  const f = fixture();
  const dependencies = mkdtempSync(
    join(tmpdir(), 'seerrng-dependency-reference-')
  );
  try {
    const lock = 'lockfileVersion: 9\n';
    f.write('pnpm-lock.yaml', lock);
    mkdirSync(join(dependencies, '.pnpm'));
    writeFileSync(join(dependencies, '.pnpm/lock.yaml'), lock);
    rmSync(join(f.directory, 'node_modules'), { recursive: true });
    symlinkSync(
      dependencies,
      join(f.directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const reference = {
      root: dependencies,
      readonlyProof: { verified: true },
      lockSha256: createHash('sha256').update(lock).digest('hex'),
    };
    const options = {
      platform: 'linux',
      mountInfo: `1 0 0:1 / ${dependencies} ro - tmpfs tmpfs ro\n`,
    };
    assert.equal(
      validateDependencyReference(f.directory, reference, options),
      dependencies
    );
    assert.throws(
      () =>
        validateDependencyReference(f.directory, reference, {
          ...options,
          mountInfo: options.mountInfo.replaceAll(' ro', ' rw'),
        }),
      /actually mounted read-only/
    );
    assert.throws(
      () =>
        validateDependencyReference(
          f.directory,
          { ...reference, readonlyProof: { verified: false } },
          options
        ),
      /actual read-only/
    );
    assert.throws(
      () =>
        validateDependencyReference(f.directory, reference, {
          ...options,
          platform: 'win32',
        }),
      /actual read-only/
    );
    writeFileSync(join(dependencies, '.pnpm/lock.yaml'), 'different-lock');
    assert.throws(
      () => validateDependencyReference(f.directory, reference, options),
      /lockfile mismatch/
    );
  } finally {
    f.cleanup();
    rmSync(dependencies, { recursive: true });
  }
});

test('full validation retains original validators and type/format/lint checks without nested duplicate test commands', () => {
  const f = fixture();
  try {
    for (const path of [
      'bin/check-i18n.js',
      'bin/check-current-batch-contract.js',
      'bin/check-refreshed-ui-style.js',
      'bin/run-prettier.mjs',
      'node_modules/eslint/bin/eslint.js',
      'node_modules/typescript/bin/tsc',
      'node_modules/next/dist/bin/next',
      'server/tsconfig.json',
      'tsconfig.json',
    ])
      f.write(path);
    const plan = createPlan(f.directory, { ts });
    assert.deepEqual(
      plan.steps.filter(({ kind }) => kind === 'check').map(({ name }) => name),
      [
        'Translations',
        'Current batch contract',
        'Shared visual standard',
        'Formatting',
        'Lint',
        'Server types',
        'Client route types',
        'Client types',
      ]
    );
    assert.equal(plan.steps.filter(({ kind }) => kind !== 'check').length, 4);
    rmSync(join(f.directory, 'bin/check-current-batch-contract.js'));
    assert.throws(() => createPlan(f.directory, { ts }), /required file/);
  } finally {
    f.cleanup();
  }
});

test('the comprehensive gate is an explicit package command while ordinary scripts keep their upstream bindings', () => {
  const valid = {
    scripts: { ...expectedPackageBindings },
  };
  assert.doesNotThrow(() => validatePackageBindings(valid));
  for (const [name, changed] of [
    ['test', 'node bin/run-local-validation.mjs --tests-only'],
    ['validate:development', 'pnpm test'],
    ['build', 'pnpm validate:development && pnpm build:all'],
    ['build:all', 'pnpm build'],
    ['dev', 'pnpm validate:development && pnpm dev:server'],
    ['test:ci', 'node bin/run-local-validation.mjs'],
    ['build:server:compile', 'pnpm build'],
  ]) {
    assert.throws(
      () =>
        validatePackageBindings({
          scripts: { ...valid.scripts, [name]: changed },
        }),
      /binding drift|recursive/
    );
  }
  assert.throws(
    () =>
      validatePackageBindings({
        scripts: { ...valid.scripts, prebuild: 'pnpm validate:development' },
      }),
    /binding drift/
  );
  assert.throws(
    () =>
      validatePackageBindings({
        scripts: { ...valid.scripts, 'dev:server': '' },
      }),
    /binding drift/
  );
});

test('agent routes require the current engine while the normal hook stays bounded', () => {
  const agents =
    'Read docs/maintainers/ui-style-standard.md docs/maintainers/ui-fix-it.md docs/maintainers/ui-forward-merge-guide.md and follow tools/validation-engine/README.md';
  const hook =
    '[ -n "$HUSKY_BYPASS" ] || pnpm attribution:check || exit $?\npnpm exec lint-staged || exit $?\n';
  assert.doesNotThrow(() => validateGovernanceSources(agents, hook));
  for (const missing of [
    'docs/maintainers/ui-style-standard.md',
    'docs/maintainers/ui-fix-it.md',
    'docs/maintainers/ui-forward-merge-guide.md',
    'tools/validation-engine/README.md',
  ])
    assert.throws(
      () => validateGovernanceSources(agents.replace(missing, ''), hook),
      /missing the required/
    );
  for (const changed of [
    `${hook}pnpm validate:development\n`,
    hook.replace(
      'pnpm attribution:check || exit $?',
      'pnpm attribution:check || true'
    ),
    `exit 0\n${hook}`,
    hook.replace('pnpm exec lint-staged || exit $?\n', ''),
  ])
    assert.throws(
      () => validateGovernanceSources(agents, changed),
      /must preserve/
    );
});

test('runtime preflight rejects unsupported engines, dependency drift, and incomplete validation governance without installing anything', () => {
  const f = fixture();
  try {
    rmSync(join(f.directory, 'node_modules'), { recursive: true, force: true });
    symlinkSync(
      join(root, 'node_modules'),
      join(f.directory, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const packageJson = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8')
    );
    packageJson.scripts = { ...expectedPackageBindings };
    f.write('package.json', JSON.stringify(packageJson));
    const options = {
      testsOnly: true,
      nodeVersion: process.version,
      inherited: {
        npm_config_user_agent: `pnpm/10.24.0 npm/? node/${process.version}`,
      },
    };
    assert.doesNotThrow(() => preflight(f.directory, options));
    assert.throws(
      () => preflight(f.directory, { ...options, nodeVersion: 'v18.0.0' }),
      /does not satisfy package engines/
    );
    assert.throws(
      () =>
        preflight(f.directory, {
          ...options,
          inherited: { npm_config_user_agent: 'pnpm/9.0.0' },
        }),
      /Use pnpm satisfying/
    );
    assert.throws(
      () =>
        preflight(f.directory, {
          ...options,
          inherited: { npm_config_user_agent: 'npm/10.0.0' },
        }),
      /Use pnpm satisfying/
    );
    assert.throws(
      () => preflight(f.directory, { ...options, testsOnly: false }),
      /required file: AGENTS.md/
    );
    f.write(
      'AGENTS.md',
      'docs/maintainers/ui-style-standard.md docs/maintainers/ui-fix-it.md docs/maintainers/ui-forward-merge-guide.md tools/validation-engine/README.md'
    );
    f.write(
      '.husky/pre-commit',
      '[ -n "$HUSKY_BYPASS" ] || pnpm attribution:check || exit $?\npnpm exec lint-staged || exit $?\n'
    );
    for (const path of [
      'docs/maintainers/ui-style-standard.md',
      'docs/maintainers/ui-fix-it.md',
      'docs/maintainers/ui-forward-merge-guide.md',
      'tools/validation-engine/README.md',
    ])
      f.write(path, '# Required source document');
    assert.doesNotThrow(() =>
      preflight(f.directory, { ...options, testsOnly: false })
    );
    packageJson.devDependencies.typescript = '^999.0.0';
    f.write('package.json', JSON.stringify(packageJson));
    assert.throws(
      () => preflight(f.directory, options),
      /Installed typescript/
    );
  } finally {
    f.cleanup();
  }
});

test('argument chunks retain every filename without shell composition or exceeding the Windows budget', () => {
  const files = Array.from(
    { length: 400 },
    (_, index) => `src/folder with spaces/item-${index}.test.ts`
  );
  const chunks = chunkArguments(files, 500);
  assert.deepEqual(chunks.flat(), files);
  assert.ok(
    chunks.every(
      (chunk) => chunk.reduce((sum, file) => sum + file.length + 3, 0) <= 500
    )
  );
  assert.throws(() => chunkArguments(['x'.repeat(600)], 500), /budget/);
});

test('isolation removes inherited live configuration and escape flags without mutating the parent', () => {
  const inherited = {
    NODE_ENV: 'production',
    CONFIG_DIRECTORY: '/live',
    DB_HOST: 'live',
    DB_PASS: 'secret',
    DB_SSL_CA_FILE: '/secret',
    DATABASE_URL: 'postgres://live',
    NODE_OPTIONS: '--require injected',
    TS_NODE_PROJECT: '/wrong',
    VITEST: 'true',
    CI: 'true',
    ALLOW_NETWORK: 'true',
    SEERR_TEST_FAIL_ON_NETWORK: 'false',
    PATH: '/tools',
  };
  const isolated = isolatedEnvironment('/owned', inherited);
  assert.equal(isolated.NODE_ENV, 'test');
  assert.equal(isolated.CONFIG_DIRECTORY, '/owned');
  assert.equal(isolated.ALLOW_NETWORK, 'false');
  assert.equal(isolated.SEERR_TEST_FAIL_ON_NETWORK, 'true');
  assert.equal(isolated.DB_HOST, undefined);
  assert.equal(isolated.NODE_OPTIONS, undefined);
  assert.equal(isolated.CI, undefined);
  assert.equal(isolated.PATH, '/tools');
  assert.equal(inherited.CONFIG_DIRECTORY, '/live');
});

test('execution enforces positive active summaries and removes only its owned temporary directory on success or failure', async () => {
  for (const mode of ['success', 'zero', 'missing', 'failure']) {
    let directory;
    const plan = {
      root,
      steps: [
        {
          name: 'fixture',
          command: process.execPath,
          args: [],
          kind: 'node-js',
        },
      ],
    };
    const executor = async (_, { env }) => {
      directory = env.CONFIG_DIRECTORY;
      assert.ok(existsSync(directory));
      assert.equal(env.NODE_ENV, 'test');
      if (mode === 'failure')
        throw Object.assign(new Error('fixture failure'), { exitCode: 7 });
      if (mode === 'missing') return 'No summary';
      return mode === 'zero'
        ? '# tests 2\n# pass 0\n# fail 0\n'
        : '# tests 2\n# pass 2\n# fail 0\n';
    };
    if (mode === 'success')
      assert.equal(
        (await executePlan(plan, { executor, stdout: sink, stderr: sink })).get(
          'node-js'
        ).active,
        2
      );
    else
      await assert.rejects(
        executePlan(plan, { executor, stdout: sink, stderr: sink }),
        /zero active|Missing native|fixture failure/
      );
    assert.equal(existsSync(directory), false);
  }
  const unsafe = mkdtempSync(join(tmpdir(), 'other-owner-'));
  try {
    assert.throws(
      () => removeOwnedTemporaryDirectory(unsafe),
      /unsafe temporary cleanup/
    );
    assert.ok(existsSync(unsafe));
    assert.throws(
      () => removeOwnedTemporaryDirectory(tmpdir()),
      /unsafe temporary cleanup/
    );
  } finally {
    rmSync(unsafe, { recursive: true, force: true });
  }
});

test('native subprocess failures propagate their actual exit status and zero-summary output cannot pass', async () => {
  await assert.rejects(
    runCommand(
      {
        name: 'failure',
        command: process.execPath,
        args: ['-e', 'process.exit(7)'],
      },
      { root, env: isolatedEnvironment(tmpdir()), stdout: sink, stderr: sink }
    ),
    (error) => error.exitCode === 7
  );
  assert.deepEqual(testCount('ℹ tests 3\nℹ pass 3\nℹ fail 0\n'), {
    total: 3,
    active: 3,
  });
  assert.throws(() => testCount('Done!'), /Missing native/);
});

test('CLI help succeeds without discovery and malformed options fail before running checks', async () => {
  const command = {
    name: 'help',
    command: process.execPath,
    args: [join(root, 'bin/run-local-validation.mjs'), '--help'],
  };
  const options = {
    root,
    env: { ...process.env, NODE_OPTIONS: '' },
    stdout: sink,
    stderr: sink,
  };
  assert.match(await runCommand(command, options), /Usage:.*--tests-only/);
  for (const args of [['--unknown'], ['--json']])
    await assert.rejects(
      runCommand({ ...command, args: [command.args[0], ...args] }, options),
      (error) => error.exitCode === 1
    );
});

test('CLI modes reject mixed, foreign, repeated, and incomplete options before project access', () => {
  const cli = join(root, 'bin/run-local-validation.mjs');
  const invalid = [
    {
      args: ['--help', '--plan'],
      message: /Help mode cannot be combined with other options/,
    },
    {
      args: ['-h', '--help'],
      message: /Duplicate option: --help/,
    },
    {
      args: ['--plan', '--plan'],
      message: /Duplicate option: --plan/,
    },
    {
      args: ['--json'],
      message: /Local full mode does not accept --json/,
    },
    {
      args: ['--tests-only', '--json'],
      message: /Local tests-only mode does not accept --json/,
    },
    {
      args: ['--tests-only', '--plan-file', 'missing-plan.json'],
      message: /Local tests-only mode does not accept --plan-file/,
    },
    {
      args: ['--plan', '--unit', 'ci'],
      message: /Local plan mode does not accept --unit/,
    },
    {
      args: ['--github-plan', '--github-admit'],
      message: /Choose exactly one hosted GitHub mode/,
    },
    {
      args: ['--github-plan'],
      message: /GitHub plan mode requires --plan-file/,
    },
    {
      args: [
        '--github-plan',
        '--plan-file',
        'missing-plan.json',
        '--unit',
        'ci',
      ],
      message: /GitHub plan mode does not accept --unit/,
    },
    {
      args: [
        '--github-plan',
        '--plan-file',
        'one.json',
        '--plan-file',
        'two.json',
      ],
      message: /Duplicate option: --plan-file/,
    },
    {
      args: ['--github-admit', '--plan-file', 'missing-plan.json'],
      message: /GitHub admission mode requires --unit/,
    },
    {
      args: ['--github-admit', '--unit', '-h'],
      message: /Missing value for --unit/,
    },
    {
      args: [
        '--github-admit',
        '--unit',
        'ci',
        '--plan-file',
        'missing-plan.json',
        '--expected-plan-sha256',
        'sha',
        '--receipt-dir',
        'receipts',
        '--evidence',
        'evidence.json',
      ],
      message: /GitHub admission mode does not accept --evidence/,
    },
    {
      args: ['--github-run-test-lane', '--plan-file', 'missing-plan.json'],
      message: /GitHub test-lane mode requires --unit/,
    },
    {
      args: [
        '--github-materialize-test-lane',
        '--plan-file',
        'missing-plan.json',
      ],
      message: /GitHub test-lane materialization mode requires --unit/,
    },
    {
      args: [
        '--github-materialize-test-lane',
        '--unit',
        'ci-unit-test',
        '--plan-file',
        'missing-plan.json',
      ],
      message: /GitHub test-lane materialization mode requires --case/,
    },
    {
      args: [
        '--github-materialize-test-lane',
        '--unit',
        'ci-unit-test',
        '--case',
        'shard-01-of-04',
        '--lane',
        'vitest',
        '--plan-file',
        'missing-plan.json',
        '--expected-plan-sha256',
        'sha',
        '--receipt-dir',
        'receipts',
        '--output-file',
        'vitest.config.mts',
        '--report-file',
        'report.json',
      ],
      message:
        /GitHub test-lane materialization mode does not accept --report-file/,
    },
    {
      args: [
        '--github-materialize-test-lane',
        '--unit',
        'ci-unit-test',
        '--case',
        'shard-01-of-04',
        '--lane',
        'vitest',
        '--plan-file',
        'missing-plan.json',
        '--expected-plan-sha256',
        'sha',
        '--receipt-dir',
        'receipts',
        '--output-file',
        'first.config.mts',
        '--output-file',
        'second.config.mts',
      ],
      message: /Duplicate option: --output-file/,
    },
    {
      args: ['--github-receipt', '--plan-file', 'missing-plan.json'],
      message: /GitHub receipt mode requires --unit/,
    },
    {
      args: [
        '--github-receipt',
        '--unit',
        'ci',
        '--plan-file',
        'missing-plan.json',
        '--expected-plan-sha256',
        'sha',
        '--receipt-dir',
        'receipts',
        '--job-status',
        'success',
        '--evidence',
        'evidence.json',
        '--evidence',
        'evidence.json',
      ],
      message: /Duplicate value for --evidence: evidence\.json/,
    },
    {
      args: ['--github-reconcile', '--plan-file', 'missing-plan.json'],
      message: /GitHub reconciliation mode requires --receipt-dir/,
    },
    {
      args: [
        '--github-reconcile',
        '--plan-file',
        'missing-plan.json',
        '--receipt-dir',
        'receipts',
        '--case',
        'actions',
      ],
      message: /GitHub reconciliation mode does not accept --case/,
    },
    {
      args: ['--distributed-controller', '--distributed-worker'],
      message: /Choose exactly one distributed mode/,
    },
    {
      args: ['--distributed-controller', '--distributed-schedule'],
      message: /Choose exactly one distributed mode/,
    },
    {
      args: ['--github-plan', '--distributed-controller'],
      message: /Hosted GitHub and distributed modes cannot be combined/,
    },
    {
      args: ['--distributed-controller'],
      message: /Distributed controller mode requires --distributed-config/,
    },
    {
      args: ['--distributed-schedule'],
      message: /Distributed schedule mode requires --distributed-config/,
    },
    {
      args: ['--distributed-discover'],
      message: /Distributed discovery mode requires --application/,
    },
    {
      args: ['--distributed-discover', '--application', 'seerrng'],
      message: /Distributed discovery mode requires --app/,
    },
    ...[
      ['--distributed-config', 'workers.json'],
      ['--task', 'e'.repeat(64)],
      [
        '--allow-task-file',
        resolve(tmpdir(), 'distributed-allowed-tasks.json'),
      ],
      ['--tls-cert', 'worker.pem'],
      ['--report-file', resolve(tmpdir(), 'distributed-discovery.json')],
    ].map(([option, optionValue]) => ({
      args: [
        '--distributed-discover',
        '--app',
        `seerrng=${root}`,
        '--application',
        'seerrng',
        option,
        optionValue,
      ],
      message: new RegExp(
        `Distributed discovery mode does not accept ${option}`
      ),
    })),
    {
      args: [
        '--distributed-discover',
        '--app',
        `seerrng=${root}`,
        '--app',
        `other=${root}`,
        '--application',
        'seerrng',
      ],
      message: /exactly one --app/,
    },
    {
      args: [
        '--distributed-discover',
        '--app',
        `seerrng=${root}`,
        '--application',
        'other',
      ],
      message: /does not register application: other/,
    },
    {
      args: ['--distributed-worker'],
      message: /Distributed worker mode requires --distributed-config/,
    },
    {
      args: [
        '--distributed-controller',
        '--distributed-config',
        'workers.json',
        '--worker-id',
        'worker-one',
        '--application',
        'seerrng',
        '--task',
        'test-one',
        '--report-file',
        'report.json',
        '--app',
        `${root}=seerrng`,
        '--tls-cert',
        'worker.pem',
      ],
      message: /Distributed controller mode does not accept --tls-cert/,
    },
    {
      args: [
        '--distributed-controller',
        '--distributed-config',
        'workers.json',
        '--worker-id',
        'worker-one',
        '--application',
        'seerrng',
        '--task-file',
        resolve(tmpdir(), 'distributed-tasks.json'),
        '--report-file',
        resolve(tmpdir(), 'distributed-controller.json'),
        '--app',
        `seerrng=${root}`,
      ],
      message: /Distributed controller mode does not accept --task-file/,
    },
    {
      args: [
        '--distributed-worker',
        '--distributed-config',
        'workers.json',
        '--worker-id',
        'worker-one',
        '--app',
        `seerrng=${root}`,
        '--tls-cert',
        'worker.pem',
        '--tls-key',
        'worker.key',
        '--listen-host',
        '127.0.0.1',
      ],
      message: /Distributed worker mode requires --allow-controller/,
    },
    {
      args: [
        '--distributed-worker',
        '--distributed-config',
        'workers.json',
        '--worker-id',
        'worker-one',
        '--app',
        `seerrng=${root}`,
        '--tls-cert',
        'worker.pem',
        '--tls-key',
        'worker.key',
        '--listen-host',
        '127.0.0.1',
        '--allow-controller',
        '127.0.0.1',
      ],
      message:
        /Distributed worker mode requires exactly one of --allow-task or --allow-task-file/,
    },
  ];

  for (const { args, message } of invalid) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
      windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, message, JSON.stringify(args));
    assert.doesNotMatch(
      result.stderr,
      /Hosted GitHub mode requires GitHub Actions|Missing hosted GitHub plan|ENOENT/,
      JSON.stringify(args)
    );
  }
});

test('distributed discovery optionally writes one sealed task manifest outside source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-discovery-manifest-'));
  const application = distributedDiscoveryFixture();
  const cli = join(root, 'bin/run-local-validation.mjs');
  const manifestFile = join(directory, 'tasks.json');
  const existingFile = join(directory, 'existing.json');
  const sourceFile = join(
    root,
    `.seerrng-discovery-manifest-${process.pid}-${Date.now()}.json`
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        cli,
        '--distributed-discover',
        '--app',
        `fixture-app=${application.directory}`,
        '--application',
        'fixture-app',
        '--task-file',
        manifestFile,
        '--json',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
        windowsHide: true,
      }
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const catalog = JSON.parse(result.stdout);
    const manifest = readDistributedTaskManifest(manifestFile);
    assert.equal(manifest.applicationId, catalog.applicationId);
    assert.equal(manifest.platform, catalog.platform);
    assert.equal(manifest.candidateSha256, catalog.candidate.candidateSha256);
    assert.equal(manifest.catalogSha256, catalog.catalogSha256);
    assert.equal(manifest.inventorySha256, catalog.inventorySha256);
    assert.equal(manifest.taskCount, catalog.tasks.length);
    assert.deepEqual(
      manifest.taskIds,
      catalog.tasks.map(({ taskId }) => taskId).toSorted()
    );
    assert.equal(
      readFileSync(manifestFile, 'utf8'),
      `${JSON.stringify(manifest)}\n`
    );
    if (process.platform !== 'win32')
      assert.equal(statSync(manifestFile).mode & 0o777, 0o600);

    writeFileSync(existingFile, 'preserve');
    assert.equal(existsSync(sourceFile), false);
    for (const [taskFile, message] of [
      [existingFile, /task manifest file must not already exist/i],
      [sourceFile, /task manifest file must be absolute and outside/i],
    ]) {
      const rejected = spawnSync(
        process.execPath,
        [
          cli,
          '--distributed-discover',
          '--app',
          `fixture-app=${application.directory}`,
          '--application',
          'fixture-app',
          '--task-file',
          taskFile,
        ],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, NODE_OPTIONS: '' },
          windowsHide: true,
        }
      );
      assert.ifError(rejected.error);
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, message);
    }
    assert.equal(readFileSync(existingFile, 'utf8'), 'preserve');
    assert.equal(existsSync(sourceFile), false);
  } finally {
    application.cleanup();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('distributed schedule and worker reject a sealed manifest after local catalog drift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-stale-manifest-'));
  const application = distributedDiscoveryFixture();
  const cli = join(root, 'bin/run-local-validation.mjs');
  const manifestFile = join(directory, 'tasks.json');
  const configFile = join(directory, 'workers.json');
  try {
    const discovery = spawnSync(
      process.execPath,
      [
        cli,
        '--distributed-discover',
        '--app',
        `fixture-app=${application.directory}`,
        '--application',
        'fixture-app',
        '--task-file',
        manifestFile,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
        windowsHide: true,
      }
    );
    assert.ifError(discovery.error);
    assert.equal(discovery.status, 0, discovery.stderr);

    application.write(
      'src/after-manifest.test.mjs',
      'import test from "node:test"; test("after", () => {});\n'
    );
    for (const args of [
      ['add', '--all'],
      ['commit', '--quiet', '-m', 'catalog drift'],
    ]) {
      const git = spawnSync('git', args, {
        cwd: application.directory,
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.equal(git.status, 0, git.stderr || git.error?.message);
    }
    writeFileSync(
      configFile,
      JSON.stringify({
        schema: 'seerrng-distributed-worker-config/v1',
        revision: 1,
        controllerId: 'controller-one',
        controllerWorkerId: null,
        workers: [
          {
            id: 'worker-one',
            address: 'https://127.0.0.1:1',
            enabled: true,
            identitySha256: 'd'.repeat(64),
            n: 1,
          },
          {
            id: 'worker-two',
            address: 'https://127.0.0.1:2',
            enabled: true,
            identitySha256: 'c'.repeat(64),
            n: 1,
          },
        ],
      })
    );

    const common = [
      '--distributed-config',
      configFile,
      '--app',
      `fixture-app=${application.directory}`,
    ];
    const cases = [
      [
        '--distributed-schedule',
        ...common,
        '--application',
        'fixture-app',
        '--task-file',
        manifestFile,
        '--report-file',
        join(directory, 'report.json'),
      ],
      [
        '--distributed-worker',
        ...common,
        '--worker-id',
        'worker-one',
        '--allow-task-file',
        manifestFile,
        '--tls-cert',
        'missing.pem',
        '--tls-key',
        'missing.key',
        '--listen-host',
        '127.0.0.1',
        '--allow-controller',
        '127.0.0.1',
      ],
    ];
    for (const args of cases) {
      const rejected = spawnSync(process.execPath, [cli, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
        windowsHide: true,
      });
      assert.ifError(rejected.error);
      assert.equal(rejected.status, 1, JSON.stringify(args));
      assert.match(rejected.stderr, /does not match the full local catalog/);
      assert.doesNotMatch(
        rejected.stderr,
        /fleet secret|ENOENT|missing\.pem|missing\.key/
      );
    }
  } finally {
    application.cleanup();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI materialization mode accepts only its complete bounded option set', () => {
  const cli = join(root, 'bin/run-local-validation.mjs');
  const result = spawnSync(
    process.execPath,
    [
      cli,
      '--github-materialize-test-lane',
      '--unit',
      'ci-unit-test',
      '--case',
      'shard-01-of-04',
      '--lane',
      'vitest',
      '--plan-file',
      'missing-plan.json',
      '--expected-plan-sha256',
      'a'.repeat(64),
      '--receipt-dir',
      'receipts',
      '--output-file',
      'vitest.config.mts',
      '--json',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
      windowsHide: true,
    }
  );
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing hosted GitHub plan/);
  assert.doesNotMatch(result.stderr, /does not accept|requires --/);
});

test('CLI distributed modes accept only their complete bounded option sets', () => {
  const cli = join(root, 'bin/run-local-validation.mjs');
  const taskId = 'e'.repeat(64);
  const common = [
    '--distributed-config',
    'missing-workers.json',
    '--worker-id',
    'worker-one',
    '--app',
    `seerrng=${root}`,
  ];
  const modes = [
    [
      '--distributed-controller',
      ...common,
      '--application',
      'seerrng',
      '--task',
      taskId,
      '--report-file',
      resolve(tmpdir(), 'distributed-result.json'),
    ],
    [
      '--distributed-worker',
      ...common,
      '--tls-cert',
      'worker.pem',
      '--tls-key',
      'worker.key',
      '--listen-host',
      '127.0.0.1',
      '--allow-task',
      taskId,
      '--allow-controller',
      '127.0.0.1',
    ],
    [
      '--distributed-schedule',
      '--distributed-config',
      'missing-workers.json',
      '--app',
      `seerrng=${root}`,
      '--application',
      'seerrng',
      '--task',
      taskId,
      '--task',
      'f'.repeat(64),
      '--report-file',
      resolve(tmpdir(), 'distributed-schedule-result.json'),
    ],
    [
      '--distributed-schedule',
      '--distributed-config',
      'missing-workers.json',
      '--app',
      `seerrng=${root}`,
      '--application',
      'seerrng',
      '--task-file',
      resolve(tmpdir(), 'distributed-schedule-tasks.json'),
      '--report-file',
      resolve(tmpdir(), 'distributed-schedule-file-result.json'),
    ],
    [
      '--distributed-worker',
      ...common,
      '--tls-cert',
      'worker.pem',
      '--tls-key',
      'worker.key',
      '--listen-host',
      '127.0.0.1',
      '--allow-task-file',
      resolve(tmpdir(), 'distributed-worker-tasks.json'),
      '--allow-controller',
      '127.0.0.1',
    ],
  ];
  for (const args of modes) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
      windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ENOENT/);
    assert.doesNotMatch(result.stderr, /does not accept|requires --/);
  }
});

test('distributed schedule parsing preserves singleton controller tasks and rejects foreign options', () => {
  const cli = join(root, 'bin/run-local-validation.mjs');
  const firstTask = 'e'.repeat(64);
  const secondTask = 'f'.repeat(64);
  const schedule = [
    '--distributed-schedule',
    '--distributed-config',
    'missing-workers.json',
    '--app',
    `seerrng=${root}`,
    '--application',
    'seerrng',
    '--task',
    firstTask,
    '--task',
    secondTask,
    '--report-file',
    resolve(tmpdir(), 'distributed-schedule-contract.json'),
  ];
  const taskFile = resolve(tmpdir(), 'distributed-schedule-tasks.json');
  const worker = [
    '--distributed-worker',
    '--distributed-config',
    'missing-workers.json',
    '--worker-id',
    'worker-one',
    '--app',
    `seerrng=${root}`,
    '--tls-cert',
    'worker.pem',
    '--tls-key',
    'worker.key',
    '--listen-host',
    '127.0.0.1',
    '--allow-controller',
    '127.0.0.1',
  ];
  const cases = [
    {
      args: schedule.filter(
        (entry, index) =>
          !(entry === '--task' && schedule[index + 1] === secondTask) &&
          entry !== secondTask
      ),
      message: /requires at least two --task values/,
    },
    {
      args: [
        '--distributed-controller',
        '--distributed-config',
        'missing-workers.json',
        '--worker-id',
        'worker-one',
        '--app',
        `seerrng=${root}`,
        '--application',
        'seerrng',
        '--task',
        firstTask,
        '--task',
        secondTask,
        '--report-file',
        resolve(tmpdir(), 'distributed-controller-contract.json'),
      ],
      message: /requires exactly one --task/,
    },
    {
      args: [...schedule, '--task', firstTask],
      message: /Duplicate value for --task/,
    },
    {
      args: [...schedule, '--task-file', taskFile],
      message: /requires exactly one of --task or --task-file/,
    },
    {
      args: schedule.filter(
        (entry) =>
          entry !== '--task' && entry !== firstTask && entry !== secondTask
      ),
      message: /requires exactly one of --task or --task-file/,
    },
    {
      args: [
        ...worker,
        '--allow-task',
        firstTask,
        '--allow-task-file',
        taskFile,
      ],
      message: /requires exactly one of --allow-task or --allow-task-file/,
    },
    {
      args: [...worker, '--task-file', taskFile],
      message: /Distributed worker mode does not accept --task-file/,
    },
    ...[
      ['--worker-id', 'worker-one'],
      ['--allow-task', firstTask],
      ['--allow-task-file', taskFile],
      ['--tls-cert', 'worker.pem'],
      ['--tls-key', 'worker.key'],
      ['--listen-host', '127.0.0.1'],
      ['--allow-controller', '127.0.0.1'],
    ].map(([option, optionValue]) => ({
      args: [...schedule, option, optionValue],
      message: new RegExp(
        `Distributed schedule mode does not accept ${option}`
      ),
    })),
  ];

  for (const { args, message } of cases) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
      windowsHide: true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, message, JSON.stringify(args));
    assert.doesNotMatch(result.stderr, /ENOENT/, JSON.stringify(args));
  }
});

test('distributed task files enforce schedule and worker cardinality before dispatch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-task-file-cli-'));
  const application = distributedDiscoveryFixture();
  try {
    const configFile = join(directory, 'workers.json');
    const oneTaskFile = join(directory, 'one-task.json');
    const twoTaskFile = join(directory, 'two-task.json');
    const emptyTaskFile = join(directory, 'empty-task.json');
    const reportFile = join(directory, 'existing-report.json');
    const firstTask = 'e'.repeat(64);
    const emptyCore = {
      schema: DISTRIBUTED_TASK_MANIFEST_SCHEMA,
      applicationId: 'fixture-app',
      platform: process.platform,
      candidateSha256: 'a'.repeat(64),
      catalogSha256: 'b'.repeat(64),
      inventorySha256: 'c'.repeat(64),
      taskCount: 0,
      taskIds: [],
    };
    const oneTaskCatalog = {
      applicationId: 'fixture-app',
      platform: process.platform,
      candidate: { candidateSha256: 'a'.repeat(64) },
      catalogSha256: 'b'.repeat(64),
      inventorySha256: 'c'.repeat(64),
      tasks: [{ taskId: firstTask }],
    };
    writeFileSync(
      configFile,
      JSON.stringify({
        schema: 'seerrng-distributed-worker-config/v1',
        revision: 1,
        controllerId: 'controller-one',
        controllerWorkerId: null,
        workers: [
          {
            id: 'worker-one',
            address: 'https://127.0.0.1:1',
            enabled: true,
            identitySha256: 'd'.repeat(64),
            n: 1,
          },
          {
            id: 'worker-two',
            address: 'https://127.0.0.1:2',
            enabled: true,
            identitySha256: 'c'.repeat(64),
            n: 1,
          },
        ],
      })
    );
    writeFileSync(
      oneTaskFile,
      JSON.stringify(createDistributedTaskManifest(oneTaskCatalog))
    );
    writeFileSync(
      emptyTaskFile,
      JSON.stringify({
        ...emptyCore,
        manifestSha256: canonicalJsonSha256(emptyCore),
      })
    );
    writeFileSync(reportFile, 'preserve');
    const discovery = spawnSync(
      process.execPath,
      [
        join(root, 'bin/run-local-validation.mjs'),
        '--distributed-discover',
        '--app',
        `fixture-app=${application.directory}`,
        '--application',
        'fixture-app',
        '--task-file',
        twoTaskFile,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
        windowsHide: true,
      }
    );
    assert.ifError(discovery.error);
    assert.equal(discovery.status, 0, discovery.stderr);

    const cases = [
      {
        args: [
          '--distributed-schedule',
          '--distributed-config',
          configFile,
          '--app',
          `fixture-app=${application.directory}`,
          '--application',
          'fixture-app',
          '--task-file',
          oneTaskFile,
          '--report-file',
          reportFile,
        ],
        message: /invalid task count/,
      },
      {
        args: [
          '--distributed-worker',
          '--distributed-config',
          configFile,
          '--worker-id',
          'worker-one',
          '--app',
          `fixture-app=${application.directory}`,
          '--allow-task-file',
          emptyTaskFile,
          '--tls-cert',
          'worker.pem',
          '--tls-key',
          'worker.key',
          '--listen-host',
          '127.0.0.1',
          '--allow-controller',
          '127.0.0.1',
        ],
        message: /invalid task count/,
      },
    ];

    for (const { args, message } of cases) {
      const result = spawnSync(
        process.execPath,
        [join(root, 'bin/run-local-validation.mjs'), ...args],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, NODE_OPTIONS: '' },
          windowsHide: true,
        }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 1, JSON.stringify(args));
      assert.match(result.stderr, message, JSON.stringify(args));
      assert.doesNotMatch(
        result.stderr,
        /fleet secret|must not already exist|ENOENT/,
        JSON.stringify(args)
      );
    }
    const accepted = spawnSync(
      process.execPath,
      [
        join(root, 'bin/run-local-validation.mjs'),
        '--distributed-schedule',
        '--distributed-config',
        configFile,
        '--app',
        `fixture-app=${application.directory}`,
        '--application',
        'fixture-app',
        '--task-file',
        twoTaskFile,
        '--report-file',
        reportFile,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
        windowsHide: true,
      }
    );
    assert.ifError(accepted.error);
    assert.equal(accepted.status, 1);
    assert.match(accepted.stderr, /must not already exist/);
    assert.doesNotMatch(accepted.stderr, /task manifest|fleet secret|ENOENT/);
    assert.equal(readFileSync(reportFile, 'utf8'), 'preserve');
  } finally {
    application.cleanup();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('distributed reports must be outside the exact source checkout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-report-boundary-'));
  try {
    const configFile = join(directory, 'workers.json');
    const reportFile = join(root, '..evidence', 'result.json');
    writeFileSync(
      configFile,
      JSON.stringify({
        schema: 'seerrng-distributed-worker-config/v1',
        revision: 1,
        controllerId: 'controller-one',
        controllerWorkerId: null,
        workers: [
          {
            id: 'worker-one',
            address: 'https://127.0.0.1:1',
            enabled: true,
            identitySha256: 'd'.repeat(64),
            n: 1,
          },
        ],
      })
    );
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'bin/run-local-validation.mjs'),
        '--distributed-controller',
        '--distributed-config',
        configFile,
        '--worker-id',
        'worker-one',
        '--app',
        `seerrng=${root}`,
        '--application',
        'seerrng',
        '--task',
        'e'.repeat(64),
        '--report-file',
        reportFile,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
        windowsHide: true,
      }
    );
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside the source checkout/);
    assert.equal(existsSync(reportFile), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('distributed schedule requires at least two enabled configured workers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-schedule-pool-'));
  try {
    const configFile = join(directory, 'workers.json');
    writeFileSync(
      configFile,
      JSON.stringify({
        schema: 'seerrng-distributed-worker-config/v1',
        revision: 1,
        controllerId: 'controller-one',
        controllerWorkerId: null,
        workers: [
          {
            id: 'worker-one',
            address: 'https://127.0.0.1:1',
            enabled: true,
            identitySha256: 'd'.repeat(64),
            n: 1,
          },
          {
            id: 'worker-disabled',
            address: 'https://127.0.0.1:2',
            enabled: false,
            identitySha256: 'c'.repeat(64),
            n: 1,
          },
        ],
      })
    );
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'bin/run-local-validation.mjs'),
        '--distributed-schedule',
        '--distributed-config',
        configFile,
        '--app',
        `seerrng=${root}`,
        '--application',
        'seerrng',
        '--task',
        'e'.repeat(64),
        '--task',
        'f'.repeat(64),
        '--report-file',
        join(directory, 'result.json'),
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
        windowsHide: true,
      }
    );
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /at least two enabled configured workers/);
    assert.doesNotMatch(result.stderr, /fleet secret|ENOENT/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('distributed controller and schedule reports require a real unused path outside source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-report-path-'));
  try {
    const configFile = join(directory, 'workers.json');
    writeFileSync(
      configFile,
      JSON.stringify({
        schema: 'seerrng-distributed-worker-config/v1',
        revision: 1,
        controllerId: 'controller-one',
        controllerWorkerId: null,
        workers: [
          {
            id: 'worker-one',
            address: 'https://127.0.0.1:1',
            enabled: true,
            identitySha256: 'd'.repeat(64),
            n: 1,
          },
          {
            id: 'worker-two',
            address: 'https://127.0.0.1:2',
            enabled: true,
            identitySha256: 'c'.repeat(64),
            n: 1,
          },
        ],
      })
    );
    const existingController = join(directory, 'existing-controller.json');
    const existingSchedule = join(directory, 'existing-schedule.json');
    writeFileSync(existingController, 'preserve');
    writeFileSync(existingSchedule, 'preserve');
    const sourceLink = join(directory, 'source-link');
    symlinkSync(
      root,
      sourceLink,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const finalLink = join(directory, 'final-link.json');
    const finalLinkTarget = join(directory, 'final-link-target');
    mkdirSync(finalLinkTarget);
    symlinkSync(
      finalLinkTarget,
      finalLink,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    const controllerArgs = (reportFile) => [
      '--distributed-controller',
      '--distributed-config',
      configFile,
      '--worker-id',
      'worker-one',
      '--app',
      `seerrng=${root}`,
      '--application',
      'seerrng',
      '--task',
      'e'.repeat(64),
      '--report-file',
      reportFile,
    ];
    const scheduleArgs = (reportFile) => [
      '--distributed-schedule',
      '--distributed-config',
      configFile,
      '--app',
      `seerrng=${root}`,
      '--application',
      'seerrng',
      '--task',
      'e'.repeat(64),
      '--task',
      'f'.repeat(64),
      '--report-file',
      reportFile,
    ];
    const cases = [
      {
        args: controllerArgs(existingController),
        message: /must not already exist/,
      },
      {
        args: scheduleArgs(existingSchedule),
        message: /must not already exist/,
      },
      {
        args: scheduleArgs(join(sourceLink, 'result.json')),
        message: /outside the source checkout/,
      },
      {
        args: controllerArgs(finalLink),
        message: /existing symlink or reparse point/,
      },
      {
        args: scheduleArgs(join(directory, 'missing', 'result.json')),
        message: /requires an existing parent directory/,
      },
    ];

    for (const { args, message } of cases) {
      const result = spawnSync(
        process.execPath,
        [join(root, 'bin/run-local-validation.mjs'), ...args],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, NODE_OPTIONS: '' },
          windowsHide: true,
        }
      );
      assert.ifError(result.error);
      assert.equal(result.status, 1, JSON.stringify(args));
      assert.match(result.stderr, message, JSON.stringify(args));
      assert.doesNotMatch(result.stderr, /fleet secret/, JSON.stringify(args));
    }
    assert.equal(readFileSync(existingController, 'utf8'), 'preserve');
    assert.equal(readFileSync(existingSchedule, 'utf8'), 'preserve');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('distributed controller CLI writes controlled local failure evidence before exiting nonzero', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-controller-failure-'));
  try {
    const configFile = join(directory, 'workers.json');
    const reportFile = join(directory, 'result.json');
    const taskId = 'e'.repeat(64);
    writeFileSync(
      configFile,
      JSON.stringify({
        schema: 'seerrng-distributed-worker-config/v1',
        revision: 1,
        controllerId: 'controller-one',
        controllerWorkerId: null,
        workers: [
          {
            id: 'worker-one',
            address: 'https://127.0.0.1:1',
            enabled: true,
            identitySha256: 'd'.repeat(64),
            n: 1,
          },
        ],
      })
    );
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'bin/run-local-validation.mjs'),
        '--distributed-controller',
        '--distributed-config',
        configFile,
        '--worker-id',
        'worker-one',
        '--app',
        `seerrng=${root}`,
        '--application',
        'seerrng',
        '--task',
        taskId,
        '--report-file',
        reportFile,
        '--timeout-ms',
        '250',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          SEERRNG_DISTRIBUTED_SHARED_SECRET: Buffer.alloc(32, 7).toString(
            'base64'
          ),
        },
        windowsHide: true,
      }
    );
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /failed closed/);
    const evidence = JSON.parse(readFileSync(reportFile, 'utf8'));
    assert.equal(evidence.report, null);
    assert.equal(evidence.result, null);
    assert.equal(evidence.controllerFailure.status, 'failed');
    assert.equal(evidence.controllerFailure.remoteOutcome, 'unknown');
    assert.equal(evidence.controllerFailure.errorCode, 'controller-error');
    assert.deepEqual(
      verifyDistributedControllerFailure(evidence.controllerFailure),
      evidence.controllerFailure
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('distributed schedule CLI writes sealed failure evidence when fleet admission cannot complete', () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-schedule-failure-'));
  const application = distributedDiscoveryFixture();
  try {
    const cli = join(root, 'bin/run-local-validation.mjs');
    const configFile = join(directory, 'workers.json');
    const reportFile = join(directory, 'result.json');
    const discovery = spawnSync(
      process.execPath,
      [
        cli,
        '--distributed-discover',
        '--app',
        `fixture-app=${application.directory}`,
        '--application',
        'fixture-app',
        '--json',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
        windowsHide: true,
      }
    );
    assert.ifError(discovery.error);
    assert.equal(discovery.status, 0, discovery.stderr);
    const taskIds = JSON.parse(discovery.stdout)
      .tasks.slice(0, 2)
      .map(({ taskId }) => taskId);
    assert.equal(taskIds.length, 2);
    writeFileSync(
      configFile,
      JSON.stringify({
        schema: 'seerrng-distributed-worker-config/v1',
        revision: 1,
        controllerId: 'controller-one',
        controllerWorkerId: null,
        workers: [
          {
            id: 'worker-one',
            address: 'https://127.0.0.1:1',
            enabled: true,
            identitySha256: 'd'.repeat(64),
            n: 1,
          },
          {
            id: 'worker-two',
            address: 'https://127.0.0.1:2',
            enabled: true,
            identitySha256: 'c'.repeat(64),
            n: 1,
          },
        ],
      })
    );
    const result = spawnSync(
      process.execPath,
      [
        cli,
        '--distributed-schedule',
        '--distributed-config',
        configFile,
        '--app',
        `fixture-app=${application.directory}`,
        '--application',
        'fixture-app',
        '--task',
        taskIds[0],
        '--task',
        taskIds[1],
        '--report-file',
        reportFile,
        '--timeout-ms',
        '250',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          SEERRNG_DISTRIBUTED_SHARED_SECRET: Buffer.alloc(32, 7).toString(
            'base64'
          ),
        },
        windowsHide: true,
      }
    );
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /task execution outcome is unknown/);
    const evidence = JSON.parse(readFileSync(reportFile, 'utf8'));
    assert.equal(evidence.status, 'failed');
    assert.equal(evidence.taskExecutionOutcome, 'unknown');
    assert.equal(evidence.selectionManifestSha256, null);
    assert.deepEqual(
      verifyDistributedScheduleFailureReport(evidence),
      evidence
    );
  } finally {
    application.cleanup();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('interruption cancels the owned child process tree and prevents later steps', async () => {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(
      runCommand(
        {
          name: 'interrupted',
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)'],
        },
        {
          root,
          env: isolatedEnvironment(tmpdir()),
          stdout: sink,
          stderr: sink,
          signal: controller.signal,
        }
      ),
      /interrupted/
    );
    let called = false;
    await assert.rejects(
      executePlan(
        { root, steps: [{ name: 'not started', args: [], kind: 'node-js' }] },
        {
          signal: controller.signal,
          stdout: sink,
          stderr: sink,
          executor: async () => {
            called = true;
            return '';
          },
        }
      ),
      /interrupted/
    );
    assert.equal(called, false);
  } finally {
    clearTimeout(handle);
  }
});

test('Vitest must produce a valid report with active tests and cleanup still runs', async () => {
  const f = fixture();
  try {
    let directory;
    const plan = {
      root: f.directory,
      steps: [
        {
          name: 'Vitest fixture',
          command: process.execPath,
          args: [
            '<temporary-vitest-config>',
            '--outputFile.json=<temporary-vitest-report>',
          ],
          kind: 'vitest',
          config: join(f.directory, 'vitest.config.mts'),
          files: ['src/component.test.ts'],
        },
      ],
    };
    const executor = async (step, { env }) => {
      directory = env.CONFIG_DIRECTORY;
      assert.match(readFileSync(step.args[0], 'utf8'), /component\.test\.ts/);
      assert.match(readFileSync(step.args[0], 'utf8'), /maxWorkers: 4/);
      writeFileSync(
        step.args[1].split('=')[1],
        JSON.stringify({
          numTotalTests: 1,
          numPassedTests: 1,
          numFailedTests: 0,
          testResults: [{ name: join(f.directory, 'src/component.test.ts') }],
        })
      );
      return '';
    };
    assert.equal(
      (
        await executePlan(plan, {
          executor,
          stdout: sink,
          stderr: sink,
          workers: 4,
        })
      ).get('vitest').total,
      1
    );
    assert.equal(existsSync(directory), false);
    await assert.rejects(
      executePlan(plan, { workers: 0 }),
      /sealed native worker budget/
    );
    await assert.rejects(
      executePlan(plan, {
        executor: async () => '',
        stdout: sink,
        stderr: sink,
      }),
      /ENOENT/
    );
    await assert.rejects(
      executePlan(plan, {
        executor: async (step) => {
          writeFileSync(
            step.args[1].split('=')[1],
            JSON.stringify({
              numTotalTests: 1,
              numPassedTests: 1,
              numFailedTests: 0,
              testResults: [],
            })
          );
          return '';
        },
        stdout: sink,
        stderr: sink,
      }),
      /excluded or added files/
    );
  } finally {
    f.cleanup();
  }
});

test('duplicate Vitest ownership or failed report cannot become a passing gate', async () => {
  const f = fixture();
  try {
    const plan = {
      root: f.directory,
      steps: [
        {
          name: 'Vitest fixture',
          command: process.execPath,
          args: [
            '<temporary-vitest-config>',
            '--outputFile.json=<temporary-vitest-report>',
          ],
          kind: 'vitest',
          config: join(f.directory, 'vitest.config.mts'),
          files: ['src/component.test.ts'],
        },
      ],
    };
    const file = { name: join(f.directory, 'src/component.test.ts') };
    for (const [report, expected] of [
      [
        {
          numTotalTests: 2,
          numPassedTests: 2,
          numFailedTests: 0,
          testResults: [file, file],
        },
        /excluded or added files/,
      ],
      [
        {
          numTotalTests: 1,
          numPassedTests: 0,
          numFailedTests: 1,
          testResults: [file],
        },
        /failed tests/,
      ],
      [
        {
          numTotalTests: 1,
          numPassedTests: 2,
          numFailedTests: 0,
          testResults: [file],
        },
        /Invalid Vitest/,
      ],
    ]) {
      await assert.rejects(
        executePlan(plan, {
          stdout: sink,
          stderr: sink,
          executor: async (step) => {
            writeFileSync(step.args[1].split('=')[1], JSON.stringify(report));
            return '';
          },
        }),
        expected
      );
    }
  } finally {
    f.cleanup();
  }
});

test('native receipts separate streams, preserve full byte hashes and retain owned logs', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'seerrng-native-logs-'));
  try {
    const stdoutLog = join(directory, 'stdout.log'),
      stderrLog = join(directory, 'stderr.log');
    const receipt = await runCommand(
      {
        id: 'structured',
        name: 'structured fixture',
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write("stdout data"); process.stderr.write("stderr data");',
        ],
      },
      {
        root,
        env: process.env,
        stdout: sink,
        stderr: sink,
        receipt: true,
        maxCaptureBytes: 6,
        logDirectory: directory,
        stdoutLog,
        stderrLog,
      }
    );
    assert.equal(receipt.id, 'structured');
    assert.equal(receipt.status, 'passed');
    assert.equal(receipt.exitCode, 0);
    assert.equal(receipt.stdout, 't data');
    assert.equal(receipt.stderr, 'r data');
    assert.equal(receipt.stdoutTruncated, true);
    assert.equal(readFileSync(stdoutLog, 'utf8'), 'stdout data');
    assert.equal(readFileSync(stderrLog, 'utf8'), 'stderr data');
    assert.equal(
      receipt.stdoutSha256,
      createHash('sha256').update('stdout data').digest('hex')
    );
    assert.equal(
      receipt.stderrSha256,
      createHash('sha256').update('stderr data').digest('hex')
    );
    assert.ok(receipt.wallMs >= 0);
    assert.equal(receipt.lifecycle.completed, true);
    assert.equal(receipt.lifecycle.cleanupVerified, true);
    await assert.rejects(
      runCommand(
        { command: process.execPath, args: [] },
        { root, logDirectory: directory, stdoutLog }
      ),
      /EEXIST/
    );
    await assert.rejects(
      runCommand(
        { command: process.execPath, args: [] },
        { root, logDirectory: root, stdoutLog: join(root, 'no-source-log') }
      ),
      /unsafe/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('failure, spawn failure, timeout and pre-abort attach truthful incomplete process receipts', async () => {
  const options = {
    root,
    env: process.env,
    stdout: sink,
    stderr: sink,
    receipt: true,
    terminationGraceMs: 50,
  };
  await assert.rejects(
    runCommand(
      {
        id: 'failed',
        name: 'failed',
        command: process.execPath,
        args: ['-e', 'console.error("native failure"); process.exit(9);'],
      },
      options
    ),
    (error) =>
      error.exitCode === 9 &&
      error.receipt.status === 'failed' &&
      error.receipt.stderr.includes('native failure')
  );
  await assert.rejects(
    runCommand(
      {
        id: 'missing',
        command: join(tmpdir(), 'seerrng-missing-native-command'),
        args: [],
      },
      options
    ),
    (error) =>
      error.receipt.status === 'incomplete' &&
      error.receipt.lifecycle.spawned === false &&
      error.receipt.lifecycle.completed === false
  );
  await assert.rejects(
    runCommand(
      {
        id: 'timeout',
        name: 'timeout',
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000);'],
      },
      { ...options, timeoutMs: 30 }
    ),
    (error) =>
      error.receipt.timedOut &&
      error.receipt.status === 'timed-out' &&
      error.receipt.lifecycle.cleanupVerified
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runCommand(
      { id: 'never-spawned', command: process.execPath, args: [] },
      { ...options, signal: controller.signal }
    ),
    (error) => error.receipt.aborted && !error.receipt.lifecycle.spawned
  );
  await assert.rejects(
    runCommand(
      { command: process.execPath, args: [] },
      { ...options, timeoutMs: 0 }
    ),
    /Invalid process/
  );
});

test('managed readiness and owned server stop reuse native runner without claiming a passed test', async () => {
  const handle = startCommand(
    {
      id: 'managed',
      name: 'managed',
      command: process.execPath,
      args: [
        '-e',
        'console.log("server started"); setInterval(() => {}, 1000);',
      ],
    },
    {
      root,
      env: process.env,
      stdout: sink,
      stderr: sink,
      terminationGraceMs: 100,
    }
  );
  const ready = await handle.waitForReady(
    async ({ pid }) => pid === handle.pid,
    { timeoutMs: 1000, pollMs: 10 }
  );
  assert.equal(ready.ready, true);
  const stopped = await handle.stop();
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.lifecycle.cleanupVerified, true);
  assert.equal(await handle.exit, stopped);
  assert.equal(await handle.stop(), stopped);
});

test('managed premature exit, health failure and readiness timeout fail and drain the owned process', async () => {
  const options = {
    root,
    env: process.env,
    stdout: sink,
    stderr: sink,
    terminationGraceMs: 50,
  };
  for (const mode of ['exit', 'health-failure', 'readiness-timeout']) {
    const handle = startCommand(
      {
        id: mode,
        name: mode,
        command: process.execPath,
        args: [
          '-e',
          mode === 'exit' ? 'process.exit(2)' : 'setInterval(() => {}, 1000)',
        ],
      },
      options
    );
    await assert.rejects(
      handle.waitForReady(
        async () => {
          if (mode === 'health-failure') throw new Error('health failure');
          return false;
        },
        { timeoutMs: mode === 'exit' ? 1000 : 40, pollMs: 5 }
      ),
      /before readiness|health failure|readiness timed out/
    );
    const receipt = await handle.exit;
    assert.equal(receipt.lifecycle.cleanupVerified, true);
    assert.notEqual(receipt.status, 'passed');
  }
});

test(
  'POSIX owned descendant cleanup failure cannot be labelled successful',
  { skip: process.platform === 'win32' },
  async () => {
    await assert.rejects(
      runCommand(
        {
          id: 'orphaned-descendant',
          name: 'orphaned descendant',
          command: process.execPath,
          args: [
            '-e',
            'require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}).unref();',
          ],
        },
        {
          root,
          env: process.env,
          stdout: sink,
          stderr: sink,
          receipt: true,
          terminationGraceMs: 50,
        }
      ),
      (error) =>
        error.receipt.status === 'incomplete' &&
        error.preserveTemporary === true &&
        /descendants|termination/.test(error.message)
    );
  }
);

test('distributed failure evidence is bounded, controlled, hashed, and free of arbitrary error text', () => {
  const hiddenErrorText = 'C:\\private\\developer-secret';
  const failure = Object.assign(new Error(hiddenErrorText), {
    stack: `stack containing ${hiddenErrorText}`,
    receipt: {
      exitCode: 1,
      signal: null,
      aborted: false,
      timedOut: false,
      wallMs: 25,
      stdout: 'x'.repeat(5000),
      stderr: 'bounded stderr',
      stdoutBytes: 5000,
      stderrBytes: 14,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutSha256: 'a'.repeat(64),
      stderrSha256: 'b'.repeat(64),
      lifecycle: {
        spawned: true,
        completed: true,
        cleanupVerified: true,
        cleanupError: null,
      },
    },
  });
  const evidence = createDistributedTaskFailureEvidence(failure);
  assert.equal(evidence.reason, 'native-failed');
  assert.equal(Array.from(evidence.receipt.stdoutTail).length, 4096);
  assert.equal(evidence.receipt.stdoutTailTruncated, true);
  assert.equal(evidence.receipt.stdoutBytes, 5000);
  assert.equal(evidence.receipt.stdoutSha256, 'a'.repeat(64));
  assert.equal(JSON.stringify(evidence).includes(hiddenErrorText), false);
  assert.deepEqual(verifyDistributedTaskFailureEvidence(evidence), evidence);
  assert.equal(Object.isFrozen(evidence.receipt.lifecycle), true);

  const contradictoryCore = {
    schema: evidence.schema,
    reason: 'execution-error',
    receipt: evidence.receipt,
  };
  assert.throws(
    () =>
      verifyDistributedTaskFailureEvidence({
        ...contradictoryCore,
        failureSha256: canonicalJsonSha256(contradictoryCore),
      }),
    /contradicts its receipt evidence/
  );

  const cleanupEvidence = createDistributedTaskFailureEvidence({
    receipt: {
      ...failure.receipt,
      timedOut: true,
      lifecycle: {
        ...failure.receipt.lifecycle,
        cleanupVerified: false,
        cleanupError: hiddenErrorText,
      },
    },
  });
  assert.equal(cleanupEvidence.reason, 'cleanup-unverified');
  assert.equal(cleanupEvidence.receipt.lifecycle.cleanupErrorPresent, true);
  assert.equal(
    JSON.stringify(cleanupEvidence).includes(hiddenErrorText),
    false
  );

  const report = createDistributedControllerFailureReport({
    configSha256: 'c'.repeat(64),
    controllerId: 'controller-one',
    workerId: 'worker-one',
    runId: 'run-one',
    applicationId: 'seerrng',
    taskId: 'd'.repeat(64),
    startedAt: '2026-10-06T00:00:00.000Z',
    wallMs: 25,
    error: Object.assign(new Error(hiddenErrorText), { code: 'ECONNRESET' }),
  });
  assert.deepEqual(Object.keys(report).toSorted(), [
    'controllerFailure',
    'report',
    'result',
  ]);
  assert.equal(report.report, null);
  assert.equal(report.result, null);
  assert.equal(report.controllerFailure.errorCode, 'transport-unavailable');
  assert.equal(report.controllerFailure.remoteOutcome, 'unknown');
  assert.equal(JSON.stringify(report).includes(hiddenErrorText), false);
  assert.deepEqual(
    verifyDistributedControllerFailure(report.controllerFailure),
    report.controllerFailure
  );
});
