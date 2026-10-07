import type { MigrationInterface, QueryRunner } from 'typeorm';

const timestampColumns = [
  ['game_library_entry', 'lastSyncedAt'],
  ['game_library_entry', 'createdAt'],
  ['game_library_entry', 'updatedAt'],
  ['game_library_account', 'lastSyncedAt'],
  ['game_library_account', 'linkedAt'],
  ['game_library_account', 'updatedAt'],
  ['reader_delivery_grouping', 'lastSyncedAt'],
  ['reader_delivery_grouping', 'createdAt'],
  ['reader_delivery_grouping', 'updatedAt'],
] as const;

export class NormalizePrivateLibraryTimestamps1791040000000 implements MigrationInterface {
  name = 'NormalizePrivateLibraryTimestamps1791040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of timestampColumns) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ALTER COLUMN "${column}" TYPE TIMESTAMP WITH TIME ZONE
        USING "${column}" AT TIME ZONE current_setting('TimeZone')
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of [...timestampColumns].reverse()) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ALTER COLUMN "${column}" TYPE TIMESTAMP WITHOUT TIME ZONE
        USING "${column}" AT TIME ZONE current_setting('TimeZone')
      `);
    }
  }
}
