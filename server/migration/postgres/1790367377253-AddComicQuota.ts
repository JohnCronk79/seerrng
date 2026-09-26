import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddComicQuota1790367377253 implements MigrationInterface {
  name = 'AddComicQuota1790367377253';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ADD "comicQuotaLimit" integer`);
    await queryRunner.query(`ALTER TABLE "user" ADD "comicQuotaDays" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "comicQuotaDays"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "comicQuotaLimit"`);
  }
}
