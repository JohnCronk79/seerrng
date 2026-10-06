// Copyright (c) snapetech and SeerrNG contributors.
// Native stage bindings for the existing validation coordinator, not a runner.
import { createHash } from 'node:crypto';
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const beneath = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
};
const identity = (candidate) => {
  if (
    !candidate ||
    typeof candidate.repository !== 'string' ||
    !candidate.repository ||
    !/^[a-f0-9]{40}$/.test(candidate.commit ?? '') ||
    !/^[a-f0-9]{40}$/.test(candidate.tree ?? '') ||
    !/^[a-f0-9]{64}$/.test(candidate.lockSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(candidate.sourceSha256 ?? '')
  ) {
    throw new Error(
      'Build/browser stages require a complete frozen candidate identity'
    );
  }
  return Object.freeze({
    repository: candidate.repository,
    commit: candidate.commit,
    tree: candidate.tree,
    lockSha256: candidate.lockSha256,
    sourceSha256: candidate.sourceSha256,
  });
};
const sameIdentity = (left, right) =>
  JSON.stringify(identity(left)) === JSON.stringify(identity(right));

const assertNativeCompletion = (receipt, id, allowTestFailure = false) => {
  const nativeFailure =
    allowTestFailure &&
    receipt?.status === 'failed' &&
    Number.isSafeInteger(receipt.exitCode) &&
    receipt.exitCode > 0;
  if (
    !receipt ||
    (!nativeFailure &&
      (receipt.status !== 'passed' || receipt.exitCode !== 0)) ||
    receipt.lifecycle?.completed !== true ||
    receipt.lifecycle?.cleanupVerified !== true ||
    receipt.aborted !== false ||
    receipt.timedOut !== false ||
    receipt.signal !== null ||
    receipt.spawnError ||
    !Number.isFinite(receipt.wallMs) ||
    receipt.wallMs < 0
  ) {
    throw Object.assign(
      new Error(`Incomplete or unsuccessful native command receipt: ${id}`),
      { receipt }
    );
  }
  return receipt;
};

// Inherited application/provider credentials are intentionally not forwarded.
// Fixture external configuration is exported by the repository's own script.
export function buildBrowserEnvironment(inherited = {}, fixtureRoot, port) {
  const allowed = new Set([
    'PATH',
    'Path',
    'HOME',
    'USERPROFILE',
    'SYSTEMROOT',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'ComSpec',
    'PATHEXT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'TERM',
    'DISPLAY',
    'XAUTHORITY',
    'CYPRESS_CACHE_FOLDER',
    'CYPRESS_RUN_BINARY',
    'PNPM_HOME',
  ]);
  const env = Object.fromEntries(
    Object.entries(inherited).filter(
      ([key, value]) => allowed.has(key) && typeof value === 'string'
    )
  );
  return {
    ...env,
    CONFIG_DIRECTORY: fixtureRoot,
    E2E_TESTS: 'true',
    WITH_MIGRATIONS: 'true',
    RUN_LIVE_AUTH_AUDIT: 'false',
    SEED_DATABASE: 'false',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: String(port),
    CYPRESS_RECORD_KEY: '',
    CYPRESS_RUN_LIVE_AUTH_AUDIT: 'false',
    CYPRESS_LIVE_QA_EMAIL: '',
    CYPRESS_LIVE_QA_PASSWORD: '',
  };
}

export async function discoverCypressSpecs(root) {
  const specs = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Cypress discovery refuses symlinks: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && /\.cy\.(?:js|jsx|ts|tsx)$/.test(entry.name)) {
        specs.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  }
  await visit(path.join(root, 'cypress', 'e2e'));
  if (!specs.length) throw new Error('Cypress discovery selected no specs');
  return Object.freeze(specs.sort());
}

