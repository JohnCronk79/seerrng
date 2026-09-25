import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAudioPlaybackVariants1784800000000 implements MigrationInterface {
  name = 'AddAudioPlaybackVariants1784800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media" ADD COLUMN "ratingKeyMp3" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD COLUMN "ratingKeyFlac" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD COLUMN "jellyfinMediaIdMp3" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD COLUMN "jellyfinMediaIdFlac" varchar`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media" DROP COLUMN "jellyfinMediaIdFlac"`
    );
    await queryRunner.query(
      `ALTER TABLE "media" DROP COLUMN "jellyfinMediaIdMp3"`
    );
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "ratingKeyFlac"`);
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "ratingKeyMp3"`);
  }
}
