import { MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import Media from '@server/entity/Media';
import { getPlaybackMediaRootId } from '@server/lib/playbackMediaRoot';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('preferred playback media root', () => {
  it('prefers FLAC, then MP3, then the legacy Plex album identifier', () => {
    const media = new Media({
      mediaType: MediaType.MUSIC,
      ratingKey: 'legacy',
      ratingKeyMp3: 'mp3',
      ratingKeyFlac: 'flac',
    });

    assert.strictEqual(
      getPlaybackMediaRootId(media, MediaServerType.PLEX, false),
      'flac'
    );
    media.ratingKeyFlac = null;
    assert.strictEqual(
      getPlaybackMediaRootId(media, MediaServerType.PLEX, false),
      'mp3'
    );
    media.ratingKeyMp3 = null;
    assert.strictEqual(
      getPlaybackMediaRootId(media, MediaServerType.PLEX, false),
      'legacy'
    );
  });

  it('prefers FLAC for Jellyfin and Emby music without changing audiobook roots', () => {
    const music = new Media({
      mediaType: MediaType.MUSIC,
      jellyfinMediaId: 'legacy',
      jellyfinMediaIdMp3: 'mp3',
      jellyfinMediaIdFlac: 'flac',
    });
    const book = new Media({
      mediaType: MediaType.BOOK,
      jellyfinMediaId: 'audiobook',
      jellyfinMediaIdFlac: 'should-not-replace-book',
    });

    assert.strictEqual(
      getPlaybackMediaRootId(music, MediaServerType.JELLYFIN, false),
      'flac'
    );
    assert.strictEqual(
      getPlaybackMediaRootId(music, MediaServerType.EMBY, false),
      'flac'
    );
    assert.strictEqual(
      getPlaybackMediaRootId(book, MediaServerType.JELLYFIN, false),
      'audiobook'
    );
  });
});
