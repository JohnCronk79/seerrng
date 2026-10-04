import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddBookRequestSearch1784300000000 } from './1784300000000-AddBookRequestSearch';

test('SQLite book request search migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddBookRequestSearch1784300000000();

  try {
    await queryRunner.query('PRAGMA foreign_keys = ON');
    await queryRunner.query(
      `CREATE TABLE "media_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)`
    );
    await queryRunner.query(`INSERT INTO "media_request" ("id") VALUES (1)`);

    await migration.up(queryRunner);
    const table = await queryRunner.query(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_request_search'`
    );
    assert.equal(table.length, 1);

    await queryRunner.query(
      `INSERT INTO "book_request_search" ("requestId", "serviceId", "format", "bookId", "commandId") VALUES (?, ?, ?, ?, ?)`,
      [1, 20, 'ebook', 55, 901]
    );
    await assert.rejects(() =>
      queryRunner.query(
        `INSERT INTO "book_request_search" ("requestId", "serviceId", "format", "bookId", "commandId") VALUES (?, ?, ?, ?, ?)`,
        [1, 20, 'ebook', 56, 902]
      )
    );

    await queryRunner.query(`DELETE FROM "media_request" WHERE "id" = 1`);
    assert.equal(
      (
        await queryRunner.query(
          `SELECT "id" FROM "book_request_search" WHERE "requestId" = 1`
        )
      ).length,
      0
    );

    await migration.down(queryRunner);
    const removed = await queryRunner.query(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book_request_search'`
    );
    assert.equal(removed.length, 0);
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
