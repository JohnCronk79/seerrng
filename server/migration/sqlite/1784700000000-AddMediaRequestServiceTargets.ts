import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaRequestServiceTargets1784700000000 implements MigrationInterface {
  name = 'AddMediaRequestServiceTargets1784700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD COLUMN "serviceTargets" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP COLUMN "serviceTargets"`
    );
  }
}
