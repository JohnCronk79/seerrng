import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import { createAdaptiveTimingProfile } from '../tools/validation-engine/runtime/distributed-adaptive-scheduler.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import {
  DISTRIBUTED_LINUX_HOST_CONTAINMENT_SCHEMA,
  createDistributedLinuxHostContainmentPlan,
} from '../tools/validation-engine/runtime/distributed-linux-host-containment.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import {
  DISTRIBUTED_LINUX_HOST_PROFILE_FILE,
  DISTRIBUTED_LINUX_HOST_PROFILE_SCHEMA,
  DISTRIBUTED_LINUX_TIMING_PROFILE_FILE,
  createDistributedLinuxHostLifecycleManifest,
  executeDistributedLinuxPublicLifecycle,
  fetchAuthenticatedGitState,
  normalizeDistributedLinuxHostProfile,
  runDistributedLinuxProofClientCommand,
} from '../tools/validation-engine/runtime/distributed-linux-public-lifecycle.mjs';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native tooling tests exercise the engine module directly.
import { canonicalJsonSha256 } from '../tools/validation-engine/runtime/run-scoped-ledger.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PROOF_PARENT = resolve(
  ROOT,
  'tools/validation-engine/container/mode3-proof-parent.py'
);
const digest = (character) => character.repeat(64);
const hash40 = (character) => character.repeat(40);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function hostProfile() {
  return {
    schema: DISTRIBUTED_LINUX_HOST_PROFILE_SCHEMA,
    images: {
      helper: {
        reference: `helper.invalid/tool@sha256:${digest('a')}`,
        id: `sha256:${digest('a')}`,
      },
      daemon: {
        reference: `daemon.invalid/dind@sha256:${digest('b')}`,
        id: `sha256:${digest('b')}`,
        entrypoint: '/usr/local/bin/dockerd-entrypoint.sh',
        storageDriver: 'overlay2',
      },
      fixture: {
        reference: `fixture.invalid/http@sha256:${digest('c')}`,
        containerPort: 8080,
        command: ['httpd', '-f', '-p', '8080', '-h', '/www'],
      },
    },
    volumes: {
      dependencies: 'focused-dependencies',
      prerequisites: 'focused-prerequisites',
    },
    resources: {
      helper: {
        cpus: 12,
        memoryBytes: 12 * 1024 ** 3,
        pidsLimit: 4096,
        tmpfsBytes: 256 * 1024 ** 2,
        tmpfsTarget: '/tmp',
      },
      daemon: {
        cpus: 2,
        memoryBytes: 4 * 1024 ** 3,
        pidsLimit: 2048,
        expectedCpuMax: '200000 100000',
        expectedMemoryMax: String(4 * 1024 ** 3),
        expectedPidsMax: '2048',
      },
    },
    network: {
      baselineMode: 'public-private-blocked',
      bridgeAddress: '172.31.253.1/29',
      bridgeCidr: '172.31.253.0/29',
      bridgeName: 'docker0',
      dnsServers: ['1.1.1.1'],
      baselineDeniedCidrsV4: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
      baselineDeniedCidrsV6: ['fc00::/7', 'fe80::/10'],
      publicProbe: {
        host: 'api.github.com',
        url: 'https://api.github.com/',
        statusMinimum: 200,
        statusMaximum: 399,
      },
      privateProbe: {
        host: '192.168.255.254',
        port: 9,
        expectedExitCode: 7,
      },
    },
  };
}

function candidate() {
  return {
    repository: 'https://github.com/example/project.git',
    branch: 'feature/focused',
    commit: hash40('1'),
    tree: hash40('2'),
    lockSha256: digest('3'),
    sourceSha256: digest('4'),
  };
}

