import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIssueTargetDetails1784500000000 implements MigrationInterface {
  name = 'AddIssueTargetDetails1784500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "issue" ADD COLUMN "problemEpisodes" text`
    );
    await queryRunner.query(
      `ALTER TABLE "issue" ADD COLUMN "is4k" boolean NOT NULL DEFAULT (0)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "issue" DROP COLUMN "is4k"`);
    await queryRunner.query(
      `ALTER TABLE "issue" DROP COLUMN "problemEpisodes"`
    );
  }
}
