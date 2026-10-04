import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { EnforceSeasonUniqueness1781800000000 } from './1781800000000-EnforceSeasonUniqueness';

test('SQLite season migration repairs duplicates and enforces parent uniqueness', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new EnforceSeasonUniqueness1781800000000();

  try {
    await queryRunner.query(`CREATE TABLE "media" ("id" integer PRIMARY KEY)`);
    await queryRunner.query(
      `CREATE TABLE "media_request" ("id" integer PRIMARY KEY)`
    );
    await queryRunner.query(`INSERT INTO "media" ("id") VALUES (1)`);
    await queryRunner.query(`INSERT INTO "media_request" ("id") VALUES (10)`);
    await queryRunner.query(
      `CREATE TABLE "season" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "seasonNumber" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, "status4k" integer NOT NULL DEFAULT (1), CONSTRAINT "FK_087099b39600be695591da9a49c" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_087099b39600be695591da9a49" ON "season" ("mediaId")`
    );
    await queryRunner.query(
      `CREATE TABLE "season_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "seasonNumber" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestId" integer, CONSTRAINT "FK_6f14737e346d6b27d8e50d2157a" FOREIGN KEY ("requestId") REFERENCES "media_request" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f14737e346d6b27d8e50d2157" ON "season_request" ("requestId")`
    );
    await queryRunner.query(`
      INSERT INTO "season" ("seasonNumber", "status", "status4k", "mediaId") VALUES
        (1, 4, 1, 1),
        (1, 5, 3, 1),
        (2, 1, 1, NULL)
    `);
    await queryRunner.query(`
      INSERT INTO "season_request" ("seasonNumber", "status", "requestId") VALUES
        (1, 1, 10),
        (1, 2, 10),
        (2, 1, NULL)
    `);

    await migration.up(queryRunner);

    assert.deepEqual(
      await queryRunner.query(
        `SELECT "seasonNumber", "status", "status4k", "mediaId" FROM "season"`
      ),
      [{ seasonNumber: 1, status: 5, status4k: 3, mediaId: 1 }]
    );
    assert.deepEqual(
      await queryRunner.query(
        `SELECT "seasonNumber", "status", "requestId" FROM "season_request"`
      ),
      [{ seasonNumber: 1, status: 2, requestId: 10 }]
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "season" ("seasonNumber", "mediaId") VALUES (1, 1)`
      )
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "season_request" ("seasonNumber", "requestId") VALUES (1, 10)`
      )
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "season" ("seasonNumber", "mediaId") VALUES (2, NULL)`
      )
    );

    await migration.down(queryRunner);
    await queryRunner.query(
      `INSERT INTO "season" ("seasonNumber", "mediaId") VALUES (1, 1), (2, NULL)`
    );
    await queryRunner.query(
      `INSERT INTO "season_request" ("seasonNumber", "requestId") VALUES (1, 10), (2, NULL)`
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
