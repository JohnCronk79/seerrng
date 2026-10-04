import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  MbAlbumDetails,
  MbRecordingDetails,
} from '@server/api/musicbrainz/interfaces';
import {
  normalizePlaylistText,
  parseYouTubeTrackTitle,
  selectBestAlbumMatch,
  selectBestRecordingMatch,
} from './playlistMatching';

const album = (overrides: Partial<MbAlbumDetails> = {}): MbAlbumDetails => ({
  id: 'album-id',
  title: 'Discovery',
  score: 100,
  media_type: 'album',
  'primary-type': 'Album',
  'first-release-date': '2001-03-07',
  'artist-credit': [
    {
      name: 'Daft Punk',
      artist: {
        id: 'artist-id',
        name: 'Daft Punk',
        'sort-name': 'Daft Punk',
      },
    },
  ],
  posterPath: undefined,
  'type-id': '',
  'primary-type-id': '',
  count: 0,
  releases: [],
  releasedate: '2001-03-07',
  ...overrides,
});

describe('playlist matching', () => {
  it('normalizes provider text consistently', () => {
    assert.equal(normalizePlaylistText('Beyoncé & Jay-Z'), 'beyonce and jay z');
  });

  it('selects an exact album match and rejects weak candidates', () => {
    const match = selectBestAlbumMatch({
      title: 'Discovery',
      artist: 'Daft Punk',
      candidates: [album()],
    });
    assert.deepEqual(match, {
      id: 'album-id',
      title: 'Discovery',
      artist: 'Daft Punk',
      year: '2001',
      releaseType: 'Album',
      confidence: 100,
    });

    assert.equal(
      selectBestAlbumMatch({
        title: 'Completely Different',
        artist: 'Unknown Artist',
        candidates: [album()],
      }),
      undefined
    );
  });

  it('maps a recording to an official non-compilation release group', () => {
    const recording: MbRecordingDetails = {
      id: 'recording-id',
      title: 'Around the World',
      score: 100,
      media_type: 'recording',
      'artist-credit': [
        {
          name: 'Daft Punk',
          artist: {
            id: 'artist-id',
            name: 'Daft Punk',
            'sort-name': 'Daft Punk',
          },
        },
      ],
      'first-release-date': '1997-01-01',
      releases: [
        {
          id: 'compilation-release',
          title: 'A Compilation',
          status: 'Official',
          'first-release-date': '2010',
          'release-group': {
            id: 'compilation-group',
            title: 'A Compilation',
            'primary-type': 'Album',
            'secondary-types': ['Compilation'],
          },
        },
        {
          id: 'discovery-release',
          title: 'Discovery',
          status: 'Official',
          'first-release-date': '2001',
          'release-group': {
            id: 'discovery-group',
            title: 'Discovery',
            'primary-type': 'Album',
            'secondary-types': [],
          },
        },
      ],
    };

    assert.equal(
      selectBestRecordingMatch({
        title: 'Around the World',
        artist: 'Daft Punk',
        recordings: [recording],
      })?.id,
      'discovery-group'
    );
  });

  it('splits common YouTube music title formats', () => {
    assert.deepEqual(
      parseYouTubeTrackTitle({
        title: 'Daft Punk - Around the World (Official Video)',
      }),
      { artist: 'Daft Punk', title: 'Around the World' }
    );
    assert.deepEqual(
      parseYouTubeTrackTitle({
        title: 'Around the World',
        artist: 'Daft Punk',
      }),
      { artist: 'Daft Punk', title: 'Around the World' }
    );
  });
});
