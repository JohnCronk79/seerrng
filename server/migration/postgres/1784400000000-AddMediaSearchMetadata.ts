import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaSearchMetadata1784400000000 implements MigrationInterface {
  name = 'AddMediaSearchMetadata1784400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "media_search_metadata" (
        "mediaId" integer NOT NULL,
        "title" text,
        "alternateTitle" text,
        "releaseDate" text,
        "genres" text,
        "runtime" text,
        "creator" text,
        "director" text,
        "writer" text,
        "studio" text,
        "network" text,
        "artist" text,
        "albumType" text,
        "author" text,
        "publisher" text,
        "format" text,
        "provider" text,
        "externalIds" text,
        "searchText" text NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "refreshedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_search_metadata" PRIMARY KEY ("mediaId"),
        CONSTRAINT "FK_media_search_metadata_media"
          FOREIGN KEY ("mediaId") REFERENCES "media"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_media_search_metadata_searchText" ON "media_search_metadata" ("searchText")'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX "IDX_media_search_metadata_searchText"'
    );
    await queryRunner.query('DROP TABLE "media_search_metadata"');
  }
}
