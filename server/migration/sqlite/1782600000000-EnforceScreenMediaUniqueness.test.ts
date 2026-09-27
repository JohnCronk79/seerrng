import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { EnforceScreenMediaUniqueness1782600000000 } from './1782600000000-EnforceScreenMediaUniqueness';

test('SQLite screen-media uniqueness migration merges duplicate relationships', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new EnforceScreenMediaUniqueness1782600000000();
  try {
    await queryRunner.query(
      `CREATE TABLE "media" (
        "id" integer PRIMARY KEY,
        "mediaType" varchar NOT NULL,
        "tmdbId" integer NOT NULL,
        "tvdbId" integer UNIQUE,
        "imdbId" varchar,
        "status" integer NOT NULL,
        "status4k" integer NOT NULL,
        "createdAt" datetime,
        "updatedAt" datetime NOT NULL,
        "lastSeasonChange" datetime,
        "mediaAddedAt" datetime,
        "serviceId" integer,
        "serviceId4k" integer,
        "externalServiceId" integer,
        "externalServiceId4k" integer,
        "externalServiceSlug" varchar,
        "externalServiceSlug4k" varchar,
        "audiobookServiceId" integer,
        "audiobookExternalServiceId" integer,
        "audiobookExternalServiceSlug" varchar,
        "ratingKey" varchar,
        "ratingKey4k" varchar,
        "jellyfinMediaId" varchar,
        "jellyfinMediaId4k" varchar,
        "mbId" varchar
      )`
    );
    for (const table of ['media_request', 'issue', 'watchlist']) {
      await queryRunner.query(
        `CREATE TABLE "${table}" ("id" integer PRIMARY KEY, "mediaId" integer)`
      );
    }
    await queryRunner.query(
      `CREATE TABLE "season" (
        "id" integer PRIMARY KEY,
        "seasonNumber" integer NOT NULL,
        "status" integer NOT NULL,
        "status4k" integer NOT NULL,
        "mediaId" integer NOT NULL,
        UNIQUE ("mediaId", "seasonNumber")
      )`
    );
    await queryRunner.query(
      `CREATE TABLE "media_identifier" (
        "id" integer PRIMARY KEY,
        "mediaId" integer,
        "provider" varchar NOT NULL,
        "value" varchar NOT NULL,
        UNIQUE ("mediaId", "provider", "value")
      )`
    );
    await queryRunner.query(
      `CREATE TABLE "blocklist" (
        "id" integer PRIMARY KEY,
        "mediaId" integer UNIQUE
      )`
    );
    await queryRunner.query(
      `INSERT INTO "media" (
        "id", "mediaType", "tmdbId", "tvdbId", "status", "status4k",
        "updatedAt", "ratingKey", "ratingKey4k"
      ) VALUES
        (1, 'movie', 100, 77, 5, 1, '2026-01-01', 'standard-key', NULL),
        (2, 'movie', 100, NULL, 1, 5, '2026-02-01', NULL, '4k-key')`
    );
    for (const table of ['media_request', 'issue', 'watchlist']) {
      await queryRunner.query(
        `INSERT INTO "${table}" ("id", "mediaId") VALUES (1, 1), (2, 2)`
      );
    }
    await queryRunner.query(
      `INSERT INTO "season" ("id", "seasonNumber", "status", "status4k", "mediaId")
       VALUES (1, 1, 5, 1, 1), (2, 1, 2, 5, 2)`
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("id", "mediaId", "provider", "value")
       VALUES
         (1, 1, 'tmdb', '100'),
         (2, 2, 'tmdb', '100'),
         (3, 1, 'imdb', 'tt100')`
    );
    await queryRunner.query(
      `INSERT INTO "blocklist" ("id", "mediaId") VALUES (1, 1)`
    );

    await migration.up(queryRunner);

    assert.deepEqual(
      await queryRunner.query(
        `SELECT "id", "tvdbId", "status", "status4k", "ratingKey", "ratingKey4k"
         FROM "media"`
      ),
      [
        {
          id: 2,
          tvdbId: 77,
          status: 5,
          status4k: 5,
          ratingKey: 'standard-key',
          ratingKey4k: '4k-key',
        },
      ]
    );
    for (const table of ['media_request', 'issue', 'watchlist', 'blocklist']) {
      assert.deepEqual(
        await queryRunner.query(
          `SELECT DISTINCT "mediaId" FROM "${table}" ORDER BY "mediaId"`
        ),
        [{ mediaId: 2 }]
      );
    }
    assert.deepEqual(
      await queryRunner.query(
        `SELECT "mediaId", "seasonNumber", "status", "status4k" FROM "season"`
      ),
      [{ mediaId: 2, seasonNumber: 1, status: 5, status4k: 5 }]
    );
    assert.deepEqual(
      await queryRunner.query(
        `SELECT "mediaId", "provider", "value" FROM "media_identifier"
         ORDER BY "provider"`
      ),
      [
        { mediaId: 2, provider: 'imdb', value: 'tt100' },
        { mediaId: 2, provider: 'tmdb', value: '100' },
      ]
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "media" (
          "id", "mediaType", "tmdbId", "status", "status4k", "updatedAt"
        ) VALUES (3, 'movie', 100, 1, 1, '2026-03-01')`
      ),
      /unique/i
    );
    await queryRunner.query(
      `INSERT INTO "media" (
        "id", "mediaType", "tmdbId", "status", "status4k", "updatedAt"
      ) VALUES (3, 'book', 100, 1, 1, '2026-03-01')`
    );

    await migration.down(queryRunner);
    await queryRunner.query(
      `INSERT INTO "media" (
        "id", "mediaType", "tmdbId", "status", "status4k", "updatedAt"
      ) VALUES (4, 'movie', 100, 1, 1, '2026-04-01')`
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
