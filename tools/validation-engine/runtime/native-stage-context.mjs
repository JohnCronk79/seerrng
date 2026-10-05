// Copyright (c) snapetech and SeerrNG contributors.
// Automatic preparation/context for the existing native validation coordinator.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { freemem, networkInterfaces, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import {
  createPlan,
  executePlan,
  runCommand,
  startCommand,
} from '../../../bin/local-validation.mjs';
import {
  buildBrowserEnvironment,
  createBuildBrowserStages,
} from './build-browser-stage.mjs';
import { createCodeqlSteps, readCodeqlWorkflow } from './codeql-stage.mjs';
import { detectWorkerCapacity } from './cpu-capacity.mjs';
import { readNodeTapHierarchy } from './node-tap-hierarchy.mjs';
import {
  createSupplementalPrStages,
  normalizeSupplementalPrChecks,
} from './pr-check-stages.mjs';
import { createStagedValidation } from './staged-validation.mjs';

const prefix = 'seerrng-native-validation-';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const beneath = (root, file) => {
  const rel = path.relative(root, file);
  return (
    rel &&
    rel !== '..' &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel)
  );
};
const safe = (file) =>
  typeof file === 'string' &&
  file &&
  !path.isAbsolute(file) &&
  !/[\x00-\x1f\\]/.test(file) &&
  file.split('/').every((part) => part && part !== '.' && part !== '..');
const git = (root, args, input) =>
  execFileSync(
    'git',
    [
      '--no-optional-locks',
      '-C',
      root,
      '-c',
      'core.fsmonitor=false',
      '-c',
      'init.templateDir=',
      ...args,
    ],
    {
      encoding: 'utf8',
      input,
      maxBuffer: 128 * 1024 ** 2,
      env: {
        ...nativeEnvironment(process.env, tmpdir()),
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      },
    }
  );

export function nativeEnvironment(inherited, home) {
  const env = buildBrowserEnvironment(inherited, home, 5056);
  env.HOME = home;
  env.USERPROFILE = home;
  delete env.CONFIG_DIRECTORY;
  delete env.E2E_TESTS;
  delete env.WITH_MIGRATIONS;
  delete env.PORT;
  return env;
}

function regular(root, file) {
  const absolute = path.resolve(root, file);
  if (!safe(file) || !beneath(root, absolute))
    throw new Error(`Unsafe source path: ${file}`);
  // Every ancestor must stay literal and inside the chosen root.
  let current = root;
  for (const component of file.split('/')) {
    current = path.join(current, component);
    if (lstatSync(current).isSymbolicLink())
      throw new Error(`Source symlink is not a frozen regular file: ${file}`);
  }
  const stat = lstatSync(absolute);
  if (!stat.isFile()) throw new Error(`Source special entry: ${file}`);
  return { absolute, stat };
}
function copyMetadata(from, to) {
  if (!existsSync(from)) return;
  const stat = lstatSync(from);
  if (stat.isSymbolicLink())
    throw new Error('External Git metadata links are not copied');
  if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      if (name === 'alternates' || name.endsWith('.lock'))
        throw new Error('External or locked Git metadata is unsafe');
      copyMetadata(path.join(from, name), path.join(to, name));
    }
  } else if (stat.isFile())
    writeFileSync(to, readFileSync(from), { flag: 'wx' });
  else throw new Error('Special Git metadata entry is unsafe');
}

export function createOwnedSourceSnapshot(
  sourceRoot,
  { scratchParent = tmpdir() } = {}
) {
  sourceRoot = realpathSync(sourceRoot);
  if (
    realpathSync(git(sourceRoot, ['rev-parse', '--show-toplevel']).trim()) !==
    sourceRoot
  )
    throw new Error('Source root must be the actual repository root');
  const origin = git(sourceRoot, [
    'config',
    '--get',
    'remote.origin.url',
  ]).trim();
  if (
    !/^(?:https:\/\/github\.com\/|git@github\.com:)[\w.-]+\/[\w.-]+(?:\.git)?$/.test(
      origin
    )
  )
    throw new Error(
      'Repository origin must be a credential-free GitHub identity'
    );
  const commit = git(sourceRoot, ['rev-parse', 'HEAD']).trim();
  const common = realpathSync(
    path.resolve(
      sourceRoot,
      git(sourceRoot, ['rev-parse', '--git-common-dir']).trim()
    )
  );
  const actualGit = realpathSync(
    git(sourceRoot, ['rev-parse', '--absolute-git-dir']).trim()
  );
  const shallow =
    git(sourceRoot, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  const tracked = git(sourceRoot, ['ls-files', '-z'])
    .split('\0')
    .filter(Boolean);
  const untracked = git(sourceRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ])
    .split('\0')
    .filter(Boolean);
  if (git(sourceRoot, ['ls-files', '--unmerged', '-z']).length)
    throw new Error('Unmerged source cannot be frozen');
  const paths = [...new Set([...tracked, ...untracked])].sort();
  scratchParent = realpathSync(scratchParent);
  if (scratchParent === sourceRoot || beneath(sourceRoot, scratchParent))
    throw new Error('Native scratch must be outside authoritative source');
  const scratchRoot = mkdtempSync(path.join(scratchParent, prefix));
  const root = path.join(scratchRoot, 'source');
  mkdirSync(root);
  const entries = [];
  try {
    for (const file of paths) {
      if (
        file === '.git' ||
        file.startsWith('.git/') ||
        file === 'node_modules' ||
        file.startsWith('node_modules/')
      )
        throw new Error(
          'Metadata/dependency paths cannot become source payload'
        );
      const { absolute, stat } = regular(sourceRoot, file),
        bytes = readFileSync(absolute);
      const target = path.join(root, file),
        mode = stat.mode & 0o111 ? '100755' : '100644';
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes, {
        flag: 'wx',
        mode: mode === '100755' ? 0o755 : 0o644,
      });
      chmodSync(target, mode === '100755' ? 0o755 : 0o644);
      entries.push({
        path: file,
        mode,
        bytes: bytes.length,
        sha256: hash(bytes),
      });
    }
    git(root, ['init', '--quiet']);
    const snapshotGit = path.join(root, '.git');
    // Object/history inputs are retained for repository-owned fixtures. Never
    // copy source Git config, hooks, logs, credential helpers or workstation state.
    copyMetadata(
      path.join(common, 'objects'),
      path.join(snapshotGit, 'objects')
    );
    copyMetadata(path.join(common, 'refs'), path.join(snapshotGit, 'refs'));
    if (existsSync(path.join(common, 'packed-refs')))
      copyMetadata(
        path.join(common, 'packed-refs'),
        path.join(snapshotGit, 'packed-refs')
      );
    if (existsSync(path.join(common, 'shallow')))
      copyMetadata(
        path.join(common, 'shallow'),
        path.join(snapshotGit, 'shallow')
      );
    writeFileSync(
      path.join(snapshotGit, 'HEAD'),
      readFileSync(path.join(actualGit, 'HEAD'))
    );
    git(root, ['config', 'remote.origin.url', origin]);
    git(root, ['config', 'core.hooksPath', path.join(scratchRoot, 'no-hooks')]);
    // One native Git operation hashes the copied bytes without filters. This
    // avoids thousands of process launches and still builds the exact working
    // tree object rather than substituting a commit's old tree.
    const blobs = git(
      root,
      ['hash-object', '-w', '--no-filters', '--stdin-paths'],
      entries.map((entry) => JSON.stringify(entry.path)).join('\n') + '\n'
    )
      .trim()
      .split('\n');
    if (
      blobs.length !== entries.length ||
      blobs.some((blob) => !/^[a-f0-9]{40}$/.test(blob))
    )
      throw new Error('Native source object closure is incomplete');
    const index = entries.map(
      (entry, ordinal) => `${entry.mode} ${blobs[ordinal]}\t${entry.path}\0`
    );
    git(root, ['update-index', '-z', '--index-info'], index.join(''));
    const tree = git(root, ['write-tree']).trim();
    const manifest = {
      schema: 1,
      representation: 'actual-working-files-and-modes',
      repository: origin,
      commit,
      tree,
      fileCount: entries.length,
      files: entries,
    };
    const sourceSha256 = hash(json(manifest));
    const candidate = {
      repository: origin,
      commit,
      tree,
      lockSha256: entries.find((entry) => entry.path === 'pnpm-lock.yaml')
        ?.sha256,
      sourceSha256,
    };
    if (!/^[a-f0-9]{64}$/.test(candidate.lockSha256 ?? ''))
      throw new Error('Exact installed lockfile input is required');
    writeFileSync(
      path.join(scratchRoot, 'source-manifest.json'),
      json(manifest),
      { flag: 'wx' }
    );
    const snapshot = {
      root,
      authoritativeRoot: sourceRoot,
      scratchRoot,
      scratchParent,
      manifest,
      candidate,
      tracked,
      untracked,
      shallow,
    };
    verifySourceSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    error.scratchRoot = scratchRoot;
    error.preserveTemporary = true;
    throw error;
  }
}

