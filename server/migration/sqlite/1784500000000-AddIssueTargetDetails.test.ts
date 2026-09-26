import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddIssueTargetDetails1784500000000 } from './1784500000000-AddIssueTargetDetails';

test('SQLite issue target details migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();

  try {
    await queryRunner.query(
      `CREATE TABLE "issue" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)`
    );
    const migration = new AddIssueTargetDetails1784500000000();
    await migration.up(queryRunner);
    await queryRunner.query(
      `INSERT INTO "issue" ("problemEpisodes", "is4k") VALUES (?, ?)`,
      [JSON.stringify([2, 3]), 1]
    );

    const [issue] = await queryRunner.query(
      `SELECT "problemEpisodes", "is4k" FROM "issue"`
    );
    assert.deepStrictEqual(JSON.parse(issue.problemEpisodes), [2, 3]);
    assert.equal(issue.is4k, 1);

    await migration.down(queryRunner);
    const columns = await queryRunner.query(`PRAGMA table_info("issue")`);
    assert.deepStrictEqual(
      columns.map(({ name }: { name: string }) => name),
      ['id']
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
