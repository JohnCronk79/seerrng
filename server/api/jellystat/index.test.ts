import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import JellystatAPI, {
  JELLYSTAT_LIFETIME_HOURS,
  mapJellystatItemPlayback,
} from '@server/api/jellystat';
import { parseJellystatSettings } from '@server/routes/settings/jellystat';
import { REDACTED_SECRET } from '@server/utils/security';

const withServer = async (
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    body: string
  ) => void,
  run: (baseUrl: string) => Promise<void>
) => {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () =>
      handler(request, response, Buffer.concat(chunks).toString('utf8'))
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.close();
  }
};

describe('Jellystat item mapping', () => {
  it('reads Postgres string counts as numbers', () => {
    assert.deepEqual(
      mapJellystatItemPlayback({ Plays: '7', total_playback_duration: '5400' }),
      { plays: 7, playbackSeconds: 5400 }
    );
  });

  it('treats missing or invalid totals as zero', () => {
    assert.deepEqual(mapJellystatItemPlayback({}), {
      plays: 0,
      playbackSeconds: 0,
    });
    assert.deepEqual(
      mapJellystatItemPlayback({ Plays: -3, total_playback_duration: 'NaN' }),
      { plays: 0, playbackSeconds: 0 }
    );
  });
});

describe('Jellystat client', () => {
  it('sends the API key header to the library overview', async () => {
    let apiToken: string | undefined;
    await withServer(
      (request, response) => {
        apiToken = request.headers['x-api-token'] as string | undefined;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('[]');
      },
      async (baseUrl) => {
        await new JellystatAPI({ url: baseUrl, apiKey: 'key-123' }).ping();
      }
    );
    assert.equal(apiToken, 'key-123');
  });

  it('posts a lifetime window and the Jellyfin item ID for item playback', async () => {
    let path = '';
    let body: Record<string, unknown> = {};
    await withServer(
      (request, response, raw) => {
        path = request.url ?? '';
        body = JSON.parse(raw);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({ Plays: '3', total_playback_duration: '900' })
        );
      },
      async (baseUrl) => {
        const playback = await new JellystatAPI({
          url: baseUrl,
          apiKey: 'key',
        }).getItemPlayback('jf-item-1');
        assert.deepEqual(playback, { plays: 3, playbackSeconds: 900 });
      }
    );
    assert.equal(path, '/stats/getGlobalItemStats');
    assert.deepEqual(body, {
      hours: JELLYSTAT_LIFETIME_HOURS,
      itemid: 'jf-item-1',
    });
  });

  it('reports a rejected API key as a failure', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(401);
        response.end();
      },
      async (baseUrl) => {
        await assert.rejects(
          new JellystatAPI({ url: baseUrl, apiKey: 'bad' }).ping(),
          /rejected the API key/
        );
      }
    );
  });

  it('rejects an overview that is not a list', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"oops":true}');
      },
      async (baseUrl) => {
        await assert.rejects(
          new JellystatAPI({ url: baseUrl, apiKey: 'k' }).ping(),
          /invalid library overview/
        );
      }
    );
  });
});

describe('Jellystat settings parsing', () => {
  it('keeps the saved key when the redacted placeholder is sent', () => {
    const result = parseJellystatSettings(
      { url: 'http://jellystat:3000/', apiKey: REDACTED_SECRET },
      { url: 'http://old', apiKey: 'saved' }
    );
    assert.ok('value' in result);
    assert.equal(result.value.apiKey, 'saved');
    assert.equal(result.value.url, 'http://jellystat:3000');
  });

  it('requires an HTTP URL and a key', () => {
    assert.ok(
      'error' in parseJellystatSettings({ url: 'file:///x', apiKey: 'k' })
    );
    assert.ok(
      'error' in parseJellystatSettings({ url: 'http://j', apiKey: '' })
    );
    assert.ok(
      'error' in
        parseJellystatSettings({
          url: 'http://jellystat?redirect=example',
          apiKey: 'k',
        })
    );
    assert.ok(
      'error' in
        parseJellystatSettings({
          url: 'http://jellystat/#fragment',
          apiKey: 'k',
        })
    );
  });
});
