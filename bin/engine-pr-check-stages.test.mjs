// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acceptSupplementalNativeCases,
  createSupplementalPrStages,
  normalizeSupplementalPrChecks,
  supplementalApplicability,
  supplementalCompletion,
} from '../tools/validation-engine/runtime/pr-check-stages.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const candidate = {
  commit: 'a'.repeat(40),
  tree: 'b'.repeat(40),
  sourceSha256: 'c'.repeat(64),
};
const binary = (version = '1.0.0') => ({
  verified: true,
  version,
  executableSha256: 'd'.repeat(64),
});

async function fixture(t) {
  const scratchRoot = await mkdtemp(
    path.join(os.tmpdir(), 'seerrng-pr-stages-test-')
  );
  t.after(() => rm(scratchRoot, { recursive: true, force: true }));
  const root = path.join(scratchRoot, 'source');
  const fixtureRoot = path.join(scratchRoot, 'fixtures');
  await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
  await mkdir(path.join(root, 'gen-docs'));
  await mkdir(fixtureRoot);
  for (const workflow of [
    'ci.yml',
    'test-docs.yml',
    'lint-helm-charts.yml',
    'docs-link-check.yml',
    'pr-validation.yml',
    'conflict_labeler.yml',
  ])
    await writeFile(
      path.join(root, '.github', 'workflows', workflow),
      `workflow:${workflow}`
    );
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: {
        'security:council':
          'node workflow && node bin/run-bash.mjs scripts/check-council-browser-boundaries.sh && node bin/run-bash.mjs scripts/check-council-server-boundaries.sh',
      },
    })
  );
  await writeFile(
    path.join(root, 'gen-docs', 'package.json'),
    JSON.stringify({
      scripts: {
        'test:security': 'node --test scripts/image-size-security.test.mjs',
        'gen-api-docs': 'docusaurus gen-api-docs all',
        build: 'docusaurus build',
      },
    })
  );
  await writeFile(path.join(root, 'gen-docs', 'pnpm-lock.yaml'), 'locked docs');
  return { root, scratchRoot, fixtureRoot, candidate, configuredWorkers: 4 };
}

const allTools = () => ({
  bash: binary(),
  perl: binary(),
  find: binary(),
  git: { ...binary(), completeHistory: true, completeTags: true },
  dotnet9: { ...binary('9.0.318'), executable: '/owned/dotnet9/dotnet' },
  python3: binary('3.11.9'),
  docker: {
    ...binary(),
    daemonVerified: true,
    scratchBindPathsVerified: true,
    loopbackReachabilityVerified: true,
  },
  ct: binary(),
  helm: binary(),
  helmDocs: binary('1.14.2'),
  yamllint: binary(),
  yamale: binary(),
  lychee: binary(),
  docsDependencies: { verified: true, lockSha256: hash('locked docs') },
});
const byId = (plan, id) => plan.checks.find((check) => check.id === id);
const receipt = (id, state = 'executed-pass') => ({
  id,
  state,
  sourceSha256: candidate.sourceSha256,
  evidenceSha256: 'e'.repeat(64),
});

test('full scope includes docs/charts/links independently of native PR path triggers', () => {
  const result = supplementalApplicability({
    scope: 'full',
    changedFiles: ['bin/engine.mjs'],
    baseBranch: 'main',
  });
  for (const check of Object.values(result)) {
    assert.equal(check.selected, true);
    assert.equal(check.nativeApplicable, false);
  }
});

test('native PR applicability distinguishes unknown, excluded branch, path inclusion and workflow changes', () => {
  assert.equal(supplementalApplicability({ scope: 'pr' }).docs.selected, null);
  assert.equal(
    supplementalApplicability({
      scope: 'pr',
      changedFiles: ['docs/index.md'],
      baseBranch: 'main',
    }).docs.selected,
    true
  );
  assert.equal(
    supplementalApplicability({
      scope: 'pr',
      changedFiles: ['docs/index.md'],
      baseBranch: 'develop',
    }).docs.selected,
    false
  );
  const changes = supplementalApplicability({
    scope: 'pr',
    changedFiles: ['.github/workflows/docs-link-check.yml'],
    baseBranch: 'main',
  });
  assert.equal(changes.links.selected, true);
  assert.equal(changes.docs.selected, false);
  assert.throws(
    () => supplementalApplicability({ changedFiles: ['../escape'] }),
    /repository-relative/
  );
});

