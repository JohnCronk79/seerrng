import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveBlocklistTmdbMediaTypeUnique1781100000000 implements MigrationInterface {
  name = 'RemoveBlocklistTmdbMediaTypeUnique1781100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blocklist" DROP CONSTRAINT "UQ_81504e02db89b4c1e3152729fa6"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blocklist" ADD CONSTRAINT "UQ_81504e02db89b4c1e3152729fa6" UNIQUE ("tmdbId", "mediaType")`
    );
  }
}
