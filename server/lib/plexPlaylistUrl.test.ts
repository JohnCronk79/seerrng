import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPlexPlaylistWebUrl } from './plexPlaylistUrl';

describe('Plex playlist web URL', () => {
  it('opens a playlist with its content key on the Plex playlist route', () => {
    assert.strictEqual(
      buildPlexPlaylistWebUrl({
        machineIdentifier: 'server-id',
        playlistKey: '/playlists/12345/items',
      }),
      'https://app.plex.tv/desktop#!/server/server-id/playlist?key=%2Fplaylists%2F12345'
    );
  });

  it('rejects a non-playlist content key', () => {
    assert.throws(
      () =>
        buildPlexPlaylistWebUrl({
          machineIdentifier: 'server-id',
          playlistKey: '/library/metadata/12345',
        }),
      /invalid playlist content key/u
    );
  });
});
