import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddLocalLoginThrottle1782000000000 } from './1782000000000-AddLocalLoginThrottle';

test('SQLite local login throttle migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddLocalLoginThrottle1782000000000();

  try {
    await queryRunner.query(
      'CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)'
    );
    await queryRunner.query('INSERT INTO "user" DEFAULT VALUES');
    await migration.up(queryRunner);

    assert.deepStrictEqual(
      await queryRunner.query(
        'SELECT "failedLoginAttempts", "lastFailedLoginAt", "loginBlockedUntil" FROM "user"'
      ),
      [
        {
          failedLoginAttempts: 0,
          lastFailedLoginAt: null,
          loginBlockedUntil: null,
        },
      ]
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
