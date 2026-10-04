import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueUserExternalIds1781600000000 implements MigrationInterface {
  name = 'UniqueUserExternalIds1781600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Retain the primary administrator when it shares an identity; otherwise
    // retain the oldest account. Duplicate identity rows are unsafe because
    // provider login can resolve to an arbitrary local account.
    await queryRunner.query(`
      UPDATE "user"
      SET "plexId" = NULL,
          "plexToken" = NULL,
          "plexUsername" = NULL,
          "userType" = CASE WHEN "userType" = 1 THEN 2 ELSE "userType" END
      WHERE "plexId" IS NOT NULL
        AND "id" <> (
          SELECT keeper."id"
          FROM "user" keeper
          WHERE keeper."plexId" = "user"."plexId"
          ORDER BY CASE WHEN keeper."id" = 1 THEN 0 ELSE 1 END, keeper."id"
          LIMIT 1
        )
    `);
    await queryRunner.query(`
      UPDATE "user"
      SET "jellyfinUserId" = NULL,
          "jellyfinAuthToken" = NULL,
          "jellyfinDeviceId" = NULL,
          "jellyfinUsername" = NULL,
          "userType" = CASE WHEN "userType" IN (3, 4) THEN 2 ELSE "userType" END
      WHERE "jellyfinUserId" IS NOT NULL
        AND "id" <> (
          SELECT keeper."id"
          FROM "user" keeper
          WHERE keeper."jellyfinUserId" = "user"."jellyfinUserId"
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
    await queryRunner.query(`DROP INDEX "IDX_user_jellyfin_user_id_unique"`);
    await queryRunner.query(`DROP INDEX "IDX_user_plex_id_unique"`);
  }
}
