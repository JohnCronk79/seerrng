import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddUniqueBuiltInDiscoverSlider1782500000000 } from './1782500000000-AddUniqueBuiltInDiscoverSlider';

test('SQLite built-in discovery slider uniqueness migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddUniqueBuiltInDiscoverSlider1782500000000();
  try {
    await queryRunner.query(
      `CREATE TABLE "discover_slider" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "type" integer NOT NULL,
        "isBuiltIn" boolean NOT NULL DEFAULT (0)
      )`
    );
    await queryRunner.query(
      `INSERT INTO "discover_slider" ("type", "isBuiltIn")
       VALUES (1, 1), (1, 1), (1, 0), (1, 0)`
    );

    await migration.up(queryRunner);
    assert.deepEqual(
      await queryRunner.query(
        `SELECT "type", "isBuiltIn", COUNT(*) AS "count"
         FROM "discover_slider"
         GROUP BY "type", "isBuiltIn"
         ORDER BY "isBuiltIn" DESC`
      ),
      [
        { type: 1, isBuiltIn: 1, count: 1 },
        { type: 1, isBuiltIn: 0, count: 2 },
      ]
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "discover_slider" ("type", "isBuiltIn") VALUES (1, 1)`
      ),
      /unique/i
    );
    await queryRunner.query(
      `INSERT INTO "discover_slider" ("type", "isBuiltIn") VALUES (1, 0)`
    );

    await migration.down(queryRunner);
    await queryRunner.query(
      `INSERT INTO "discover_slider" ("type", "isBuiltIn") VALUES (1, 1)`
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
