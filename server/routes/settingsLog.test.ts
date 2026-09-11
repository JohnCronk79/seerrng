import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const posixIt = process.platform === 'win32' ? it.skip : it;

import { readLogTail } from './settings';

const temporaryDirectories = new Set<string>();

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-log-read-'));
  temporaryDirectories.add(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      fs.rm(directory, { force: true, recursive: true })
    )
  );
  temporaryDirectories.clear();
});

describe('readLogTail', () => {
  posixIt(
    'reads a bounded tail through an in-directory rotation symlink',
    async () => {
      const directory = await createTemporaryDirectory();
      const target = path.join(directory, 'seerr-2026-07-17.log');
      const alias = path.join(directory, '.machinelogs.json');
      await fs.writeFile(target, 'discard\nsecond\nthird\n');
      await fs.symlink(path.basename(target), alias);

      assert.equal(await readLogTail(alias, 9), 'third\n');
    }
  );

  posixIt('rejects escaping symlinks and hard-linked log files', async () => {
    const directory = await createTemporaryDirectory();
    const outsideDirectory = await createTemporaryDirectory();
    const outside = path.join(outsideDirectory, 'outside.log');
    await fs.writeFile(outside, 'private');

    const escapingAlias = path.join(directory, '.machinelogs.json');
    await fs.symlink(outside, escapingAlias);
    await assert.rejects(readLogTail(escapingAlias), /log symlink/i);

    const hardLink = path.join(directory, 'hard-linked.log');
    await fs.link(outside, hardLink);
    await assert.rejects(readLogTail(hardLink), /private regular file/i);
  });

  posixIt('rejects symlinks in the log directory path', async () => {
    const directory = await createTemporaryDirectory();
    const targetDirectory = await createTemporaryDirectory();
    await fs.writeFile(path.join(targetDirectory, 'seerr.log'), 'private');
    const linkedDirectory = path.join(directory, 'logs');
    await fs.symlink(targetDirectory, linkedDirectory);

    await assert.rejects(
      readLogTail(path.join(linkedDirectory, 'seerr.log')),
      /must not contain symlinks/i
    );
  });
});
