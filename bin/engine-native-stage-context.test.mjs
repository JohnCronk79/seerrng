// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createOwnedDocsLinkSnapshot,
  createOwnedSourceSnapshot,
  disposeSourceSnapshot,
  evaluatorHeadroom,
  findNativeExecutable,
  materializeNativeReceipt,
  nativeEnvironment,
  nativeNetworkBoundary,
  prepareJellyfinTemporaryDirectory,
  readonlyMountProof,
  repositoryIsolationReadiness,
  repositoryNativeCases,
  validateNativeBoundaryProof,
  verifySourceSnapshot,
} from '../tools/validation-engine/runtime/native-stage-context.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
function fixture(t) {
  const parent = mkdtempSync(path.join(tmpdir(), 'native-context-test-'));
  const root = path.join(parent, 'repository');
  mkdirSync(root);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'Source fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  git(
    root,
    'config',
    'remote.origin.url',
    'https://github.com/Example/seerr.git'
  );
  git(root, 'config', 'credential.helper', 'never-copy-this-private-setting');
  writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  writeFileSync(path.join(root, '.gitignore'), 'private-provider.json\n');
  writeFileSync(path.join(root, 'source.mjs'), 'export const value = 1;\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'Fixture only');
  git(root, 'tag', 'fixture-v1');
  return { root, parent };
}

test('snapshot seals actual working bytes/modes, includes unignored files and omits credentials', (t) => {
  const { root, parent } = fixture(t);
  writeFileSync(path.join(root, 'source.mjs'), 'export const value = 2;\n');
  writeFileSync(path.join(root, 'new.mjs'), 'export const added = true;\n');
  writeFileSync(
    path.join(root, 'private-provider.json'),
    '{"token":"never-copy"}'
  );
  if (process.platform !== 'win32')
    chmodSync(path.join(root, 'new.mjs'), 0o755);
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  assert.notEqual(
    snapshot.candidate.tree,
    git(root, 'rev-parse', 'HEAD^{tree}')
  );
  assert.equal(snapshot.candidate.commit, git(root, 'rev-parse', 'HEAD'));
  assert.equal(
    readFileSync(path.join(snapshot.root, 'source.mjs'), 'utf8'),
    'export const value = 2;\n'
  );
  assert.equal(snapshot.manifest.fileCount, 4);
  assert.equal(
    existsSync(path.join(snapshot.root, 'private-provider.json')),
    false
  );
  const config = readFileSync(path.join(snapshot.root, '.git/config'), 'utf8');
  assert.doesNotMatch(
    config,
    /credential|user\.name|Source fixture|fixture@example/
  );
  assert.equal(git(snapshot.root, 'write-tree'), snapshot.candidate.tree);
  assert.equal(git(snapshot.root, 'tag', '--list'), 'fixture-v1');
  assert.equal(verifySourceSnapshot(snapshot), true);
  disposeSourceSnapshot(snapshot);
  assert.equal(existsSync(snapshot.scratchRoot), false);
});

test('source changes and manifest changes fail the post-source guard', (t) => {
  const { root, parent } = fixture(t);
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  writeFileSync(path.join(root, 'source.mjs'), 'changed while tests ran');
  assert.throws(() => verifySourceSnapshot(snapshot), /Frozen source changed/);
  writeFileSync(path.join(root, 'source.mjs'), 'export const value = 1;\n');
  writeFileSync(path.join(snapshot.scratchRoot, 'source-manifest.json'), '{}');
  assert.throws(() => verifySourceSnapshot(snapshot), /manifest changed/);
});

