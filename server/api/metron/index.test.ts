import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import MetronAPI, {
  mapMetronSeriesToVolume,
  splitMetronSeriesName,
} from '@server/api/metron';
import { searchComicVolumes } from '@server/routes/search';

const series = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  series: 'Batman (2016)',
  year_began: 2016,
  issue_count: 80,
  publisher: { id: 10, name: 'DC Comics' },
  cv_id: 18002,
  gcd_id: null,
  ...overrides,
});

describe('Metron series mapping', () => {
  it('splits the year from the display name', () => {
    assert.deepEqual(splitMetronSeriesName('Batman (2016)'), {
      name: 'Batman',
      year: '2016',
    });
    assert.deepEqual(splitMetronSeriesName('Batman'), { name: 'Batman' });
  });

  it('maps a series with a ComicVine ID to a ComicVine-shaped volume', () => {
    assert.deepEqual(mapMetronSeriesToVolume(series()), {
      id: 18002,
      name: 'Batman',
      start_year: '2016',
      count_of_issues: 80,
      publisher: { id: 10, name: 'DC Comics' },
      resource_type: 'volume',
    });
  });

  it('drops series without a ComicVine ID, because requests are keyed by it', () => {
    assert.equal(mapMetronSeriesToVolume(series({ cv_id: null })), undefined);
  });

  it('rejects malformed rows', () => {
    assert.equal(mapMetronSeriesToVolume('not a row'), undefined);
    assert.equal(mapMetronSeriesToVolume(series({ series: '' })), undefined);
  });
});

describe('Metron search', () => {
  it('sends the name query and maps the paged response', async () => {
    const api = new MetronAPI('token');
    const calls: unknown[] = [];
    Object.assign(api, {
      get: async (endpoint: string, config: unknown) => {
        calls.push({ endpoint, config });
        return {
          count: 2,
          next: null,
          previous: null,
          results: [series(), series({ id: 2, cv_id: null })],
        };
      },
    });

    const response = await api.searchVolumes({ query: 'batman', limit: 20 });

    assert.equal(response.number_of_total_results, 2);
    assert.equal(response.results.length, 1);
    assert.equal(response.results[0].id, 18002);
    assert.deepEqual(calls[0], {
      endpoint: '/series/',
      config: { params: { name: 'batman', page: 1 } },
    });
  });

  it('rejects an invalid response', async () => {
    const api = new MetronAPI('token');
    Object.assign(api, { get: async () => 'nope' });
    await assert.rejects(api.searchVolumes({ query: 'batman' }));
  });
});

describe('comic search fallback', () => {
  const comicVineResponse = (status_code: number) => ({
    error: 'OK',
    limit: 20,
    offset: 0,
    number_of_page_results: 0,
    number_of_total_results: 0,
    status_code,
    results: [],
  });

  const fakeMetron = (result: unknown): InstanceType<typeof MetronAPI> =>
    ({ searchVolumes: async () => result }) as unknown as InstanceType<
      typeof MetronAPI
    >;

  it('uses ComicVine when its search succeeds', async () => {
    const comicVine = {
      searchVolumes: async () => comicVineResponse(1),
    } as unknown as Parameters<typeof searchComicVolumes>[0]['comicVine'];
    const result = await searchComicVolumes({
      comicVine,
      metron: fakeMetron({ marker: 'metron' }),
      query: 'x',
      page: 1,
    });
    assert.equal(result.status_code, 1);
  });

  it('falls back to Metron when ComicVine throws', async () => {
    const comicVine = {
      searchVolumes: async () => {
        throw new Error('rate limited');
      },
    } as unknown as Parameters<typeof searchComicVolumes>[0]['comicVine'];
    const result = await searchComicVolumes({
      comicVine,
      metron: fakeMetron({ marker: 'metron' }),
      query: 'x',
      page: 1,
    });
    assert.deepEqual(result, { marker: 'metron' });
  });

  it('falls back to Metron when ComicVine reports a failed status', async () => {
    const comicVine = {
      searchVolumes: async () => comicVineResponse(107),
    } as unknown as Parameters<typeof searchComicVolumes>[0]['comicVine'];
    const result = await searchComicVolumes({
      comicVine,
      metron: fakeMetron({ marker: 'metron' }),
      query: 'x',
      page: 1,
    });
    assert.deepEqual(result, { marker: 'metron' });
  });

  it('rethrows the ComicVine error when no Metron token is configured', async () => {
    const comicVine = {
      searchVolumes: async () => {
        throw new Error('rate limited');
      },
    } as unknown as Parameters<typeof searchComicVolumes>[0]['comicVine'];
    await assert.rejects(
      searchComicVolumes({ comicVine, query: 'x', page: 1 }),
      /rate limited/
    );
  });
});
