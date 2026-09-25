import { runStartupMigrations } from '@server/lib/startupMigrations';
import { DataSource, type MigrationInterface, type QueryRunner } from 'typeorm';

class ConcurrentStartupMigration1900000000000 implements MigrationInterface {
  name = 'ConcurrentStartupMigration1900000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    await queryRunner.query(
      `CREATE TABLE "startup_migration_result" (
        "id" integer PRIMARY KEY NOT NULL
      )`
    );
    await queryRunner.query(
      `INSERT INTO "startup_migration_result" ("id") VALUES (1)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "startup_migration_result"`);
  }
}

const main = async () => {
  const database = process.argv[2];
  if (!database) {
    throw new Error('A database path is required');
  }

  const source = new DataSource({
    type: 'better-sqlite3',
    database,
    migrations: [ConcurrentStartupMigration1900000000000],
  });

  try {
    await source.initialize();
    const migrations = await runStartupMigrations(source);
    process.stdout.write(
      `${JSON.stringify({ migrationCount: migrations.length })}\n`
    );
  } finally {
    if (source.isInitialized) {
      await source.destroy();
    }
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
