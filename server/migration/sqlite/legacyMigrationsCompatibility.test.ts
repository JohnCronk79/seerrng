import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddLastSeasonChangeMedia1608477467935 } from './1608477467935-AddLastSeasonChangeMedia';
import { AddDisplayNameToUser1611508672722 } from './1611508672722-AddDisplayNameToUser';
import { AddBlacklistTagsColumn1737320080282 } from './1737320080282-AddBlacklistTagsColumn';

const createDataSource = async (): Promise<DataSource> =>
  new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();

test('SQLite media migration does not read the column it is adding', async () => {
  const dataSource = await createDataSource();
  const queryRunner = dataSource.createQueryRunner();

  try {
    await queryRunner.query(`
      CREATE TABLE "media" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "mediaType" varchar NOT NULL,
        "tmdbId" integer NOT NULL,
        "tvdbId" integer,
        "imdbId" varchar,
        "status" integer NOT NULL DEFAULT (1),
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_7157aad07c73f6a6ae3bbd5ef5" ON "media" ("tmdbId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_41a289eb1fa489c1bc6f38d9c3" ON "media" ("tvdbId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7ff2d11f6a83cb52386eaebe74" ON "media" ("imdbId")`
    );
    await queryRunner.query(
      `INSERT INTO "media" ("mediaType", "tmdbId", "status") VALUES ('movie', 10, 1)`
    );

    await new AddLastSeasonChangeMedia1608477467935().up(queryRunner);

    const rows = await queryRunner.query(
      `SELECT "mediaType", "tmdbId", "lastSeasonChange" FROM "media"`
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].mediaType, 'movie');
    assert.equal(rows[0].tmdbId, 10);
    assert.equal(typeof rows[0].lastSeasonChange, 'string');
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});

test('SQLite user migration uses a string literal for the new nullable username', async () => {
  const dataSource = await createDataSource();
  const queryRunner = dataSource.createQueryRunner();

  try {
    await queryRunner.query(`
      CREATE TABLE "user" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "email" varchar NOT NULL,
        "username" varchar NOT NULL,
        "plexId" integer,
        "plexToken" varchar,
        "permissions" integer NOT NULL DEFAULT (0),
        "avatar" varchar NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
        "password" varchar,
        "userType" integer NOT NULL DEFAULT (1),
        "plexUsername" varchar,
        CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email")
      )
    `);
    await queryRunner.query(
      `INSERT INTO "user" ("email", "username", "avatar") VALUES ('user@example.com', 'user', 'avatar')`
    );

    await new AddDisplayNameToUser1611508672722().up(queryRunner);

    assert.deepEqual(
      await queryRunner.query(
        `SELECT "email", "username", "plexUsername" FROM "user"`
      ),
      [
        {
          email: 'user@example.com',
          username: '',
          plexUsername: 'user',
        },
      ]
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});

test('SQLite blacklist migration omits the column it is adding', async () => {
  const dataSource = await createDataSource();
  const queryRunner = dataSource.createQueryRunner();

  try {
    await queryRunner.query(`CREATE TABLE "user" ("id" integer PRIMARY KEY)`);
    await queryRunner.query(`CREATE TABLE "media" ("id" integer PRIMARY KEY)`);
    await queryRunner.query(`
      CREATE TABLE "blacklist" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "mediaType" varchar NOT NULL,
        "title" varchar,
        "tmdbId" integer NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "userId" integer,
        "mediaId" integer
      )
    `);
    await queryRunner.query(
      `INSERT INTO "blacklist" ("mediaType", "title", "tmdbId") VALUES ('movie', 'Movie', 10)`
    );

    await new AddBlacklistTagsColumn1737320080282().up(queryRunner);

    assert.deepEqual(
      await queryRunner.query(
        `SELECT "title", "tmdbId", "blacklistedTags" FROM "blacklist"`
      ),
      [{ title: 'Movie', tmdbId: 10, blacklistedTags: null }]
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
