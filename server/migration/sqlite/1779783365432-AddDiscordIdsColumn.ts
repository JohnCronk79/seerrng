import type { MigrationInterface, QueryRunner } from 'typeorm';

// Columns added by later-timestamped migrations that also rebuild this
// table. On a fresh install this migration runs before any of them exist,
// so the rebuild below omits them safely. On an install upgrading from a
// state where these columns were already added (out-of-order migration
// insertion), the rebuild must carry them forward explicitly or the
// SQLite temp-table swap silently drops the data.
const OPTIONAL_LATER_COLUMNS: { name: string; definition: string }[] = [
  { name: 'watchlistSyncMusic', definition: '"watchlistSyncMusic" boolean' },
  { name: 'watchlistSyncBooks', definition: '"watchlistSyncBooks" boolean' },
  {
    name: 'cardTextVisibilityMovie',
    definition: '"cardTextVisibilityMovie" varchar',
  },
  {
    name: 'cardTextVisibilityTv',
    definition: '"cardTextVisibilityTv" varchar',
  },
  {
    name: 'cardTextVisibilityAlbum',
    definition: '"cardTextVisibilityAlbum" varchar',
  },
  {
    name: 'cardTextVisibilityBook',
    definition: '"cardTextVisibilityBook" varchar',
  },
];

export class AddDiscordIdsColumn1779783365432 implements MigrationInterface {
  name = 'AddDiscordIdsColumn1779783365432';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existingColumns: { name: string }[] = await queryRunner.query(
      `PRAGMA table_info("user_settings")`
    );
    const presentLaterColumns = OPTIONAL_LATER_COLUMNS.filter((column) =>
      existingColumns.some((existing) => existing.name === column.name)
    );
    const extraDefinitions = presentLaterColumns
      .map((column) => `, ${column.definition}`)
      .join('');
    const extraNames = presentLaterColumns
      .map((column) => `, "${column.name}"`)
      .join('');

    await queryRunner.query(
      `CREATE TABLE "temporary_user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "locale" varchar NOT NULL DEFAULT (''), "discoverRegion" varchar, "streamingRegion" varchar, "originalLanguage" varchar, "pgpKey" varchar, "discordIds" text, "pushbulletAccessToken" varchar, "pushoverApplicationToken" varchar, "pushoverUserKey" varchar, "pushoverSound" varchar, "telegramChatId" varchar, "telegramSendSilently" boolean, "watchlistSyncMovies" boolean, "watchlistSyncTv" boolean, "notificationTypes" text, "userId" integer, "telegramMessageThreadId" varchar${extraDefinitions}, CONSTRAINT "REL_986a2b6d3c05eb4091bb8066f7" UNIQUE ("userId"), CONSTRAINT "FK_986a2b6d3c05eb4091bb8066f78" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_user_settings"("id", "locale", "discoverRegion", "streamingRegion", "originalLanguage", "pgpKey", "discordIds", "pushbulletAccessToken", "pushoverApplicationToken", "pushoverUserKey", "pushoverSound", "telegramChatId", "telegramSendSilently", "watchlistSyncMovies", "watchlistSyncTv", "notificationTypes", "userId", "telegramMessageThreadId"${extraNames}) SELECT "id", "locale", "discoverRegion", "streamingRegion", "originalLanguage", "pgpKey", CASE WHEN "discordId" IS NOT NULL AND "discordId" != '' THEN '["' || "discordId" || '"]' ELSE NULL END, "pushbulletAccessToken", "pushoverApplicationToken", "pushoverUserKey", "pushoverSound", "telegramChatId", "telegramSendSilently", "watchlistSyncMovies", "watchlistSyncTv", "notificationTypes", "userId", "telegramMessageThreadId"${extraNames} FROM "user_settings"`
    );
    await queryRunner.query(`DROP TABLE "user_settings"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_user_settings" RENAME TO "user_settings"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" RENAME TO "temporary_user_settings"`
    );

    const existingColumns: { name: string }[] = await queryRunner.query(
      `PRAGMA table_info("temporary_user_settings")`
    );
    const presentLaterColumns = OPTIONAL_LATER_COLUMNS.filter((column) =>
      existingColumns.some((existing) => existing.name === column.name)
    );
    const extraDefinitions = presentLaterColumns
      .map((column) => `, ${column.definition}`)
      .join('');
    const extraNames = presentLaterColumns
      .map((column) => `, "${column.name}"`)
      .join('');

    await queryRunner.query(
      `CREATE TABLE "user_settings" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "locale" varchar NOT NULL DEFAULT (''), "discoverRegion" varchar, "streamingRegion" varchar, "originalLanguage" varchar, "pgpKey" varchar, "discordId" varchar, "pushbulletAccessToken" varchar, "pushoverApplicationToken" varchar, "pushoverUserKey" varchar, "pushoverSound" varchar, "telegramChatId" varchar, "telegramSendSilently" boolean, "watchlistSyncMovies" boolean, "watchlistSyncTv" boolean, "notificationTypes" text, "userId" integer, "telegramMessageThreadId" varchar${extraDefinitions}, CONSTRAINT "REL_986a2b6d3c05eb4091bb8066f7" UNIQUE ("userId"), CONSTRAINT "FK_986a2b6d3c05eb4091bb8066f78" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "user_settings"("id", "locale", "discoverRegion", "streamingRegion", "originalLanguage", "pgpKey", "discordId", "pushbulletAccessToken", "pushoverApplicationToken", "pushoverUserKey", "pushoverSound", "telegramChatId", "telegramSendSilently", "watchlistSyncMovies", "watchlistSyncTv", "notificationTypes", "userId", "telegramMessageThreadId"${extraNames}) SELECT "id", "locale", "discoverRegion", "streamingRegion", "originalLanguage", "pgpKey", json_extract("discordIds", '$[0]'), "pushbulletAccessToken", "pushoverApplicationToken", "pushoverUserKey", "pushoverSound", "telegramChatId", "telegramSendSilently", "watchlistSyncMovies", "watchlistSyncTv", "notificationTypes", "userId", "telegramMessageThreadId"${extraNames} FROM "temporary_user_settings"`
    );
    await queryRunner.query(`DROP TABLE "temporary_user_settings"`);
  }
}
