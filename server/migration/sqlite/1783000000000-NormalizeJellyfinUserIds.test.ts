import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { NormalizeJellyfinUserIds1783000000000 } from './1783000000000-NormalizeJellyfinUserIds';

test('SQLite Jellyfin identity migration canonicalizes and repairs duplicates', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new NormalizeJellyfinUserIds1783000000000();

  try {
    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" integer PRIMARY KEY,
        "jellyfinUserId" varchar,
        "jellyfinAuthToken" varchar,
        "jellyfinDeviceId" varchar,
        "jellyfinUsername" varchar,
        "userType" integer NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_jellyfin_user_id_unique" ON "user" ("jellyfinUserId")`
    );
    await queryRunner.query(`
      INSERT INTO "user" VALUES
        (1, 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', 'owner-token', 'owner-device', 'owner', 3),
        (2, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'duplicate-token', 'duplicate-device', 'duplicate', 4),
        (3, 'legacy-non-guid', 'legacy-token', 'legacy-device', 'legacy', 3),
        (4, 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB', 'other-token', 'other-device', 'other', 3)
    `);

    await migration.up(queryRunner);

    const rows = await queryRunner.query(`SELECT * FROM "user" ORDER BY "id"`);
    assert.strictEqual(
      rows[0].jellyfinUserId,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    assert.strictEqual(rows[0].jellyfinAuthToken, 'owner-token');
    assert.strictEqual(rows[1].jellyfinUserId, null);
    assert.strictEqual(rows[1].jellyfinAuthToken, null);
    assert.strictEqual(rows[1].userType, 2);
    assert.strictEqual(rows[2].jellyfinUserId, 'legacy-non-guid');
    assert.strictEqual(
      rows[3].jellyfinUserId,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
