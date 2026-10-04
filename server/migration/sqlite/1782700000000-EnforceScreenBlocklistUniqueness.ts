import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceScreenBlocklistUniqueness1782700000000 implements MigrationInterface {
  name = 'EnforceScreenBlocklistUniqueness1782700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "duplicate_blocklist_map"`);
    await queryRunner.query(
      `CREATE TEMPORARY TABLE "duplicate_blocklist_map" (
        "duplicateId" integer PRIMARY KEY NOT NULL,
        "keepId" integer NOT NULL,
        "mediaId" integer
      )`
    );
    await queryRunner.query(
      `INSERT INTO "duplicate_blocklist_map" ("duplicateId", "keepId", "mediaId")
       SELECT "id", "keepId", "mediaId"
       FROM (
         SELECT "id", "mediaId",
           FIRST_VALUE("id") OVER (
             PARTITION BY "tmdbId", "mediaType"
             ORDER BY
               CASE WHEN "blocklistedTags" IS NULL THEN 0 ELSE 1 END,
               CASE WHEN "mediaId" IS NOT NULL THEN 0 ELSE 1 END,
               "createdAt" DESC,
               "id" DESC
           ) AS "keepId",
           COUNT(*) OVER (PARTITION BY "tmdbId", "mediaType") AS "copies"
         FROM "blocklist"
         WHERE "mediaType" IN ('movie', 'tv') AND "tmdbId" > 0
       ) ranked
       WHERE "copies" > 1 AND "id" <> "keepId"`
    );

    for (const column of [
      'title',
      'userId',
      'previousStatus',
      'previousStatus4k',
      'isMediaPlaceholder',
    ] as const) {
      await queryRunner.query(
        `UPDATE "blocklist"
         SET "${column}" = COALESCE(
           "${column}",
           (
             SELECT duplicate."${column}"
             FROM "duplicate_blocklist_map" mapping
             JOIN "blocklist" duplicate ON duplicate."id" = mapping."duplicateId"
             WHERE mapping."keepId" = "blocklist"."id"
               AND duplicate."${column}" IS NOT NULL
             ORDER BY duplicate."createdAt" DESC, duplicate."id" DESC
             LIMIT 1
           )
         )
         WHERE "id" IN (SELECT "keepId" FROM "duplicate_blocklist_map")`
      );
    }

    await queryRunner.query(
      `UPDATE "blocklist"
       SET "mediaId" = NULL
       WHERE "id" IN (SELECT "duplicateId" FROM "duplicate_blocklist_map")`
    );
    await queryRunner.query(
      `UPDATE "blocklist"
       SET "mediaId" = COALESCE(
         "mediaId",
         (
           SELECT mapping."mediaId"
           FROM "duplicate_blocklist_map" mapping
           WHERE mapping."keepId" = "blocklist"."id"
             AND mapping."mediaId" IS NOT NULL
           ORDER BY mapping."duplicateId" DESC
           LIMIT 1
         )
       )
       WHERE "id" IN (SELECT "keepId" FROM "duplicate_blocklist_map")`
    );
    await queryRunner.query(
      `DELETE FROM "blocklist"
       WHERE "id" IN (SELECT "duplicateId" FROM "duplicate_blocklist_map")`
    );
    await queryRunner.query(`DROP TABLE "duplicate_blocklist_map"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_blocklist_screen_tmdb_type"
       ON "blocklist" ("tmdbId", "mediaType")
       WHERE "mediaType" IN ('movie', 'tv') AND "tmdbId" > 0`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_blocklist_screen_tmdb_type"`);
  }
}
