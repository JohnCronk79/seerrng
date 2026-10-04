import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookRequestFormat1780500000000 implements MigrationInterface {
  name = 'AddBookRequestFormat1780500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" ADD "bookFormat" varchar`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "media_request" DROP COLUMN "bookFormat"`
    );
  }
}
