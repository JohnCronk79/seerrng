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
] as const;

export class EnforceMusicMediaUniqueness1782900000000 implements MigrationInterface {
  name = 'EnforceMusicMediaUniqueness1782900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "media" SET "mbId" = lower(trim("mbId"))
       WHERE "mediaType" = 'music' AND "mbId" IS NOT NULL`
    );
    await queryRunner.query(
      `UPDATE "media" SET "mbId" = NULL
       WHERE "mediaType" = 'music' AND "mbId" = ''`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "duplicate_music_media"`);
    await queryRunner.query(
      `CREATE TEMPORARY TABLE "duplicate_music_media" (
        "duplicateId" integer PRIMARY KEY NOT NULL,
        "keepId" integer NOT NULL,
        "tvdbId" integer
      )`
    );
    await queryRunner.query(
      `INSERT INTO "duplicate_music_media" ("duplicateId", "keepId", "tvdbId")
       SELECT "id", "keepId", "tvdbId"
       FROM (
         SELECT "id", "tvdbId",
           FIRST_VALUE("id") OVER (
             PARTITION BY "mbId"
             ORDER BY "updatedAt" DESC, "id" DESC
           ) AS "keepId",
           COUNT(*) OVER (PARTITION BY "mbId") AS "copies"
         FROM "media"
         WHERE "mediaType" = 'music' AND "mbId" IS NOT NULL
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
             FROM "duplicate_music_media" mapping
             JOIN "media" duplicate ON duplicate."id" = mapping."duplicateId"
             WHERE mapping."keepId" = "media"."id"
               AND duplicate."${column}" IS NOT NULL
             ORDER BY duplicate."updatedAt" DESC, duplicate."id" DESC
             LIMIT 1
           )
         )
         WHERE "id" IN (SELECT "keepId" FROM "duplicate_music_media")`
      );
    }

    for (const column of ['status', 'status4k'] as const) {
      await queryRunner.query(
        `UPDATE "media"
         SET "${column}" = CASE
           WHEN "${column}" = 1 THEN COALESCE(
             (
               SELECT candidate."${column}"
               FROM "media" candidate
               WHERE candidate."id" = "media"."id"
                 OR candidate."id" IN (
                   SELECT "duplicateId" FROM "duplicate_music_media"
                   WHERE "keepId" = "media"."id"
                 )
               ORDER BY
                 CASE WHEN candidate."${column}" = 1 THEN 1 ELSE 0 END,
                 candidate."updatedAt" DESC,
                 candidate."id" DESC
               LIMIT 1
             ),
             "${column}"
           )
           ELSE "${column}"
         END
         WHERE "id" IN (SELECT "keepId" FROM "duplicate_music_media")`
      );
    }

    for (const table of ['media_request', 'issue', 'watchlist'] as const) {
      await queryRunner.query(
        `UPDATE "${table}"
         SET "mediaId" = (
           SELECT "keepId" FROM "duplicate_music_media"
           WHERE "duplicateId" = "${table}"."mediaId"
         )
         WHERE "mediaId" IN (SELECT "duplicateId" FROM "duplicate_music_media")`
      );
    }

    const canonicalMediaId = (alias: string) =>
      `COALESCE((SELECT "keepId" FROM "duplicate_music_media" WHERE "duplicateId" = ${alias}."mediaId"), ${alias}."mediaId")`;
    await queryRunner.query(
      `DELETE FROM "media_identifier"
       WHERE ${canonicalMediaId('media_identifier')} IN (
         SELECT "keepId" FROM "duplicate_music_media"
       )
       AND "id" NOT IN (
         SELECT MIN(identifier."id") FROM "media_identifier" identifier
         WHERE ${canonicalMediaId('identifier')} IN (
           SELECT "keepId" FROM "duplicate_music_media"
         )
         GROUP BY ${canonicalMediaId('identifier')}, identifier."provider", identifier."value"
       )`
    );
    await queryRunner.query(
      `UPDATE "media_identifier"
       SET "mediaId" = (
         SELECT "keepId" FROM "duplicate_music_media"
         WHERE "duplicateId" = "media_identifier"."mediaId"
       )
       WHERE "mediaId" IN (SELECT "duplicateId" FROM "duplicate_music_media")`
    );
    await queryRunner.query(
      `DELETE FROM "blocklist"
       WHERE ${canonicalMediaId('blocklist')} IN (
         SELECT "keepId" FROM "duplicate_music_media"
       )
       AND "id" NOT IN (
         SELECT MIN(item."id") FROM "blocklist" item
         WHERE ${canonicalMediaId('item')} IN (
           SELECT "keepId" FROM "duplicate_music_media"
         )
         GROUP BY ${canonicalMediaId('item')}
       )`
    );
    await queryRunner.query(
      `UPDATE "blocklist"
       SET "mediaId" = (
         SELECT "keepId" FROM "duplicate_music_media"
         WHERE "duplicateId" = "blocklist"."mediaId"
       )
       WHERE "mediaId" IN (SELECT "duplicateId" FROM "duplicate_music_media")`
    );

    await queryRunner.query(
      `UPDATE "media" SET "tvdbId" = NULL
       WHERE "id" IN (SELECT "duplicateId" FROM "duplicate_music_media")`
    );
    await queryRunner.query(
      `DELETE FROM "media"
       WHERE "id" IN (SELECT "duplicateId" FROM "duplicate_music_media")`
    );
    await queryRunner.query(
      `UPDATE "media"
       SET "tvdbId" = COALESCE(
         "tvdbId",
         (
           SELECT mapping."tvdbId" FROM "duplicate_music_media" mapping
           WHERE mapping."keepId" = "media"."id"
             AND mapping."tvdbId" IS NOT NULL
           ORDER BY mapping."duplicateId" DESC LIMIT 1
         )
       )
       WHERE "id" IN (SELECT "keepId" FROM "duplicate_music_media")`
    );
    await queryRunner.query(`DROP TABLE "duplicate_music_media"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_media_music_mbid" ON "media" ("mbId")
       WHERE "mediaType" = 'music' AND "mbId" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_media_music_mbid"`);
  }
}
