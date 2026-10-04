import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenUserPermissions1781300000000 implements MigrationInterface {
  name = 'WidenUserPermissions1781300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "permissions" TYPE bigint USING "permissions"::bigint`
    );
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "permissions" SET DEFAULT '0'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "permissions" TYPE integer USING "permissions"::integer`
    );
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "permissions" SET DEFAULT '0'`
    );
  }
}
