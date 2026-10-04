import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { DropPushSubscriptionAuthUnique1781700000000 } from './1781700000000-DropPushSubscriptionAuthUnique';

test('SQLite push subscription migration scopes uniqueness to endpoint and user', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new DropPushSubscriptionAuthUnique1781700000000();

  try {
    await queryRunner.query(
      `CREATE TABLE "user" ("id" integer PRIMARY KEY NOT NULL)`
    );
    await queryRunner.query(`INSERT INTO "user" ("id") VALUES (1), (2)`);
    await queryRunner.query(
      `CREATE TABLE "user_push_subscription" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "endpoint" varchar NOT NULL, "p256dh" varchar NOT NULL, "auth" varchar NOT NULL, "userId" integer, "userAgent" varchar, "createdAt" datetime DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "UQ_6427d07d9a171a3a1ab87480005" UNIQUE ("endpoint", "userId"), CONSTRAINT "UQ_f90ab5a4ed54905a4bb51a7148b" UNIQUE ("auth"), CONSTRAINT "FK_03f7958328e311761b0de675fbe" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_03f7958328e311761b0de675fb" ON "user_push_subscription" ("userId")`
    );
    await queryRunner.query(
      `INSERT INTO "user_push_subscription" ("endpoint", "p256dh", "auth", "userId") VALUES ('https://push.example/one', 'key-one', 'shared-auth', 1)`
    );

    await migration.up(queryRunner);

    await queryRunner.query(
      `INSERT INTO "user_push_subscription" ("endpoint", "p256dh", "auth", "userId") VALUES ('https://push.example/two', 'key-two', 'shared-auth', 2)`
    );
    assert.equal(
      (
        await queryRunner.query(
          `SELECT COUNT(*) AS "count" FROM "user_push_subscription" WHERE "auth" = 'shared-auth'`
        )
      )[0].count,
      2
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "user_push_subscription" ("endpoint", "p256dh", "auth", "userId") VALUES ('https://push.example/one', 'key-three', 'different-auth', 1)`
      )
    );

    await queryRunner.query(
      `DELETE FROM "user_push_subscription" WHERE "userId" = 2`
    );
    await migration.down(queryRunner);
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "user_push_subscription" ("endpoint", "p256dh", "auth", "userId") VALUES ('https://push.example/two', 'key-two', 'shared-auth', 2)`
      )
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
