import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { createDownloadClient } from '@server/api/downloadClients';
import RTorrentClient, {
  decodeXmlRpcValue,
  escapeXml,
  mapRTorrentState,
  mapRTorrentTorrent,
  rowFromMulticall,
} from '@server/api/downloadClients/rtorrent';
import { DownloadClientError } from '@server/api/downloadClients/types';
import type { DownloadClientSettings } from '@server/lib/settings';
import { parseStringPromise } from 'xml2js';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);
const HASH_C = 'c'.repeat(40);

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const withServer = async (
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    body: string
  ) => void,
  run: (port: number) => Promise<void>
) => {
  const server = createServer((request, response) => {
    void readBody(request).then((body) => handler(request, response, body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    server.close();
  }
};

const settings = (
  port: number,
  overrides: Partial<DownloadClientSettings> = {}
): DownloadClientSettings => ({
  id: 1,
  name: 'rtorrent',
  type: 'rtorrent',
  enabled: true,
  hostname: '127.0.0.1',
  port,
  useSsl: false,
  baseUrl: '',
  username: '',
  password: '',
  ...overrides,
});

type XmlRpcScalar = string | number;

const xmlValue = (value: XmlRpcScalar): string =>
  typeof value === 'number'
    ? `<value><i8>${value}</i8></value>`
    : `<value><string>${escapeXml(value)}</string></value>`;

/** Builds a `d.multicall2` response: one array row per torrent. */
const multicallResponse = (rows: XmlRpcScalar[][]): string => {
  const body = rows
    .map(
      (row) =>
        `<value><array><data>${row.map(xmlValue).join('')}</data></array></value>`
    )
    .join('');
  return `<?xml version="1.0"?><methodResponse><params><param><value><array><data>${body}</data></array></value></param></params></methodResponse>`;
};

const stringResponse = (value: string): string =>
  `<?xml version="1.0"?><methodResponse><params><param><value><string>${value}</string></value></param></params></methodResponse>`;

const faultResponse = (): string =>
  `<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultCode</name><value><int>-501</int></value></member><member><name>faultString</name><value><string>Could not find info-hash.</string></value></member></struct></value></fault></methodResponse>`;

describe('rTorrent XML-RPC decoding', () => {
  it('decodes scalars, arrays and structs', async () => {
    const parsed = await parseStringPromise(
      `<value><struct><member><name>a</name><value><i8>7</i8></value></member><member><name>b</name><value><array><data><value><string>x</string></value><value>plain</value></data></array></value></member></struct></value>`,
      { explicitArray: true }
    );
    assert.deepEqual(decodeXmlRpcValue(parsed.value), {
      a: 7,
      b: ['x', 'plain'],
    });
  });

  it('escapes XML metacharacters in outgoing values', () => {
    assert.equal(
      escapeXml(`<a & "b" 'c'>`),
      '&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;'
    );
  });
});

describe('rTorrent state mapping', () => {
  it('maps active, paused, seeding, completed, stalled and checking torrents', () => {
    assert.equal(
      mapRTorrentState({ active: true, complete: false, downRate: 500 }),
      'downloading'
    );
    assert.equal(
      mapRTorrentState({
        active: true,
        complete: false,
        downRate: 0,
        peersComplete: 0,
      }),
      'stalled'
    );
    assert.equal(
      mapRTorrentState({ active: false, complete: false }),
      'paused'
    );
    assert.equal(mapRTorrentState({ active: true, complete: true }), 'seeding');
    assert.equal(
      mapRTorrentState({ active: false, complete: true }),
      'completed'
    );
    assert.equal(
      mapRTorrentState({ active: true, complete: false, checking: true }),
      'checking'
    );
  });

  it('never marks a torrent as an error from tracker messages', () => {
    // d.message carries tracker notices too, so the mapper does not read it.
    const status = mapRTorrentTorrent(
      rowFromMulticall([HASH_A, 100, 50, 50, 10, 0, 1, 0, 0, 2, 1])
    );
    assert.equal(status?.state, 'downloading');
    assert.equal(status?.progress, 0.5);
  });

  it('rejects rows without a valid info hash', () => {
    assert.equal(
      mapRTorrentTorrent(rowFromMulticall(['not-a-hash', 1])),
      undefined
    );
  });

  it('derives remaining bytes from completed bytes when left bytes are absent', () => {
    const status = mapRTorrentTorrent({
      hash: HASH_A,
      sizeBytes: 200,
      completedBytes: 50,
      active: true,
      complete: false,
      downRate: 25,
    });
    assert.equal(status?.sizeLeft, 150);
    assert.equal(status?.etaSeconds, 6);
  });
});

describe('rTorrent client', () => {
  it('sends one d.multicall2 request and returns only subscribed hashes', async () => {
    let seenBody = '';
    await withServer(
      (request, response, body) => {
        seenBody = body;
        assert.equal(request.url, '/RPC2');
        response.writeHead(200, { 'Content-Type': 'text/xml' });
        response.end(
          multicallResponse([
            [HASH_A.toUpperCase(), 1000, 250, 750, 100, 0, 1, 0, 0, 3, 2],
            [HASH_B, 500, 500, 0, 0, 0, 0, 1, 0, 0, 0],
            [HASH_C, 10, 0, 10, 0, 0, 1, 0, 0, 0, 0],
          ])
        );
      },
      async (port) => {
        const client = new RTorrentClient(settings(port));
        const torrents = await client.getTorrents([HASH_A, HASH_B]);
        assert.deepEqual(
          torrents.map((torrent) => [torrent.hash, torrent.state]),
          [
            [HASH_A, 'downloading'],
            [HASH_B, 'completed'],
          ]
        );
        assert.equal(torrents[0].progress, 0.25);
        assert.equal(torrents[0].peers, 3);
        assert.equal(torrents[0].seeds, 2);
      }
    );

    assert.equal(
      seenBody.match(/<methodName>(.*?)<\/methodName>/)?.[1],
      'd.multicall2'
    );
    assert.ok(seenBody.includes('<string>d.hash=</string>'));
    assert.ok(seenBody.includes('<string>d.left_bytes=</string>'));
  });

  it('sends HTTP basic auth when credentials are configured', async () => {
    let authorization: string | undefined;
    await withServer(
      (request, response) => {
        authorization = request.headers.authorization;
        response.writeHead(200, { 'Content-Type': 'text/xml' });
        response.end(stringResponse('0.9.8'));
      },
      async (port) => {
        await new RTorrentClient(
          settings(port, { username: 'rutorrent', password: 'secret' })
        ).testConnection();
      }
    );
    assert.equal(
      authorization,
      `Basic ${Buffer.from('rutorrent:secret').toString('base64')}`
    );
  });

  it('reports the client version from system.client_version', async () => {
    await withServer(
      (_request, response, body) => {
        assert.ok(
          body.includes('<methodName>system.client_version</methodName>')
        );
        response.writeHead(200, { 'Content-Type': 'text/xml' });
        response.end(stringResponse('0.9.8'));
      },
      async (port) => {
        const result = await new RTorrentClient(
          settings(port)
        ).testConnection();
        assert.equal(result.version, '0.9.8');
      }
    );
  });

  it('treats a rejected login as an auth error', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(401);
        response.end();
      },
      async (port) => {
        await assert.rejects(
          new RTorrentClient(settings(port)).getTorrents([HASH_A]),
          (error: unknown) =>
            error instanceof DownloadClientError && error.kind === 'auth'
        );
      }
    );
  });

  it('reports an XML-RPC fault as a protocol error without echoing its text', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/xml' });
        response.end(faultResponse());
      },
      async (port) => {
        await assert.rejects(
          new RTorrentClient(settings(port)).getTorrents([HASH_A]),
          (error: unknown) =>
            error instanceof DownloadClientError &&
            error.kind === 'protocol' &&
            !error.message.includes('info-hash')
        );
      }
    );
  });

  it('skips the request entirely when no valid hash is subscribed', async () => {
    let requests = 0;
    await withServer(
      (_request, response) => {
        requests += 1;
        response.end();
      },
      async (port) => {
        const torrents = await new RTorrentClient(settings(port)).getTorrents([
          'not-a-hash',
        ]);
        assert.deepEqual(torrents, []);
      }
    );
    assert.equal(requests, 0);
  });

  it('is constructed by the download client factory', () => {
    const client = createDownloadClient(settings(80));
    assert.ok(client instanceof RTorrentClient);
  });
});
