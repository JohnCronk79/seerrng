import type { MigrationInterface, QueryRunner } from 'typeorm';

type SeasonRow = {
  id: number;
  seasonNumber: number;
  status: number;
  status4k: number;
  mediaId: number | null;
};

const availabilityRank = [5, 4, 3, 2, 7, 1, 6];

const strongestAvailability = (values: number[]): number =>
  availabilityRank.find((status) => values.includes(status)) ?? values[0];

export class EnforceSeasonUniqueness1781800000000 implements MigrationInterface {
  name = 'EnforceSeasonUniqueness1781800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "season" WHERE "mediaId" IS NULL`);
    await queryRunner.query(
      `DELETE FROM "season_request" WHERE "requestId" IS NULL`
    );

    const seasons = (await queryRunner.query(
      `SELECT "id", "seasonNumber", "status", "status4k", "mediaId" FROM "season" ORDER BY "id"`
    )) as SeasonRow[];
    const seasonGroups = new Map<string, SeasonRow[]>();
    for (const season of seasons) {
      const key = `${season.mediaId}:${season.seasonNumber}`;
      seasonGroups.set(key, [...(seasonGroups.get(key) ?? []), season]);
    }
    for (const duplicates of seasonGroups.values()) {
      if (duplicates.length < 2) {
        continue;
      }
      const [keeper, ...removed] = duplicates;
      await queryRunner.query(
        `UPDATE "season" SET "status" = ?, "status4k" = ? WHERE "id" = ?`,
        [
          strongestAvailability(duplicates.map((season) => season.status)),
          strongestAvailability(duplicates.map((season) => season.status4k)),
          keeper.id,
        ]
      );
      await queryRunner.query(
        `DELETE FROM "season" WHERE "id" IN (${removed.map(() => '?').join(', ')})`,
        removed.map((season) => season.id)
      );
    }

    await queryRunner.query(`
      UPDATE "season_request"
      SET "status" = (
        SELECT MAX(duplicate."status")
        FROM "season_request" duplicate
        WHERE duplicate."requestId" = "season_request"."requestId"
          AND duplicate."seasonNumber" = "season_request"."seasonNumber"
      )
      WHERE "id" IN (
        SELECT MIN("id")
        FROM "season_request"
        GROUP BY "requestId", "seasonNumber"
      )
    `);
    await queryRunner.query(`
      DELETE FROM "season_request"
      WHERE "id" NOT IN (
        SELECT MIN("id")
        FROM "season_request"
        GROUP BY "requestId", "seasonNumber"
      )
    `);

    await queryRunner.query(`DROP INDEX "IDX_087099b39600be695591da9a49"`);
    await queryRunner.query(
      `ALTER TABLE "season" RENAME TO "temporary_season"`
    );
    await queryRunner.query(
      `CREATE TABLE "season" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "seasonNumber" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer NOT NULL, "status4k" integer NOT NULL DEFAULT (1), CONSTRAINT "UNIQUE_MEDIA_SEASON" UNIQUE ("mediaId", "seasonNumber"), CONSTRAINT "FK_087099b39600be695591da9a49c" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "season"("id", "seasonNumber", "status", "createdAt", "updatedAt", "mediaId", "status4k") SELECT "id", "seasonNumber", "status", "createdAt", "updatedAt", "mediaId", "status4k" FROM "temporary_season"`
    );
    await queryRunner.query(`DROP TABLE "temporary_season"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_087099b39600be695591da9a49" ON "season" ("mediaId")`
    );

    await queryRunner.query(`DROP INDEX "IDX_6f14737e346d6b27d8e50d2157"`);
    await queryRunner.query(
      `ALTER TABLE "season_request" RENAME TO "temporary_season_request"`
    );
    await queryRunner.query(
      `CREATE TABLE "season_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "seasonNumber" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestId" integer NOT NULL, CONSTRAINT "UNIQUE_REQUEST_SEASON" UNIQUE ("requestId", "seasonNumber"), CONSTRAINT "FK_6f14737e346d6b27d8e50d2157a" FOREIGN KEY ("requestId") REFERENCES "media_request" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "season_request"("id", "seasonNumber", "status", "createdAt", "updatedAt", "requestId") SELECT "id", "seasonNumber", "status", "createdAt", "updatedAt", "requestId" FROM "temporary_season_request"`
    );
    await queryRunner.query(`DROP TABLE "temporary_season_request"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_6f14737e346d6b27d8e50d2157" ON "season_request" ("requestId")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_6f14737e346d6b27d8e50d2157"`);
    await queryRunner.query(
      `ALTER TABLE "season_request" RENAME TO "temporary_season_request"`
    );
    await queryRunner.query(
      `CREATE TABLE "season_request" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "seasonNumber" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "requestId" integer, CONSTRAINT "FK_6f14737e346d6b27d8e50d2157a" FOREIGN KEY ("requestId") REFERENCES "media_request" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "season_request"("id", "seasonNumber", "status", "createdAt", "updatedAt", "requestId") SELECT "id", "seasonNumber", "status", "createdAt", "updatedAt", "requestId" FROM "temporary_season_request"`
    );
    await queryRunner.query(`DROP TABLE "temporary_season_request"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_6f14737e346d6b27d8e50d2157" ON "season_request" ("requestId")`
    );

    await queryRunner.query(`DROP INDEX "IDX_087099b39600be695591da9a49"`);
    await queryRunner.query(
      `ALTER TABLE "season" RENAME TO "temporary_season"`
    );
    await queryRunner.query(
      `CREATE TABLE "season" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "seasonNumber" integer NOT NULL, "status" integer NOT NULL DEFAULT (1), "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "mediaId" integer, "status4k" integer NOT NULL DEFAULT (1), CONSTRAINT "FK_087099b39600be695591da9a49c" FOREIGN KEY ("mediaId") REFERENCES "media" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "season"("id", "seasonNumber", "status", "createdAt", "updatedAt", "mediaId", "status4k") SELECT "id", "seasonNumber", "status", "createdAt", "updatedAt", "mediaId", "status4k" FROM "temporary_season"`
    );
    await queryRunner.query(`DROP TABLE "temporary_season"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_087099b39600be695591da9a49" ON "season" ("mediaId")`
    );
  }
}