test('missing prerequisites and PR metadata remain blocked/pending, not passed', async (t) => {
  const plan = await createSupplementalPrStages(await fixture(t));
  assert.equal(
    byId(plan, 'council-browser-boundaries').state,
    'prerequisite-blocked'
  );
  assert(
    byId(plan, 'council-browser-boundaries').missingPrerequisites.includes(
      'perl'
    )
  );
  assert.equal(
    byId(plan, 'jellyfin-plugin-publish').state,
    'prerequisite-blocked'
  );
  assert.equal(
    byId(plan, 'docs-production-build').state,
    'prerequisite-blocked'
  );
  assert.equal(
    byId(plan, 'release-note-contract').state,
    'GitHub-native-pending'
  );
  assert.equal(supplementalCompletion(plan, []).status, 'incomplete');
});

test('native supplementary commands preserve .NET9, pinned smoke, required build order and advisory link policy', async (t) => {
  const plan = await createSupplementalPrStages({
    ...(await fixture(t)),
    tools: allTools(),
  });
  assert.equal(
    byId(plan, 'jellyfin-plugin-publish').command,
    '/owned/dotnet9/dotnet'
  );
  assert(byId(plan, 'jellyfin-plugin-publish').args.includes('Release'));
  assert.equal(byId(plan, 'jellyfin-plugin-native-smoke').state, 'ready');
  assert(
    byId(plan, 'jellyfin-plugin-native-smoke').fixtureImage.includes('@sha256:')
  );
  assert.deepEqual(byId(plan, 'docs-production-build').dependsOn, [
    'docs-api-generate',
  ]);
  assert.deepEqual(byId(plan, 'docs-api-generate').dependsOn, [
    'docs-image-parser-security',
  ]);
  assert(byId(plan, 'charts-native-lint').args.includes('--all'));
  const links = byId(plan, 'docs-links-advisory');
  assert.equal(links.required, false);
  assert(links.args.includes('200..204,300..304,307,308,404,429,999'));
  assert.equal(links.env.GITHUB_TOKEN, '');
  assert.equal(
    byId(plan, 'council-native-tooling').state,
    'delegated-to-native-owner'
  );
});

test('wrong SDK, helm-docs version, lockfile or daemon paths block their check', async (t) => {
  const tools = allTools();
  tools.dotnet9.version = '10.0.100';
  tools.helmDocs.version = '1.14.3';
  tools.docsDependencies.lockSha256 = 'f'.repeat(64);
  tools.docker.scratchBindPathsVerified = false;
  const plan = await createSupplementalPrStages({
    ...(await fixture(t)),
    tools,
  });
  for (const id of [
    'jellyfin-plugin-publish',
    'charts-generated-docs',
    'docs-production-build',
    'jellyfin-plugin-native-smoke',
  ])
    assert.equal(byId(plan, id).state, 'prerequisite-blocked');
});

test('PR release body requires exact source/head/base and full Git closure; no opt-out is generated', async (t) => {
  const options = await fixture(t);
  const bodyFile = path.join(options.fixtureRoot, 'reviewed-pr-body.md');
  const body = 'A reviewed human body';
  await writeFile(bodyFile, body);
  const metadata = {
    source: 'proposed-reviewed',
    head: candidate.commit,
    headTree: candidate.tree,
    headSourceSha256: candidate.sourceSha256,
    base: 'f'.repeat(40),
    bodyFile,
    bodySha256: hash(body),
    authorType: 'User',
  };
  const plan = await createSupplementalPrStages({
    ...options,
    metadata,
    tools: allTools(),
  });
  assert.equal(byId(plan, 'release-note-contract').state, 'ready');
  assert(byId(plan, 'release-note-contract').args.includes(bodyFile));
  const stale = await createSupplementalPrStages({
    ...options,
    metadata: { ...metadata, headSourceSha256: 'f'.repeat(64) },
    tools: allTools(),
  });
  assert.equal(
    byId(stale, 'release-note-contract').state,
    'GitHub-native-pending'
  );
  await writeFile(bodyFile, 'changed');
  await assert.rejects(
    createSupplementalPrStages({ ...options, metadata, tools: allTools() }),
    /body bytes changed/
  );
});

test('chart PR target is the repository default branch, not an inferred target or every chart', async (t) => {
  const options = {
    ...(await fixture(t)),
    tools: allTools(),
    scope: 'pr',
    changedFiles: ['charts/example/Chart.yaml'],
    baseBranch: 'main',
  };
  const noRef = await createSupplementalPrStages(options);
  assert.equal(byId(noRef, 'charts-native-lint').state, 'prerequisite-blocked');
  const plan = await createSupplementalPrStages({
    ...options,
    defaultBranch: 'main',
  });
  assert.deepEqual(byId(plan, 'charts-list-changed').args, [
    'list-changed',
    '--target-branch',
    'main',
  ]);
  assert(!byId(plan, 'charts-native-lint').args.includes('--all'));
  assert.equal(
    byId(plan, 'charts-native-lint').nativeCondition,
    'charts-list-changed:nonempty-native-output'
  );
});

