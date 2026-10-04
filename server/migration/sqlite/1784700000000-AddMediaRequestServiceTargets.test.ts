import assert from 'node:assert/strict';
import test from 'node:test';
import { DataSource } from 'typeorm';
import { AddMediaRequestServiceTargets1784700000000 } from './1784700000000-AddMediaRequestServiceTargets';

test('SQLite request service target migration is reversible', async () => {
  const dataSource = await new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
  }).initialize();
  const queryRunner = dataSource.createQueryRunner();
  const migration = new AddMediaRequestServiceTargets1784700000000();

  try {
    await queryRunner.query(
      `CREATE TABLE "media_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL)`
    );
    await migration.up(queryRunner);
    const target = JSON.stringify([
      {
        serviceType: 'lidarr',
        format: 'music',
        serverId: 1,
        profileId: 3,
        metadataProfileId: 4,
      },
    ]);
    await queryRunner.query(
      `INSERT INTO "media_request" ("serviceTargets") VALUES (?)`,
      [target]
    );
    const [row] = await queryRunner.query(
      `SELECT "serviceTargets" FROM "media_request"`
    );
    assert.deepStrictEqual(JSON.parse(row.serviceTargets), JSON.parse(target));

    await migration.down(queryRunner);
    assert.deepStrictEqual(
      (await queryRunner.query(`PRAGMA table_info("media_request")`)).map(
        ({ name }: { name: string }) => name
      ),
      ['id']
    );
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
});
