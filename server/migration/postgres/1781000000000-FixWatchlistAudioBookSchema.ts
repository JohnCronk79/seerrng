import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FixWatchlistAudioBookSchema1781000000000 implements MigrationInterface {
  name = 'FixWatchlistAudioBookSchema1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "watchlist" ADD CONSTRAINT "UNIQUE_USER_BOOK" UNIQUE ("externalId", "requestedById")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "watchlist" DROP CONSTRAINT "UNIQUE_USER_BOOK"`
    );
  }
}
