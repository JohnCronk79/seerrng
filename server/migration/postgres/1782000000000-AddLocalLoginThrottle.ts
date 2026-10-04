import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLocalLoginThrottle1782000000000 implements MigrationInterface {
  name = 'AddLocalLoginThrottle1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "failedLoginAttempts" integer NOT NULL DEFAULT 0`
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "lastFailedLoginAt" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD "loginBlockedUntil" TIMESTAMP WITH TIME ZONE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "loginBlockedUntil"`
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "lastFailedLoginAt"`
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "failedLoginAttempts"`
    );
  }
}
