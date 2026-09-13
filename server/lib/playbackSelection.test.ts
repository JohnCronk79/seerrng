import { MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import {
  isPlaybackQuality4k,
  resolvePlaybackCatalogItemIds,
} from '@server/lib/playbackSelection';
import type { PlaybackCatalogResponse } from '@server/models/Playback';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const movieCatalog = (rootItemId?: string): PlaybackCatalogResponse => ({
  mediaId: 4676,
  serverType: MediaServerType.PLEX,
  is4k: false,
  rootItem: rootItemId
    ? {
        id: rootItemId,
        title: 'Moana',
        index: 0,
        kind: 'movie',
        available: true,
      }
    : undefined,
  groups: [],
});

describe('playback catalog selection', () => {
  it('accepts both validated boolean and raw string 4K query flags', () => {
    assert.strictEqual(isPlaybackQuality4k(true), true);
    assert.strictEqual(isPlaybackQuality4k('true'), true);
    assert.strictEqual(isPlaybackQuality4k(false), false);
    assert.strictEqual(isPlaybackQuality4k('false'), false);
  });

  it('uses the current movie catalog item when the browser sends a stale ID', () => {
    assert.deepStrictEqual(
      resolvePlaybackCatalogItemIds({
        mediaType: MediaType.MOVIE,
        targetCatalog: movieCatalog('current-rating-key'),
        requestedItemIds: ['stale-rating-key'],
      }),
      ['current-rating-key']
    );
  });

  it('uses the current movie catalog item when nothing is selected', () => {
    assert.deepStrictEqual(
      resolvePlaybackCatalogItemIds({
        mediaType: MediaType.MOVIE,
        targetCatalog: movieCatalog('current-rating-key'),
        requestedItemIds: [],
      }),
      ['current-rating-key']
    );
  });

  it('does not invent a movie item when the current catalog has none', () => {
    assert.deepStrictEqual(
      resolvePlaybackCatalogItemIds({
        mediaType: MediaType.MOVIE,
        targetCatalog: movieCatalog(),
        requestedItemIds: ['stale-rating-key'],
      }),
      []
    );
  });
});
