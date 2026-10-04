import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMusicFoundation1780000000000 implements MigrationInterface {
  name = 'AddMusicFoundation1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "metadata_album" ("id" SERIAL NOT NULL, "mbAlbumId" character varying NOT NULL, "caaUrl" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_metadata_album_mbAlbumId" UNIQUE ("mbAlbumId"), CONSTRAINT "PK_metadata_album" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE TABLE "metadata_artist" ("id" SERIAL NOT NULL, "mbArtistId" character varying NOT NULL, "tmdbPersonId" character varying, "tmdbThumb" character varying, "tmdbUpdatedAt" TIMESTAMP WITH TIME ZONE, "tadbThumb" character varying, "tadbCover" character varying, "tadbUpdatedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_metadata_artist_mbArtistId" UNIQUE ("mbArtistId"), CONSTRAINT "PK_metadata_artist" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(`ALTER TABLE "media" ADD "mbId" character varying`);
    await queryRunner.query(
      `ALTER TABLE "override_rule" ADD "lidarrServiceId" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "watchlist" ADD "mbId" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "watchlist" ALTER COLUMN "tmdbId" DROP NOT NULL`
    );
    await queryRunner.query(`ALTER TABLE "user" ADD "musicQuotaLimit" integer`);
    await queryRunner.query(`ALTER TABLE "user" ADD "musicQuotaDays" integer`);
    await queryRunner.query(
      `CREATE INDEX "IDX_media_mbId" ON "media" ("mbId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_watchlist_mbId" ON "watchlist" ("mbId")`
    );
    await queryRunner.query(
      `ALTER TABLE "watchlist" ADD CONSTRAINT "UNIQUE_USER_MUSIC" UNIQUE ("mbId", "requestedById")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "watchlist" DROP CONSTRAINT "UNIQUE_USER_MUSIC"`
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_watchlist_mbId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_media_mbId"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaDays"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "musicQuotaLimit"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "mbId"`);
    await queryRunner.query(
      `ALTER TABLE "override_rule" DROP COLUMN "lidarrServiceId"`
    );
    await queryRunner.query(
      `ALTER TABLE "watchlist" ALTER COLUMN "tmdbId" SET NOT NULL`
    );
    await queryRunner.query(`ALTER TABLE "watchlist" DROP COLUMN "mbId"`);
    await queryRunner.query(`DROP TABLE "metadata_artist"`);
    await queryRunner.query(`DROP TABLE "metadata_album"`);
  }
}
