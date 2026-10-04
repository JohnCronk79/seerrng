import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAudioPlaybackVariants1784800000000 implements MigrationInterface {
  name = 'AddAudioPlaybackVariants1784800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "media" ADD "ratingKeyMp3" varchar`);
    await queryRunner.query(`ALTER TABLE "media" ADD "ratingKeyFlac" varchar`);
    await queryRunner.query(
      `ALTER TABLE "media" ADD "jellyfinMediaIdMp3" varchar`
    );
    await queryRunner.query(
      `ALTER TABLE "media" ADD "jellyfinMediaIdFlac" varchar`
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
