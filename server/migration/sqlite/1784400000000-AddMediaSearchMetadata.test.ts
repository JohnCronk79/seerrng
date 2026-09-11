import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddMediaSearchMetadata1784400000000 } from './1784400000000-AddMediaSearchMetadata';

test('SQLite media search metadata migration is reversible and cascades with media', async () => {
  const dataSource = await new DataSource({
    type: 'sqlite',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddMediaSearchMetadata1784400000000();

  try {
    await queryRunner.query('PRAGMA foreign_keys = ON');
    await queryRunner.query(
      `CREATE TABLE "media" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)`
    );
    await queryRunner.query(`INSERT INTO "media" ("id") VALUES (1)`);

    await migration.up(queryRunner);
    await queryRunner.query(
      `INSERT INTO "media_search_metadata" ("mediaId", "title", "searchText") VALUES (?, ?, ?)`,
      [1, 'A Test Movie', 'a test movie director']
    );
    assert.equal(
      (
        await queryRunner.query(
          `SELECT "title" FROM "media_search_metadata" WHERE "searchText" LIKE ?`,
          ['%director%']
        )
      )[0].title,
      'A Test Movie'
    );

    await queryRunner.query(`DELETE FROM "media" WHERE "id" = 1`);
    assert.equal(
      (
        await queryRunner.query(
          `SELECT "mediaId" FROM "media_search_metadata" WHERE "mediaId" = 1`
        )
      ).length,
      0
    );

    await migration.down(queryRunner);
    assert.equal(
      (
        await queryRunner.query(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'media_search_metadata'`
        )
      ).length,
      0
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