function lifecycleFixture(root) {
  const configDirectory = join(root, 'config');
  const sourceDirectory = join(root, 'source');
  const gitDirectory = join(sourceDirectory, '.git');
  const evidenceDirectory = join(root, 'evidence');
  for (const directory of [
    configDirectory,
    sourceDirectory,
    gitDirectory,
    evidenceDirectory,
  ])
    mkdirSync(directory);
  const parentBytes = readFileSync(PROOF_PARENT);
  return createDistributedLinuxHostLifecycleManifest({
    candidate: candidate(),
    configDirectory,
    dependencyVolume: 'focused-dependencies',
    gitDirectory,
    gitEvidenceSha256: digest('5'),
    hostProfile: hostProfile(),
    outerDaemonId: 'focused-outer-daemon',
    outerEvidenceDirectory: join(evidenceDirectory, 'containment'),
    parentScriptPath: PROOF_PARENT,
    parentScriptSha256: sha256(parentBytes),
    prerequisiteVolume: 'focused-prerequisites',
    runId: 'mode3-focused-run',
    runtimeApplicationKey: 'seerrng',
    sourceDirectory,
    distributedEndpoints: [{ host: '192.168.10.9', port: 62021 }],
  });
}

test('host profile is data-only and rejects mutable image identities', () => {
  const profile = normalizeDistributedLinuxHostProfile(hostProfile());
  assert.equal(profile.schema, DISTRIBUTED_LINUX_HOST_PROFILE_SCHEMA);
  assert.equal(profile.volumes.dependencies, 'focused-dependencies');
  const mutable = structuredClone(hostProfile());
  mutable.images.helper.reference = 'helper.invalid/tool:latest';
  assert.throws(
    () => normalizeDistributedLinuxHostProfile(mutable),
    /immutable identity/
  );
  assert.deepEqual(Object.keys(profile).sort(), [
    'images',
    'network',
    'resources',
    'schema',
    'volumes',
  ]);
});

test('proof client runner delivers the exact canonical request on standard input', () => {
  const input = Buffer.from('{"op":"observe"}\n');
  const receipt = runDistributedLinuxProofClientCommand(
    [process.execPath, '-e', 'process.stdin.pipe(process.stdout)'],
    { id: 'focused-proof-client', input, timeoutMs: 10_000 }
  );
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.stdout, input.toString('utf8'));
  assert.equal(receipt.lifecycle.cleanupVerified, true);
});

test('authenticated Git closure fetches and binds the exact published branch and tags', () => {
  const commit = hash40('1');
  const defaultCommit = hash40('2');
  const tagCommit = hash40('3');
  const remote = [
    `${defaultCommit}\tHEAD`,
    `${commit}\trefs/heads/feature/focused`,
    `${tagCommit}\trefs/tags/v1`,
    '',
  ].join('\n');
  const calls = [];
  const state = fetchAuthenticatedGitState('ignored-by-focused-adapter', {
    git: (_root, args) => {
      calls.push(args);
      const command = args.join(' ');
      if (command === 'symbolic-ref --short HEAD') return 'feature/focused\n';
      if (command === 'config --get remote.origin.url')
        return 'https://github.com/example/project.git\n';
      if (command.startsWith('ls-remote origin HEAD')) return remote;
      if (command === 'fetch --prune --tags origin') return '';
      if (command === 'rev-parse HEAD') return `${commit}\n`;
      if (command === 'rev-parse --is-shallow-repository') return 'false\n';
      if (command === 'show-ref --tags') return `${tagCommit} refs/tags/v1\n`;
      throw new Error(`Unexpected focused Git command: ${command}`);
    },
  });
  assert.equal(state.branch, 'feature/focused');
  assert.equal(state.commit, commit);
  assert.deepEqual(state.tagRefs, [`refs/tags/v1 ${tagCommit}`]);
  assert.equal(
    calls.filter((args) => args[0] === 'ls-remote').length,
    2,
    'Remote refs must be observed before and after the authenticated fetch'
  );
  assert.ok(
    calls.some((args) => args.join(' ') === 'fetch --prune --tags origin')
  );
});

