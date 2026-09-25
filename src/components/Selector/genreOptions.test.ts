import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getGenreSelectorOptions } from './genreOptions';

describe('genre selector options', () => {
  const tvGenres = [
    { id: 10759, name: 'Action & Adventure' },
    { id: 10765, name: 'Sci-Fi & Fantasy' },
    { id: 18, name: 'Drama' },
  ];

  it('prepares the complete Series genre list for the default dropdown', () => {
    assert.deepEqual(getGenreSelectorOptions(tvGenres), [
      { label: 'Action & Adventure', value: 10759 },
      { label: 'Sci-Fi & Fantasy', value: 10765 },
      { label: 'Drama', value: 18 },
    ]);
  });

  it('filters the preloaded options when the user types', () => {
    assert.deepEqual(getGenreSelectorOptions(tvGenres, 'fantasy'), [
      { label: 'Sci-Fi & Fantasy', value: 10765 },
    ]);
  });
});
