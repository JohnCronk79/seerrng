import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetDeliveryPending1782100000000 implements MigrationInterface {
  name = 'AddPasswordResetDeliveryPending1782100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "resetPasswordDeliveryPending" boolean NOT NULL DEFAULT (0)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "resetPasswordDeliveryPending"`
    );
  }
}
