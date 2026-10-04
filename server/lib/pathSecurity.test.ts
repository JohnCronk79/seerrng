import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const posixIt = process.platform === 'win32' ? it.skip : it;

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertNoSymlinkDirectoryComponents } from './pathSecurity';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true }))
  );
});

describe('assertNoSymlinkDirectoryComponents', () => {
  posixIt('rejects symlinks in non-final path components', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-path-'));
    temporaryDirectories.push(root);
    const target = path.join(root, 'target');
    const linked = path.join(root, 'linked');
    await fs.mkdir(path.join(target, 'nested'), { recursive: true });
    await fs.symlink(target, linked);

    assert.throws(
      () =>
        assertNoSymlinkDirectoryComponents(path.join(linked, 'nested'), {
          label: 'Sensitive directory',
        }),
      /must not contain symlinks/
    );
  });

  it('allows a missing suffix only when requested', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-path-'));
    temporaryDirectories.push(root);
    const missing = path.join(root, 'new', 'nested');

    assert.doesNotThrow(() =>
      assertNoSymlinkDirectoryComponents(missing, { allowMissing: true })
    );
    assert.throws(() => assertNoSymlinkDirectoryComponents(missing), /ENOENT/);
  });
});
