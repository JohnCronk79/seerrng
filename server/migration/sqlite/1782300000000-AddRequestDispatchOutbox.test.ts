import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddRequestDispatchOutbox1782300000000 } from './1782300000000-AddRequestDispatchOutbox';

test('SQLite request dispatch outbox migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddRequestDispatchOutbox1782300000000();
  try {
    await queryRunner.query(
      `CREATE TABLE "media_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)`
    );
    await migration.up(queryRunner);
    await queryRunner.query(`INSERT INTO "media_request" ("id") VALUES (1)`);
    await queryRunner.query(
      `INSERT INTO "request_dispatch_outbox" ("requestId") VALUES (1)`
    );
    assert.deepEqual(
      await queryRunner.query(
        `SELECT "requestId", "attempts", "nextAttemptAt", "claimToken" FROM "request_dispatch_outbox"`
      ),
      [
        {
          requestId: 1,
          attempts: 0,
          nextAttemptAt: null,
          claimToken: null,
        },
      ]
    );
    await queryRunner.query(`DELETE FROM "media_request" WHERE "id" = 1`);
    assert.deepEqual(
      await queryRunner.query(`SELECT * FROM "request_dispatch_outbox"`),
      []
    );
    await migration.down(queryRunner);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
