import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DropPushSubscriptionAuthUnique1781700000000 implements MigrationInterface {
  name = 'DropPushSubscriptionAuthUnique1781700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_push_subscription" DROP CONSTRAINT IF EXISTS "UQ_f90ab5a4ed54905a4bb51a7148b"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_push_subscription" ADD CONSTRAINT "UQ_f90ab5a4ed54905a4bb51a7148b" UNIQUE ("auth")`
    );
  }
}
