import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddNotificationOutbox1782200000000 } from './1782200000000-AddNotificationOutbox';

test('SQLite notification outbox migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddNotificationOutbox1782200000000();

  try {
    await migration.up(queryRunner);
    await queryRunner.query(
      `INSERT INTO "notification_outbox" ("type", "payload", "targetAgents", "deliveredAgents") VALUES (8, '{}', '["EmailAgent:0"]', '[]')`
    );
    assert.deepStrictEqual(
      await queryRunner.query(
        `SELECT "type", "attempts", "targetAgents", "claimToken", "claimedAt" FROM "notification_outbox"`
      ),
      [
        {
          type: 8,
          attempts: 0,
          targetAgents: '["EmailAgent:0"]',
          claimToken: null,
          claimedAt: null,
        },
      ]
    );

    await migration.down(queryRunner);
    const tables = (await queryRunner.query(
      `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'notification_outbox'`
    )) as { name: string }[];
    assert.deepStrictEqual(tables, []);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
