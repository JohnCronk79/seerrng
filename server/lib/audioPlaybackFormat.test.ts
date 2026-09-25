import {
  classifyAudioPlaybackFormats,
  type AudioPlaybackFormat,
} from '@server/lib/audioPlaybackFormat';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('audio playback format classification', () => {
  it('recognizes FLAC and MP3 without relying on album names', () => {
    assert.deepStrictEqual(
      classifyAudioPlaybackFormats(['FLAC', 'audio/mpeg-1-layer-3', 'mp3']),
      ['flac', 'mp3'] satisfies AudioPlaybackFormat[]
    );
    assert.deepStrictEqual(
      classifyAudioPlaybackFormats(['audio/mpeg-1-layer-3']),
      ['mp3'] satisfies AudioPlaybackFormat[]
    );
  });

  it('does not mislabel unsupported or missing codecs', () => {
    assert.deepStrictEqual(classifyAudioPlaybackFormats(['aac', 'opus']), []);
    assert.deepStrictEqual(classifyAudioPlaybackFormats([]), []);
  });
});