test('completion cannot accept duplicates, foreign evidence, local GitHub metadata, advisory required gates or unproved fixture cleanup', async (t) => {
  const plan = await createSupplementalPrStages({
    ...(await fixture(t)),
    tools: allTools(),
  });
  assert.throws(
    () =>
      supplementalCompletion(plan, [
        receipt('council-workflow-boundaries'),
        receipt('council-workflow-boundaries'),
      ]),
    /Duplicate/
  );
  assert.throws(
    () =>
      supplementalCompletion(plan, [
        {
          ...receipt('council-workflow-boundaries'),
          sourceSha256: 'f'.repeat(64),
        },
      ]),
    /Unbound/
  );
  assert.throws(
    () => supplementalCompletion(plan, [receipt('github-pr-title')]),
    /cannot be passed locally/
  );
  assert.throws(
    () =>
      supplementalCompletion(plan, [
        receipt('council-workflow-boundaries', 'advisory'),
      ]),
    /cannot become advisory/
  );
  assert.throws(
    () =>
      supplementalCompletion(plan, [receipt('jellyfin-plugin-native-smoke')]),
    /fixture cleanup/
  );
  const links = supplementalCompletion(plan, [
    receipt('docs-links-advisory', 'executed-fail'),
  ]);
  assert.equal(links.status, 'incomplete');
  assert.equal(
    links.checks.find((check) => check.id === 'docs-links-advisory').outcome,
    'advisory'
  );
});

test('reviewed workflow hashes and source-owned package scripts detect recipe drift', async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    createSupplementalPrStages({ ...options, reviewedWorkflowSha256: {} }),
    /workflow identity changed/
  );
  await writeFile(
    path.join(options.root, 'gen-docs', 'package.json'),
    JSON.stringify({ scripts: { build: 'true' } })
  );
  await assert.rejects(createSupplementalPrStages(options), /binding changed/);
});

test('normalization preserves ordered native groups, root stage contract and separate pending metadata', async (t) => {
  const plan = await createSupplementalPrStages({
    ...(await fixture(t)),
    tools: allTools(),
  });
  const normalized = normalizeSupplementalPrChecks(plan);
  const docs = normalized.prChecks.find(
    (check) => check.id === 'docs-production'
  );
  assert.equal(docs.stage, 'build');
  assert.equal(docs.status, 'ready');
  assert.deepEqual(
    docs.commands.map((command) => command.id),
    ['docs-api-generate', 'docs-production-build']
  );
  const jellyfin = normalized.prChecks.find(
    (check) => check.id === 'jellyfin-plugin'
  );
  assert.deepEqual(
    jellyfin.commands.map((command) => command.id),
    ['jellyfin-plugin-publish', 'jellyfin-plugin-native-smoke']
  );
  assert(
    normalized.pendingMetadata.some(
      (check) => check.id === 'release-note-contract'
    )
  );
  assert(
    normalized.delegatedCoverageReferences.some(
      (check) => check.id === 'council-native-tooling'
    )
  );
  assert(
    normalized.prChecks.every((check) =>
      ['repository', 'codeql', 'build', 'browser'].includes(check.stage)
    )
  );
});

test('supplemental cases require existing hierarchy parser and complete active source-bound native bytes', () => {
  const descriptor = {
    id: 'docs-image-parser-security',
    candidate,
    caseLedger: { file: 'gen-docs/scripts/image-size-security.test.mjs' },
  };
  assert.throws(
    () =>
      acceptSupplementalNativeCases(descriptor, { stdout: 'TAP version 13\n' }),
    /hierarchy parser/
  );
  assert.throws(
    () =>
      acceptSupplementalNativeCases(
        descriptor,
        { stdout: 'no cases' },
        { readNodeTapHierarchy() {} }
      ),
    /header is absent/
  );
  const parser = (bytes, file) => {
    assert.equal(bytes.toString(), 'TAP version 13\n');
    assert.equal(file, descriptor.caseLedger.file);
    return {
      complete: true,
      counts: { passed: 1, failed: 0, skipped: 0 },
      cases: [{ caseId: 'native-id' }],
      issues: [],
    };
  };
  const result = acceptSupplementalNativeCases(
    descriptor,
    { stdout: '> pnpm native command\nTAP version 13\n' },
    { readNodeTapHierarchy: parser }
  );
  assert.deepEqual(result.caseIds, ['native-id']);
  assert.equal(result.sourceSha256, candidate.sourceSha256);
  assert.throws(
    () =>
      acceptSupplementalNativeCases(
        descriptor,
        { stdout: 'TAP version 13\n' },
        {
          readNodeTapHierarchy: () => ({
            complete: false,
            counts: { passed: 0, failed: 0 },
            issues: ['truncated'],
          }),
        }
      ),
    /Incomplete/
  );
});