test('docs link checkout excludes installed vendors and other jobs generated docs without excluding source docs', (t) => {
  const { root, parent } = fixture(t);
  writeFileSync(
    path.join(root, '.gitignore'),
    'private-provider.json\nnode_modules/\n'
  );
  mkdirSync(path.join(root, 'docs'));
  mkdirSync(path.join(root, 'gen-docs/node_modules/vendor'), {
    recursive: true,
  });
  writeFileSync(
    path.join(root, 'docs/readme.md'),
    '[original](https://example.com)\n'
  );
  writeFileSync(
    path.join(root, 'gen-docs/node_modules/vendor/readme.md'),
    '[vendor](https://vendor.invalid)\n'
  );
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  const links = createOwnedDocsLinkSnapshot(snapshot);
  assert.equal(links.candidate.sourceSha256, snapshot.candidate.sourceSha256);
  assert.equal(
    existsSync(path.join(links.root, 'gen-docs/node_modules')),
    false
  );
  writeFileSync(
    path.join(snapshot.root, 'docs/readme.md'),
    'generated by another job'
  );
  assert.equal(
    readFileSync(path.join(links.root, 'docs/readme.md'), 'utf8'),
    '[original](https://example.com)\n'
  );
  assert.equal(verifySourceSnapshot(links), true);
  writeFileSync(path.join(links.root, 'docs/readme.md'), 'changed link input');
  assert.throws(() => verifySourceSnapshot(links), /Frozen source changed/);
});

test('new source paths are not silently omitted after the freeze', (t) => {
  const { root, parent } = fixture(t);
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  writeFileSync(path.join(root, 'later.mjs'), 'new source');
  assert.throws(
    () => verifySourceSnapshot(snapshot),
    /untracked paths changed/
  );
});

test('derived documentation exemptions are copy-only and cannot relax authoritative input protection', (t) => {
  const { root, parent } = fixture(t);
  mkdirSync(path.join(root, 'docs/api'), { recursive: true });
  writeFileSync(path.join(root, 'docs/api/generated.mdx'), 'initial source');
  const snapshot = createOwnedSourceSnapshot(root, { scratchParent: parent });
  const options = { derivedOutputs: new Set(['docs-api']) };
  writeFileSync(
    path.join(snapshot.root, 'docs/api/generated.mdx'),
    'actual generated output'
  );
  assert.equal(verifySourceSnapshot(snapshot, options), true);
  assert.throws(() => verifySourceSnapshot(snapshot), /Frozen source changed/);
  writeFileSync(
    path.join(root, 'docs/api/generated.mdx'),
    'unauthorized authoritative write'
  );
  assert.throws(
    () => verifySourceSnapshot(snapshot, options),
    /Frozen source changed/
  );
});

test(
  'source symlinks and scratch nested in source are rejected before native execution',
  { skip: process.platform === 'win32' },
  (t) => {
    const { root, parent } = fixture(t);
    const outside = path.join(parent, 'outside.txt');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, path.join(root, 'escape.mjs'));
    assert.throws(
      () => createOwnedSourceSnapshot(root, { scratchParent: parent }),
      /symlink/
    );
    assert.throws(
      () => createOwnedSourceSnapshot(root, { scratchParent: root }),
      /outside authoritative source/
    );
  }
);

test('cleanup refuses roots whose exact generated ownership is not established', (t) => {
  const { root, parent } = fixture(t);
  assert.throws(
    () => disposeSourceSnapshot({ scratchRoot: root, scratchParent: parent }),
    /unsafe native scratch cleanup/
  );
  assert.equal(existsSync(root), true);
});

test('environment preserves runtime paths but strips provider credentials and workstation identity', () => {
  const env = nativeEnvironment(
    {
      PATH: '/bin',
      HOME: '/private/home',
      USERPROFILE: 'private-profile',
      GITHUB_TOKEN: 'secret',
      TMDB_API_KEY: 'secret',
      DATABASE_URL: 'private-provider',
      DOCKER_HOST: 'tcp://production:2375',
      NODE_OPTIONS: '--import=private',
      CYPRESS_LIVE_QA_EMAIL: 'personal',
    },
    '/owned/tool-home'
  );
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/owned/tool-home');
  assert.equal(env.USERPROFILE, '/owned/tool-home');
  for (const key of [
    'GITHUB_TOKEN',
    'TMDB_API_KEY',
    'DATABASE_URL',
    'DOCKER_HOST',
    'NODE_OPTIONS',
  ])
    assert.equal(env[key], undefined);
  assert.equal(env.CYPRESS_LIVE_QA_EMAIL, '');
  assert.equal(env.CONFIG_DIRECTORY, undefined);
});

