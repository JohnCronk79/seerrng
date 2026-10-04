import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEpisodeSelections1784600000000 implements MigrationInterface {
  name = 'AddEpisodeSelections1784600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "issue" ADD COLUMN "problemEpisodeSelections" text`
    );
    await queryRunner.query(
      `ALTER TABLE "season_request" ADD COLUMN "episodeNumbers" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "season_request" DROP COLUMN "episodeNumbers"`
    );
    await queryRunner.query(
      `ALTER TABLE "issue" DROP COLUMN "problemEpisodeSelections"`
    );
  }
}
