import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryRunner } from 'typeorm';
import { DropPushSubscriptionAuthUnique1781700000000 } from './1781700000000-DropPushSubscriptionAuthUnique';

test('PostgreSQL push subscription migration removes and restores global auth uniqueness', async () => {
  const statements: string[] = [];
  const queryRunner = {
    query: async (statement: string) => {
      statements.push(statement);
    },
  } as QueryRunner;
  const migration = new DropPushSubscriptionAuthUnique1781700000000();

  await migration.up(queryRunner);
  await migration.down(queryRunner);

  assert.deepEqual(statements, [
    'ALTER TABLE "user_push_subscription" DROP CONSTRAINT IF EXISTS "UQ_f90ab5a4ed54905a4bb51a7148b"',
    'ALTER TABLE "user_push_subscription" ADD CONSTRAINT "UQ_f90ab5a4ed54905a4bb51a7148b" UNIQUE ("auth")',
  ]);
});
