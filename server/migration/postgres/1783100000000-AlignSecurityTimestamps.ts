import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignSecurityTimestamps1783100000000 implements MigrationInterface {
  name = 'AlignSecurityTimestamps1783100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_identifier" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE current_setting('TimeZone')`
    );
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "passwordChangedAt" TYPE TIMESTAMP WITH TIME ZONE USING "passwordChangedAt" AT TIME ZONE current_setting('TimeZone')`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "passwordChangedAt" TYPE TIMESTAMP WITHOUT TIME ZONE USING "passwordChangedAt" AT TIME ZONE current_setting('TimeZone')`
    );
    await queryRunner.query(
      `ALTER TABLE "media_identifier" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITHOUT TIME ZONE USING "createdAt" AT TIME ZONE current_setting('TimeZone')`
    );
  }
}
