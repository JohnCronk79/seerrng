import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const workflow = yaml.load(
  fs.readFileSync(
    path.join(rootDirectory, '.github', 'workflows', 'lint-helm-charts.yml'),
    'utf8'
  )
);
const steps = workflow.jobs['lint-test'].steps;

test('chart validation uses version-aware comparison for pull requests', () => {
  const listChanged = steps.find(
    (step) => step.name === 'Run chart-testing (list-changed)'
  );
  const pullRequestLint = steps.find(
    (step) => step.name === 'Run chart-testing (pull request)'
  );

  assert.equal(listChanged.if, "github.event_name == 'pull_request'");
  assert.equal(
    pullRequestLint.if,
    "github.event_name == 'pull_request' && steps.list-changed.outputs.changed == 'true'"
  );
  assert.match(pullRequestLint.run, /ct lint --target-branch/iu);
});

test('chart validation lints all charts on pushes without a base-version check', () => {
  const pushLint = steps.find(
    (step) => step.name === 'Run chart-testing (push)'
  );

  assert.equal(pushLint.if, "github.event_name == 'push'");
  assert.match(pushLint.run, /ct lint --all --validate-maintainers=false/iu);
  assert.deepEqual(workflow.on.push.paths, [
    '.github/workflows/lint-helm-charts.yml',
    'charts/**',
  ]);
});
