import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { EnforceCanonicalBookIdentifierUniqueness1782800000000 } from './1782800000000-EnforceCanonicalBookIdentifierUniqueness';

test('SQLite canonical book identifier migration repairs and enforces ownership', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new EnforceCanonicalBookIdentifierUniqueness1782800000000();
  try {
    await queryRunner.query(
      `CREATE TABLE "media" (
        "id" integer PRIMARY KEY,
        "mediaType" varchar NOT NULL,
        "status" integer NOT NULL
      )`
    );
    await queryRunner.query(
      `CREATE TABLE "media_request" (
        "id" integer PRIMARY KEY,
        "mediaId" integer
      )`
    );
    await queryRunner.query(
      `CREATE TABLE "media_identifier" (
        "id" integer PRIMARY KEY,
        "mediaId" integer,
        "provider" varchar NOT NULL,
        "value" varchar NOT NULL
      )`
    );
    await queryRunner.query(
      `INSERT INTO "media" ("id", "mediaType", "status") VALUES
        (1, 'book', 1),
        (2, 'book', 5),
        (3, 'book', 1),
        (4, 'movie', 5)`
    );
    await queryRunner.query(
      `INSERT INTO "media_request" ("id", "mediaId") VALUES (1, 3)`
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("id", "mediaId", "provider", "value") VALUES
        (1, 1, 'openlibrary', 'OL1W'),
        (2, 2, 'openlibrary', 'OL1W'),
        (3, 1, 'isbn', '9780000000001'),
        (4, 3, 'isbn', '9780000000001'),
        (5, 1, 'readarr', '10'),
        (6, 2, 'readarr', '10'),
        (7, 1, 'tmdb', '55'),
        (8, 4, 'tmdb', '55'),
        (9, 4, 'openlibrary', 'OL1W'),
        (10, NULL, 'isbn', '9780000000001')`
    );

    await migration.up(queryRunner);

    assert.deepEqual(
      await queryRunner.query(
        `SELECT "id", "mediaId", "provider", "value"
         FROM "media_identifier" ORDER BY "id"`
      ),
      [
        { id: 2, mediaId: 2, provider: 'openlibrary', value: 'OL1W' },
        { id: 4, mediaId: 3, provider: 'isbn', value: '9780000000001' },
        { id: 5, mediaId: 1, provider: 'readarr', value: '10' },
        { id: 6, mediaId: 2, provider: 'readarr', value: '10' },
        { id: 7, mediaId: 1, provider: 'tmdb', value: '55' },
        { id: 8, mediaId: 4, provider: 'tmdb', value: '55' },
      ]
    );
    await assert.rejects(
      queryRunner.query(
        `INSERT INTO "media_identifier" ("id", "mediaId", "provider", "value")
         VALUES (11, 1, 'openlibrary', 'OL1W')`
      ),
      /unique/i
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("id", "mediaId", "provider", "value")
       VALUES (11, 3, 'tmdb', '55')`
    );

    await migration.down(queryRunner);
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("id", "mediaId", "provider", "value")
       VALUES (12, 1, 'openlibrary', 'OL1W')`
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