const declaredDerived = (file, enabled) =>
  (enabled.has('docs-api') && file.startsWith('docs/api/')) ||
  (enabled.has('chart-docs') && /^charts\/.+\/README\.md$/.test(file));

export function verifySourceSnapshot(
  snapshot,
  { derivedOutputs = new Set() } = {}
) {
  if (
    hash(json(snapshot.manifest)) !== snapshot.candidate.sourceSha256 ||
    hash(
      readFileSync(path.join(snapshot.scratchRoot, 'source-manifest.json'))
    ) !== snapshot.candidate.sourceSha256
  )
    throw new Error('Frozen source manifest changed');
  if (
    git(snapshot.authoritativeRoot, ['rev-parse', 'HEAD']).trim() !==
    snapshot.candidate.commit
  )
    throw new Error('Authoritative HEAD changed during native validation');
  for (const [kind, previous] of [
    ['tracked', snapshot.tracked],
    ['untracked', snapshot.untracked],
  ]) {
    const now = git(
      snapshot.authoritativeRoot,
      kind === 'tracked'
        ? ['ls-files', '-z']
        : ['ls-files', '--others', '--exclude-standard', '-z']
    )
      .split('\0')
      .filter(Boolean)
      .sort();
    if (JSON.stringify(now) !== JSON.stringify([...previous].sort()))
      throw new Error(
        `Authoritative ${kind} paths changed during native validation`
      );
  }
  for (const file of snapshot.manifest.files)
    for (const root of [snapshot.authoritativeRoot, snapshot.root]) {
      // Only the disjoint supplemental copy may contain native-declared derived
      // output. Authoritative bytes are never exempt from the input guard.
      if (root === snapshot.root && declaredDerived(file.path, derivedOutputs))
        continue;
      const { absolute, stat } = regular(root, file.path);
      if (
        hash(readFileSync(absolute)) !== file.sha256 ||
        (stat.mode & 0o111 ? '100755' : '100644') !== file.mode
      )
        throw new Error(`Frozen source changed: ${file.path}`);
    }
  return true;
}

function derivedOutputManifest(snapshot, enabled) {
  const entries = [];
  const scan = (directory) => {
    if (!existsSync(directory)) return;
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name),
        stat = lstatSync(absolute);
      if (stat.isSymbolicLink())
        throw new Error('Derived documentation output contains a symlink');
      if (stat.isDirectory()) scan(absolute);
      else if (stat.isFile()) {
        const file = path
          .relative(snapshot.root, absolute)
          .split(path.sep)
          .join('/');
        if (declaredDerived(file, enabled))
          entries.push({
            path: file,
            bytes: stat.size,
            sha256: hash(readFileSync(absolute)),
          });
      } else throw new Error('Derived documentation contains a special entry');
    }
  };
  if (enabled.has('docs-api')) scan(path.join(snapshot.root, 'docs/api'));
  if (enabled.has('chart-docs')) scan(path.join(snapshot.root, 'charts'));
  for (const entry of snapshot.manifest.files)
    if (
      declaredDerived(entry.path, enabled) &&
      !existsSync(path.join(snapshot.root, entry.path))
    )
      entries.push({ path: entry.path, deleted: true });
  const manifest = {
    sourceSha256: snapshot.candidate.sourceSha256,
    declaredNativeOutputs: [...enabled].sort(),
    files: entries.sort((a, b) => a.path.localeCompare(b.path)),
  };
  return { ...manifest, sha256: hash(json(manifest)) };
}

export function readonlyMountProof(
  directory,
  {
    platform = process.platform,
    mountInfo = platform === 'linux'
      ? readFileSync('/proc/self/mountinfo', 'utf8')
      : '',
  } = {}
) {
  if (platform !== 'linux')
    return {
      verified: false,
      reason:
        'No native read-only bind-mount proof is available on this platform',
    };
  const real = realpathSync(directory);
  const mounts = mountInfo
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '))
    .filter(
      (parts) =>
        parts[4] &&
        (real === parts[4].replaceAll('\\040', ' ') ||
          beneath(parts[4].replaceAll('\\040', ' '), real))
    )
    .sort((a, b) => b[4].length - a[4].length);
  const selected = mounts[0];
  return {
    verified: !!selected?.[5].split(',').includes('ro'),
    mount: selected?.[4] ?? null,
    reason: selected?.[5].split(',').includes('ro')
      ? 'Actual execution namespace declares this dependency mount read-only'
      : 'Installed dependency reference is not proven read-only',
  };
}

