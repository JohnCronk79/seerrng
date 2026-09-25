import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { EnforceScreenBlocklistUniqueness1782700000000 } from './1782700000000-EnforceScreenBlocklistUniqueness';

test('SQLite screen-blocklist uniqueness migration preserves manual ownership and media', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new EnforceScreenBlocklistUniqueness1782700000000();
  try {
    await queryRunner.query(
      `CREATE TABLE "blocklist" (
        "id" integer PRIMARY KEY,
        "mediaType" varchar NOT NULL,
        "title" varchar,
        "tmdbId" integer NOT NULL,
        "blocklistedTags" varchar,
        "createdAt" datetime NOT NULL,
        "userId" integer,
        "mediaId" integer UNIQUE,
        "previousStatus" integer,
        "previousStatus4k" integer,
        "isMediaPlaceholder" boolean
      )`
    );
    await queryRunner.query(
      `INSERT INTO "blocklist" (
        "id", "mediaType", "title", "tmdbId", "blocklistedTags",
        "createdAt", "userId", "mediaId", "previousStatus",
        "previousStatus4k", "isMediaPlaceholder"
      ) VALUES
        (1, 'movie', 'Automatic title', 100, ',10,', '2026-01-01', NULL, 7, 5, 1, 0),
        (2, 'movie', 'Manual title', 100, NULL, '2026-02-01', 9, NULL, NULL, NULL, NULL),
        (3, 'tv', 'First automatic', 200, ',20,', '2026-01-01', NULL, NULL, NULL, NULL, 1),
        (4, 'tv', 'Newest automatic', 200, ',21,', '2026-02-01', NULL, NULL, NULL, NULL, 1),
        (5, 'music', 'Music one', 0, NULL, '2026-01-01', NULL, NULL, NULL, NULL, 1),
        (6, 'music', 'Music two', 0, NULL, '2026-02-01', NULL, NULL, NULL, NULL, 1)`
    );

    await migration.up(queryRunner);

    assert.deepEqual(
      await queryRunner.query(
        `SELECT "id", "mediaType", "title", "tmdbId", "blocklistedTags",
                "userId", "mediaId", "previousStatus", "previousStatus4k",
                "isMediaPlaceholder"
         FROM "blocklist" ORDER BY "id"`
      ),
      [
        {
          id: 2,
          mediaType: 'movie',
          title: 'Manual title',
          tmdbId: 100,
          blocklistedTags: null,
          userId: 9,
          mediaId: 7,
          previousStatus: 5,
          previousStatus4k: 1,
          isMediaPlaceholder: 0,
        },
        {
          id: 4,
          mediaType: 'tv',
          title: 'Newest automatic',
          tmdbId: 200,
          blocklistedTags: ',21,',
          userId: null,
          mediaId: null,
          previousStatus: null,
          previousStatus4k: null,
          isMediaPlaceholder: 1,
        },
        {
          id: 5,
          mediaType: 'music',
          title: 'Music one',
          tmdbId: 0,
          blocklistedTags: null,
          userId: null,
          mediaId: null,
          previousStatus: null,
          previousStatus4k: null,
          isMediaPlaceholder: 1,
        },
        {
          id: 6,
          mediaType: 'music',
          title: 'Music two',
          tmdbId: 0,
          blocklistedTags: null,
          userId: null,
          mediaId: null,
          previousStatus: null,
          previousStatus4k: null,
          isMediaPlaceholder: 1,
        },
      ]
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "blocklist" ("id", "mediaType", "tmdbId", "createdAt")
         VALUES (7, 'movie', 100, '2026-03-01')`
      ),
      /unique/i
    );
    await queryRunner.query(
      `INSERT INTO "blocklist" ("id", "mediaType", "tmdbId", "createdAt")
       VALUES (7, 'book', 0, '2026-03-01')`
    );

    await migration.down(queryRunner);
    await queryRunner.query(
      `INSERT INTO "blocklist" ("id", "mediaType", "tmdbId", "createdAt")
       VALUES (8, 'movie', 100, '2026-04-01')`
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
