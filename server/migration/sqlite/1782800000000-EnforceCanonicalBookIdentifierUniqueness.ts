import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceCanonicalBookIdentifierUniqueness1782800000000 implements MigrationInterface {
  name = 'EnforceCanonicalBookIdentifierUniqueness1782800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "media_identifier"
       WHERE "provider" IN ('isbn', 'openlibrary', 'openlibrary_edition')
         AND NOT EXISTS (
           SELECT 1 FROM "media"
           WHERE "media"."id" = "media_identifier"."mediaId"
             AND "media"."mediaType" = 'book'
         )`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "duplicate_book_identifier"`);
    await queryRunner.query(
      `CREATE TEMPORARY TABLE "duplicate_book_identifier" (
        "id" integer PRIMARY KEY NOT NULL
      )`
    );
    await queryRunner.query(
      `INSERT INTO "duplicate_book_identifier" ("id")
       SELECT "id"
       FROM (
         SELECT identifier."id",
           ROW_NUMBER() OVER (
             PARTITION BY identifier."provider", identifier."value"
             ORDER BY
               CASE WHEN EXISTS (
                 SELECT 1 FROM "media_request" request
                 WHERE request."mediaId" = identifier."mediaId"
               ) THEN 0 ELSE 1 END,
               CASE media."status"
                 WHEN 5 THEN 0
                 WHEN 3 THEN 1
                 WHEN 1 THEN 2
                 ELSE 3
               END,
               identifier."id" ASC
           ) AS "position"
         FROM "media_identifier" identifier
         INNER JOIN "media" media ON media."id" = identifier."mediaId"
         WHERE identifier."provider" IN (
             'isbn', 'openlibrary', 'openlibrary_edition'
           )
       ) ranked
       WHERE "position" > 1`
    );
    await queryRunner.query(
      `DELETE FROM "media_identifier"
       WHERE "id" IN (SELECT "id" FROM "duplicate_book_identifier")`
    );
    await queryRunner.query(`DROP TABLE "duplicate_book_identifier"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_media_identifier_canonical_book"
       ON "media_identifier" ("provider", "value")
       WHERE "provider" IN ('isbn', 'openlibrary', 'openlibrary_edition')`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_media_identifier_canonical_book"`);
  }
}