export function nativeNetworkBoundary({
  platform = process.platform,
  interfaces = networkInterfaces(),
  routes = platform === 'linux' ? readFileSync('/proc/net/route', 'utf8') : '',
} = {}) {
  const external = Object.entries(interfaces)
    .filter(([, addresses]) => addresses?.some((address) => !address.internal))
    .map(([name]) => name);
  const defaultRoute = routes
    .split('\n')
    .slice(1)
    .some((line) => /^\S+\s+00000000\s/.test(line));
  const verified =
    platform === 'linux' && external.length === 0 && !defaultRoute;
  return {
    isolated: verified,
    deniesPrivateProviders: verified,
    mechanism: verified
      ? 'observed-loopback-only-Linux-network-namespace'
      : 'unproven',
    externalInterfaces: external,
    defaultRoute,
    evidenceSha256: hash(json({ platform, external, defaultRoute })),
    reason: verified
      ? 'No external interface or IPv4 default route exists in the current process namespace'
      : 'Browser fixture flags are not an OS provider-network boundary',
  };
}

export function validateNativeBoundaryProof(
  proof,
  candidate,
  {
    platform = process.platform,
    networkNamespace = platform === 'linux'
      ? readlinkSync('/proc/self/ns/net')
      : null,
    status = platform === 'linux'
      ? readFileSync('/proc/self/status', 'utf8')
      : '',
  } = {}
) {
  const boundingSet = /^CapBnd:\s*(\S+)$/m.exec(status)?.[1];
  const effectiveSet = /^CapEff:\s*(\S+)$/m.exec(status)?.[1];
  const noNewPrivileges = /^NoNewPrivs:\s*1$/m.test(status);
  if (
    platform !== 'linux' ||
    proof?.verified !== true ||
    proof.isolated !== true ||
    proof.deniesPrivateProviders !== true ||
    proof.sourceSha256 !== candidate.sourceSha256 ||
    proof.networkNamespace !== networkNamespace ||
    !/^[a-f0-9]{64}$/.test(proof.rulesSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(proof.evidenceSha256 ?? '') ||
    boundingSet !== '0000000000000000' ||
    effectiveSet !== '0000000000000000' ||
    proof.capabilityBoundingSet !== boundingSet ||
    !noNewPrivileges ||
    proof.noNewPrivileges !== true ||
    proof.publicProbe?.host !== 'api.themoviedb.org' ||
    !Number.isInteger(proof.publicProbe.httpsStatus) ||
    proof.publicProbe.httpsStatus < 200 ||
    proof.publicProbe.httpsStatus >= 400 ||
    proof.privateProbe?.destination !== '192.168.255.254:9' ||
    proof.privateProbe.refused !== true ||
    proof.privateProbe.exitCode !== 7
  )
    throw new Error(
      'Current namespace/capability/live-probe provider boundary is unproven'
    );
  return structuredClone(proof);
}

function closure(root) {
  root = realpathSync(root);
  const entries = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name),
        stat = lstatSync(absolute),
        file = path.relative(root, absolute).split(path.sep).join('/');
      if (stat.isSymbolicLink()) {
        const resolved = realpathSync(absolute);
        if (resolved !== root && !beneath(root, resolved))
          throw new Error(`Tool/dependency closure escapes its root: ${file}`);
        entries.push({ path: file, link: readlinkSync(absolute) });
      } else if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile())
        entries.push({
          path: file,
          mode: stat.mode & 0o111 ? '100755' : '100644',
          bytes: stat.size,
          sha256: hash(readFileSync(absolute)),
        });
      else throw new Error('Special entry in native closure');
    }
  };
  visit(root);
  return {
    root,
    sha256: hash(json(entries)),
    entries: entries.length,
    representation:
      'sorted-native-tree-regular-bytes-modes-internal-symlink-targets-json-v1',
  };
}

export function findNativeExecutable(name, environment = process.env) {
  if (!/^[A-Za-z0-9_-]+$/.test(name))
    throw new Error('Unsafe native executable name');
  const extensions =
    process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  const candidates = (environment.PATH ?? environment.Path ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      extensions.map((extension) => path.join(directory, `${name}${extension}`))
    );
  if (name === 'codeql')
    candidates.push(
      path.join(
        '/opt/codeql',
        process.platform === 'win32' ? 'codeql.exe' : 'codeql'
      )
    );
  for (const candidate of candidates) {
    try {
      const actual = realpathSync(candidate);
      if (lstatSync(actual).isFile()) {
        accessSync(actual, constants.X_OK);
        return actual;
      }
    } catch {}
  }
  return null;
}

export function materializeNativeReceipt(receipt) {
  for (const stream of ['stdout', 'stderr']) {
    if (!receipt[`${stream}Truncated`]) continue;
    const file = receipt[`${stream}Log`];
    if (!file)
      throw new Error('Truncated native output has no complete persistent log');
    const bytes = readFileSync(file);
    if (
      bytes.length !== receipt[`${stream}Bytes`] ||
      hash(bytes) !== receipt[`${stream}Sha256`]
    )
      throw new Error(
        'Complete native output log does not match its process receipt'
      );
    receipt = {
      ...receipt,
      [stream]: bytes.toString('utf8'),
      [`${stream}CaptureTruncated`]: true,
      [`${stream}Truncated`]: false,
    };
  }
  return receipt;
}

export function prepareJellyfinTemporaryDirectory(command, fixtureRoot) {
  if (command.id !== 'jellyfin-plugin-native-smoke') return null;
  const root = realpathSync(fixtureRoot);
  if (lstatSync(fixtureRoot).isSymbolicLink())
    throw new Error('Jellyfin fixture root must not be a symlink');
  const expected = path.join(root, 'jellyfin-smoke');
  if (['TMPDIR', 'TMP', 'TEMP'].some((key) => command.env?.[key] !== expected))
    throw new Error(
      'Jellyfin native temporary directory is not bound to owned fixtures'
    );
  // The native smoke script calls mktemp beneath TMPDIR. Create only its fresh
  // parent; it remains responsible for its own temporary fixture lifecycle.
  mkdirSync(expected, { recursive: false, mode: 0o700 });
  return expected;
}

export function repositoryIsolationReadiness(
  withRepositoryIsolation,
  observedBoundary = nativeNetworkBoundary()
) {
  if (
    withRepositoryIsolation !== undefined &&
    typeof withRepositoryIsolation !== 'function'
  )
    throw new Error(
      'Internal repository-isolation admission must be a function'
    );
  if (typeof withRepositoryIsolation === 'function')
    return {
      ready: true,
      mechanism: 'internal-repository-isolation-admission',
      requiresLiveProof: true,
    };
  return {
    ready:
      observedBoundary.isolated === true &&
      observedBoundary.mechanism ===
        'observed-loopback-only-Linux-network-namespace',
    mechanism: observedBoundary.mechanism,
    requiresLiveProof: false,
    reason:
      'Without an internal live admission wrapper, repository tests require an observed loopback-only OS namespace',
  };
}

