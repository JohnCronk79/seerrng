import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRequestDispatchOutbox1782300000000 implements MigrationInterface {
  name = 'AddRequestDispatchOutbox1782300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "request_dispatch_outbox" ("id" SERIAL NOT NULL, "requestId" integer NOT NULL, "attempts" integer NOT NULL DEFAULT 0, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lastAttemptAt" TIMESTAMP WITH TIME ZONE, "nextAttemptAt" TIMESTAMP WITH TIME ZONE, "claimToken" character varying(64), "claimedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_request_dispatch_outbox_request_id" UNIQUE ("requestId"), CONSTRAINT "PK_request_dispatch_outbox" PRIMARY KEY ("id"))`
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
    await queryRunner.query(
      `ALTER TABLE "request_dispatch_outbox" ADD CONSTRAINT "FK_request_dispatch_outbox_request" FOREIGN KEY ("requestId") REFERENCES "media_request"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "request_dispatch_outbox" DROP CONSTRAINT "FK_request_dispatch_outbox_request"`
    );
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
