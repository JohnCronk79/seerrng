import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRequestDispatchOutbox1782300000000 implements MigrationInterface {
  name = 'AddRequestDispatchOutbox1782300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "request_dispatch_outbox" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "requestId" integer NOT NULL, "attempts" integer NOT NULL DEFAULT (0), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "lastAttemptAt" datetime, "nextAttemptAt" datetime, "claimToken" varchar(64), "claimedAt" datetime, CONSTRAINT "UQ_request_dispatch_outbox_request_id" UNIQUE ("requestId"), CONSTRAINT "FK_request_dispatch_outbox_request" FOREIGN KEY ("requestId") REFERENCES "media_request" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_dispatch_outbox_created_at" ON "request_dispatch_outbox" ("createdAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_dispatch_outbox_claimed_at" ON "request_dispatch_outbox" ("claimedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_request_dispatch_outbox_next_attempt_at" ON "request_dispatch_outbox" ("nextAttemptAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_request_dispatch_outbox_next_attempt_at"`
    );
    await queryRunner.query(
      `DROP INDEX "IDX_request_dispatch_outbox_claimed_at"`
    );
    await queryRunner.query(
      `DROP INDEX "IDX_request_dispatch_outbox_created_at"`
    );
    await queryRunner.query(`DROP TABLE "request_dispatch_outbox"`);
  }
}
