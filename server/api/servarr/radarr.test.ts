import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { RadarrMovie } from '@server/api/servarr/radarr';
import type { AxiosInstance } from 'axios';
import axios from 'axios';

import RadarrAPI, { sanitizeRadarrMovie } from './radarr';

function buildRadarr(): RadarrAPI {
  return new RadarrAPI({ url: 'http://localhost:7878/api/v3', apiKey: 'test' });
}

function getAxios(radarr: RadarrAPI): AxiosInstance {
  return (radarr as unknown as { axios: AxiosInstance }).axios;
}

describe('Radarr response normalization', () => {
  it('rejects malformed or incomplete inventories in deletion-check mode', async () => {
    const radarr = buildRadarr();
    for (const data of [
      {},
      [null],
      [{ id: 0, tmdbId: 42, title: 'Invalid' }],
      [{ id: 4, title: 'No canonical ID' }],
    ]) {
      const get = mock.method(getAxios(radarr), 'get', async () => ({ data }));
      await assert.rejects(radarr.getMovies({ strict: true }));
      get.mock.restore();
    }
  });
  it('accepts a verified empty inventory and sends the canonical filter', async () => {
    const radarr = buildRadarr();
    const get = mock.method(getAxios(radarr), 'get', async () => ({
      data: [],
    }));
    assert.deepEqual(await radarr.getMovies({ strict: true, tmdbId: 42 }), []);
    const options = get.mock.calls[0].arguments[1] as
      | { params?: { tmdbId?: number } }
      | undefined;
    assert.equal(options?.params?.tmdbId, 42);
    get.mock.restore();
  });
  it('returns an exact bounded movie and nested media record', () => {
    const movie = sanitizeRadarrMovie({
      id: 9,
      title: 'Movie',
      tmdbId: 42,
      monitored: true,
      hasFile: true,
      tags: [1, 'bad', 2],
      apiKey: 'provider-secret',
      movieFile: {
        id: 3,
        movieId: 9,
        size: 100,
        dateAdded: '2026-01-01',
        qualityCutoffNotMet: false,
        providerSecret: 'nested-secret',
        mediaInfo: {
          resolution: '3840x2160',
          providerOnly: true,
        },
      },
    });

    assert.ok(movie);
    assert.strictEqual(movie.movieFile?.mediaInfo.resolution, '3840x2160');
    assert.deepStrictEqual(movie.tags, [1, 2]);
    assert.ok(!('apiKey' in movie));
    assert.ok(!('providerSecret' in (movie.movieFile ?? {})));
    assert.ok(!('providerOnly' in (movie.movieFile?.mediaInfo ?? {})));
  });

  it('rejects unusable identities and bounds provider text', () => {
    assert.strictEqual(sanitizeRadarrMovie({ title: 'Missing ID' }), undefined);
    const movie = sanitizeRadarrMovie({
      id: -1,
      title: 'x'.repeat(20_000),
      tmdbId: 1,
    });
    assert.strictEqual(movie?.title.length, 10_000);
    assert.strictEqual(movie?.id, 0);
  });
});

describe('RadarrAPI removeMovie', () => {
  afterEach(() => mock.restoreAll());

  it('removes the movie when it exists in the library', async () => {
    const radarr = buildRadarr();
    mock.method(RadarrAPI.prototype, 'getMovieByTmdbId', async () => ({
      id: 7,
      title: 'Test Movie',
    }));
    const del = mock.method(getAxios(radarr), 'delete', async () => ({}));

    await radarr.removeMovie(550);

    assert.strictEqual(del.mock.callCount(), 1);
    assert.strictEqual(
      del.mock.calls[0].arguments[0],
      'http://localhost:7878/api/v3/movie/7'
    );
  });

  it('does nothing when the movie is not in the library', async () => {
    const radarr = buildRadarr();
    mock.method(getAxios(radarr), 'get', async () => ({
      data: [{ id: 0, title: 'Fight Club', tmdbId: 550 }],
    }));
    const del = mock.method(getAxios(radarr), 'delete', async () => ({}));

    await assert.doesNotReject(() => radarr.removeMovie(550));
    assert.strictEqual(del.mock.callCount(), 0);
  });

  it('rejects when the tmdbId is unknown to the lookup', async () => {
    const radarr = buildRadarr();
    mock.method(getAxios(radarr), 'get', async () => ({ data: [] }));
    const del = mock.method(getAxios(radarr), 'delete', async () => ({}));

    await assert.rejects(() => radarr.removeMovie(550), /Movie not found/);
    assert.strictEqual(del.mock.callCount(), 0);
  });

  it('ignores a 404 when the movie was already removed in Radarr', async () => {
    const radarr = buildRadarr();
    mock.method(RadarrAPI.prototype, 'getMovieByTmdbId', async () => ({
      id: 7,
      title: 'Test Movie',
    }));
    mock.method(getAxios(radarr), 'delete', async () => {
      throw { response: { status: 404 } };
    });

    await assert.doesNotReject(() => radarr.removeMovie(550));
  });

  it('rethrows errors other than 404', async () => {
    const radarr = buildRadarr();
    mock.method(RadarrAPI.prototype, 'getMovieByTmdbId', async () => ({
      id: 7,
      title: 'Test Movie',
    }));
    mock.method(getAxios(radarr), 'delete', async () => {
      throw { response: { status: 500 } };
    });

    await assert.rejects(() => radarr.removeMovie(550));
  });

  it('rethrows a 404 from the lookup instead of treating it as removed', async () => {
    const radarr = buildRadarr();
    mock.method(getAxios(radarr), 'get', async () => {
      throw { response: { status: 404 } };
    });
    const del = mock.method(getAxios(radarr), 'delete', async () => ({}));

    await assert.rejects(
      () => radarr.removeMovie(550),
      (e: unknown) =>
        (e as { response?: { status?: number } }).response?.status === 404
    );
    assert.strictEqual(del.mock.callCount(), 0);
  });
});

