import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueUserExternalIds1781600000000 implements MigrationInterface {
  name = 'UniqueUserExternalIds1781600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "user" AS duplicate
      SET "plexId" = NULL,
          "plexToken" = NULL,
          "plexUsername" = NULL,
          "userType" = CASE WHEN duplicate."userType" = 1 THEN 2 ELSE duplicate."userType" END
      WHERE duplicate."plexId" IS NOT NULL
        AND duplicate."id" <> (
          SELECT keeper."id"
          FROM "user" AS keeper
          WHERE keeper."plexId" = duplicate."plexId"
          ORDER BY CASE WHEN keeper."id" = 1 THEN 0 ELSE 1 END, keeper."id"
          LIMIT 1
        )
    `);
    await queryRunner.query(`
      UPDATE "user" AS duplicate
      SET "jellyfinUserId" = NULL,
          "jellyfinAuthToken" = NULL,
          "jellyfinDeviceId" = NULL,
          "jellyfinUsername" = NULL,
          "userType" = CASE WHEN duplicate."userType" IN (3, 4) THEN 2 ELSE duplicate."userType" END
      WHERE duplicate."jellyfinUserId" IS NOT NULL
        AND duplicate."id" <> (
          SELECT keeper."id"
          FROM "user" AS keeper
          WHERE keeper."jellyfinUserId" = duplicate."jellyfinUserId"
          ORDER BY CASE WHEN keeper."id" = 1 THEN 0 ELSE 1 END, keeper."id"
          LIMIT 1
        )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_plex_id_unique" ON "user" ("plexId")`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_jellyfin_user_id_unique" ON "user" ("jellyfinUserId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_user_jellyfin_user_id_unique"`
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_user_plex_id_unique"`);
  }
}
