import type { MigrationInterface, QueryRunner } from 'typeorm';

const nullableMediaColumns = [
  'imdbId',
  'mediaAddedAt',
  'serviceId',
  'serviceId4k',
  'externalServiceId',
  'externalServiceId4k',
  'externalServiceSlug',
  'externalServiceSlug4k',
  'audiobookServiceId',
  'audiobookExternalServiceId',
  'audiobookExternalServiceSlug',
  'ratingKey',
  'ratingKey4k',
  'jellyfinMediaId',
  'jellyfinMediaId4k',
  'mbId',
] as const;

export class EnforceScreenMediaUniqueness1782600000000 implements MigrationInterface {
  name = 'EnforceScreenMediaUniqueness1782600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "duplicate_media_map"`);
    await queryRunner.query(
      `CREATE TEMPORARY TABLE "duplicate_media_map" (
        "duplicateId" integer PRIMARY KEY NOT NULL,
        "keepId" integer NOT NULL,
        "tvdbId" integer
      )`
    );
    await queryRunner.query(
      `INSERT INTO "duplicate_media_map" ("duplicateId", "keepId", "tvdbId")
       SELECT "id", "keepId", "tvdbId"
       FROM (
         SELECT "id", "tvdbId",
           FIRST_VALUE("id") OVER (
             PARTITION BY "tmdbId", "mediaType"
             ORDER BY "updatedAt" DESC, "id" DESC
           ) AS "keepId",
           COUNT(*) OVER (PARTITION BY "tmdbId", "mediaType") AS "copies"
         FROM "media"
         WHERE "mediaType" IN ('movie', 'tv') AND "tmdbId" > 0
       ) ranked
       WHERE "copies" > 1 AND "id" <> "keepId"`
    );

    for (const column of nullableMediaColumns) {
      await queryRunner.query(
        `UPDATE "media"
         SET "${column}" = COALESCE(
           "${column}",
           (
             SELECT duplicate."${column}"
             FROM "duplicate_media_map" mapping
             JOIN "media" duplicate ON duplicate."id" = mapping."duplicateId"
             WHERE mapping."keepId" = "media"."id"
               AND duplicate."${column}" IS NOT NULL
             ORDER BY duplicate."updatedAt" DESC, duplicate."id" DESC
             LIMIT 1
           )
         )
         WHERE "id" IN (SELECT "keepId" FROM "duplicate_media_map")`
      );
    }

    await this.mergeMediaStatuses(queryRunner);

    for (const table of ['media_request', 'issue', 'watchlist'] as const) {
      await queryRunner.query(
        `UPDATE "${table}"
         SET "mediaId" = (
           SELECT "keepId" FROM "duplicate_media_map"
           WHERE "duplicateId" = "${table}"."mediaId"
         )
         WHERE "mediaId" IN (SELECT "duplicateId" FROM "duplicate_media_map")`
      );
    }

    await this.mergeSeasons(queryRunner);
    await this.mergeIdentifiers(queryRunner);
    await this.mergeBlocklists(queryRunner);

