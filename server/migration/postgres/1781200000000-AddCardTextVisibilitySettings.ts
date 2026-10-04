import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCardTextVisibilitySettings1781200000000 implements MigrationInterface {
  name = 'AddCardTextVisibilitySettings1781200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "cardTextVisibilityMovie" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "cardTextVisibilityTv" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "cardTextVisibilityAlbum" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "cardTextVisibilityBook" character varying`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "cardTextVisibilityBook"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "cardTextVisibilityAlbum"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "cardTextVisibilityTv"`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "cardTextVisibilityMovie"`
    );
  }
}
