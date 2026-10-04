import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaIdentifiers1780200000000 implements MigrationInterface {
  name = 'AddMediaIdentifiers1780200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "media_identifier" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "provider" varchar NOT NULL, "value" varchar NOT NULL, "canonical" boolean NOT NULL DEFAULT (0), "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "mediaId" integer, CONSTRAINT "UNIQUE_MEDIA_IDENTIFIER" UNIQUE ("mediaId", "provider", "value"), CONSTRAINT "FK_media_identifier_media" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_identifier_provider_value" ON "media_identifier" ("provider", "value")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_media_identifier_mediaId" ON "media_identifier" ("mediaId")`
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("mediaId", "provider", "value", "canonical") SELECT "id", 'tmdb', CAST("tmdbId" AS text), 1 FROM "media" WHERE "tmdbId" IS NOT NULL AND "mediaType" IN ('movie', 'tv')`
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("mediaId", "provider", "value", "canonical") SELECT "id", 'tvdb', CAST("tvdbId" AS text), 0 FROM "media" WHERE "tvdbId" IS NOT NULL`
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("mediaId", "provider", "value", "canonical") SELECT "id", 'imdb', "imdbId", 0 FROM "media" WHERE "imdbId" IS NOT NULL`
    );
    await queryRunner.query(
      `INSERT INTO "media_identifier" ("mediaId", "provider", "value", "canonical") SELECT "id", 'musicbrainz', "mbId", 1 FROM "media" WHERE "mbId" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_media_identifier_mediaId"`);
    await queryRunner.query(`DROP INDEX "IDX_media_identifier_provider_value"`);
    await queryRunner.query(`DROP TABLE "media_identifier"`);
  }
}
