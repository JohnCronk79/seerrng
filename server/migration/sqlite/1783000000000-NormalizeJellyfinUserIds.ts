import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeJellyfinUserIds1783000000000 implements MigrationInterface {
  name = 'NormalizeJellyfinUserIds1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const canonical = (alias: string) =>
      `lower(replace(trim(${alias}."jellyfinUserId"), '-', ''))`;
    const isGuid = (alias: string) =>
      `length(${canonical(alias)}) = 32 AND ${canonical(alias)} NOT GLOB '*[^0-9a-f]*'`;

    // Retain the primary administrator when present, otherwise the oldest
    // account, before canonicalization could collide with the unique index.
    await queryRunner.query(`
      UPDATE "user"
      SET "jellyfinUserId" = NULL,
          "jellyfinAuthToken" = NULL,
          "jellyfinDeviceId" = NULL,
          "jellyfinUsername" = NULL,
          "userType" = CASE WHEN "userType" IN (3, 4) THEN 2 ELSE "userType" END
      WHERE "jellyfinUserId" IS NOT NULL
        AND ${isGuid('"user"')}
        AND "id" <> (
          SELECT keeper."id"
          FROM "user" keeper
          WHERE keeper."jellyfinUserId" IS NOT NULL
            AND ${isGuid('keeper')}
            AND ${canonical('keeper')} = ${canonical('"user"')}
          ORDER BY CASE WHEN keeper."id" = 1 THEN 0 ELSE 1 END, keeper."id"
          LIMIT 1
        )
    `);
    await queryRunner.query(`
      UPDATE "user"
      SET "jellyfinUserId" = lower(replace(trim("jellyfinUserId"), '-', ''))
      WHERE "jellyfinUserId" IS NOT NULL
        AND ${isGuid('"user"')}
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    // Canonicalization and duplicate credential removal are intentionally
    // irreversible because restoring ambiguous identities is unsafe.
  }
}
