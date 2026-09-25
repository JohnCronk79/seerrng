import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import KapowarrAPI from '@server/api/comics/kapowarr';

type MockableKapowarr = {
  get: (
    endpoint: string,
    options?: { params?: Record<string, unknown> },
    ttl?: number
  ) => Promise<unknown>;
  post: (endpoint: string, data?: Record<string, unknown>) => Promise<unknown>;
};

const mockGet = (implementation: (endpoint: string) => Promise<unknown>) =>
  mock.method(
    KapowarrAPI.prototype as unknown as MockableKapowarr,
    'get',
    implementation
  );

const mockPost = (
  implementation: (
    endpoint: string,
    data?: Record<string, unknown>
  ) => Promise<unknown>
) =>
  mock.method(
    KapowarrAPI.prototype as unknown as MockableKapowarr,
    'post',
    implementation
  );

describe('KapowarrAPI', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('parses /system/about', async () => {
    mockGet(async () => ({
      error: null,
      result: { version: 'V1.3.2', database_version: 51 },
    }));

    const api = new KapowarrAPI({
      url: 'http://localhost:5656',
      apiKey: 'key',
    });
    const about = await api.getSystemAbout();

    assert.deepStrictEqual(about, { version: 'V1.3.2', database_version: 51 });
  });

  it('drops volumes missing required fields', async () => {
    mockGet(async () => ({
      error: null,
      result: [
        { id: 1, comicvine_id: 100, title: 'Batman' },
        { id: 2, title: 'Missing comicvine_id' },
        { comicvine_id: 3, title: 'Missing id' },
      ],
    }));

    const api = new KapowarrAPI({
      url: 'http://localhost:5656',
      apiKey: 'key',
    });
    const volumes = await api.getVolumes();

    assert.strictEqual(volumes.length, 1);
    assert.strictEqual(volumes[0].title, 'Batman');
    assert.strictEqual(volumes[0].monitored, false);
    assert.strictEqual(volumes[0].issue_count, 0);
  });

  it('resolveRootFolderId reuses an existing folder before creating one', async () => {
    mockGet(async () => ({
      error: null,
      result: [{ id: 7, folder: '/comics/' }],
    }));
    const postMock = mockPost(async () => ({
      error: null,
      result: { id: 99, folder: '/new/' },
    }));

    const api = new KapowarrAPI({
      url: 'http://localhost:5656',
      apiKey: 'key',
    });
    const id = await api.resolveRootFolderId('/comics/');

    assert.strictEqual(id, 7);
    assert.strictEqual(postMock.mock.calls.length, 0);
  });

  it('resolveRootFolderId creates a folder when none matches', async () => {
    mockGet(async () => ({ error: null, result: [] }));
    mockPost(async () => ({
      error: null,
      result: { id: 99, folder: '/new/' },
    }));

    const api = new KapowarrAPI({
      url: 'http://localhost:5656',
      apiKey: 'key',
    });
    const id = await api.resolveRootFolderId('/new/');

    assert.strictEqual(id, 99);
  });

  it('addVolume posts the expected body and parses the created volume', async () => {
    const postMock = mockPost(async () => ({
      error: null,
      result: {
        id: 5,
        comicvine_id: 1234,
        title: 'Batman',
        monitored: true,
        issue_count: 10,
        issues_downloaded: 0,
      },
    }));

    const api = new KapowarrAPI({
      url: 'http://localhost:5656',
      apiKey: 'key',
    });
    const volume = await api.addVolume({ comicVineId: 1234, rootFolderId: 7 });

    assert.strictEqual(volume.id, 5);
    assert.deepStrictEqual(postMock.mock.calls[0].arguments[1], {
      comicvine_id: 1234,
      root_folder_id: 7,
      monitor: true,
      auto_search: true,
    });
  });

  it('throws when the created volume cannot be parsed', async () => {
    mockPost(async () => ({ error: null, result: null }));

    const api = new KapowarrAPI({
      url: 'http://localhost:5656',
      apiKey: 'key',
    });
    await assert.rejects(() =>
      api.addVolume({ comicVineId: 1, rootFolderId: 1 })
    );
  });

  it('treats a VolumeAlreadyAdded error as success and fetches the existing volume', async () => {
    // A client-side timeout doesn't mean Kapowarr's own add didn't complete
    // server-side - confirmed against a real instance. A bare retry then
    // hits this same response, so it must resolve to the existing volume
    // rather than fail the request.
    mockPost(async () => {
      const error = new Error(
        'Request failed with status code 400'
      ) as Error & {
        isAxiosError: boolean;
        response: { status: number; data: unknown };
      };
      error.isAxiosError = true;
      error.response = {
        status: 400,
        data: {
          error: 'VolumeAlreadyAdded',
          result: { comicvine_id: 1234, volume_id: 2 },
        },
      };
      throw error;
    });
    mockGet(async () => ({
      error: null,
      result: {
        id: 2,
        comicvine_id: 1234,
        title: 'Existing Volume',
        monitored: true,
        issue_count: 5,
        issues_downloaded: 1,
      },
    }));

    const api = new KapowarrAPI({
      url: 'http://localhost:5656',
      apiKey: 'key',
    });
    const volume = await api.addVolume({ comicVineId: 1234, rootFolderId: 1 });

    assert.strictEqual(volume.id, 2);
    assert.strictEqual(volume.title, 'Existing Volume');
  });
});
