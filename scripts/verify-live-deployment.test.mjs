import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const scriptPath = path.resolve('scripts/verify-live-deployment.sh');
const temporaryDirectories = new Set();

const createFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-verify-live-'));
  temporaryDirectories.add(root);
  const executableDirectory = path.join(root, 'bin');
  const argumentsFile = path.join(root, 'arguments');
  await fs.mkdir(executableDirectory);
  await fs.writeFile(
    path.join(executableDirectory, 'ssh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$@" >"$SSH_ARGUMENTS"\ncat >/dev/null\n',
    { mode: 0o755 }
  );
  return { argumentsFile, executableDirectory, root };
};

const runScript = (fixture, environment = {}, ...arguments_) =>
  new Promise((resolve) => {
    const child = spawn(scriptPath, arguments_, {
      env: {
        ...process.env,
        PATH: `${fixture.executableDirectory}:${process.env.PATH}`,
        SSH_ARGUMENTS: fixture.argumentsFile,
        ...environment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stderr }));
  });

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      fs.rm(directory, { force: true, recursive: true })
    )
  );
  temporaryDirectories.clear();
});

describe('live deployment verification', () => {
  it('passes only bounded arguments to ssh', async () => {
    const fixture = await createFixture();
    const commit = 'a'.repeat(40);
    const result = await runScript(
      fixture,
      {
        SEERRNG_CONTAINER_NAME: 'seerr-host',
        SEERRNG_DEPLOY_HOST: 'deploy.example',
        SEERRNG_PORT: '5055',
      },
      commit
    );

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      (await fs.readFile(fixture.argumentsFile, 'utf8')).trim().split('\n'),
      ['--', 'deploy.example', 'bash', '-s', '--', 'seerr-host', '5055', commit]
    );
  });

  it('rejects shell syntax before invoking ssh', async () => {
    const fixture = await createFixture();
    const result = await runScript(
      fixture,
      { SEERRNG_CONTAINER_NAME: 'seerr; touch /tmp/pwned' },
      'a'.repeat(40)
    );

    assert.equal(result.code, 2);
    assert.match(result.stderr, /CONTAINER_NAME contains invalid/);
    await assert.rejects(fs.readFile(fixture.argumentsFile), {
      code: 'ENOENT',
    });
  });
});