describe('RadarrAPI getMovieByTmdbId', () => {
  afterEach(() => mock.restoreAll());

  it('rethrows a 401 from the lookup with the status intact', async () => {
    const radarr = buildRadarr();
    mock.method(getAxios(radarr), 'get', async () => {
      throw { response: { status: 401 } };
    });

    await assert.rejects(
      () => radarr.getMovieByTmdbId(550),
      (e: unknown) =>
        (e as { response?: { status?: number } }).response?.status === 401
    );
  });

  it('throws "Movie not found" when the lookup returns no results', async () => {
    const radarr = buildRadarr();
    mock.method(getAxios(radarr), 'get', async () => ({ data: [] }));

    await assert.rejects(() => radarr.getMovieByTmdbId(550), {
      message: 'Movie not found',
    });
  });
});

const movie = (overrides: Partial<RadarrMovie> = {}): RadarrMovie => ({
  id: 42,
  title: 'Test Movie',
  isAvailable: true,
  monitored: true,
  tmdbId: 100,
  imdbId: 'tt0000100',
  titleSlug: 'test-movie',
  folderName: 'Test Movie',
  path: '/movies/Test Movie',
  profileId: 1,
  qualityProfileId: 1,
  added: '2026-01-01T00:00:00Z',
  hasFile: true,
  tags: [],
  ...overrides,
});

describe('RadarrAPI.getMovieCover', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('fetches the first advertised relative cover path outside the API base path', async () => {
    const api = new RadarrAPI({
      url: 'http://localhost:7878/base/api/v3',
      apiKey: 'key',
    });
    mock.method(api, 'getMovie', async () =>
      movie({
        images: [
          {
            coverType: 'poster',
            url: '/MediaCover/42/poster.jpg',
          },
        ],
      })
    );
    const axiosGetMock = mock.fn(async () => ({
      data: Buffer.from('movie-image'),
      headers: { 'content-type': 'image/jpeg' },
    }));
    (
      api as unknown as {
        axios: { get: typeof axiosGetMock };
      }
    ).axios.get = axiosGetMock;

    const result = await api.getMovieCover(42);

    assert.deepStrictEqual(result.imageBuffer, Buffer.from('movie-image'));
    assert.strictEqual(result.contentType, 'image/jpeg');
    assert.strictEqual(
      (
        axiosGetMock.mock.calls as unknown as {
          arguments: [string];
        }[]
      )[0].arguments[0],
      'http://localhost:7878/base/MediaCover/42/poster.jpg'
    );
  });

  it('falls back to the standard Radarr-compatible poster path', async () => {
    const api = new RadarrAPI({
      url: 'http://localhost:7878/api/v3',
      apiKey: 'key',
    });
    mock.method(api, 'getMovie', async () => movie());
    const axiosGetMock = mock.fn(async () => ({
      data: Buffer.from('fallback-movie-image'),
      headers: { 'content-type': 'image/png' },
    }));
    (
      api as unknown as {
        axios: { get: typeof axiosGetMock };
      }
    ).axios.get = axiosGetMock;

    const result = await api.getMovieCover(42);

    assert.deepStrictEqual(
      result.imageBuffer,
      Buffer.from('fallback-movie-image')
    );
    assert.strictEqual(
      (
        axiosGetMock.mock.calls as unknown as {
          arguments: [string];
        }[]
      )[0].arguments[0],
      'http://localhost:7878/MediaCover/42/poster.jpg'
    );
  });

  it('falls back to an advertised remote poster when local media cover is not an image', async () => {
    const api = new RadarrAPI({
      url: 'http://localhost:7878/api/v3',
      apiKey: 'key',
    });
    mock.method(api, 'getMovie', async () =>
      movie({
        images: [
          {
            coverType: 'poster',
            url: '/MediaCover/42/poster.jpg?lastWrite=123',
            remoteUrl: 'https://image.tmdb.org/t/p/original/poster.jpg',
          },
        ],
      })
    );
    const axiosGetMock = mock.fn(async () => ({
      data: Buffer.from('login-page'),
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    (
      api as unknown as {
        axios: { get: typeof axiosGetMock };
      }
    ).axios.get = axiosGetMock;
    const remoteGetMock = mock.method(axios, 'get', async () => ({
      data: Buffer.from('remote-movie-image'),
      headers: { 'content-type': 'image/jpeg' },
    }));

    const result = await api.getMovieCover(42);

    assert.deepStrictEqual(
      result.imageBuffer,
      Buffer.from('remote-movie-image')
    );
    assert.strictEqual(result.contentType, 'image/jpeg');
    assert.strictEqual(
      remoteGetMock.mock.calls[0].arguments[0],
      'https://image.tmdb.org/t/p/original/poster.jpg'
    );
    assert.deepStrictEqual(remoteGetMock.mock.calls[0].arguments[1], {
      responseType: 'arraybuffer',
      headers: { Accept: 'image/*' },
    });
  });
});
