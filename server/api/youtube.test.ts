import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseYouTubePlaylistUrl } from './youtube';

describe('parseYouTubePlaylistUrl', () => {
  it('accepts YouTube and YouTube Music playlist URLs', () => {
    assert.deepEqual(
      parseYouTubePlaylistUrl(
        'https://music.youtube.com/playlist?list=PL1234567890'
      ),
      {
        id: 'PL1234567890',
        url: 'https://www.youtube.com/playlist?list=PL1234567890',
      }
    );
  });

  it('rejects URLs without a playlist identifier', () => {
    assert.equal(
      parseYouTubePlaylistUrl('https://www.youtube.com/watch?v=x'),
      undefined
    );
    assert.equal(
      parseYouTubePlaylistUrl('http://www.youtube.com/playlist?list=PL123'),
      undefined
    );
  });
});
