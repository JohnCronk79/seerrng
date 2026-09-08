import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookRequestSearch1784300000000 implements MigrationInterface {
  name = 'AddBookRequestSearch1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "book_request_search" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "requestId" integer NOT NULL,
        "serviceId" integer NOT NULL,
        "format" varchar(16) NOT NULL,
        "bookId" integer NOT NULL,
        "authorId" integer,
        "commandId" integer NOT NULL,
        "createdBook" boolean NOT NULL DEFAULT (0),
        "createdAuthor" boolean NOT NULL DEFAULT (0),
        "state" varchar(32) NOT NULL DEFAULT ('searching'),
        "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        CONSTRAINT "UQ_book_request_search_request_format"
          UNIQUE ("requestId", "format"),
        CONSTRAINT "FK_book_request_search_request"
          FOREIGN KEY ("requestId") REFERENCES "media_request" ("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_book_request_search_command" ON "book_request_search" ("serviceId", "commandId")'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_book_request_search_command"');
    await queryRunner.query('DROP TABLE "book_request_search"');
  }
}
