import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeJellyfinUserIds1783000000000 implements MigrationInterface {
  name = 'NormalizeJellyfinUserIds1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const canonical = (alias: string) =>
      `lower(replace(trim(${alias}."jellyfinUserId"), '-', ''))`;
    const isGuid = (alias: string) => `${canonical(alias)} ~ '^[0-9a-f]{32}$'`;

    await queryRunner.query(`
      UPDATE "user" AS duplicate
      SET "jellyfinUserId" = NULL,
          "jellyfinAuthToken" = NULL,
          "jellyfinDeviceId" = NULL,
          "jellyfinUsername" = NULL,
          "userType" = CASE WHEN duplicate."userType" IN (3, 4) THEN 2 ELSE duplicate."userType" END
      WHERE duplicate."jellyfinUserId" IS NOT NULL
        AND ${isGuid('duplicate')}
        AND duplicate."id" <> (
          SELECT keeper."id"
          FROM "user" AS keeper
          WHERE keeper."jellyfinUserId" IS NOT NULL
            AND ${isGuid('keeper')}
            AND ${canonical('keeper')} = ${canonical('duplicate')}
          ORDER BY CASE WHEN keeper."id" = 1 THEN 0 ELSE 1 END, keeper."id"
          LIMIT 1
        )
    `);
    await queryRunner.query(`
      UPDATE "user"
      SET "jellyfinUserId" = lower(replace(trim("jellyfinUserId"), '-', ''))
      WHERE "jellyfinUserId" IS NOT NULL
        AND lower(replace(trim("jellyfinUserId"), '-', '')) ~ '^[0-9a-f]{32}$'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    // Canonicalization and duplicate credential removal are intentionally
    // irreversible because restoring ambiguous identities is unsafe.
  }
}
