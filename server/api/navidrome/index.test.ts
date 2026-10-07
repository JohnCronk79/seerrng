import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import NavidromeAPI, {
  mapNavidromeAlbum,
  subsonicAuthParams,
} from '@server/api/navidrome';
import { fetchAllNavidromeAlbums } from '@server/lib/scanners/navidrome';
import { parseNavidromeSettings } from '@server/routes/settings/navidrome';
import { REDACTED_SECRET } from '@server/utils/security';

const withServer = async (
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>
) => {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
};

const ok = (payload: Record<string, unknown> = {}) =>
  JSON.stringify({
    'subsonic-response': { status: 'ok', version: '1.16.1', ...payload },
  });

const settings = (baseUrl: string) => ({
  url: baseUrl,
  username: 'listener',
  password: 'secret',
  syncEnabled: true,
});

describe('Subsonic token auth', () => {
  it('computes t as md5(password + salt) and sends the salt', () => {
    const params = subsonicAuthParams('listener', 'secret', 'abc123');
    assert.equal(params.s, 'abc123');
    assert.equal(
      params.t,
      createHash('md5').update('secretabc123').digest('hex')
    );
    assert.equal(params.f, 'json');
    assert.equal(params.u, 'listener');
  });
});

describe('Navidrome album mapping', () => {
  it('keeps the MusicBrainz ID when present', () => {
    assert.deepEqual(
      mapNavidromeAlbum({
        id: 'al-1',
        name: 'Abbey Road',
        artist: 'The Beatles',
        musicBrainzId: '9162580e-5df4-32de-80cc-f45a8d8a9b1d',
      }),
      {
        id: 'al-1',
        name: 'Abbey Road',
        artist: 'The Beatles',
        musicBrainzId: '9162580e-5df4-32de-80cc-f45a8d8a9b1d',
      }
    );
  });

  it('drops rows without an ID or a name', () => {
    assert.equal(mapNavidromeAlbum({ name: 'No ID' }), undefined);
    assert.equal(mapNavidromeAlbum({ id: 'al-2' }), undefined);
  });
});

describe('Navidrome client', () => {
  it('sends token auth to the REST endpoint and reads albums from albumList2', async () => {
    let seenUrl = '';
    await withServer(
      (request, response) => {
        seenUrl = request.url ?? '';
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          ok({
            albumList2: {
              album: [
                {
                  id: 'al-1',
                  name: 'Abbey Road',
                  musicBrainzId: '9162580e-5df4-32de-80cc-f45a8d8a9b1d',
                },
              ],
            },
          })
        );
      },
      async (baseUrl) => {
        const albums = await new NavidromeAPI(settings(baseUrl)).getAlbumsPage(
          0,
          50
        );
        assert.equal(albums.length, 1);
        assert.equal(albums[0].name, 'Abbey Road');
      }
    );
    const url = new URL(seenUrl, 'http://localhost');
    assert.equal(url.pathname, '/rest/getAlbumList2.view');
    assert.equal(url.searchParams.get('type'), 'alphabeticalByName');
    assert.equal(url.searchParams.get('offset'), '0');
    assert.equal(url.searchParams.get('u'), 'listener');
    assert.ok(url.searchParams.get('t'));
    assert.equal(url.searchParams.get('password'), null);
  });

  it('reports a Subsonic error payload as a failure', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            'subsonic-response': {
              status: 'failed',
              error: { code: 40, message: 'Wrong username or password.' },
            },
          })
        );
      },
      async (baseUrl) => {
        await assert.rejects(
          new NavidromeAPI(settings(baseUrl)).ping(),
          /Wrong username or password/
        );
      }
    );
  });

  it('reports an HTTP 401 as a credentials failure', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(401);
        response.end();
      },
      async (baseUrl) => {
        await assert.rejects(
          new NavidromeAPI(settings(baseUrl)).ping(),
          /rejected the username or password/
        );
      }
    );
  });
});

describe('Navidrome library paging', () => {
  it('stops on a short page and collects every album', async () => {
    const pages = [
      Array.from({ length: 500 }, (_, index) => ({
        id: `a${index}`,
        name: `A${index}`,
      })),
      [{ id: 'last', name: 'Last' }],
    ];
    const calls: number[] = [];
    const albums = await fetchAllNavidromeAlbums({
      getAlbumsPage: async (offset: number) => {
        calls.push(offset);
        return pages[calls.length - 1] as never;
      },
    });
    assert.equal(albums.length, 501);
    assert.deepEqual(calls, [0, 500]);
  });

  it('throws instead of returning a partial catalogue when the cap is reached', async () => {
    await assert.rejects(
      fetchAllNavidromeAlbums({
        getAlbumsPage: async () =>
          Array.from({ length: 500 }, (_, index) => ({
            id: `${index}`,
            name: 'x',
          })) as never,
      }),
      /scan limit/
    );
  });
});

describe('Navidrome settings parsing', () => {
  it('requires an HTTP URL and a boolean sync flag', () => {
    assert.ok(
      'error' in
        parseNavidromeSettings({
          url: 'ftp://nope',
          username: 'u',
          password: 'p',
          syncEnabled: true,
        })
    );
    assert.ok(
      'error' in
        parseNavidromeSettings({
          url: 'http://navidrome:4533',
          username: 'u',
          password: 'p',
          syncEnabled: 'yes',
        })
    );
  });

  it('keeps the saved password when the redacted placeholder is sent', () => {
    const result = parseNavidromeSettings(
      {
        url: 'http://navidrome:4533/',
        username: 'u',
        password: REDACTED_SECRET,
        syncEnabled: true,
      },
      { url: 'http://old', username: 'u', password: 'kept', syncEnabled: false }
    );
    assert.ok('value' in result);
    assert.equal(result.value.password, 'kept');
    assert.equal(result.value.url, 'http://navidrome:4533');
  });
});