test('read-only dependency proof uses the innermost actual mount, not ancestor or a flag', (t) => {
  const { root } = fixture(t);
  const normalized = root.split(path.sep).join('/');
  const mountInfo = `1 0 0:1 / / rw - overlay overlay rw\n2 1 0:2 / ${normalized} ro,nosuid - ext4 /dev/a ro\n`;
  assert.equal(
    readonlyMountProof(root, { platform: 'linux', mountInfo }).verified,
    process.platform === 'win32' ? false : true
  );
  assert.equal(
    readonlyMountProof(root, { platform: 'win32', mountInfo }).verified,
    false
  );
  const writable = mountInfo.replace('ro,nosuid', 'rw,nosuid');
  assert.equal(
    readonlyMountProof(root, { platform: 'linux', mountInfo: writable })
      .verified,
    false
  );
});

test('provider isolation is only proven by an observed loopback-only Linux namespace', () => {
  const loopback = { lo: [{ address: '127.0.0.1', internal: true }] };
  assert.equal(
    nativeNetworkBoundary({
      platform: 'linux',
      interfaces: loopback,
      routes: 'Iface Destination\n',
    }).isolated,
    true
  );
  assert.equal(
    nativeNetworkBoundary({
      platform: 'win32',
      interfaces: loopback,
      routes: '',
    }).isolated,
    false
  );
  assert.equal(
    nativeNetworkBoundary({
      platform: 'linux',
      interfaces: { ...loopback, eth0: [{ internal: false }] },
      routes: '',
    }).isolated,
    false
  );
  assert.equal(
    nativeNetworkBoundary({
      platform: 'linux',
      interfaces: loopback,
      routes: 'Iface Destination\neth0\t00000000\t00000000',
    }).isolated,
    false
  );
});

test('injected boundary proofs require source, live namespace, capability and probe binding', () => {
  const candidate = { sourceSha256: 'a'.repeat(64) };
  const proof = {
    verified: true,
    isolated: true,
    deniesPrivateProviders: true,
    sourceSha256: candidate.sourceSha256,
    networkNamespace: 'net:[123]',
    rulesSha256: 'b'.repeat(64),
    evidenceSha256: 'c'.repeat(64),
    capabilityBoundingSet: '0000000000000000',
    noNewPrivileges: true,
    publicProbe: { host: 'api.themoviedb.org', httpsStatus: 204 },
    privateProbe: {
      destination: '192.168.255.254:9',
      refused: true,
      exitCode: 7,
    },
  };
  const current = {
    platform: 'linux',
    networkNamespace: 'net:[123]',
    status:
      'CapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nNoNewPrivs:\t1\n',
  };
  assert.deepEqual(
    validateNativeBoundaryProof(proof, candidate, current),
    proof
  );
  for (const changed of [
    { ...proof, sourceSha256: 'd'.repeat(64) },
    { ...proof, networkNamespace: 'net:[other]' },
    { ...proof, rulesSha256: null },
    { ...proof, privateProbe: { ...proof.privateProbe, refused: false } },
  ])
    assert.throws(
      () => validateNativeBoundaryProof(changed, candidate, current),
      /unproven/
    );
  assert.throws(
    () =>
      validateNativeBoundaryProof(proof, candidate, {
        ...current,
        status: 'CapBnd:\t0000000000002000\nNoNewPrivs:\t1\n',
      }),
    /unproven/
  );
});

