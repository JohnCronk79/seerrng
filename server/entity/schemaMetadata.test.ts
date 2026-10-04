import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import dataSource from '@server/datasource';
import { Blocklist } from '@server/entity/Blocklist';
import Media from '@server/entity/Media';
import MediaIdentifier from '@server/entity/MediaIdentifier';
import { RequestDispatchOutbox } from '@server/entity/RequestDispatchOutbox';
import { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import { setupTestDb } from '@server/test/db';

setupTestDb();

describe('database schema metadata', () => {
  it('matches SQLite migration column types and defaults', () => {
    const permissions = dataSource
      .getMetadata(User)
      .findColumnWithPropertyName('permissions');
    const identifierCreatedAt = dataSource
      .getMetadata(MediaIdentifier)
      .findColumnWithPropertyName('createdAt');

    assert.equal(permissions?.type, 'integer');
    assert.equal(
      typeof identifierCreatedAt?.default === 'function'
        ? identifierCreatedAt.default()
        : identifierCreatedAt?.default,
      "datetime('now')"
    );
  });

  it('uses the schema object names committed by migrations', () => {
    const indexNames = [
      ...dataSource.getMetadata(MediaIdentifier).indices,
      ...dataSource.getMetadata(Watchlist).indices,
      ...dataSource.getMetadata(Blocklist).indices,
      ...dataSource.getMetadata(Media).indices,
    ].map((index) => index.name);
    const foreignKeyNames = [
      ...dataSource.getMetadata(MediaIdentifier).foreignKeys,
      ...dataSource.getMetadata(RequestDispatchOutbox).foreignKeys,
    ].map((foreignKey) => foreignKey.name);
    const requestOutboxUniqueNames = dataSource
      .getMetadata(RequestDispatchOutbox)
      .uniques.map((unique) => unique.name);

    for (const name of [
      'IDX_media_identifier_provider_value',
      'IDX_media_identifier_mediaId',
      'IDX_watchlist_mbId',
      'IDX_watchlist_external_id',
      'IDX_blocklist_external_media_type',
      'IDX_media_mbId',
    ]) {
      assert.ok(indexNames.includes(name), `missing metadata index ${name}`);
    }
    assert.ok(foreignKeyNames.includes('FK_media_identifier_media'));
    assert.ok(foreignKeyNames.includes('FK_request_dispatch_outbox_request'));
    assert.ok(
      requestOutboxUniqueNames.includes('UQ_request_dispatch_outbox_request_id')
    );
  });
});
