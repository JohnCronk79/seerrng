import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';

test('the custom test runner returns a failure status', async () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
  };
  // Node marks test-runner children to prevent accidental recursive run()
  // calls. This subprocess intentionally starts an independent runner.
  delete childEnvironment['NODE_TEST_CONTEXT'];
  const child = spawn(
    process.execPath,
    [
      path.join(repoRoot, 'server/test/index.mts'),
      path.join(repoRoot, 'server/test/fixtures/failing.test.fixture.ts'),
    ],
    {
      cwd: repoRoot,
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  const [code, signal] = (await once(child, 'exit')) as [
    number | null,
    NodeJS.Signals | null,
  ];

  assert.strictEqual(code, 1, output);
  assert.strictEqual(signal, null, output);
  assert.match(output, /intentional runner failure/);
});
