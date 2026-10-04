import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PreserveBlocklistMediaStatus1781900000000 implements MigrationInterface {
  name = 'PreserveBlocklistMediaStatus1781900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blocklist" ADD "previousStatus" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "blocklist" ADD "previousStatus4k" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "blocklist" ADD "isMediaPlaceholder" boolean`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blocklist" DROP COLUMN "isMediaPlaceholder"`
    );
    await queryRunner.query(
      `ALTER TABLE "blocklist" DROP COLUMN "previousStatus4k"`
    );
    await queryRunner.query(
      `ALTER TABLE "blocklist" DROP COLUMN "previousStatus"`
    );
  }
}
