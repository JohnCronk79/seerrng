import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const scripts = {
  checkout: path.resolve('packaging/scripts/checkout-aur-repo.sh'),
  push: path.resolve('packaging/scripts/push-aur-repo.sh'),
  setup: path.resolve('packaging/scripts/setup-aur-ssh.sh'),
  ssh: path.resolve('packaging/scripts/aur-ssh-command.sh'),
};
const temporaryDirectories = new Set();

const createTemporaryDirectory = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aur-scripts-test-'));
  temporaryDirectories.add(root);
  return root;
};

const run = (script, arguments_, environment = {}) =>
  new Promise((resolve) => {
    const { TEST_CWD, ...childEnvironment } = environment;
    const child = spawn(script, arguments_, {
      cwd: TEST_CWD,
      env: { ...process.env, ...childEnvironment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => resolve({ code, output }));
  });

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      fs.rm(directory, { force: true, recursive: true })
    )
  );
  temporaryDirectories.clear();
});

describe('AUR release script boundaries', () => {
  it('installs isolated SSH state without overwriting the user config', async () => {
    const root = await createTemporaryDirectory();
    const sshDirectory = path.join(root, '.ssh');
    const key = path.join(root, 'key');
    await fs.mkdir(sshDirectory);
    await fs.writeFile(path.join(sshDirectory, 'config'), 'keep-me\n');
    await fs.writeFile(key, 'test-private-key\n', { mode: 0o600 });

    const result = await run(scripts.setup, [key], { HOME: root });

    assert.equal(result.code, 0, result.output);
    assert.equal(
      await fs.readFile(path.join(sshDirectory, 'config'), 'utf8'),
      'keep-me\n'
    );
    assert.match(
      await fs.readFile(path.join(sshDirectory, 'aur_config'), 'utf8'),
      /UserKnownHostsFile ~\/\.ssh\/aur_known_hosts/
    );
    assert.equal(
      (await fs.stat(path.join(sshDirectory, 'aur'))).mode & 0o777,
      0o600
    );
  });

  it('does not overwrite a planted private-key symlink', async () => {
    const root = await createTemporaryDirectory();
    const sshDirectory = path.join(root, '.ssh');
    const key = path.join(root, 'key');
    const sentinel = path.join(root, 'sentinel');
    await fs.mkdir(sshDirectory);
    await fs.writeFile(key, 'new-key\n');
    await fs.writeFile(sentinel, 'unchanged');
    await fs.symlink(sentinel, path.join(sshDirectory, 'aur'));

    const result = await run(scripts.setup, [key], { HOME: root });

    assert.notEqual(result.code, 0);
    assert.match(result.output, /refusing to replace existing SSH file/);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'unchanged');
  });

  it('rejects destructive checkout target paths before invoking git', async () => {
    const root = await createTemporaryDirectory();
    const result = await run(scripts.checkout, ['seerrng-bin', '../outside'], {
      HOME: root,
    });

    assert.notEqual(result.code, 0);
    assert.match(result.output, /safe relative directory name/);
  });

  it('rejects option-like push branches before invoking git', async () => {
    const root = await createTemporaryDirectory();
    const repository = path.join(root, 'repo');
    await fs.mkdir(repository);

    const result = await run(
      scripts.push,
      [repository, 'seerrng-bin', 'message', '--upload-pack=payload'],
      { HOME: root }
    );

    assert.notEqual(result.code, 0);
    assert.match(result.output, /invalid AUR branch name/);
  });

  it('passes SSH config paths as data rather than shell syntax', async () => {
    const root = await createTemporaryDirectory();
    const executableDirectory = path.join(root, 'bin');
    const argumentsFile = path.join(root, 'arguments');
    const marker = path.join(root, 'injected');
    const config = path.join(root, 'config;touch injected');
    await fs.mkdir(executableDirectory);
    await fs.writeFile(config, 'fixture');
    await fs.writeFile(
      path.join(executableDirectory, 'ssh'),
      '#!/bin/sh\nprintf \'%s\\n\' "$@" >"$SSH_ARGUMENTS"\n',
      { mode: 0o755 }
    );

    const result = await run(scripts.ssh, ['host', 'command'], {
      AUR_SSH_CONFIG: config,
      HOME: root,
      PATH: `${executableDirectory}:${process.env.PATH}`,
      SSH_ARGUMENTS: argumentsFile,
      TEST_CWD: root,
    });

    assert.equal(result.code, 0, result.output);
    assert.deepEqual(
      (await fs.readFile(argumentsFile, 'utf8')).trim().split('\n'),
      ['-F', config, 'host', 'command']
    );
    await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  });
});