test('native tool discovery is PATH-bound and rejects path-like names', (t) => {
  const { parent } = fixture(t);
  const executable = path.join(
    parent,
    process.platform === 'win32' ? 'fake-native.exe' : 'fake-native'
  );
  writeFileSync(executable, 'test-only tool bytes');
  chmodSync(executable, 0o755);
  assert.equal(
    findNativeExecutable('fake-native', { PATH: parent }),
    executable
  );
  assert.equal(findNativeExecutable('absent-native', { PATH: parent }), null);
  assert.throws(
    () => findNativeExecutable('../private', { PATH: parent }),
    /Unsafe native executable name/
  );
});

test('complete native output is materialized only when persistent byte count/hash closes', (t) => {
  const { parent } = fixture(t);
  const log = path.join(parent, 'native.stdout.log');
  const bytes = Buffer.from('TAP version 13\ncomplete native output\n');
  writeFileSync(log, bytes);
  const receipt = {
    stdout: 'tail',
    stdoutTruncated: true,
    stdoutLog: log,
    stdoutBytes: bytes.length,
    stdoutSha256: sha(bytes),
    stderr: '',
    stderrTruncated: false,
  };
  const result = materializeNativeReceipt(receipt);
  assert.equal(result.stdout, bytes.toString());
  assert.equal(result.stdoutTruncated, false);
  assert.equal(result.stdoutCaptureTruncated, true);
  assert.throws(
    () =>
      materializeNativeReceipt({ ...receipt, stdoutSha256: '0'.repeat(64) }),
    /does not match/
  );
  assert.throws(
    () => materializeNativeReceipt({ ...receipt, stdoutLog: null }),
    /no complete persistent log/
  );
});

test('Jellyfin native smoke gets an exclusively owned TMPDIR parent before mktemp', (t) => {
  const { parent } = fixture(t);
  const fixtures = path.join(parent, 'supplemental-fixtures');
  mkdirSync(fixtures);
  const expected = path.join(fixtures, 'jellyfin-smoke');
  const descriptor = {
    id: 'jellyfin-plugin-native-smoke',
    env: { TMPDIR: expected, TMP: expected, TEMP: expected },
  };
  assert.equal(
    prepareJellyfinTemporaryDirectory(descriptor, fixtures),
    expected
  );
  assert.equal(existsSync(expected), true);
  assert.throws(
    () => prepareJellyfinTemporaryDirectory(descriptor, fixtures),
    /EEXIST/
  );
  assert.equal(
    prepareJellyfinTemporaryDirectory({ id: 'other-native-check' }, fixtures),
    null
  );
});

test('Jellyfin temporary directory cannot escape fixture ownership or follow a reused symlink', (t) => {
  const { parent } = fixture(t);
  const fixtures = path.join(parent, 'supplemental-fixtures');
  mkdirSync(fixtures);
  const outside = path.join(parent, 'outside');
  mkdirSync(outside);
  const descriptor = {
    id: 'jellyfin-plugin-native-smoke',
    env: { TMPDIR: outside, TMP: outside, TEMP: outside },
  };
  assert.throws(
    () => prepareJellyfinTemporaryDirectory(descriptor, fixtures),
    /not bound/
  );
  if (process.platform !== 'win32') {
    const expected = path.join(fixtures, 'jellyfin-smoke');
    symlinkSync(outside, expected);
    assert.throws(
      () =>
        prepareJellyfinTemporaryDirectory(
          {
            ...descriptor,
            env: { TMPDIR: expected, TMP: expected, TEMP: expected },
          },
          fixtures
        ),
      /EEXIST/
    );
    assert.deepEqual(readdirSync(outside), []);
  }
});