export function repositoryNativeCases(command, receipt, { vitestReport } = {}) {
  if (command.kind === 'check') return null;
  if (command.kind === 'vitest') {
    if (!vitestReport || !Array.isArray(vitestReport.testResults))
      throw new Error('Actual native Vitest JSON case ledger is required');
    const files = vitestReport.testResults.map((result) => ({
      file: result.name,
      cases: result.assertionResults,
    }));
    if (files.some((file) => !Array.isArray(file.cases)))
      throw new Error('Vitest assertion closure is missing');
    const cases = files.flatMap((file) =>
      file.cases.map((entry) => ({
        file: file.file,
        name: entry.fullName ?? entry.title,
        status: entry.status,
      }))
    );
    if (
      cases.some(
        (entry) =>
          ![
            'passed',
            'failed',
            'pending',
            'skipped',
            'todo',
            'disabled',
          ].includes(entry.status)
      )
    )
      throw new Error('Unknown native Vitest case status');
    const counts = {
      passed: cases.filter((entry) => entry.status === 'passed').length,
      failed: cases.filter((entry) => entry.status === 'failed').length,
      skipped: cases.filter(
        (entry) => !['passed', 'failed'].includes(entry.status)
      ).length,
    };
    if (
      counts.passed !== vitestReport.numPassedTests ||
      counts.failed !== vitestReport.numFailedTests ||
      cases.length !== vitestReport.numTotalTests ||
      vitestReport.success !== true ||
      counts.failed
    )
      throw new Error(
        'Native Vitest cases/summary closure is incomplete or failed'
      );
    return {
      format: 'native-vitest-json',
      files: command.files,
      cases,
      counts,
      reportSha256: hash(json(vitestReport)),
    };
  }
  const raw = Buffer.from(receipt.stdout),
    marker = raw.indexOf(Buffer.from('TAP version 13'));
  if (marker < 0 || (marker > 0 && raw[marker - 1] !== 10))
    throw new Error('Actual native Node TAP case ledger is absent');
  const runner =
    command.kind === 'node-ts'
      ? 'server/test/index.mts'
      : command.kind === 'tooling'
        ? 'bin/run-tooling-tests.mjs'
        : 'node:test';
  const ledger = readNodeTapHierarchy(raw.subarray(marker), runner);
  if (!ledger.complete || ledger.counts.failed || ledger.counts.passed < 1)
    throw new Error(
      `Native repository case closure failed: ${ledger.issues.join('; ')}`
    );
  return { ...ledger, files: command.files, nativeRunner: runner };
}

export function evaluatorHeadroom({
  memAvailableBytes,
  cgroupLimitBytes = null,
  cgroupCurrentBytes = 0,
  inactiveFileBytes = 0,
  reserveMb = 1024,
}) {
  if (
    ![
      memAvailableBytes,
      cgroupCurrentBytes,
      inactiveFileBytes,
      reserveMb,
    ].every((value) => Number.isFinite(value) && value >= 0) ||
    (cgroupLimitBytes !== null &&
      (!Number.isFinite(cgroupLimitBytes) || cgroupLimitBytes <= 0))
  )
    throw new Error('Invalid observed native memory capacity');
  const workingSetBytes = Math.max(0, cgroupCurrentBytes - inactiveFileBytes);
  const availableBytes = Math.min(
    memAvailableBytes,
    cgroupLimitBytes === null
      ? memAvailableBytes
      : Math.max(0, cgroupLimitBytes - workingSetBytes)
  );
  return {
    memAvailableBytes,
    cgroupLimitBytes,
    cgroupCurrentBytes,
    inactiveFileBytes,
    workingSetBytes,
    reserveMb,
    evaluatorMb: Math.max(
      0,
      Math.floor(availableBytes / 1024 ** 2) - reserveMb
    ),
    policy:
      'observed-MemAvailable-capped-by-cgroup-current-minus-inactive-file-with-explicit-reserve',
  };
}

function liveEvaluatorHeadroom() {
  let memAvailableBytes = Math.min(totalmem(), freemem()),
    cgroupLimitBytes = null,
    cgroupCurrentBytes = 0,
    inactiveFileBytes = 0;
  if (process.platform === 'linux') {
    const available = /^MemAvailable:\s*(\d+) kB$/m.exec(
      readFileSync('/proc/meminfo', 'utf8')
    );
    if (available)
      memAvailableBytes = Math.min(totalmem(), Number(available[1]) * 1024);
    if (existsSync('/sys/fs/cgroup/memory.max')) {
      const limit = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
      if (limit !== 'max') cgroupLimitBytes = Number(limit);
      cgroupCurrentBytes = Number(
        readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim()
      );
      inactiveFileBytes = Number(
        /^inactive_file (\d+)$/m.exec(
          readFileSync('/sys/fs/cgroup/memory.stat', 'utf8')
        )?.[1] ?? 0
      );
    } else if (existsSync('/sys/fs/cgroup/memory/memory.limit_in_bytes')) {
      cgroupLimitBytes = Number(
        readFileSync(
          '/sys/fs/cgroup/memory/memory.limit_in_bytes',
          'utf8'
        ).trim()
      );
      cgroupCurrentBytes = Number(
        readFileSync(
          '/sys/fs/cgroup/memory/memory.usage_in_bytes',
          'utf8'
        ).trim()
      );
      inactiveFileBytes = Number(
        /^total_inactive_file (\d+)$/m.exec(
          readFileSync('/sys/fs/cgroup/memory/memory.stat', 'utf8')
        )?.[1] ?? 0
      );
    }
  }
  return evaluatorHeadroom({
    memAvailableBytes,
    cgroupLimitBytes,
    cgroupCurrentBytes,
    inactiveFileBytes,
  });
}

async function inspectTools(discoveryEnv, env, run) {
  const tools = {};
  for (const [id, name, args] of [
    ['bash', 'bash', ['--version']],
    ['perl', 'perl', ['--version']],
    ['find', 'find', ['--version']],
    ['python3', 'python3', ['--version']],
    ['dotnet9', 'dotnet', ['--version']],
    ['docker', 'docker', ['--version']],
    ['git', 'git', ['--version']],
    ['helm', 'helm', ['version', '--short']],
    ['helmDocs', 'helm-docs', ['--version']],
    ['ct', 'ct', ['version']],
    ['yamllint', 'yamllint', ['--version']],
    ['yamale', 'yamale', ['--version']],
    ['lychee', 'lychee', ['--version']],
  ]) {
    const executable = findNativeExecutable(name, discoveryEnv);
    if (!executable || /\.(cmd|bat)$/i.test(executable)) {
      tools[id] = {
        verified: false,
        reason:
          'Native executable not found or requires unsupported shell composition',
      };
      continue;
    }
    try {
      const result = await run({
        id: `prerequisite-${id}`,
        command: executable,
        args,
        env,
      });
      const versionOutput = `${result.stdout} ${result.stderr}`.trim();
      if (id === 'find' && !versionOutput.includes('GNU findutils'))
        throw new Error(
          'Repository scripts require GNU find, not a same-name platform utility'
        );
      tools[id] = {
        verified: true,
        executable,
        executableSha256: hash(readFileSync(executable)),
        version:
          versionOutput.match(/v?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)/)?.[1] ??
          versionOutput,
        versionEvidenceSha256: hash(
          json({ stdout: result.stdout, stderr: result.stderr })
        ),
      };
    } catch (error) {
      tools[id] = { verified: false, reason: error.message };
    }
  }
  // Docker CLI availability never proves nested daemon/bind/loopback safety.
  if (tools.docker)
    Object.assign(tools.docker, {
      daemonVerified: false,
      scratchBindPathsVerified: false,
      loopbackReachabilityVerified: false,
    });
  return tools;
}

