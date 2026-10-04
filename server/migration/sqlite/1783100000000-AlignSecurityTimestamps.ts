import type { MigrationInterface, QueryRunner } from 'typeorm';

// SQLite stores both entity fields as datetime values and has no distinct
// timezone-aware column type. Keep migration numbering aligned with PostgreSQL.
export class AlignSecurityTimestamps1783100000000 implements MigrationInterface {
  name = 'AlignSecurityTimestamps1783100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
  }
}