test('repository isolation requires live internal admission or an observed loopback-only fallback', () => {
  const wrapper = async (operation) => operation();
  const deferred = repositoryIsolationReadiness(wrapper, { isolated: false });
  assert.equal(deferred.ready, true);
  assert.equal(deferred.requiresLiveProof, true);
  assert.equal(
    repositoryIsolationReadiness(undefined, {
      isolated: true,
      mechanism: 'observed-loopback-only-Linux-network-namespace',
    }).ready,
    true
  );
  assert.equal(
    repositoryIsolationReadiness(undefined, {
      isolated: true,
      mechanism: 'private-egress-firewall',
    }).ready,
    false
  );
  assert.equal(
    repositoryIsolationReadiness(undefined, {
      isolated: false,
      mechanism: 'unproven',
    }).ready,
    false
  );
  assert.throws(() => repositoryIsolationReadiness(true), /must be a function/);
});

test('repository count evidence requires actual native cases and rejects failed/incomplete closure', () => {
  const report = {
    numPassedTests: 1,
    numFailedTests: 0,
    numTotalTests: 2,
    success: true,
    testResults: [
      {
        name: 'source.test.ts',
        assertionResults: [
          { fullName: 'actual pass', status: 'passed' },
          { fullName: 'native conditional skip', status: 'pending' },
        ],
      },
    ],
  };
  const command = { kind: 'vitest', files: ['source.test.ts'] };
  assert.deepEqual(
    repositoryNativeCases(command, {}, { vitestReport: report }).counts,
    { passed: 1, failed: 0, skipped: 1 }
  );
  assert.throws(
    () =>
      repositoryNativeCases(
        command,
        {},
        { vitestReport: { ...report, numTotalTests: 3 } }
      ),
    /incomplete or failed/
  );
  assert.throws(
    () =>
      repositoryNativeCases(
        { kind: 'node-js', files: ['actual.test.mjs'] },
        { stdout: '# tests 12\n# pass 12\n# fail 0' }
      ),
    /TAP case ledger is absent/
  );
  const stdout =
    "TAP version 13\n# Subtest: actual case\nok 1 - actual case\n  ---\n  type: 'test'\n  ...\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  assert.equal(
    repositoryNativeCases(
      { kind: 'node-js', files: ['actual.test.mjs'] },
      { stdout }
    ).counts.passed,
    1
  );
  assert.throws(
    () =>
      repositoryNativeCases(
        { kind: 'node-js', files: ['actual.test.mjs'] },
        { stdout: stdout.replace('# tests 1', '# tests 2') }
      ),
    /closure failed/
  );
});

test('CodeQL memory headroom discounts observed inactive file cache but retains working-set reserve', () => {
  const gib = 1024 ** 3;
  const headroom = evaluatorHeadroom({
    memAvailableBytes: 20 * gib,
    cgroupLimitBytes: 4 * gib,
    cgroupCurrentBytes: 3 * gib,
    inactiveFileBytes: 2 * gib,
  });
  assert.equal(headroom.workingSetBytes, gib);
  assert.equal(headroom.evaluatorMb, 2048);
  assert.equal(
    evaluatorHeadroom({
      memAvailableBytes: gib,
      cgroupLimitBytes: 4 * gib,
      cgroupCurrentBytes: 3 * gib,
      inactiveFileBytes: 2 * gib,
    }).evaluatorMb,
    0
  );
  assert.equal(
    evaluatorHeadroom({
      memAvailableBytes: 20 * gib,
      cgroupLimitBytes: 4 * gib,
      cgroupCurrentBytes: 3 * gib,
    }).evaluatorMb,
    0
  );
  assert.throws(
    () => evaluatorHeadroom({ memAvailableBytes: NaN }),
    /Invalid observed/
  );
});

test('help stays read-only and does not require project/dependency/tool prerequisites', (t) => {
  const { root } = fixture(t);
  const before = readdirSync(root).sort();
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('./run-local-validation.mjs', import.meta.url)),
      '--help',
    ],
    { cwd: root, encoding: 'utf8' }
  );
  assert.match(output, /staged native PR-parity gate/);
  assert.deepEqual(readdirSync(root).sort(), before);
});
