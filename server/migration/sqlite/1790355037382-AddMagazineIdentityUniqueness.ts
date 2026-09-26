import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMagazineIdentityUniqueness1790355037382 implements MigrationInterface {
  name = 'AddMagazineIdentityUniqueness1790355037382';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_media_identifier_canonical_magazine" ON "media_identifier" ("provider", "value") WHERE "provider" = 'lazylibrarian'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_media_identifier_canonical_magazine"`
    );
  }
}
