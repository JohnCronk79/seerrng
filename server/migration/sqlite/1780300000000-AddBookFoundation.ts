import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookFoundation1780300000000 implements MigrationInterface {
  name = 'AddBookFoundation1780300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ADD "bookQuotaLimit" integer`);
    await queryRunner.query(`ALTER TABLE "user" ADD "bookQuotaDays" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "bookQuotaDays"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "bookQuotaLimit"`);
  }
}
