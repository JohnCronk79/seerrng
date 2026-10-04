import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RestoreMediaRequestRoutingFields1783300000000 implements MigrationInterface {
  name = 'RestoreMediaRequestRoutingFields1783300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('media_request', 'bookFormat'))) {
      await queryRunner.query(
        `ALTER TABLE "media_request" ADD "bookFormat" varchar`
      );
    }
    if (!(await queryRunner.hasColumn('media_request', 'metadataProfileId'))) {
      await queryRunner.query(
        `ALTER TABLE "media_request" ADD "metadataProfileId" integer`
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('media_request', 'metadataProfileId')) {
      await queryRunner.query(
        `ALTER TABLE "media_request" DROP COLUMN "metadataProfileId"`
      );
    }
    if (await queryRunner.hasColumn('media_request', 'bookFormat')) {
      await queryRunner.query(
        `ALTER TABLE "media_request" DROP COLUMN "bookFormat"`
      );
    }
  }
}
