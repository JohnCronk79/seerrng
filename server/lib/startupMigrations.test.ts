import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DataSource, type MigrationInterface, type QueryRunner } from 'typeorm';
import { runStartupMigrations } from './startupMigrations';

class FailingStartupMigration1900000000001 implements MigrationInterface {
  name = 'FailingStartupMigration1900000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "rolled_back_migration" ("id" integer PRIMARY KEY)`
    );
    throw new Error('migration failed');
  }

  public async down(): Promise<void> {}
}

test('runStartupMigrations serializes competing SQLite processes', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'seerr-startup-migrations-')
  );
  const database = path.join(directory, 'database.sqlite3');
  const workerPath = path.join(
    __dirname,
    '../test/startupMigrationsConcurrencyWorker.ts'
  );
  const runWorker = () =>
    new Promise<{ migrationCount: number }>((resolve, reject) => {
      const worker = spawn(
        process.execPath,
        [
          '-r',
          'ts-node/register',
          '-r',
          'tsconfig-paths/register',
          workerPath,
          database,
        ],
        {
          cwd: path.join(__dirname, '../..'),
          env: {
            ...process.env,
            NODE_ENV: 'test',
            TS_NODE_FILES: 'true',
            TS_NODE_PROJECT: path.join(__dirname, '../tsconfig.json'),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      let stdout = '';
      let stderr = '';
      worker.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      worker.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      worker.once('error', reject);
      worker.once('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `Migration worker exited with ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()) as { migrationCount: number });
        } catch (error) {
          reject(error);
        }
      });
    });
  const verificationSource = new DataSource({
    type: 'better-sqlite3',
    database,
  });

  try {
    const [firstResult, secondResult] = await Promise.all([
      runWorker(),
      runWorker(),
    ]);

    await verificationSource.initialize();
    assert.deepStrictEqual(
      [firstResult.migrationCount, secondResult.migrationCount].sort(
        (a, b) => a - b
      ),
      [0, 1]
    );
    assert.deepStrictEqual(
      await verificationSource.query(
        `SELECT "id" FROM "startup_migration_result"`
      ),
      [{ id: 1 }]
    );
    assert.strictEqual(
      (await verificationSource.query('PRAGMA foreign_keys'))[0].foreign_keys,
      1
    );
  } finally {
    if (verificationSource.isInitialized) await verificationSource.destroy();
    await fs.rm(directory, { force: true, recursive: true });
  }
});

test('runStartupMigrations rolls back failures and restores SQLite pragmas', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'seerr-failed-migration-')
  );
  const source = new DataSource({
    type: 'better-sqlite3',
    database: path.join(directory, 'database.sqlite3'),
    migrations: [FailingStartupMigration1900000000001],
  });

  try {
    await source.initialize();
    await assert.rejects(runStartupMigrations(source), /migration failed/);
    const queryRunner = source.createQueryRunner();
    assert.strictEqual(
      await queryRunner.hasTable('rolled_back_migration'),
      false
    );
    assert.strictEqual(await queryRunner.hasTable('migrations'), false);
    await queryRunner.release();
    assert.strictEqual(
      (await source.query('PRAGMA foreign_keys'))[0].foreign_keys,
      1
    );
  } finally {
    if (source.isInitialized) await source.destroy();
    await fs.rm(directory, { force: true, recursive: true });
  }
});
