import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAvailableMusicServiceIds1784900000000 implements MigrationInterface {
  name = 'AddAvailableMusicServiceIds1784900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media" ADD COLUMN "availableMusicServiceIds" text`
    );
    await queryRunner.query(
      `UPDATE "media" SET "availableMusicServiceIds" = '[' || CAST("serviceId" AS varchar) || ']' WHERE "mediaType" = 'music' AND "status" = 5 AND "serviceId" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media" DROP COLUMN "availableMusicServiceIds"`
    );
  }
}
