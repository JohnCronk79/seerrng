import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const posixIt = process.platform === 'win32' ? it.skip : it;

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PRIVATE_SQLITE_DIRECTORY_MODE,
  PRIVATE_SQLITE_FILE_MODE,
  secureSqliteDatabaseFiles,
} from './sqliteFileSecurity';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true }))
  );
});

describe('SQLite file permissions', () => {
  posixIt('tightens database directories and SQLite files', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-sqlite-'));
    temporaryDirectories.push(parent);
    const databaseDirectory = path.join(parent, 'db');
    const databasePath = path.join(databaseDirectory, 'db.sqlite3');
    await fs.mkdir(databaseDirectory, { mode: 0o755 });
    await Promise.all(
      [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].map(
        (filePath) => fs.writeFile(filePath, 'sqlite', { mode: 0o644 })
      )
    );

    secureSqliteDatabaseFiles(databasePath);

    assert.equal(
      (await fs.stat(databaseDirectory)).mode & 0o777,
      PRIVATE_SQLITE_DIRECTORY_MODE
    );
    for (const filePath of [
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
    ]) {
      assert.equal(
        (await fs.stat(filePath)).mode & 0o777,
        PRIVATE_SQLITE_FILE_MODE
      );
    }
  });

  posixIt(
    'rejects symlinked database files without modifying their targets',
    async () => {
      const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-sqlite-'));
      temporaryDirectories.push(parent);
      const databaseDirectory = path.join(parent, 'db');
      const databasePath = path.join(databaseDirectory, 'db.sqlite3');
      const targetPath = path.join(parent, 'unrelated');
      await fs.mkdir(databaseDirectory);
      await fs.writeFile(targetPath, 'unrelated', { mode: 0o644 });
      await fs.symlink(targetPath, databasePath);

      assert.throws(
        () => secureSqliteDatabaseFiles(databasePath),
        /regular file/
      );
      assert.equal((await fs.stat(targetPath)).mode & 0o777, 0o644);
    }
  );

  posixIt(
    'rejects hard-linked database files without modifying their targets',
    async () => {
      const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-sqlite-'));
      temporaryDirectories.push(parent);
      const databaseDirectory = path.join(parent, 'db');
      const databasePath = path.join(databaseDirectory, 'db.sqlite3');
      const targetPath = path.join(parent, 'unrelated');
      await fs.mkdir(databaseDirectory);
      await fs.writeFile(targetPath, 'unrelated', { mode: 0o644 });
      await fs.link(targetPath, databasePath);

      assert.throws(
        () => secureSqliteDatabaseFiles(databasePath),
        /regular file/
      );
      assert.equal((await fs.stat(targetPath)).mode & 0o777, 0o644);
    }
  );

  posixIt('rejects symlinks above the direct database directory', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'seerr-sqlite-'));
    temporaryDirectories.push(parent);
    const targetRoot = path.join(parent, 'target');
    const targetDirectory = path.join(targetRoot, 'db');
    const linkedRoot = path.join(parent, 'linked');
    const databasePath = path.join(linkedRoot, 'db', 'db.sqlite3');
    await fs.mkdir(targetDirectory, { recursive: true, mode: 0o755 });
    await fs.writeFile(path.join(targetDirectory, 'db.sqlite3'), 'sqlite');
    await fs.symlink(targetRoot, linkedRoot);

    assert.throws(() => secureSqliteDatabaseFiles(databasePath), /symlink/);
    assert.equal((await fs.stat(targetDirectory)).mode & 0o777, 0o755);
  });
});
