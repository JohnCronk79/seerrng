import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LbAlbumDetails } from '@server/api/listenbrainz/interfaces';
import {
  MAX_MUSIC_DETAIL_LISTENERS,
  MAX_MUSIC_DETAIL_MEDIA,
  MAX_MUSIC_DETAIL_TAGS,
  MAX_MUSIC_DETAIL_TRACKS,
  MAX_MUSIC_DETAIL_TRACK_ARTISTS,
  mapMusicDetails,
} from '@server/models/Music';

describe('mapMusicDetails provider bounds', () => {
  it('bounds tracks, credits, tags, listeners, and text', () => {
    const track = {
      name: 't'.repeat(2_000),
      position: 1,
      length: 100,
      recording_mbid: 'recording',
      total_listen_count: 1,
      total_user_count: 1,
      artists: Array.from(
        { length: MAX_MUSIC_DETAIL_TRACK_ARTISTS + 10 },
        (_, index) => ({
          artist_credit_name: `Artist ${index}`,
          artist_mbid: `artist-${index}`,
        })
      ),
    };
    const album = {
      release_group_mbid: 'album',
      type: 'Album',
      mediums: Array.from({ length: MAX_MUSIC_DETAIL_MEDIA + 10 }, () => ({
        tracks: Array.from({ length: 30 }, () => ({ ...track })),
      })),
      release_group_metadata: {
        release_group: { name: 'n'.repeat(2_000), date: '2026' },
        artist: { name: 'Artist', artists: [] },
        tag: {
          artist: Array.from(
            { length: MAX_MUSIC_DETAIL_TAGS + 10 },
            (_, index) => ({
              artist_mbid: `artist-${index}`,
              count: 1,
              tag: 'tag',
            })
          ),
          release_group: Array.from(
            { length: MAX_MUSIC_DETAIL_TAGS + 10 },
            (_, index) => ({
              genre_mbid: `genre-${index}`,
              count: 1,
              tag: 'tag',
            })
          ),
        },
      },
      listening_stats: {
        total_listen_count: 1,
        total_user_count: 1,
        listeners: Array.from(
          { length: MAX_MUSIC_DETAIL_LISTENERS + 10 },
          (_, index) => ({ user_name: `listener-${index}`, listen_count: 1 })
        ),
      },
    } as unknown as LbAlbumDetails;

    const result = mapMusicDetails(album);

    assert.strictEqual(result.tracks.length, MAX_MUSIC_DETAIL_TRACKS);
    assert.strictEqual(
      result.tracks[0].artists.length,
      MAX_MUSIC_DETAIL_TRACK_ARTISTS
    );
    assert.strictEqual(result.tags?.artist.length, MAX_MUSIC_DETAIL_TAGS);
    assert.strictEqual(result.tags?.releaseGroup.length, MAX_MUSIC_DETAIL_TAGS);
    assert.strictEqual(
      result.stats?.listeners.length,
      MAX_MUSIC_DETAIL_LISTENERS
    );
    assert.strictEqual(result.title.length, 1_000);
    assert.strictEqual(result.tracks[0].name.length, 1_000);
  });
});
