import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryRunner } from 'typeorm';
import { AlignSecurityTimestamps1783100000000 } from './1783100000000-AlignSecurityTimestamps';

test('PostgreSQL security timestamps migrate reversibly with explicit timezone interpretation', async () => {
  const statements: string[] = [];
  const queryRunner = {
    query: async (statement: string) => {
      statements.push(statement);
    },
  } as QueryRunner;
  const migration = new AlignSecurityTimestamps1783100000000();

  await migration.up(queryRunner);
  await migration.down(queryRunner);

  assert.deepStrictEqual(statements, [
    `ALTER TABLE "media_identifier" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE current_setting('TimeZone')`,
    `ALTER TABLE "user" ALTER COLUMN "passwordChangedAt" TYPE TIMESTAMP WITH TIME ZONE USING "passwordChangedAt" AT TIME ZONE current_setting('TimeZone')`,
    `ALTER TABLE "user" ALTER COLUMN "passwordChangedAt" TYPE TIMESTAMP WITHOUT TIME ZONE USING "passwordChangedAt" AT TIME ZONE current_setting('TimeZone')`,
    `ALTER TABLE "media_identifier" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITHOUT TIME ZONE USING "createdAt" AT TIME ZONE current_setting('TimeZone')`,
  ]);
});