test('generated manifest is accepted by the real containment planner', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'mode3-public-manifest-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lifecycle = lifecycleFixture(root);
  assert.equal(
    lifecycle.manifest.schema,
    DISTRIBUTED_LINUX_HOST_CONTAINMENT_SCHEMA
  );
  const plan = createDistributedLinuxHostContainmentPlan(lifecycle.manifest, {
    uniqueToken: 'f'.repeat(32),
  });
  assert.equal(plan.manifest.inputs.candidate.target, '/app');
  assert.equal(plan.manifest.inputs.dependencies.target, '/app/node_modules');
  assert.deepEqual(plan.manifest.inner.engineArguments, [
    '/app/bin/run-local-validation.mjs',
    '--distributed-contained-run',
    '--request-file',
    '/config/contained-request.json',
  ]);
  assert.equal(
    plan.manifest.network.distributed.endpoints[0].host,
    '192.168.10.9'
  );
  assert.ok(
    plan.manifest.evidence.artifacts.some(
      ({ role }) => role === 'proof-parent-ledger'
    )
  );
  assert.ok(
    plan.manifest.evidence.artifacts.some(
      ({ role, fileName }) =>
        role === 'native-process-streams' &&
        fileName === 'native-process-streams.json'
    )
  );
});

test('public lifecycle persists the returned profile, cleans preparation, and writes success last', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'mode3-public-lifecycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const stateRoot = join(root, 'state');
  const logRoot = join(root, 'logs');
  const scratchRoot = join(stateRoot, 'owned-snapshot');
  for (const directory of [stateRoot, logRoot, scratchRoot])
    mkdirSync(directory);
  writeFileSync(
    join(stateRoot, DISTRIBUTED_LINUX_HOST_PROFILE_FILE),
    `${JSON.stringify(hostProfile(), null, 2)}\n`
  );
  const activeMarker = join(stateRoot, 'active-controller');
  writeFileSync(activeMarker, 'controller.cfg\n');
  const currentCommit = hash40('6');
  const currentTree = hash40('7');
  const sourceSha256 = digest('8');
  const sourceProfile = resolve(
    ROOT,
    'tools/validation-engine/setup/seerrng-test-suite-dependancies.cfg'
  );
  const config = {
    global: {
      githubUsername: 'JohnCronk79',
      computerName: 'Focused laptop',
      ipAddress: '192.168.10.82',
      port: 62021,
      cpuName: 'Focused CPU',
      availableThreads: 12,
      threads: '2n',
      minimumThreadCount: 1,
    },
    nodes: [
      {
        nodeNumber: '01',
        computerName: 'Focused server',
        ipAddress: '192.168.10.9',
        port: 62021,
        cpuName: 'Focused server CPU',
        availableThreads: 8,
        threads: 'n-2',
        minimumThreadCount: 1,
      },
    ],
    supportedApplications: [
      {
        entryId: '01',
        applicationId: 'SeerrNG 3.48.3',
        name: 'Focused SeerrNG',
        profilePath: sourceProfile,
      },
    ],
    applicationRequirements: [
      {
        applicationId: 'SeerrNG 3.48.3',
        dependencies: [{ name: 'node', version: '24.21.0' }],
      },
    ],
    nodeDependencyAvailability: [
      {
        nodeNumber: '01',
        dependencies: [{ name: 'node', version: '24.21.0' }],
      },
    ],
    sharedAuthenticationKey: 'd'.repeat(64),
  };
  const profile = createAdaptiveTimingProfile();
  const events = [];
  let capturedManifest;
  const request = {
    activeConfigMarkerPath: activeMarker,
    applicationEntryId: '01',
    logRoot,
    runId: 'mode3-focused-public-run',
    runtimeApplicationKey: 'seerrng',
    signal: undefined,
    sourceRoot: ROOT,
    stateRoot,
  };
  const dependencies = {
    createHostAdapters: () => ({
      docker: {
        run: async () => ({
          status: 'passed',
          exitCode: 0,
          stdout: '"focused-daemon"\n',
        }),
      },
    }),
    fetchGitState: () => ({
      branch: 'feature/focused',
      commit: currentCommit,
      repository: 'https://github.com/JohnCronk79/seerrng.git',
      tagRefs: [`refs/tags/v1 ${hash40('9')}`],
      remoteRefs: [
        { oid: hash40('0'), ref: 'HEAD' },
        { oid: currentCommit, ref: 'refs/heads/feature/focused' },
        { oid: hash40('9'), ref: 'refs/tags/v1' },
      ],
    }),
    createSnapshot: () => ({
      root: ROOT,
      scratchRoot,
      candidate: {
        repository: 'https://github.com/JohnCronk79/seerrng.git',
        commit: currentCommit,
        tree: currentTree,
        lockSha256: digest('a'),
        sourceSha256,
      },
    }),
    detectOperatorGithubLogin: () => 'JohnCronk79',
    resolveActiveConfig: async () => ({ config, configPath: activeMarker }),
    readTimingProfile: () => profile,
    persistTimingProfile: async (_path, value) => {
      events.push('persist-profile');
      assert.deepEqual(value, profile);
    },
    verifySnapshot: () => events.push('verify-snapshot'),
    disposeSnapshot: () => events.push('dispose-snapshot'),
    createContainment: (manifest) => {
      capturedManifest = manifest;
      return {
        executeHostLifecycle: async () => {
          mkdirSync(manifest.evidence.outerDirectory);
          writeFileSync(
            join(
              manifest.evidence.outerDirectory,
              'adaptive-timing-profile.json'
            ),
            `${JSON.stringify(profile, null, 2)}\n`
          );
          writeFileSync(
            join(
              manifest.evidence.outerDirectory,
              'launch-result-verification.json'
            ),
            '{"status":"passed"}\n'
          );
          return {
            runId: manifest.runId,
            status: 'passed',
            containedRun: {
              updatedProfileSha256: canonicalJsonSha256(profile),
            },
          };
        },
      };
    },
  };
  await assert.rejects(
    executeDistributedLinuxPublicLifecycle(
      { ...request, runId: 'mode3-missing-operator-run' },
      { ...dependencies, detectOperatorGithubLogin: () => null }
    ),
    /operator differs from the authenticated checkout operator/u
  );
  const result = await executeDistributedLinuxPublicLifecycle(
    request,
    dependencies
  );
  assert.equal(result.status, 'passed');
  assert.equal(capturedManifest.candidate.sourceSha256, sourceSha256);
  const containedRequest = JSON.parse(
    readFileSync(
      join(scratchRoot, 'host-preparation', 'contained-request.json'),
      'utf8'
    )
  );
  assert.equal(containedRequest.operatorGithubLogin, 'JohnCronk79');
  assert.equal(containedRequest.requiredCapacityProof.expectedLogicalCpus, 12);
  assert.equal(
    containedRequest.requiredCapacityProof.expectedConfiguredWorkers,
    24
  );
  assert.equal(
    capturedManifest.inner.environment.SEERR_MODE3_OPERATOR_GITHUB_LOGIN,
    'JohnCronk79'
  );
  assert.ok(
    capturedManifest.evidence.artifacts.some(
      ({ role }) => role === 'native-run-expectations'
    )
  );
  assert.deepEqual(events, [
    'persist-profile',
    'verify-snapshot',
    'dispose-snapshot',
  ]);
  assert.equal(
    JSON.parse(
      readFileSync(
        join(
          logRoot,
          'mode3-focused-public-run',
          'launch-result-verification.json'
        ),
        'utf8'
      )
    ).hostPreparationCleanupVerified,
    true
  );
  assert.equal(
    existsSyncSafe(join(stateRoot, DISTRIBUTED_LINUX_TIMING_PROFILE_FILE)),
    false,
    'The persistence adapter, not an unowned fallback write, owns the profile'
  );
});

function existsSyncSafe(path) {
  try {
    readFileSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
