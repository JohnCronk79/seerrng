import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddAudioPlaybackVariants1784800000000 } from './1784800000000-AddAudioPlaybackVariants';

test('SQLite audio playback variant migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'sqlite',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddAudioPlaybackVariants1784800000000();

  try {
    await queryRunner.query(
      `CREATE TABLE "media" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "ratingKey" varchar)`
    );
    await queryRunner.query(
      `INSERT INTO "media" ("id", "ratingKey") VALUES (1, 'legacy')`
    );

    await migration.up(queryRunner);
    const addedColumns = (await queryRunner.query(`PRAGMA table_info("media")`))
      .map((column: { name: string }) => column.name)
      .filter((name: string) =>
        [
          'ratingKeyMp3',
          'ratingKeyFlac',
          'jellyfinMediaIdMp3',
          'jellyfinMediaIdFlac',
        ].includes(name)
      );
    assert.deepStrictEqual(addedColumns, [
      'ratingKeyMp3',
      'ratingKeyFlac',
      'jellyfinMediaIdMp3',
      'jellyfinMediaIdFlac',
    ]);
    assert.deepStrictEqual(
      await queryRunner.query(
        `SELECT "ratingKey", "ratingKeyMp3", "ratingKeyFlac", "jellyfinMediaIdMp3", "jellyfinMediaIdFlac" FROM "media" WHERE "id" = 1`
      ),
      [
        {
          ratingKey: 'legacy',
          ratingKeyMp3: null,
          ratingKeyFlac: null,
          jellyfinMediaIdMp3: null,
          jellyfinMediaIdFlac: null,
        },
      ]
    );

    await migration.down(queryRunner);
    const remainingColumns = (
      await queryRunner.query(`PRAGMA table_info("media")`)
    ).map((column: { name: string }) => column.name);
    assert.deepStrictEqual(remainingColumns, ['id', 'ratingKey']);
    assert.equal(
      (
        await queryRunner.query(
          `SELECT "ratingKey" FROM "media" WHERE "id" = 1`
        )
      )[0].ratingKey,
      'legacy'
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
