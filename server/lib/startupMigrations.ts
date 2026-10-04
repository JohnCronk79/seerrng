import dataSource from '@server/datasource';
import type { DataSource, Migration } from 'typeorm';
import { MigrationExecutor } from 'typeorm/migration/MigrationExecutor';

const MIGRATION_ADVISORY_LOCK_KEY = 'seerr:startup-migrations';
const SQLITE_MIGRATION_BUSY_TIMEOUT_MS = 5 * 60 * 1000;
const SQLITE_RUNTIME_BUSY_TIMEOUT_MS = 5_000;

export const runStartupMigrations = async (
  source: DataSource = dataSource
): Promise<Migration[]> => {
  const databaseType = source.options.type;
  if (databaseType !== 'better-sqlite3' && databaseType !== 'postgres') {
    throw new Error(`Unsupported migration database type: ${databaseType}`);
  }

  const queryRunner = source.createQueryRunner();
  await queryRunner.connect();

  try {
    if (databaseType === 'better-sqlite3') {
      await queryRunner.query(
        `PRAGMA busy_timeout = ${SQLITE_MIGRATION_BUSY_TIMEOUT_MS}`
      );
      await queryRunner.query('PRAGMA foreign_keys=OFF');
      await queryRunner.query(
        `CREATE TABLE IF NOT EXISTS "seerr_migration_lock" (
          "id" integer PRIMARY KEY NOT NULL,
          "lockedAt" datetime
        )`
      );
      await queryRunner.query(
        `INSERT OR IGNORE INTO "seerr_migration_lock" ("id") VALUES (1)`
      );
    }

    await queryRunner.startTransaction();

    if (databaseType === 'postgres') {
      await queryRunner.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [MIGRATION_ADVISORY_LOCK_KEY]
      );
    } else {
      // Force acquisition of SQLite's single-writer lock before the executor
      // reads the pending migration set. Competing processes wait here, then
      // re-read migration history after the winner commits.
      await queryRunner.query(
        `UPDATE "seerr_migration_lock"
         SET "lockedAt" = CURRENT_TIMESTAMP WHERE "id" = 1`
      );
    }

    const executor = new MigrationExecutor(source, queryRunner);
    executor.transaction = 'all';
    const migrations = await executor.executePendingMigrations();

    await queryRunner.commitTransaction();
    return migrations;
  } catch (error) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction().catch(() => undefined);
    }
    throw error;
  } finally {
    if (databaseType === 'better-sqlite3') {
      await queryRunner.query('PRAGMA foreign_keys=ON').catch(() => undefined);
      await queryRunner
        .query(`PRAGMA busy_timeout = ${SQLITE_RUNTIME_BUSY_TIMEOUT_MS}`)
        .catch(() => undefined);
    }
    await queryRunner.release();
  }
};
