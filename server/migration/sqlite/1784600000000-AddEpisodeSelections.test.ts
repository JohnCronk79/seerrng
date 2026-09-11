import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddEpisodeSelections1784600000000 } from './1784600000000-AddEpisodeSelections';

test('SQLite episode selection migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'sqlite',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();

  try {
    await queryRunner.query(
      `CREATE TABLE "issue" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)`
    );
    await queryRunner.query(
      `CREATE TABLE "season_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)`
    );
    const migration = new AddEpisodeSelections1784600000000();
    await migration.up(queryRunner);
    const selection = JSON.stringify([
      { seasonNumber: 1, episodeNumbers: [2, 3] },
    ]);
    await queryRunner.query(
      `INSERT INTO "issue" ("problemEpisodeSelections") VALUES (?)`,
      [selection]
    );
    await queryRunner.query(
      `INSERT INTO "season_request" ("episodeNumbers") VALUES (?)`,
      [JSON.stringify([2, 3])]
    );

    const [issue] = await queryRunner.query(
      `SELECT "problemEpisodeSelections" FROM "issue"`
    );
    const [season] = await queryRunner.query(
      `SELECT "episodeNumbers" FROM "season_request"`
    );
    assert.deepStrictEqual(JSON.parse(issue.problemEpisodeSelections), [
      { seasonNumber: 1, episodeNumbers: [2, 3] },
    ]);
    assert.deepStrictEqual(JSON.parse(season.episodeNumbers), [2, 3]);

    await migration.down(queryRunner);
    assert.deepStrictEqual(
      (await queryRunner.query(`PRAGMA table_info("issue")`)).map(
        ({ name }: { name: string }) => name
      ),
      ['id']
    );
    assert.deepStrictEqual(
      (await queryRunner.query(`PRAGMA table_info("season_request")`)).map(
        ({ name }: { name: string }) => name
      ),
      ['id']
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
