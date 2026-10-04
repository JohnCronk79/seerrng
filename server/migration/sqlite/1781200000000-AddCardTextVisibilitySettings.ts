import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCardTextVisibilitySettings1781200000000 implements MigrationInterface {
  name = 'AddCardTextVisibilitySettings1781200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "cardTextVisibilityMovie" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "cardTextVisibilityTv" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "cardTextVisibilityAlbum" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "cardTextVisibilityBook" varchar`
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
