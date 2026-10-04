import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddScheduledJobLease1782400000000 } from './1782400000000-AddScheduledJobLease';

test('SQLite scheduled job lease migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddScheduledJobLease1782400000000();
  try {
    await migration.up(queryRunner);
    await queryRunner.query(
      `INSERT INTO "scheduled_job_lease" ("name", "owner", "expiresAt") VALUES (?, ?, ?)`,
      ['scheduled-job:test', 'owner', '2030-01-01 00:00:00']
    );
    assert.deepEqual(
      await queryRunner.query(
        `SELECT "name", "owner" FROM "scheduled_job_lease"`
      ),
      [{ name: 'scheduled-job:test', owner: 'owner' }]
    );
    await migration.down(queryRunner);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
