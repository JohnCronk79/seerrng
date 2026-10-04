import { describe, expect, it } from 'vitest';
import { classifyBookshelfProvider } from './bookshelfProvider';

describe('classifyBookshelfProvider', () => {
  it.each([
    ['https://api.hardcover.app', 'hardcover'],
    ['https://goodreads.com/api', 'softcover'],
    ['softcover', 'softcover'],
    ['http://127.0.0.1:8790', 'softcover'],
    ['https://openlibrary.org', 'openlibrary'],
    ['google books', 'googlebooks'],
    ['https://metadata.example/api', 'custom'],
    [undefined, 'unknown'],
  ] as const)('classifies %s as %s', (source, expected) => {
    expect(classifyBookshelfProvider(source)).toBe(expected);
  });
});
