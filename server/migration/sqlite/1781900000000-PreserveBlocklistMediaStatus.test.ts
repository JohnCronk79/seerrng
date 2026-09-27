import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DataSource } from 'typeorm';
import { PreserveBlocklistMediaStatus1781900000000 } from './1781900000000-PreserveBlocklistMediaStatus';

describe('PreserveBlocklistMediaStatus1781900000000', () => {
  it('adds and removes reversible blocklist metadata columns', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
    });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();

    try {
      await queryRunner.query(
        'CREATE TABLE "blocklist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)'
      );
      const migration = new PreserveBlocklistMediaStatus1781900000000();
      await migration.up(queryRunner);

      const addedColumns = (await queryRunner.query(
        'PRAGMA table_info("blocklist")'
      )) as { name: string }[];
      assert.deepStrictEqual(
        addedColumns.map((column) => column.name),
        ['id', 'previousStatus', 'previousStatus4k', 'isMediaPlaceholder']
      );

      await migration.down(queryRunner);
      const remainingColumns = (await queryRunner.query(
        'PRAGMA table_info("blocklist")'
      )) as { name: string }[];
      assert.deepStrictEqual(
        remainingColumns.map((column) => column.name),
        ['id']
      );
    } finally {
      await queryRunner.release();
      await dataSource.destroy();
    }
  });
});
