import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSpotifyPlaylistUrl } from './spotify';

describe('parseSpotifyPlaylistUrl', () => {
  it('accepts Spotify playlist URLs and URIs', () => {
    assert.deepEqual(
      parseSpotifyPlaylistUrl(
        'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=ignored'
      ),
      {
        id: '37i9dQZF1DXcBWIGoYBM5M',
        url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      }
    );
    assert.deepEqual(parseSpotifyPlaylistUrl('spotify:playlist:abc123'), {
      id: 'abc123',
      url: 'https://open.spotify.com/playlist/abc123',
    });
  });

  it('rejects non-Spotify playlist URLs', () => {
    assert.equal(
      parseSpotifyPlaylistUrl('https://example.com/playlist/abc123'),
      undefined
    );
    assert.equal(
      parseSpotifyPlaylistUrl('https://open.spotify.com/album/abc123'),
      undefined
    );
  });
});
