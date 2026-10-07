import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryRunner } from 'typeorm';
import { NormalizePrivateLibraryTimestamps1791040000000 } from './1791040000000-NormalizePrivateLibraryTimestamps';

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

test('normalizes private-library PostgreSQL timestamp types using the configured timezone', async () => {
  const statements: string[] = [];
  const queryRunner = {
    query: async (statement: string) => {
      statements.push(statement.replace(/\s+/g, ' ').trim());
    },
  } as unknown as QueryRunner;
  const migration = new NormalizePrivateLibraryTimestamps1791040000000();

  await migration.up(queryRunner);
  assert.equal(statements.length, timestampColumns.length);
  for (const [table, column] of timestampColumns) {
    assert.ok(
      statements.includes(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP WITH TIME ZONE USING "${column}" AT TIME ZONE current_setting('TimeZone')`
      )
    );
  }

  statements.length = 0;
  await migration.down(queryRunner);
  assert.equal(statements.length, timestampColumns.length);
  for (const [table, column] of [...timestampColumns].reverse()) {
    assert.ok(
      statements.includes(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP WITHOUT TIME ZONE USING "${column}" AT TIME ZONE current_setting('TimeZone')`
      )
    );
  }
});