function packLocations(resolved, name, desiredVersion = null) {
  const found = new Map();
  for (const step of resolved.steps ?? []) {
    for (const scan of [...(step.scans ?? []), step]) {
      const item = scan.found?.[name];
      for (const pack of item?.path
        ? [item]
        : Object.entries(item ?? {}).map(([version, details]) => ({
            ...details,
            version,
          }))) {
        if (pack.path && (!desiredVersion || pack.version === desiredVersion))
          found.set(realpathSync(pack.path), pack);
      }
    }
  }
  if (found.size !== 1)
    throw new Error(`CodeQL pack is absent or ambiguous: ${name}`);
  return [...found.values()][0];
}

export async function createNativeStageContext(
  sourceRoot,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    inherited = process.env,
    signal,
    scratchParent = tmpdir(),
    prerequisiteReferences = {},
    verifyNetworkBoundary,
    verifyDockerFixture,
    verifyGitHistory,
    withRepositoryIsolation,
  } = {}
) {
  const capacity = detectWorkerCapacity({ sourceRoot, environment: inherited });
  const snapshot = createOwnedSourceSnapshot(sourceRoot, { scratchParent });
  try {
    // Public operator identity is resolved on the real checkout, not from copied
    // credentials/config. Retain only that approved login for existing Vitest's
    // automatic capacity resolver when it executes on the disposable copy.
    if (capacity.operatorGithubLogin)
      git(snapshot.root, [
        'config',
        'github.user',
        capacity.operatorGithubLogin,
      ]);
    const logs = path.join(snapshot.scratchRoot, 'logs'),
      home = path.join(snapshot.scratchRoot, 'tool-home'),
      supplementalFixtures = path.join(
        snapshot.scratchRoot,
        'supplemental-fixtures'
      ),
      codeqlScratch = path.join(snapshot.scratchRoot, 'codeql');
    for (const directory of [logs, home, supplementalFixtures, codeqlScratch])
      mkdirSync(directory);
    const env = nativeEnvironment(inherited, home);
    const dependencyRoot = realpathSync(path.join(sourceRoot, 'node_modules'));
    const dependencyProof = readonlyMountProof(dependencyRoot);
    symlinkSync(
      dependencyRoot,
      path.join(snapshot.root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const blockers = [];
    const blocked = (id, stage, reason) =>
      blockers.push({
        id,
        stage,
        required: true,
        status: 'prerequisite-blocked',
        reason,
      });
    if (!dependencyProof.verified)
      blocked(
        'readonly-installed-dependency-reference',
        'repository',
        dependencyProof.reason
      );
    const installedLock = path.join(dependencyRoot, '.pnpm/lock.yaml');
    const installedLockSha256 = existsSync(installedLock)
      ? hash(readFileSync(installedLock))
      : null;
    if (installedLockSha256 !== snapshot.candidate.lockSha256)
      blocked(
        'installed-dependency-lock-binding',
        'repository',
        'Installed dependency lockfile does not match the actual frozen source lockfile'
      );
    const dependency = closure(dependencyRoot);
    let ordinal = 0;
    let supplementalSnapshot;
    const derivedOutputs = new Set(),
      derivedArtifacts = [];
    const nativeRun = async (command, options = {}) => {
      signal?.throwIfAborted();
      const id = `${++ordinal}-${(command.id ?? command.name ?? 'native').replace(/[^A-Za-z0-9_-]/g, '-')}`;
      let executable = command.command,
        args = [...command.args];
      if (executable === 'pnpm' && process.platform === 'win32') {
        const cli = inherited.npm_execpath;
        if (!cli || !/pnpm\.(?:c?js)$/i.test(path.basename(cli)))
          throw new Error(
            'Native Windows pnpm Node entry is unavailable; no shell command is invented'
          );
        executable = process.execPath;
        args.unshift(realpathSync(cli));
      }
      if (command.id === 'docs-api-generate') derivedOutputs.add('docs-api');
      if (command.id === 'charts-generated-docs')
        derivedOutputs.add('chart-docs');
      prepareJellyfinTemporaryDirectory(command, supplementalFixtures);
      let resourceAdmission;
      if (
        /^codeql-(?:actions|javascript)-(?:create|analyze)$/.test(
          command.id ?? ''
        )
      ) {
        const currentCapacity = detectWorkerCapacity({
          sourceRoot: snapshot.authoritativeRoot,
          environment: inherited,
        });
        const memory = liveEvaluatorHeadroom();
        if (
          currentCapacity.effectiveLogicalCpus < codeqlPlan.resources.threads ||
          memory.evaluatorMb < codeqlPlan.resources.memoryMb
        )
          throw new Error(
            'Current native CodeQL CPU/memory capacity is below the sealed command budget'
          );
        resourceAdmission = {
          effectiveLogicalCpus: currentCapacity.effectiveLogicalCpus,
          memory,
        };
      }
      try {
        const receipt = await runCommand(
          {
            ...command,
            command: executable,
            args,
            name: command.name ?? command.id,
          },
          {
            root: command.cwd ?? snapshot.root,
            env: { ...env, ...command.env },
            stdout:
              command.id === 'cypress-fixture-external-config'
                ? { write() {} }
                : stdout,
            stderr,
            signal: options.signal ?? signal,
            timeoutMs: options.timeoutMs,
            receipt: true,
            logDirectory: logs,
            stdoutLog: path.join(logs, `${id}.stdout.log`),
            stderrLog: path.join(logs, `${id}.stderr.log`),
          }
        );
        return {
          ...materializeNativeReceipt(receipt),
          ...(resourceAdmission ? { resourceAdmission } : {}),
        };
      } catch (error) {
        if (error.receipt)
          error.receipt = {
            ...materializeNativeReceipt(error.receipt),
            ...(resourceAdmission ? { resourceAdmission } : {}),
          };
        throw error;
      } finally {
        if (supplementalSnapshot) {
          verifySourceSnapshot(supplementalSnapshot, { derivedOutputs });
          if (derivedOutputs.size) {
            const artifact = derivedOutputManifest(
              supplementalSnapshot,
              derivedOutputs
            );
            const file = path.join(
              snapshot.scratchRoot,
              `${id}.derived-doc-output.json`
            );
            writeFileSync(file, json(artifact), { flag: 'wx' });
            derivedArtifacts.push({ file, sha256: hash(json(artifact)) });
          }
        }
      }
    };
    const tools = await inspectTools(inherited, env, (command) =>
      nativeRun(command, { timeoutMs: 10_000 })
    );
    if (tools.ct?.verified) {
      const configDir =
        prerequisiteReferences.chartTestingConfig ??
        inherited.CT_CONFIG_DIR ??
        path.join(path.dirname(tools.ct.executable), 'etc');
      try {
        const actual = realpathSync(configDir),
          proof = readonlyMountProof(actual);
        if (!proof.verified)
          throw new Error(
            'Chart-testing bundled configuration is not proven read-only'
          );
        const schema = regular(actual, 'chart_schema.yaml'),
          lint = regular(actual, 'lintconf.yaml');
        Object.assign(tools.ct, {
          configDir: actual,
          configSha256: {
            chartSchema: hash(readFileSync(schema.absolute)),
            lintconf: hash(readFileSync(lint.absolute)),
          },
          configReadonlyProof: proof,
        });
      } catch (error) {
        tools.ct.configProofFailure = error.message;
      }
    }
    const proofContext = {
      candidate: snapshot.candidate,
      capacity,
      scratchRoot: snapshot.scratchRoot,
    };
    let gitHistoryProof = null;
    if (tools.git?.verified) {
      const localTagRefsSha256 = hash(
        git(snapshot.root, [
          'for-each-ref',
          '--format=%(refname) %(objectname)',
          'refs/tags',
        ])
      );
      Object.assign(tools.git, {
        knownHistory: !snapshot.shallow,
        knownTags: git(snapshot.root, ['tag', '--list']).trim().length > 0,
        localTagRefsSha256,
        completeHistory: false,
        completeTags: false,
      });
      if (typeof verifyGitHistory === 'function') {
        try {
          const proof = await verifyGitHistory({
            ...proofContext,
            localTagRefsSha256,
          });
          if (
            proof?.verified !== true ||
            proof.completeClosure !== true ||
            snapshot.shallow ||
            proof.sourceSha256 !== snapshot.candidate.sourceSha256 ||
            proof.commit !== snapshot.candidate.commit ||
            typeof proof.version !== 'string' ||
            !proof.version.trim() ||
            proof.localTagRefsSha256 !== localTagRefsSha256 ||
            proof.remoteTagRefsSha256 !== localTagRefsSha256 ||
            !/^[a-f0-9]{64}$/.test(proof.remoteRefsSha256 ?? '') ||
            !/^[a-f0-9]{64}$/.test(proof.evidenceSha256 ?? '') ||
            git(snapshot.root, [
              'rev-list',
              '--objects',
              '--all',
              '--missing=print',
            ])
              .split('\n')
              .some((line) => line.startsWith('?'))
          )
            throw new Error(
              'Authenticated complete Git remote/history/tag closure is unproven'
            );
          gitHistoryProof = proof;
          Object.assign(tools.git, {
            completeHistory: true,
            completeTags: true,
            closureProof: proof,
          });
        } catch (error) {
          tools.git.reason = error.message;
        }
      }
    }
    let dockerFixtureProof = null;
    if (typeof verifyDockerFixture === 'function') {
      try {
        const proof = await verifyDockerFixture(proofContext);
        const socket = proof.endpoint?.startsWith('unix://')
          ? path.resolve(proof.endpoint.slice(7))
          : null;
        if (
          process.platform !== 'linux' ||
          proof.verified !== true ||
          proof.sourceSha256 !== snapshot.candidate.sourceSha256 ||
          proof.namespaceId !== readlinkSync('/proc/self/ns/net') ||
          !/^[a-f0-9]{64}$/.test(proof.evidenceSha256 ?? '') ||
          !proof.daemonVerified ||
          !proof.daemonId ||
          !proof.scratchBindPathsVerified ||
          !proof.loopbackReachabilityVerified ||
          !socket ||
          !beneath(snapshot.scratchParent, socket) ||
          !lstatSync(socket).isSocket() ||
          proof.executableSha256 !== tools.docker?.executableSha256
        )
          throw new Error(
            'Private Docker endpoint/daemon/fixture namespace proof is incomplete'
          );
        dockerFixtureProof = proof;
        tools.docker = { ...tools.docker, ...proof };
        env.DOCKER_HOST = proof.endpoint;
      } catch (error) {
        if (tools.docker) tools.docker.reason = error.message;
      }
    }
    const docsDeps =
      prerequisiteReferences.docsDependencies ??
      path.join(sourceRoot, 'gen-docs/node_modules');
    if (existsSync(docsDeps) && readonlyMountProof(docsDeps).verified) {
      symlinkSync(
        realpathSync(docsDeps),
        path.join(snapshot.root, 'gen-docs/node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const lockSha256 = hash(
        readFileSync(path.join(snapshot.root, 'gen-docs/pnpm-lock.yaml'))
      );
      const installedDocsLock = path.join(docsDeps, '.pnpm/lock.yaml');
      tools.docsDependencies = {
        verified:
          existsSync(installedDocsLock) &&
          hash(readFileSync(installedDocsLock)) === lockSha256,
        lockSha256,
        closure: closure(docsDeps),
      };
    }
    const workflowText = readFileSync(
      path.join(snapshot.root, '.github/workflows/codeql.yml'),
      'utf8'
    );
    let codeqlPlan = {
        sourceIdentity: { sha256: snapshot.candidate.sourceSha256 },
        prerequisiteBlocked: true,
      },
      codeqlToolchain = null;
    try {
      const executable = findNativeExecutable('codeql', inherited);
      if (!executable || /\.(cmd|bat)$/i.test(executable))
        throw new Error('Native CodeQL CLI not installed');
      const versionReceipt = await nativeRun(
        {
          id: 'codeql-version',
          command: executable,
          args: ['version', '--format=json'],
          env: nativeEnvironment(inherited, home),
        },
        { timeoutMs: 10_000 }
      );
      const nativeVersion = JSON.parse(versionReceipt.stdout);
      const modelReference = prerequisiteReferences.codeqlModels;
      if (modelReference && !readonlyMountProof(modelReference).verified)
        throw new Error(
          'Explicit public CodeQL model reference is not proven read-only'
        );
      const resolveArgs = ['resolve', 'packs', '--format=json'];
      if (modelReference)
        resolveArgs.push(`--additional-packs=${realpathSync(modelReference)}`);
      const resolveReceipt = await nativeRun(
        {
          id: 'codeql-packs',
          command: executable,
          args: resolveArgs,
          env: modelReference
            ? nativeEnvironment(inherited, home)
            : buildBrowserEnvironment(inherited, home, 5056),
        },
        { timeoutMs: 10_000 }
      );
      const resolved = JSON.parse(resolveReceipt.stdout),
        workflow = readCodeqlWorkflow(workflowText),
        packs = [];
      for (const name of workflow.languages.map(
        (language) => `codeql/${language}-queries`
      )) {
        const pack = packLocations(resolved, name);
        packs.push({
          name,
          version: pack.version,
          ...closure(path.dirname(pack.path)),
        });
      }
      const [modelName, modelVersion] = workflow.modelPack.split('@'),
        model = packLocations(resolved, modelName, modelVersion);
      packs.push({
        name: modelName,
        version: modelVersion,
        ...closure(path.dirname(model.path)),
      });
      codeqlToolchain = {
        cliPath: executable,
        cliVersion: nativeVersion.version,
        sha256: closure(path.dirname(executable)).sha256,
        packs,
        nativeVersion,
      };
      const memoryAdmission = liveEvaluatorHeadroom();
      codeqlToolchain.memoryAdmission = memoryAdmission;
      // Do not reserve all free RAM on a large runner. The native evaluator's
      // bounded budget leaves measured headroom for the controller and fixtures.
      const memoryMb = Math.min(4096, memoryAdmission.evaluatorMb);
      codeqlPlan = createCodeqlSteps({
        sourceRoot: snapshot.root,
        scratchRoot: codeqlScratch,
        capacity,
        memoryMb,
        toolchain: codeqlToolchain,
        workflowText,
        sourceIdentity: { sha256: snapshot.candidate.sourceSha256 },
      });
      for (const command of codeqlPlan.steps) {
        if (command.args[1] === 'analyze')
          command.args.push(
            `--additional-packs=${packs.map((pack) => pack.root).join(path.delimiter)}`
          );
      }
      // Additional-packs is part of the sealed native command recipe, never an
      // unrecorded executable override after the plan is approved.
      const { planSha256, ...unsealed } = codeqlPlan;
      codeqlPlan.planSha256 = hash(JSON.stringify(unsealed));
    } catch (error) {
      blocked('native-codeql-toolchain', 'codeql', error.message);
    }
    const buildBrowserPlan = await createBuildBrowserStages({
      root: snapshot.root,
      authoritativeRoot: snapshot.authoritativeRoot,
      scratchRoot: snapshot.scratchRoot,
      fixtureRoot: path.join(snapshot.scratchRoot, 'browser-fixture'),
      candidate: snapshot.candidate,
      capacity,
      inheritedEnv: env,
    });
    supplementalSnapshot = createOwnedSourceSnapshot(
      snapshot.authoritativeRoot,
      { scratchParent: snapshot.scratchRoot }
    );
    if (
      supplementalSnapshot.candidate.sourceSha256 !==
      snapshot.candidate.sourceSha256
    )
      throw new Error(
        'Supplemental source copy does not match the sealed application input'
      );
    symlinkSync(
      dependencyRoot,
      path.join(supplementalSnapshot.root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    if (tools.docsDependencies?.verified)
      symlinkSync(
        realpathSync(docsDeps),
        path.join(supplementalSnapshot.root, 'gen-docs/node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    let networkBoundaryProof = nativeNetworkBoundary();
    if (typeof verifyNetworkBoundary === 'function') {
      try {
        networkBoundaryProof = validateNativeBoundaryProof(
          await verifyNetworkBoundary(proofContext),
          snapshot.candidate
        );
      } catch (error) {
        networkBoundaryProof = {
          isolated: false,
          deniesPrivateProviders: false,
          reason: error.message,
        };
      }
    }
    if (!networkBoundaryProof.isolated)
      blocked(
        'browser-provider-network-boundary',
        'browser',
        networkBoundaryProof.reason
      );
    const repositoryIsolation = repositoryIsolationReadiness(
      withRepositoryIsolation
    );
    if (!repositoryIsolation.ready)
      blocked(
        'repository-loopback-only-network-boundary',
        'repository',
        repositoryIsolation.reason
      );
    let defaultBranch = null;
    try {
      defaultBranch = git(snapshot.root, [
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
      ])
        .trim()
        .replace(/^refs\/remotes\/origin\//, '');
    } catch {}
    const supplemental = await createSupplementalPrStages({
      root: supplementalSnapshot.root,
      scratchRoot: snapshot.scratchRoot,
      fixtureRoot: supplementalFixtures,
      candidate: snapshot.candidate,
      tools,
      scope: 'full',
      env,
      configuredWorkers: capacity.configuredWorkers,
      defaultBranch,
    });
    const normalized = normalizeSupplementalPrChecks(supplemental);
    const pendingMetadata = normalized.pendingMetadata;
    const repositoryPlan = createPlan(snapshot.root, {
      canonicalTypescript: true,
      dependencyReference: {
        root: dependencyRoot,
        readonlyProof: dependencyProof,
        lockSha256: installedLockSha256,
      },
    });
    const environmentIdentity = {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      nodeExecutableSha256: hash(readFileSync(process.execPath)),
      dependency,
      dependencyProof,
      installedLockSha256,
      codeqlToolchain,
      tools,
      networkBoundaryProof,
      repositoryIsolation,
      capacity,
      sourceSha256: snapshot.candidate.sourceSha256,
    };
    const executionEnvironmentSha256 = hash(json(environmentIdentity));
    const environmentManifest = path.join(
      snapshot.scratchRoot,
      'native-environment-manifest.json'
    );
    writeFileSync(environmentManifest, json(environmentIdentity), {
      flag: 'wx',
    });
    const binding = createStagedValidation({
      runId: `native-${Date.now()}`,
      candidate: snapshot.candidate,
      executionEnvironmentSha256,
      capacity,
      repositoryPlan,
      codeqlPlan,
      buildBrowserPlan,
      prChecks: [...normalized.prChecks, ...blockers],
    });
    let preserveTemporary = false;
    const verifySource = async () => {
      verifySourceSnapshot(snapshot);
      verifySourceSnapshot(supplementalSnapshot, { derivedOutputs });
      if (networkBoundaryProof.isolated) {
        if (typeof verifyNetworkBoundary === 'function') {
          const fresh = validateNativeBoundaryProof(
            await verifyNetworkBoundary(proofContext),
            snapshot.candidate
          );
          if (fresh.rulesSha256 !== networkBoundaryProof.rulesSha256)
            throw new Error('Frozen browser boundary rules changed');
        } else if (!nativeNetworkBoundary().isolated)
          throw new Error('Browser network boundary changed');
      }
      if (dockerFixtureProof) {
        const fresh = await verifyDockerFixture(proofContext);
        if (
          fresh.verified !== true ||
          fresh.daemonId !== dockerFixtureProof.daemonId ||
          fresh.endpoint !== dockerFixtureProof.endpoint ||
          fresh.namespaceId !== dockerFixtureProof.namespaceId ||
          fresh.sourceSha256 !== snapshot.candidate.sourceSha256 ||
          fresh.daemonVerified !== true ||
          fresh.scratchBindPathsVerified !== true ||
          fresh.loopbackReachabilityVerified !== true ||
          !/^[a-f0-9]{64}$/.test(fresh.evidenceSha256 ?? '')
        )
          throw new Error('Private Docker fixture proof changed');
      }
      if (gitHistoryProof) {
        const fresh = await verifyGitHistory({
          ...proofContext,
          localTagRefsSha256: tools.git.localTagRefsSha256,
        });
        if (
          fresh?.verified !== true ||
          fresh.completeClosure !== true ||
          fresh.sourceSha256 !== snapshot.candidate.sourceSha256 ||
          fresh.commit !== snapshot.candidate.commit ||
          fresh.localTagRefsSha256 !== gitHistoryProof.localTagRefsSha256 ||
          fresh.remoteTagRefsSha256 !== gitHistoryProof.remoteTagRefsSha256 ||
          fresh.remoteRefsSha256 !== gitHistoryProof.remoteRefsSha256 ||
          !/^[a-f0-9]{64}$/.test(fresh.evidenceSha256 ?? '')
        )
          throw new Error(
            'Authenticated Git history/tag closure proof changed'
          );
      }
    };
    const options = {
      signal,
      run: nativeRun,
      readFile: async (file) =>
        readFileSync(
          regular(
            snapshot.scratchRoot,
            path
              .relative(snapshot.scratchRoot, path.resolve(file))
              .split(path.sep)
              .join('/')
          ).absolute
        ),
      writeArtifact: async (artifact) => {
        if (
          !beneath(codeqlScratch, path.resolve(artifact.path)) ||
          !beneath(
            snapshot.scratchRoot,
            realpathSync(path.dirname(artifact.path))
          ) ||
          hash(artifact.contents) !== artifact.sha256
        )
          throw new Error('Unbound CodeQL artifact');
        writeFileSync(artifact.path, artifact.contents, { flag: 'wx' });
      },
      verifySource,
      networkBoundaryProof,
      ...(typeof withRepositoryIsolation === 'function'
        ? { withRepositoryIsolation }
        : {}),
      executeRepository: async (plan) => {
        if (
          !withRepositoryIsolation &&
          !repositoryIsolationReadiness(undefined).ready
        )
          throw new Error(
            'Repository loopback-only network boundary changed before native execution'
          );
        const receipts = [];
        const caseLedgers = [];
        const totals = await executePlan(plan, {
          stdout,
          stderr,
          inherited: env,
          signal,
          executor: async (command, execution) => {
            const receipt = await nativeRun({
              ...command,
              cwd: plan.root,
              env: execution.env,
            });
            receipts.push(receipt);
            let vitestReport;
            if (command.kind === 'vitest') {
              const file = command.args
                .find((arg) => arg.startsWith('--outputFile.json='))
                ?.slice('--outputFile.json='.length);
              if (!file)
                throw new Error('Native Vitest output file is not bound');
              const bytes = readFileSync(file);
              vitestReport = JSON.parse(bytes);
              const artifact = path.join(
                snapshot.scratchRoot,
                'native-vitest-report.json'
              );
              writeFileSync(artifact, bytes, { flag: 'wx' });
              receipt.nativeReport = { file: artifact, sha256: hash(bytes) };
            }
            const ledger = repositoryNativeCases(command, receipt, {
              vitestReport,
            });
            if (ledger) caseLedgers.push(ledger);
            return `${receipt.stdout}\n${receipt.stderr}`;
          },
        });
        const counts = [...totals.values()];
        const actual = caseLedgers.reduce(
          (sum, ledger) => ({
            passed: sum.passed + ledger.counts.passed,
            failed: sum.failed + ledger.counts.failed,
            skipped: sum.skipped + ledger.counts.skipped,
          }),
          { passed: 0, failed: 0, skipped: 0 }
        );
        if (
          actual.passed !==
            counts.reduce((sum, count) => sum + count.active, 0) ||
          actual.passed + actual.skipped !==
            counts.reduce((sum, count) => sum + count.total, 0)
        )
          throw new Error(
            'Original repository totals do not close against native case ledgers'
          );
        return {
          status: 'passed',
          cases: actual,
          caseLedgers,
          totals: Object.fromEntries(totals),
          commands: receipts,
          resultReuse: false,
        };
      },
      startServer: async (descriptor) =>
        startCommand(descriptor, {
          root: descriptor.cwd,
          env: descriptor.env,
          stdout,
          stderr,
          signal,
          logDirectory: logs,
          stdoutLog: path.join(logs, 'browser-server.stdout.log'),
          stderrLog: path.join(logs, 'browser-server.stderr.log'),
        }),
      waitForReady: async (url, { service }) =>
        service.waitForReady(
          async () => {
            try {
              const response = await fetch(url, {
                signal: AbortSignal.timeout(2000),
                redirect: 'error',
              });
              return response.status === 200;
            } catch {
              return false;
            }
          },
          { timeoutMs: 30_000, pollMs: 100 }
        ),
    };
    const localBlocked = [...normalized.prChecks, ...blockers].filter(
      (check) => check.required && check.status === 'prerequisite-blocked'
    );
    const report = {
      schema: 1,
      status: localBlocked.length ? 'prerequisite-blocked' : 'ready',
      candidate: snapshot.candidate,
      capacity,
      executionEnvironmentSha256,
      environmentManifest: {
        file: environmentManifest,
        sha256: executionEnvironmentSha256,
      },
      sourceManifest: {
        file: path.join(snapshot.scratchRoot, 'source-manifest.json'),
        sha256: snapshot.candidate.sourceSha256,
      },
      dependencyProof,
      networkBoundaryProof,
      repositoryIsolation,
      blockedRequired: localBlocked,
      pendingMetadata,
      delegatedCoverageReferences: normalized.delegatedCoverageReferences,
      derivedCoverageReferences: normalized.derivedCoverageReferences ?? [],
      artifacts: snapshot.scratchRoot,
      stages: ['repository', 'codeql', 'build', 'browser'],
      actualTestsExecuted: 0,
      actualBuilds: 0,
      resultReuse: false,
    };
    writeFileSync(
      path.join(snapshot.scratchRoot, 'native-context-report.json'),
      json(report),
      { flag: 'wx' }
    );
    return {
      binding,
      options,
      report,
      snapshot,
      pendingMetadata,
      derivedArtifacts,
      cleanup: async (error) => {
        preserveTemporary ||= error?.preserveTemporary === true;
        await verifySource();
        if (!preserveTemporary) disposeSourceSnapshot(snapshot);
      },
    };
  } catch (error) {
    error.scratchRoot = snapshot.scratchRoot;
    error.preserveTemporary = true;
    try {
      verifySourceSnapshot(snapshot);
    } catch (guard) {
      error.sourceGuardFailure = guard.message;
    }
    throw error;
  }
}

export function disposeSourceSnapshot(snapshot) {
  const root = path.resolve(snapshot.scratchRoot);
  if (
    path.dirname(root) !== snapshot.scratchParent ||
    !path.basename(root).startsWith(prefix) ||
    lstatSync(root).isSymbolicLink() ||
    !beneath(snapshot.scratchParent, realpathSync(root))
  )
    throw new Error('Refusing unsafe native scratch cleanup');
  rmSync(root, { recursive: true, force: true });
}