export async function createBuildBrowserStages(options) {
  const {
    root,
    authoritativeRoot,
    scratchRoot,
    fixtureRoot,
    candidate,
    capacity,
    inheritedEnv = {},
    port = 5056,
  } = options;
  const source = identity(candidate);
  if (
    !Number.isSafeInteger(capacity?.configuredWorkers) ||
    capacity.configuredWorkers < 1 ||
    capacity.configuredWorkers > 256
  ) {
    throw new Error('Build/browser stages require a sealed worker budget');
  }
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid disposable server port');
  const roots = await Promise.all(
    [root, authoritativeRoot, scratchRoot].map((value) => realpath(value))
  );
  const [copy, authoritative, scratch] = roots;
  const fixture = path.resolve(fixtureRoot);
  if (
    copy === authoritative ||
    beneath(authoritative, copy) ||
    beneath(copy, authoritative) ||
    !beneath(scratch, copy) ||
    !beneath(scratch, fixture) ||
    beneath(copy, fixture) ||
    beneath(fixture, copy)
  ) {
    throw new Error(
      'Compile and Cypress require an owned scratch source copy and separate disposable fixtures'
    );
  }
  if (
    (await lstat(root)).isSymbolicLink() ||
    (await lstat(scratchRoot)).isSymbolicLink()
  ) {
    throw new Error('Build/browser source roots must not be symlinks');
  }
  // Creation cannot overwrite an earlier fixture/database or pass receipt.
  await mkdir(fixture, { recursive: false });
  const resolvedFixture = await realpath(fixture);
  if (!beneath(scratch, resolvedFixture))
    throw new Error('Fixture escaped the owned scratch boundary');
  const specs = await discoverCypressSpecs(copy);
  const env = buildBrowserEnvironment(inheritedEnv, resolvedFixture, port);
  const command = (id, args, commandEnv = env) =>
    Object.freeze({
      id,
      command: 'pnpm',
      args: Object.freeze(args),
      cwd: copy,
      env: Object.freeze(commandEnv),
      kind: 'check',
      slots: capacity.configuredWorkers,
    });
  const baseUrl = `http://127.0.0.1:${port}`;
  const wrapper = path.join(
    copy,
    'cypress',
    '.engine-native-results.config.ts'
  );
  const report = path.join(resolvedFixture, 'native-cypress-results.json');
  // Fixture data and generated output are deliberately outside the source pin.
  return Object.freeze({
    candidate: source,
    root: copy,
    scratchRoot: scratch,
    fixtureRoot: resolvedFixture,
    specs,
    baseUrl,
    wrapper,
    report,
    env: Object.freeze(env),
    configuredWorkers: capacity.configuredWorkers,
    build: Object.freeze([
      command('production-build', ['build'], { ...env, E2E_TESTS: 'false' }),
      command('production-bundle-check', ['bundle:check'], {
        ...env,
        E2E_TESTS: 'false',
      }),
    ]),
    // Reuse this run's successful production compile, including the same seed
    // script, entities, and migrations. Production selects matching JS classes
    // and the owned disk DB; test would select an in-memory database.
    prepare: Object.freeze({
      id: 'cypress-fixture-prepare',
      command: process.execPath,
      args: Object.freeze(['dist/scripts/prepareTestDb.js']),
      cwd: copy,
      env: Object.freeze({
        ...env,
        NODE_ENV: 'production',
        WITH_MIGRATIONS: 'true',
      }),
      kind: 'check',
      slots: capacity.configuredWorkers,
    }),
    exportConfig: Object.freeze({
      id: 'cypress-fixture-external-config',
      command: process.execPath,
      args: Object.freeze([
        'scripts/export-external-config.mjs',
        path.join(resolvedFixture, 'settings.json'),
      ]),
      cwd: copy,
      env: Object.freeze(env),
      kind: 'prerequisite',
      slots: 1,
    }),
    server: command('cypress-disposable-server', ['start']),
    browser: command('native-cypress', [
      'exec',
      'cypress',
      'run',
      '--project',
      copy,
      '--config-file',
      wrapper,
      '--config',
      `baseUrl=${baseUrl},screenshotsFolder=${path.join(resolvedFixture, 'screenshots')},videosFolder=${path.join(resolvedFixture, 'videos')},downloadsFolder=${path.join(resolvedFixture, 'downloads')}`,
      '--spec',
      specs.join(','),
      '--record',
      'false',
    ]),
  });
}

export function nativeCypressConfigSource(plan) {
  const original = path.join(plan.root, 'cypress.config.ts');
  const envelope = JSON.stringify({
    schema: 1,
    candidate: plan.candidate,
    specs: plan.specs,
  });
  return (
    `// Generated only in the engine-owned source copy; original assertions/config remain unchanged.\n` +
    `import original from ${JSON.stringify(original)};\nimport { writeFileSync } from 'node:fs';\n` +
    `const source = ${envelope};\nexport default { ...original, e2e: { ...original.e2e,\n` +
    `async setupNodeEvents(on, config) {\n` +
    `const afterRun = [];\nconst preserveOn = (event, handler) => {\n` +
    `if (event === 'after:run') afterRun.push(handler); else on(event, handler);\n};\n` +
    `const configured = await original.e2e?.setupNodeEvents?.(preserveOn, config);\n` +
    `on('after:run', async (native) => {\n` +
    `for (const handler of afterRun) await handler(native);\n` +
    `writeFileSync(${JSON.stringify(plan.report)}, JSON.stringify({ ...source, native }));\n});\n` +
    `return configured ?? config;\n} } };\n`
  );
}

