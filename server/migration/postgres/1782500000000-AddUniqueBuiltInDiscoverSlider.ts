import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueBuiltInDiscoverSlider1782500000000 implements MigrationInterface {
  name = 'AddUniqueBuiltInDiscoverSlider1782500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "discover_slider"
       WHERE "isBuiltIn" = true
         AND "id" NOT IN (
           SELECT MIN("id") FROM "discover_slider"
           WHERE "isBuiltIn" = true
           GROUP BY "type"
         )`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_discover_slider_builtin_type"
       ON "discover_slider" ("type") WHERE "isBuiltIn" = true`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_discover_slider_builtin_type"`);
  }
}
