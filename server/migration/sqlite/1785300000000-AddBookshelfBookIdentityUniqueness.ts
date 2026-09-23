import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookshelfBookIdentityUniqueness1785300000000 implements MigrationInterface {
  name = 'AddBookshelfBookIdentityUniqueness1785300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_media_identifier_canonical_book"`
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_media_identifier_canonical_book"
      ON "media_identifier" ("provider", "value")
      WHERE "provider" IN ('isbn', 'openlibrary', 'openlibrary_edition', 'bookshelf')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_media_identifier_canonical_book"`
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_media_identifier_canonical_book"
      ON "media_identifier" ("provider", "value")
      WHERE "provider" IN ('isbn', 'openlibrary', 'openlibrary_edition')
    `);
  }
}
