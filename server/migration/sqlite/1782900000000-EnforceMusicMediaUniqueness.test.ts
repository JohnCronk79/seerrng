import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { EnforceMusicMediaUniqueness1782900000000 } from './1782900000000-EnforceMusicMediaUniqueness';

test('SQLite music-media uniqueness migration merges duplicate relationships', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new EnforceMusicMediaUniqueness1782900000000();
  try {
    await queryRunner.query(
      `CREATE TABLE "media" (
        "id" integer PRIMARY KEY,
        "mediaType" varchar NOT NULL,
        "mbId" varchar,
        "tmdbId" integer NOT NULL,
        "tvdbId" integer UNIQUE,
        "imdbId" varchar,
        "status" integer NOT NULL,
        "status4k" integer NOT NULL,
        "updatedAt" datetime NOT NULL,
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
        "jellyfinMediaId4k" varchar
      )`
    );
    for (const table of ['media_request', 'issue', 'watchlist']) {
      await queryRunner.query(
        `CREATE TABLE "${table}" ("id" integer PRIMARY KEY, "mediaId" integer)`
      );
    }
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
        "id", "mediaType", "mbId", "tmdbId", "tvdbId", "status",
        "status4k", "updatedAt", "serviceId", "ratingKey",
        "externalServiceSlug"
      ) VALUES
        (1, 'music', ' RELEASE-GROUP ', 0, 77, 5, 1, '2026-01-01', 4, 'old-key', NULL),
        (2, 'music', 'release-group', 0, NULL, 1, 1, '2026-02-01', NULL, NULL, 'new-slug'),
        (3, 'music', '', 0, NULL, 1, 1, '2026-03-01', NULL, NULL, NULL)`
    );
    for (const table of ['media_request', 'issue', 'watchlist']) {
      await queryRunner.query(
        `INSERT INTO "${table}" ("id", "mediaId") VALUES (1, 1), (2, 2)`
      );
    }
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("id", "mediaId", "provider", "value") VALUES
        (1, 1, 'musicbrainz', 'release-group'),
        (2, 2, 'musicbrainz', 'release-group'),
        (3, 1, 'lidarr', '10')`
    );
    await queryRunner.query(
      `INSERT INTO "blocklist" ("id", "mediaId") VALUES (1, 1)`
    );

    await migration.up(queryRunner);

    assert.deepEqual(
      await queryRunner.query(
        `SELECT "id", "mbId", "tvdbId", "status", "serviceId",
                "ratingKey", "externalServiceSlug"
         FROM "media" ORDER BY "id"`
      ),
      [
        {
          id: 2,
          mbId: 'release-group',
          tvdbId: 77,
          status: 5,
          serviceId: 4,
          ratingKey: 'old-key',
          externalServiceSlug: 'new-slug',
        },
        {
          id: 3,
          mbId: null,
          tvdbId: null,
          status: 1,
          serviceId: null,
          ratingKey: null,
          externalServiceSlug: null,
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
        `SELECT "mediaId", "provider", "value" FROM "media_identifier"
         ORDER BY "provider"`
      ),
      [
        { mediaId: 2, provider: 'lidarr', value: '10' },
        { mediaId: 2, provider: 'musicbrainz', value: 'release-group' },
      ]
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "media" (
          "id", "mediaType", "mbId", "tmdbId", "status", "status4k", "updatedAt"
        ) VALUES (4, 'music', 'release-group', 0, 1, 1, '2026-04-01')`
      ),
      /unique/i
    );
    await queryRunner.query(
      `INSERT INTO "media" (
        "id", "mediaType", "mbId", "tmdbId", "status", "status4k", "updatedAt"
      ) VALUES (4, 'book', 'release-group', 0, 1, 1, '2026-04-01')`
    );

    await migration.down(queryRunner);
    await queryRunner.query(
      `INSERT INTO "media" (
        "id", "mediaType", "mbId", "tmdbId", "status", "status4k", "updatedAt"
      ) VALUES (5, 'music', 'release-group', 0, 1, 1, '2026-05-01')`
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
