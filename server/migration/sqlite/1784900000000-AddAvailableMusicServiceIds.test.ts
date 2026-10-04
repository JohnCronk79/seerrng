import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddAvailableMusicServiceIds1784900000000 } from './1784900000000-AddAvailableMusicServiceIds';

test('adds and backfills available Lidarr service ids for existing music', async () => {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  });
  await dataSource.initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddAvailableMusicServiceIds1784900000000();

  try {
    await queryRunner.query(
      `CREATE TABLE "media" ("id" integer PRIMARY KEY AUTOINCREMENT, "mediaType" varchar NOT NULL, "status" integer NOT NULL, "serviceId" integer)`
    );
    await queryRunner.query(
      `INSERT INTO "media" ("mediaType", "status", "serviceId") VALUES ('music', 5, 0), ('music', 3, 1), ('movie', 5, 2)`
    );

    await migration.up(queryRunner);

    const rows = await queryRunner.query(
      `SELECT "mediaType", "availableMusicServiceIds" FROM "media" ORDER BY "id"`
    );
    assert.deepStrictEqual(rows, [
      { mediaType: 'music', availableMusicServiceIds: '[0]' },
      { mediaType: 'music', availableMusicServiceIds: null },
      { mediaType: 'movie', availableMusicServiceIds: null },
    ]);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
