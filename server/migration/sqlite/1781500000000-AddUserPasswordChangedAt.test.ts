import assert from 'node:assert/strict';
import test from 'node:test';

import { DataSource } from 'typeorm';
import { AddUserPasswordChangedAt1781500000000 } from './1781500000000-AddUserPasswordChangedAt';

test('SQLite password credential-version migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddUserPasswordChangedAt1781500000000();

  try {
    await queryRunner.query(
      `CREATE TABLE "user" ("id" integer PRIMARY KEY, "email" varchar NOT NULL)`
    );

    await migration.up(queryRunner);
    const columnsAfterUp = (await queryRunner.query(
      `PRAGMA table_info("user")`
    )) as { name: string }[];
    assert.equal(
      columnsAfterUp.some((column) => column.name === 'passwordChangedAt'),
      true
    );

    await migration.down(queryRunner);
    const columnsAfterDown = (await queryRunner.query(
      `PRAGMA table_info("user")`
    )) as { name: string }[];
    assert.equal(
      columnsAfterDown.some((column) => column.name === 'passwordChangedAt'),
      false
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
