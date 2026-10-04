import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationOutbox1782200000000 implements MigrationInterface {
  name = 'AddNotificationOutbox1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notification_outbox" ("id" SERIAL NOT NULL, "type" integer NOT NULL, "payload" text NOT NULL, "targetAgents" text NOT NULL, "deliveredAgents" text NOT NULL, "attempts" integer NOT NULL DEFAULT 0, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lastAttemptAt" TIMESTAMP WITH TIME ZONE, "claimToken" character varying(64), "claimedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_notification_outbox" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_outbox_created_at" ON "notification_outbox" ("createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_outbox_claimed_at" ON "notification_outbox" ("claimedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_notification_outbox_claimed_at"`);
    await queryRunner.query(`DROP INDEX "IDX_notification_outbox_created_at"`);
    await queryRunner.query(`DROP TABLE "notification_outbox"`);
  }
}
