import type ReadarrAPI from '@server/api/servarr/readarr';
import { describe, expect, it, vi } from 'vitest';
import {
  hydrateBookshelfLookupResult,
  isAddableBookshelfLookupResult,
} from './bookshelfLookup';

const makeApi = (lookupAuthor: ReadarrAPI['lookupAuthor']) =>
  ({ lookupAuthor }) as unknown as ReadarrAPI;

describe('Bookshelf metadata lookup hydration', () => {
  it('resolves an exact author and fills the edition while preserving provider IDs', async () => {
    const lookupAuthor = vi.fn(async () => [
      {
        foreignAuthorId: 'wrong-author',
        authorName: 'Stephen King Jr.',
      },
      {
        foreignAuthorId: 'goodreads-author-3389',
        authorName: 'Stephen King',
      },
    ]);
    const result = await hydrateBookshelfLookupResult(
      makeApi(lookupAuthor),
      {
        title: 'The Shining',
        foreignBookId: 'goodreads-book-11588',
        foreignEditionId: 'goodreads-edition-13536749',
        authorTitle: 'King, Stephen The Shining',
      },
      '9780307743657'
    );

    expect(result.author?.foreignAuthorId).toBe('goodreads-author-3389');
    expect(result.editions).toEqual([
      {
        foreignEditionId: 'goodreads-edition-13536749',
        title: 'The Shining',
        isbn13: '9780307743657',
        monitored: true,
      },
    ]);
    expect(isAddableBookshelfLookupResult(result)).toBe(true);
  });

  it('fills incomplete editions even when the author is already present', async () => {
    const lookupAuthor = vi.fn();
    const result = await hydrateBookshelfLookupResult(makeApi(lookupAuthor), {
      title: 'The Hobbit',
      foreignBookId: 'hc-book-5907',
      foreignEditionId: 'hc-edition-5907',
      author: {
        foreignAuthorId: 'hc-author-656983',
        authorName: 'J.R.R. Tolkien',
      },
      editions: [],
    });

    expect(lookupAuthor).not.toHaveBeenCalled();
    expect(result.editions?.[0]?.foreignEditionId).toBe('hc-edition-5907');
    expect(isAddableBookshelfLookupResult(result)).toBe(true);
  });

  it('keeps the lookup hit when Goodreads author lookup fails', async () => {
    const lookupAuthor = vi.fn(async () => {
      throw new Error(
        "Search for 'Stephen King' failed. Invalid response received from Goodreads."
      );
    });
    const result = await hydrateBookshelfLookupResult(makeApi(lookupAuthor), {
      title: 'The Shining',
      foreignBookId: 'goodreads-book-11588',
      foreignEditionId: 'goodreads-edition-13536749',
      authorTitle: 'King, Stephen The Shining',
    });

    expect(result.foreignBookId).toBe('goodreads-book-11588');
    expect(result.editions?.[0]?.foreignEditionId).toBe(
      'goodreads-edition-13536749'
    );
    expect(result.author?.foreignAuthorId).toBeUndefined();
    expect(isAddableBookshelfLookupResult(result)).toBe(false);
  });
});
