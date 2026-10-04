import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMusicFoundation1780000000000 implements MigrationInterface {
  name = 'AddMusicFoundation1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "metadata_album" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mbAlbumId" varchar NOT NULL, "caaUrl" varchar, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_metadata_album_mbAlbumId" UNIQUE ("mbAlbumId"))`
    );
    await queryRunner.query(
      `CREATE TABLE "metadata_artist" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mbArtistId" varchar NOT NULL, "tmdbPersonId" varchar, "tmdbThumb" varchar, "tmdbUpdatedAt" datetime, "tadbThumb" varchar, "tadbCover" varchar, "tadbUpdatedAt" datetime, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_metadata_artist_mbArtistId" UNIQUE ("mbArtistId"))`
    );
    await queryRunner.query(`ALTER TABLE "media" ADD "mbId" varchar`);
    await queryRunner.query(
      `ALTER TABLE "override_rule" ADD "lidarrServiceId" integer`
    );
    await queryRunner.query(`ALTER TABLE "watchlist" ADD "mbId" varchar`);
    await queryRunner.query(`ALTER TABLE "user" ADD "musicQuotaLimit" integer`);
    await queryRunner.query(`ALTER TABLE "user" ADD "musicQuotaDays" integer`);
    await queryRunner.query(
      `CREATE INDEX "IDX_media_mbId" ON "media" ("mbId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_watchlist_mbId" ON "watchlist" ("mbId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_watchlist_mbId"`);
    await queryRunner.query(`DROP INDEX "IDX_media_mbId"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaDays"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaLimit"`);
    await queryRunner.query(`ALTER TABLE "watchlist" DROP COLUMN "mbId"`);
    await queryRunner.query(
      `ALTER TABLE "override_rule" DROP COLUMN "lidarrServiceId"`
    );
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "mbId"`);
    await queryRunner.query(`DROP TABLE "metadata_artist"`);
    await queryRunner.query(`DROP TABLE "metadata_album"`);
  }
}
