import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceSeasonUniqueness1781800000000 implements MigrationInterface {
  name = 'EnforceSeasonUniqueness1781800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "season" WHERE "mediaId" IS NULL`);
    await queryRunner.query(
      `DELETE FROM "season_request" WHERE "requestId" IS NULL`
    );
    await queryRunner.query(`
      WITH merged AS (
        SELECT MIN("id") AS keeper,
               "mediaId",
               "seasonNumber",
               CASE
                 WHEN BOOL_OR("status" = 5) THEN 5
                 WHEN BOOL_OR("status" = 4) THEN 4
                 WHEN BOOL_OR("status" = 3) THEN 3
                 WHEN BOOL_OR("status" = 2) THEN 2
                 WHEN BOOL_OR("status" = 7) THEN 7
                 WHEN BOOL_OR("status" = 1) THEN 1
                 ELSE 6
               END AS status,
               CASE
                 WHEN BOOL_OR("status4k" = 5) THEN 5
                 WHEN BOOL_OR("status4k" = 4) THEN 4
                 WHEN BOOL_OR("status4k" = 3) THEN 3
                 WHEN BOOL_OR("status4k" = 2) THEN 2
                 WHEN BOOL_OR("status4k" = 7) THEN 7
                 WHEN BOOL_OR("status4k" = 1) THEN 1
                 ELSE 6
               END AS status4k
        FROM "season"
        GROUP BY "mediaId", "seasonNumber"
      )
      UPDATE "season" target
      SET "status" = merged.status, "status4k" = merged.status4k
      FROM merged
      WHERE target."id" = merged.keeper
    `);
    await queryRunner.query(`
      DELETE FROM "season" duplicate
      USING "season" keeper
      WHERE duplicate."mediaId" = keeper."mediaId"
        AND duplicate."seasonNumber" = keeper."seasonNumber"
        AND duplicate."id" > keeper."id"
    `);
    await queryRunner.query(`
      WITH merged AS (
        SELECT MIN("id") AS keeper, MAX("status") AS status
        FROM "season_request"
        GROUP BY "requestId", "seasonNumber"
      )
      UPDATE "season_request" target
      SET "status" = merged.status
      FROM merged
      WHERE target."id" = merged.keeper
    `);
    await queryRunner.query(`
      DELETE FROM "season_request" duplicate
      USING "season_request" keeper
      WHERE duplicate."requestId" = keeper."requestId"
        AND duplicate."seasonNumber" = keeper."seasonNumber"
        AND duplicate."id" > keeper."id"
    `);
    await queryRunner.query(
      `ALTER TABLE "season" ALTER COLUMN "mediaId" SET NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "season_request" ALTER COLUMN "requestId" SET NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "season" ADD CONSTRAINT "UNIQUE_MEDIA_SEASON" UNIQUE ("mediaId", "seasonNumber")`
    );
    await queryRunner.query(
      `ALTER TABLE "season_request" ADD CONSTRAINT "UNIQUE_REQUEST_SEASON" UNIQUE ("requestId", "seasonNumber")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "season_request" DROP CONSTRAINT "UNIQUE_REQUEST_SEASON"`
    );
    await queryRunner.query(
      `ALTER TABLE "season" DROP CONSTRAINT "UNIQUE_MEDIA_SEASON"`
    );
    await queryRunner.query(
      `ALTER TABLE "season_request" ALTER COLUMN "requestId" DROP NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "season" ALTER COLUMN "mediaId" DROP NOT NULL`
    );
  }
}
