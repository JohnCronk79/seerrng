import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPasswordChangedAt1781500000000 implements MigrationInterface {
  name = 'AddUserPasswordChangedAt1781500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "passwordChangedAt" TIMESTAMP WITH TIME ZONE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "passwordChangedAt"`
    );
  }
}
