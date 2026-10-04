import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const scriptPath = path.resolve('scripts/store-copr-kerberos-openbao.sh');
const temporaryDirectories = new Set();

const createFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-openbao-'));
  temporaryDirectories.add(root);
  const executableDirectory = path.join(root, 'bin');
  const argumentsFile = path.join(root, 'arguments');
  const inputFile = path.join(root, 'input');
  const keytab = path.join(root, 'release.keytab');
  await fs.mkdir(executableDirectory);
  await fs.writeFile(keytab, 'binary-keytab-secret');
  await fs.writeFile(
    path.join(executableDirectory, 'bao'),
    '#!/bin/sh\nprintf \'%s\\n\' "$@" >"$BAO_ARGUMENTS"\ncat >"$BAO_INPUT"\n',
    { mode: 0o755 }
  );
  return { argumentsFile, executableDirectory, inputFile, keytab, root };
};

const runScript = (fixture, ...arguments_) =>
  new Promise((resolve) => {
    const child = spawn(scriptPath, arguments_, {
      env: {
        ...process.env,
        BAO_ARGUMENTS: fixture.argumentsFile,
        BAO_INPUT: fixture.inputFile,
        PATH: `${fixture.executableDirectory}:${process.env.PATH}`,
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

describe('OpenBao Copr credential storage', () => {
  it('streams the encoded keytab instead of placing it in process arguments', async () => {
    const fixture = await createFixture();
    const result = await runScript(
      fixture,
      '--principal',
      'release-user@FEDORAPROJECT.ORG',
      '--keytab',
      fixture.keytab
    );

    assert.equal(result.code, 0, result.stderr);
    const argumentsText = await fs.readFile(fixture.argumentsFile, 'utf8');
    assert.equal(argumentsText.includes('YmluYXJ5LWtleXRhYi1zZWNyZXQ='), false);
    assert.match(argumentsText, /copr_kerberos_keytab_b64=-/);
    assert.equal(
      await fs.readFile(fixture.inputFile, 'utf8'),
      'YmluYXJ5LWtleXRhYi1zZWNyZXQ='
    );
  });

  it('rejects option-like secret paths before invoking bao', async () => {
    const fixture = await createFixture();
    const result = await runScript(
      fixture,
      '--principal',
      'release-user@FEDORAPROJECT.ORG',
      '--keytab',
      fixture.keytab,
      '--secret-path',
      '-output-curl-string'
    );

    assert.equal(result.code, 2);
    assert.match(result.stderr, /secret path contains invalid/);
    await assert.rejects(fs.readFile(fixture.argumentsFile), {
      code: 'ENOENT',
    });
  });
});
