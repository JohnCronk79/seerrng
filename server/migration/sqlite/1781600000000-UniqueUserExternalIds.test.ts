import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { UniqueUserExternalIds1781600000000 } from './1781600000000-UniqueUserExternalIds';

test('SQLite external identity migration repairs duplicates and enforces uniqueness', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new UniqueUserExternalIds1781600000000();

  try {
    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" integer PRIMARY KEY,
        "plexId" integer,
        "plexToken" varchar,
        "plexUsername" varchar,
        "jellyfinUserId" varchar,
        "jellyfinAuthToken" varchar,
        "jellyfinDeviceId" varchar,
        "jellyfinUsername" varchar,
        "userType" integer NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO "user" VALUES
        (1, 7, 'owner-plex-token', 'owner', 'jf-owner', 'owner-jf-token', 'owner-device', 'owner', 1),
        (2, 7, 'duplicate-plex-token', 'duplicate', NULL, NULL, NULL, NULL, 1),
        (3, NULL, NULL, NULL, 'jf-owner', 'duplicate-jf-token', 'duplicate-device', 'duplicate', 3),
        (4, 8, 'keeper-token', 'keeper', 'jf-other', 'keeper-jf-token', 'keeper-device', 'keeper', 3),
        (5, 8, 'later-token', 'later', 'jf-other', 'later-jf-token', 'later-device', 'later', 4)
    `);

    await migration.up(queryRunner);

    assert.deepEqual(
      await queryRunner.query(`
        SELECT "id", "plexId", "plexToken", "jellyfinUserId", "jellyfinAuthToken", "userType"
        FROM "user"
        ORDER BY "id"
      `),
      [
        {
          id: 1,
          plexId: 7,
          plexToken: 'owner-plex-token',
          jellyfinUserId: 'jf-owner',
          jellyfinAuthToken: 'owner-jf-token',
          userType: 1,
        },
        {
          id: 2,
          plexId: null,
          plexToken: null,
          jellyfinUserId: null,
          jellyfinAuthToken: null,
          userType: 2,
        },
        {
          id: 3,
          plexId: null,
          plexToken: null,
          jellyfinUserId: null,
          jellyfinAuthToken: null,
          userType: 2,
        },
        {
          id: 4,
          plexId: 8,
          plexToken: 'keeper-token',
          jellyfinUserId: 'jf-other',
          jellyfinAuthToken: 'keeper-jf-token',
          userType: 3,
        },
        {
          id: 5,
          plexId: null,
          plexToken: null,
          jellyfinUserId: null,
          jellyfinAuthToken: null,
          userType: 2,
        },
      ]
    );

    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "user" ("id", "plexId", "userType") VALUES (6, 7, 1)`
      )
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "user" ("id", "jellyfinUserId", "userType") VALUES (6, 'jf-owner', 3)`
      )
    );

    await migration.down(queryRunner);
    await queryRunner.query(
      `INSERT INTO "user" ("id", "plexId", "jellyfinUserId", "userType") VALUES (6, 7, 'jf-owner', 1)`
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
