import {
  TableColumn,
  type MigrationInterface,
  type QueryRunner,
} from 'typeorm';

export class AddSpotifyPlaylistCredentials1784100000000 implements MigrationInterface {
  name = 'AddSpotifyPlaylistCredentials1784100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addColumnIfMissing(queryRunner, 'spotifyAccessToken', 'text');
    await this.addColumnIfMissing(queryRunner, 'spotifyRefreshToken', 'text');
    await this.addColumnIfMissing(
      queryRunner,
      'spotifyUserId',
      'character varying'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'spotifyDisplayName',
      'character varying'
    );
    await this.addColumnIfMissing(
      queryRunner,
      'spotifyTokenExpiresAt',
      'timestamp with time zone'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      'spotifyTokenExpiresAt',
      'spotifyDisplayName',
      'spotifyUserId',
      'spotifyRefreshToken',
      'spotifyAccessToken',
    ]) {
      if (await queryRunner.hasColumn('user_settings', column)) {
        await queryRunner.dropColumn('user_settings', column);
      }
    }
  }

  private async addColumnIfMissing(
    queryRunner: QueryRunner,
    name: string,
    type: string
  ): Promise<void> {
    if (await queryRunner.hasColumn('user_settings', name)) {
      return;
    }
    await queryRunner.addColumn(
      'user_settings',
      new TableColumn({ name, type, isNullable: true })
    );
  }
}