    await queryRunner.query(
      `UPDATE "media" SET "tvdbId" = NULL
       WHERE "id" IN (SELECT "duplicateId" FROM "duplicate_media_map")`
    );
    await queryRunner.query(
      `DELETE FROM "media"
       WHERE "id" IN (SELECT "duplicateId" FROM "duplicate_media_map")`
    );
    await queryRunner.query(
      `UPDATE "media"
       SET "tvdbId" = COALESCE(
         "tvdbId",
         (
           SELECT mapping."tvdbId" FROM "duplicate_media_map" mapping
           WHERE mapping."keepId" = "media"."id"
             AND mapping."tvdbId" IS NOT NULL
           ORDER BY mapping."duplicateId" DESC LIMIT 1
         )
       )
       WHERE "id" IN (SELECT "keepId" FROM "duplicate_media_map")`
    );
    await queryRunner.query(`DROP TABLE "duplicate_media_map"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_media_screen_tmdb_type"
       ON "media" ("tmdbId", "mediaType")
       WHERE "mediaType" IN ('movie', 'tv') AND "tmdbId" > 0`
    );
  }

  private async mergeMediaStatuses(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['status', 'status4k'] as const) {
      await queryRunner.query(
        `UPDATE "media"
         SET "${column}" = CASE
           WHEN "${column}" = 1 THEN COALESCE(
             (
               SELECT candidate."${column}"
               FROM "media" candidate
               WHERE (
                 candidate."id" = "media"."id"
                 OR candidate."id" IN (
                   SELECT "duplicateId" FROM "duplicate_media_map"
                   WHERE "keepId" = "media"."id"
                 )
               )
                 AND candidate."${column}" <> 1
               ORDER BY candidate."updatedAt" DESC, candidate."id" DESC
               LIMIT 1
             ),
             "${column}"
           )
           ELSE "${column}"
         END
         WHERE "id" IN (SELECT "keepId" FROM "duplicate_media_map")`
      );
    }
  }

  private async mergeSeasons(queryRunner: QueryRunner): Promise<void> {
    const canonicalMediaId = (alias: string) =>
      `COALESCE((SELECT "keepId" FROM "duplicate_media_map" WHERE "duplicateId" = ${alias}."mediaId"), ${alias}."mediaId")`;
    await queryRunner.query(
      `UPDATE "season"
       SET "status" = (
         SELECT MAX(other."status") FROM "season" other
         WHERE ${canonicalMediaId('other')} = ${canonicalMediaId('season')}
           AND other."seasonNumber" = "season"."seasonNumber"
       ),
       "status4k" = (
         SELECT MAX(other."status4k") FROM "season" other
         WHERE ${canonicalMediaId('other')} = ${canonicalMediaId('season')}
           AND other."seasonNumber" = "season"."seasonNumber"
       )
       WHERE ${canonicalMediaId('season')} IN (
         SELECT "keepId" FROM "duplicate_media_map"
       )`
    );
    await queryRunner.query(
      `DELETE FROM "season"
       WHERE ${canonicalMediaId('season')} IN (
         SELECT "keepId" FROM "duplicate_media_map"
       )
       AND "id" NOT IN (
         SELECT MIN(item."id") FROM "season" item
         WHERE ${canonicalMediaId('item')} IN (
           SELECT "keepId" FROM "duplicate_media_map"
         )
         GROUP BY ${canonicalMediaId('item')}, item."seasonNumber"
       )`
    );
    await queryRunner.query(
      `UPDATE "season"
       SET "mediaId" = (
         SELECT "keepId" FROM "duplicate_media_map"
         WHERE "duplicateId" = "season"."mediaId"
       )
       WHERE "mediaId" IN (SELECT "duplicateId" FROM "duplicate_media_map")`
    );
  }

  private async mergeIdentifiers(queryRunner: QueryRunner): Promise<void> {
    const canonicalMediaId = (alias: string) =>
      `COALESCE((SELECT "keepId" FROM "duplicate_media_map" WHERE "duplicateId" = ${alias}."mediaId"), ${alias}."mediaId")`;
    await queryRunner.query(
      `DELETE FROM "media_identifier"
       WHERE ${canonicalMediaId('media_identifier')} IN (
         SELECT "keepId" FROM "duplicate_media_map"
       )
       AND "id" NOT IN (
         SELECT MIN(identifier."id") FROM "media_identifier" identifier
         WHERE ${canonicalMediaId('identifier')} IN (
           SELECT "keepId" FROM "duplicate_media_map"
         )
         GROUP BY ${canonicalMediaId('identifier')}, identifier."provider", identifier."value"
       )`
    );
    await queryRunner.query(
      `UPDATE "media_identifier"
       SET "mediaId" = (
         SELECT "keepId" FROM "duplicate_media_map"
         WHERE "duplicateId" = "media_identifier"."mediaId"
       )
       WHERE "mediaId" IN (SELECT "duplicateId" FROM "duplicate_media_map")`
    );
  }

  private async mergeBlocklists(queryRunner: QueryRunner): Promise<void> {
    const canonicalMediaId = (alias: string) =>
      `COALESCE((SELECT "keepId" FROM "duplicate_media_map" WHERE "duplicateId" = ${alias}."mediaId"), ${alias}."mediaId")`;
    await queryRunner.query(
      `DELETE FROM "blocklist"
       WHERE ${canonicalMediaId('blocklist')} IN (
         SELECT "keepId" FROM "duplicate_media_map"
       )
       AND "id" NOT IN (
         SELECT MIN(item."id") FROM "blocklist" item
         WHERE ${canonicalMediaId('item')} IN (
           SELECT "keepId" FROM "duplicate_media_map"
         )
         GROUP BY ${canonicalMediaId('item')}
       )`
    );
    await queryRunner.query(
      `UPDATE "blocklist"
       SET "mediaId" = (
         SELECT "keepId" FROM "duplicate_media_map"
         WHERE "duplicateId" = "blocklist"."mediaId"
       )
       WHERE "mediaId" IN (SELECT "duplicateId" FROM "duplicate_media_map")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_media_screen_tmdb_type"`);
  }
}
