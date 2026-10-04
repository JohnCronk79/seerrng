import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScheduledJobLease1782400000000 implements MigrationInterface {
  name = 'AddScheduledJobLease1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scheduled_job_lease" ("name" character varying(128) NOT NULL, "owner" character varying(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_scheduled_job_lease" PRIMARY KEY ("name"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_job_lease_expires_at" ON "scheduled_job_lease" ("expiresAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_scheduled_job_lease_expires_at"`);
    await queryRunner.query(`DROP TABLE "scheduled_job_lease"`);
  }
}
