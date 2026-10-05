// Copyright (c) snapetech and SeerrNG contributors.
import * as yaml from 'js-yaml';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readWorkflow = (name) => {
  const text = readFileSync(
    path.join(root, '.github/workflows', `${name}.yml`),
    'utf8'
  ).replaceAll('\r\n', '\n');
  return { text, workflow: yaml.load(text) };
};

const ci = readWorkflow('ci');
const nativeJobs = [
  'jellyfin-plugin',
  'release-notes',
  'i18n',
  'test',
  'unit-test',
];
const reusableJobs = {
  codeql: 'codeql.yml',
  cypress: 'cypress.yml',
  'test-docs': 'test-docs.yml',
  'docs-links': 'docs-link-check.yml',
  helm: 'lint-helm-charts.yml',
};

test('the existing CI workflow invokes the engine plan and reconciler around native jobs', () => {
  const jobs = ci.workflow.jobs;
  assert.equal(
    jobs['engine-plan'].steps.at(-1).run,
    'node bin/run-local-validation.mjs --github-plan --json'
  );
  assert.equal(
    jobs['engine-reconcile'].steps.at(-1).run,
    'node bin/run-local-validation.mjs --github-reconcile --json'
  );
  assert.deepEqual(
    new Set(jobs['engine-reconcile'].needs),
    new Set(['engine-plan', ...nativeJobs, ...Object.keys(reusableJobs)])
  );
  assert.match(jobs['engine-reconcile'].if, /always\(\)/);
  assert.equal(
    jobs['engine-reconcile'].steps.at(-1).env
      .SEERRNG_ENGINE_EXPECTED_PLAN_SHA256,
    '${{ needs.engine-plan.outputs.planSha256 }}'
  );
});

test('GitHub keeps independent runners parallel after the engine plan', () => {
  const jobs = ci.workflow.jobs;
  for (const id of [...nativeJobs, ...Object.keys(reusableJobs)]) {
    assert.equal(jobs[id].needs, 'engine-plan', id);
  }
  for (const [id, file] of Object.entries(reusableJobs)) {
    assert.equal(jobs[id].uses, `./.github/workflows/${file}`, id);
    assert.match(jobs[id].if, /needs\.engine-plan\.outputs\./, id);
  }
  assert.equal(
    jobs.cypress.secrets.CYPRESS_RECORD_KEY,
    '${{ secrets.CYPRESS_RECORD_KEY }}'
  );
});

test('native workflow bodies are reused without duplicate PR or push launches', () => {
  for (const [id, file] of Object.entries(reusableJobs)) {
    const name = file.replace(/\.yml$/, '');
    const { text, workflow } = readWorkflow(name);
    assert.ok(Object.hasOwn(workflow.on, 'workflow_call'), id);
    assert.equal(workflow.on.pull_request, undefined, id);
    assert.equal(workflow.on.push, undefined, id);
    assert.doesNotMatch(
      workflow.concurrency.group,
      /github\.workflow/,
      `${id} must not cancel its caller through a shared concurrency group`
    );
    assert.match(
      text,
      /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/
    );
  }
});

test('hosted orchestration retains the original pinned native actions and commands', () => {
  const required = {
    codeql: [
      'github/codeql-action/init@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
      'github/codeql-action/analyze@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2',
      'queries: +security-and-quality',
      'snapetech/seerrng-codeql-models@0.0.15',
    ],
    cypress: [
      'cypress-io/github-action@789d836053c5ca389c2905fc0c9f2909da778c46',
      'build: pnpm cypress:build',
      'start: env E2E_TESTS=true pnpm start',
    ],
    'test-docs': ['pnpm test:security', 'pnpm gen-api-docs && pnpm build'],
    'docs-link-check': [
      'lycheeverse/lychee-action@e7477775783ea5526144ba13e8db5eec57747ce8',
      'fail: false',
    ],
    'lint-helm-charts': [
      'azure/setup-helm@9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310',
      'helm/chart-testing-action@6ec842c01de15ebb84c8627d2744a0c2f2755c9f',
      'docker://jnorwood/helm-docs:v1.14.2@sha256:7e562b49ab6b1dbc50c3da8f2dd6ffa8a5c6bba327b1c6335cc15ce29267979c',
    ],
  };
  for (const [name, fragments] of Object.entries(required)) {
    const text = readWorkflow(name).text;
    for (const fragment of fragments)
      assert.ok(text.includes(fragment), `${name}: ${fragment}`);
  }
});

test('trusted PR metadata workflows remain outside the untrusted execution DAG', () => {
  const called = Object.values(reusableJobs);
  assert.equal(called.includes('pr-validation.yml'), false);
  assert.equal(called.includes('conflict_labeler.yml'), false);
  assert.ok(ci.workflow.jobs['engine-reconcile']);
});
