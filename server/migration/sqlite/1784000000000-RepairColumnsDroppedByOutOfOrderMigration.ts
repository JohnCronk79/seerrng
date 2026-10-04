import type { MigrationInterface, QueryRunner } from 'typeorm';

// AddDiscordIdsColumn (1779783365432) and AddIgnoreQuotaToMediaRequest
// (1781732036510) were merged in from upstream with timestamps older than
// several fork-only columns already present in some installs. TypeORM ran
// those two migrations out of chronological order on such installs, and
// their SQLite temp-table rebuilds used upstream's column list, silently
// dropping the fork-only columns during the rebuild. Both migrations have
// since been fixed to carry the columns forward correctly, but installs
// that already executed the old, buggy versions need this repair.
export class RepairColumnsDroppedByOutOfOrderMigration1784000000000 implements MigrationInterface {
  name = 'RepairColumnsDroppedByOutOfOrderMigration1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addColumnIfMissing(
      queryRunner,
      'media_request',
      'bookFormat',
      '"bookFormat" varchar'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'media_request',
      'metadataProfileId',
      '"metadataProfileId" integer'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'user_settings',
      'watchlistSyncMusic',
      '"watchlistSyncMusic" boolean'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'user_settings',
      'watchlistSyncBooks',
      '"watchlistSyncBooks" boolean'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'user_settings',
      'cardTextVisibilityMovie',
      '"cardTextVisibilityMovie" varchar'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'user_settings',
      'cardTextVisibilityTv',
      '"cardTextVisibilityTv" varchar'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'user_settings',
      'cardTextVisibilityAlbum',
      '"cardTextVisibilityAlbum" varchar'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'user_settings',
      'cardTextVisibilityBook',
      '"cardTextVisibilityBook" varchar'
    );
  }

  public async down(): Promise<void> {
    // No-op: this migration only repairs schema previously lost to a bug.
    // Reversing it would re-introduce the data loss it fixes.
  }

  private async addColumnIfMissing(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    definition: string
  ): Promise<void> {
    const existing: { name: string }[] = await queryRunner.query(
      `PRAGMA table_info("${table}")`
    );
    if (existing.some((c) => c.name === column)) {
      return;
    }
    await queryRunner.query(`ALTER TABLE "${table}" ADD ${definition}`);
  }
}
