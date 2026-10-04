import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChaptarrPendingBookTracking1790214517393 implements MigrationInterface {
  name = 'AddChaptarrPendingBookTracking1790214517393';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "book_request_search" ALTER COLUMN "bookId" DROP NOT NULL'
    );
    await queryRunner.query(
      'ALTER TABLE "book_request_search" ALTER COLUMN "commandId" DROP NOT NULL'
    );
    await queryRunner.query(
      'ALTER TABLE "book_request_search" ADD "providerBookId" character varying(512)'
    );
    await queryRunner.query(
      'ALTER TABLE "book_request_search" ADD "providerEditionId" character varying(512)'
    );
    await queryRunner.query(
      'ALTER TABLE "book_request_search" ADD "pendingId" integer'
    );
    await queryRunner.query(`
      UPDATE "book_request_search"
      SET "providerBookId" = (
        SELECT "media_identifier"."value"
        FROM "media_identifier"
        INNER JOIN "media_request" ON "media_request"."mediaId" = "media_identifier"."mediaId"
        WHERE "media_request"."id" = "book_request_search"."requestId"
          AND "media_identifier"."provider" = 'readarr'
        ORDER BY "media_identifier"."id" ASC
        LIMIT 1
      )
      WHERE "providerBookId" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DELETE FROM "book_request_search" WHERE "bookId" IS NULL OR "commandId" IS NULL'
    );
    await queryRunner.query(
      'ALTER TABLE "book_request_search" DROP COLUMN "pendingId"'
    );
    await queryRunner.query(
      'ALTER TABLE "book_request_search" DROP COLUMN "providerEditionId"'
    );
    await queryRunner.query(
      'ALTER TABLE "book_request_search" DROP COLUMN "providerBookId"'
    );
    await queryRunner.query(
      'ALTER TABLE "book_request_search" ALTER COLUMN "commandId" SET NOT NULL'
    );
    await queryRunner.query(
      'ALTER TABLE "book_request_search" ALTER COLUMN "bookId" SET NOT NULL'
    );
  }
}
