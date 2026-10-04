import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddPasswordResetDeliveryPending1782100000000 } from './1782100000000-AddPasswordResetDeliveryPending';

test('SQLite password-reset delivery migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddPasswordResetDeliveryPending1782100000000();

  try {
    await queryRunner.query(
      'CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)'
    );
    await queryRunner.query('INSERT INTO "user" DEFAULT VALUES');
    await migration.up(queryRunner);

    assert.deepStrictEqual(
      await queryRunner.query(
        'SELECT "resetPasswordDeliveryPending" FROM "user"'
      ),
      [{ resetPasswordDeliveryPending: 0 }]
    );

    await migration.down(queryRunner);
    const columns = (await queryRunner.query('PRAGMA table_info("user")')) as {
      name: string;
    }[];
    assert.deepStrictEqual(
      columns.map((column) => column.name),
      ['id']
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