const count = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid native Cypress ${name}`);
  return value;
};

export function acceptNativeCypressResults(
  envelope,
  plan,
  { allowNoActiveTests = false } = {}
) {
  if (typeof allowNoActiveTests !== 'boolean')
    throw new Error('Invalid native Cypress active-test policy');
  if (
    envelope?.schema !== 1 ||
    !sameIdentity(envelope.candidate, plan.candidate) ||
    JSON.stringify(envelope.specs) !== JSON.stringify(plan.specs)
  )
    throw new Error(
      'Cypress result is not bound to this source/spec inventory'
    );
  const native = envelope.native;
  if (!native || native.status === 'failed' || !Array.isArray(native.runs))
    throw new Error('Cypress did not produce a complete native run');
  const seen = new Set();
  const cases = [];
  const totals = { passed: 0, failed: 0, pending: 0, skipped: 0 };
  for (const run of native.runs) {
    const spec = run?.spec?.relative?.replaceAll('\\', '/');
    if (!plan.specs.includes(spec) || seen.has(spec))
      throw new Error(`Unexpected or duplicate Cypress spec: ${spec}`);
    seen.add(spec);
    if (path.resolve(run.spec.absolute) !== path.resolve(plan.root, spec))
      throw new Error(`Cypress spec escaped the source copy: ${spec}`);
    if (run.error || !Array.isArray(run.tests))
      throw new Error(`Cypress infrastructure failure in ${spec}`);
    const counts = { passed: 0, failed: 0, pending: 0, skipped: 0 };
    for (const [ordinal, test] of run.tests.entries()) {
      if (
        !Object.hasOwn(counts, test.state) ||
        !Array.isArray(test.title) ||
        !test.title.length ||
        !test.title.every((part) => typeof part === 'string' && part) ||
        !Array.isArray(test.attempts)
      )
        throw new Error(`Incomplete native Cypress case in ${spec}`);
      if (['passed', 'failed'].includes(test.state) && !test.attempts.length)
        throw new Error(`Active Cypress case has no attempt in ${spec}`);
      const attempts = test.attempts.map((attempt) => {
        if (!Object.hasOwn(counts, attempt.state))
          throw new Error(`Unknown native Cypress attempt state in ${spec}`);
        return { state: attempt.state };
      });
      if (
        attempts.length &&
        ['passed', 'failed'].includes(test.state) &&
        attempts.at(-1).state !== test.state
      ) {
        throw new Error(
          `Native Cypress final attempt disagrees with case state in ${spec}`
        );
      }
      counts[test.state] += 1;
      cases.push({
        id: `${spec}:${ordinal}:${JSON.stringify(test.title)}`,
        spec,
        title: [...test.title],
        state: test.state,
        attempts,
        retries: Math.max(0, attempts.length - 1),
        durationMs: test.duration ?? null,
        displayError: test.displayError ?? null,
      });
    }
    for (const [state, field] of [
      ['passed', 'passes'],
      ['failed', 'failures'],
      ['pending', 'pending'],
      ['skipped', 'skipped'],
    ]) {
      if (count(run.stats?.[field], field) !== counts[state])
        throw new Error(`Native Cypress ${spec} ${field} count mismatch`);
      totals[state] += counts[state];
    }
    if (count(run.stats?.tests, 'tests') !== run.tests.length)
      throw new Error(`Native Cypress ${spec} test count mismatch`);
  }
  if (seen.size !== plan.specs.length)
    throw new Error('Cypress did not execute every discovered spec');
  for (const [state, field] of [
    ['passed', 'totalPassed'],
    ['failed', 'totalFailed'],
    ['pending', 'totalPending'],
    ['skipped', 'totalSkipped'],
  ]) {
    if (count(native[field], field) !== totals[state])
      throw new Error(`Native Cypress ${field} count mismatch`);
  }
  if (
    count(native.totalTests, 'totalTests') !== cases.length ||
    (!allowNoActiveTests && totals.passed + totals.failed < 1)
  )
    throw new Error('Cypress executed no active test cases');
  return {
    status: totals.failed ? 'failed' : 'passed',
    cases,
    counts: totals,
    specs: [...seen],
    skipReviewRequired: totals.pending + totals.skipped > 0,
    durationMs: native.totalDuration ?? null,
    browser: native.browserName ?? null,
    cypressVersion: native.cypressVersion ?? null,
    evidenceSha256: sha256(JSON.stringify(envelope)),
    resultReuse: false,
  };
}

export async function executeProductionBuild(
  plan,
  { run, signal, verifySource }
) {
  if (typeof run !== 'function' || typeof verifySource !== 'function')
    throw new Error('Native executor/source verification are required');
  signal?.throwIfAborted();
  await verifySource(plan.candidate);
  const commands = [];
  for (const descriptor of plan.build) {
    signal?.throwIfAborted();
    const receipt = await run(descriptor, { signal });
    assertNativeCompletion(receipt, descriptor.id);
    commands.push(receipt);
  }
  signal?.throwIfAborted();
  await Promise.all(
    ['.next/BUILD_ID', 'dist/index.js'].map((file) =>
      access(path.join(plan.root, file))
    )
  );
  await verifySource(plan.candidate);
  return Object.freeze({
    status: 'passed',
    candidate: plan.candidate,
    root: plan.root,
    compileInvocations: 1,
    resultReuse: false,
    commands,
  });
}

export async function executeCypressStage(
  plan,
  buildReceipt,
  { run, startServer, waitForReady, verifySource, networkBoundaryProof, signal }
) {
  if (
    buildReceipt?.status !== 'passed' ||
    buildReceipt.compileInvocations !== 1 ||
    buildReceipt.root !== plan.root ||
    !sameIdentity(buildReceipt.candidate, plan.candidate)
  )
    throw new Error(
      'Cypress requires the successful same-candidate production build'
    );
  if (
    typeof run !== 'function' ||
    typeof startServer !== 'function' ||
    typeof waitForReady !== 'function' ||
    typeof verifySource !== 'function' ||
    networkBoundaryProof?.isolated !== true ||
    networkBoundaryProof?.deniesPrivateProviders !== true
  ) {
    throw new Error(
      'Cypress requires managed lifecycle, source verification, and an isolated provider-network boundary'
    );
  }
  signal?.throwIfAborted();
  await verifySource(plan.candidate);
  let service;
  let primaryError;
  let result;
  let wrapperCreated = false;
  try {
    assertNativeCompletion(
      await run(plan.prepare, { signal }),
      plan.prepare.id
    );
    signal?.throwIfAborted();
    const exported = await run(plan.exportConfig, { signal });
    assertNativeCompletion(exported, plan.exportConfig.id);
    signal?.throwIfAborted();
    const external = JSON.parse(exported.stdout ?? exported.output ?? '');
    if (!external || typeof external !== 'object' || Array.isArray(external))
      throw new Error('Fixture external configuration export is invalid');
    const env = {
      ...plan.env,
      SEERR_EXTERNAL_CONFIG: JSON.stringify(external),
    };
    await writeFile(plan.wrapper, nativeCypressConfigSource(plan), {
      flag: 'wx',
    });
    wrapperCreated = true;
    service = await startServer({ ...plan.server, env }, { signal });
    if (typeof service?.stop !== 'function')
      throw new Error('Managed Cypress server returned no cleanup handle');
    await waitForReady(plan.baseUrl, { signal, service });
    signal?.throwIfAborted();
    let nativeExitError;
    let nativeReceipt;
    try {
      nativeReceipt = await run({ ...plan.browser, env }, { signal });
    } catch (error) {
      nativeExitError = error;
      nativeReceipt = error.receipt;
    }
    assertNativeCompletion(nativeReceipt, plan.browser.id, true);
    signal?.throwIfAborted();
    const envelope = JSON.parse(await readFile(plan.report, 'utf8'));
    result = acceptNativeCypressResults(envelope, plan);
    if (result.status === 'passed') {
      assertNativeCompletion(nativeReceipt, plan.browser.id);
      if (nativeExitError) throw nativeExitError;
    }
    result.nativeCommandReceipt = nativeReceipt;
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = [];
  try {
    if (service?.stop) await service.stop();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    if (wrapperCreated) await rm(plan.wrapper);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await verifySource(plan.candidate);
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length)
    throw new AggregateError(
      [...(primaryError ? [primaryError] : []), ...cleanupErrors],
      'Cypress lifecycle cleanup did not complete'
    );
  if (primaryError) throw primaryError;
  return {
    ...result,
    candidate: plan.candidate,
    reusedCompile: true,
    compileInvocations: 0,
    configuredWorkers: plan.configuredWorkers,
  };
}
