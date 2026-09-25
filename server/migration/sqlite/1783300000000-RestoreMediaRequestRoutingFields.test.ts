import assert from 'node:assert/strict';
import test from 'node:test';

import { DataSource } from 'typeorm';
import { RestoreMediaRequestRoutingFields1783300000000 } from './1783300000000-RestoreMediaRequestRoutingFields';

test('SQLite media-request routing-field repair is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new RestoreMediaRequestRoutingFields1783300000000();

  try {
    await queryRunner.query(
      'CREATE TABLE "media_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "ignoreQuota" boolean NOT NULL DEFAULT (0))'
    );
    await queryRunner.query(
      'INSERT INTO "media_request" ("ignoreQuota") VALUES (1)'
    );

    await migration.up(queryRunner);

    const repairedColumns = (await queryRunner.query(
      'PRAGMA table_info("media_request")'
    )) as { name: string }[];
    assert.deepStrictEqual(
      repairedColumns.map((column) => column.name),
      ['id', 'ignoreQuota', 'bookFormat', 'metadataProfileId']
    );
    assert.deepStrictEqual(
      await queryRunner.query(
        'SELECT "ignoreQuota", "bookFormat", "metadataProfileId" FROM "media_request"'
      ),
      [{ ignoreQuota: 1, bookFormat: null, metadataProfileId: null }]
    );

    await migration.down(queryRunner);
    const remainingColumns = (await queryRunner.query(
      'PRAGMA table_info("media_request")'
    )) as { name: string }[];
    assert.deepStrictEqual(
      remainingColumns.map((column) => column.name),
      ['id', 'ignoreQuota']
    );
    assert.deepStrictEqual(
      await queryRunner.query(
        'SELECT "id", "ignoreQuota" FROM "media_request"'
      ),
      [{ id: 1, ignoreQuota: 1 }]
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
