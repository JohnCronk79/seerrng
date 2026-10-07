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
import SabnzbdClient, {
  mapSabnzbdSlot,
  parseSabnzbdTimeleft,
} from '@server/api/downloadClients/sabnzbd';
import {
  DownloadClientError,
  keysForClientType,
  normalizeDownloadKey,
} from '@server/api/downloadClients/types';
import { LiveDownloadTokenRegistry } from '@server/lib/liveDownloadTokens';
import type { DownloadClientSettings } from '@server/lib/settings';

const NZO_A = 'SABnzbd_nzo_abc123';
const NZO_B = 'SABnzbd_nzo_def456';
const HASH = 'a'.repeat(40);

const withServer = async (
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (port: number) => Promise<void>
) => {
  const server = createServer(handler);
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
  name: 'sab',
  type: 'sabnzbd',
  enabled: true,
  hostname: '127.0.0.1',
  port,
  useSsl: false,
  baseUrl: '',
  username: '',
  password: 'api-key',
  ...overrides,
});

describe('SABnzbd time and state mapping', () => {
  it('parses H:MM:SS estimates and rejects other text', () => {
    assert.equal(parseSabnzbdTimeleft('1:02:03'), 3723);
    assert.equal(parseSabnzbdTimeleft('0:00:00'), 0);
    assert.equal(parseSabnzbdTimeleft('unknown'), null);
    assert.equal(parseSabnzbdTimeleft('1:2'), null);
  });

  it('maps a downloading slot with its aggregate speed and estimate', () => {
    const status = mapSabnzbdSlot(
      {
        nzo_id: NZO_A,
        mb: '1000.00',
        mbleft: '250.00',
        percentage: '75',
        status: 'Downloading',
        timeleft: '0:01:00',
      },
      2 * 1024 * 1024
    );
    assert.equal(status?.hash, NZO_A);
    assert.equal(status?.state, 'downloading');
    assert.equal(status?.size, 1000 * 1024 * 1024);
    assert.equal(status?.progress, 0.75);
    assert.equal(status?.downloadRate, 2 * 1024 * 1024);
    assert.equal(status?.etaSeconds, 60);
  });

  it('reports a downloading slot with no speed as stalled', () => {
    const status = mapSabnzbdSlot(
      { nzo_id: NZO_A, mb: '10', mbleft: '10', status: 'Downloading' },
      0
    );
    assert.equal(status?.state, 'stalled');
  });

  it('reports paused, queued and post-processing slots without speed', () => {
    const paused = mapSabnzbdSlot(
      { nzo_id: NZO_A, mb: '10', mbleft: '5', status: 'Paused' },
      9999
    );
    const queued = mapSabnzbdSlot(
      { nzo_id: NZO_A, mb: '10', mbleft: '5', status: 'Queued' },
      9999
    );
    const repairing = mapSabnzbdSlot(
      { nzo_id: NZO_A, mb: '10', mbleft: '0', status: 'Repairing' },
      9999
    );
    assert.equal(paused?.state, 'paused');
    assert.equal(paused?.downloadRate, 0);
    assert.equal(queued?.state, 'queued');
    assert.equal(repairing?.state, 'checking');
    assert.equal(repairing?.downloadRate, 0);
  });

  it('rejects slots whose ID is not a SABnzbd queue ID', () => {
    assert.equal(
      mapSabnzbdSlot({ nzo_id: HASH, mb: '1', mbleft: '1' }, 0),
      undefined
    );
    assert.equal(
      mapSabnzbdSlot({ nzo_id: 'SABnzbd_nzo_bad-id' }, 0),
      undefined
    );
  });
});

describe('download key routing', () => {
  it('accepts torrent hashes and SABnzbd queue IDs, and rejects other text', () => {
    assert.equal(normalizeDownloadKey(HASH.toUpperCase()), HASH);
    assert.equal(normalizeDownloadKey(NZO_A), NZO_A);
    assert.equal(normalizeDownloadKey('not a key'), undefined);
  });

  it('sends SABnzbd queue IDs only to SABnzbd and hashes only to torrent clients', () => {
    const keys = [HASH, NZO_A];
    assert.deepEqual(keysForClientType('sabnzbd', keys), [NZO_A]);
    assert.deepEqual(keysForClientType('qbittorrent', keys), [HASH]);
    assert.deepEqual(keysForClientType('rtorrent', keys), [HASH]);
  });

  it('issues live tokens for SABnzbd queue IDs without changing their case', () => {
    const registry = new LiveDownloadTokenRegistry();
    const token = registry.issue(NZO_A, 7);
    assert.ok(token);
    assert.equal(registry.resolve(token, 7), NZO_A);
  });
});

describe('SABnzbd client', () => {
  it('sends the API key and returns only subscribed queue IDs', async () => {
    let seenUrl = '';
    await withServer(
      (request, response) => {
        seenUrl = request.url ?? '';
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            queue: {
              kbpersec: '1024.00',
              slots: [
                {
                  nzo_id: NZO_A,
                  mb: '100',
                  mbleft: '50',
                  percentage: '50',
                  status: 'Downloading',
                  timeleft: '0:00:30',
                },
                {
                  nzo_id: NZO_B,
                  mb: '20',
                  mbleft: '20',
                  percentage: '0',
                  status: 'Queued',
                  timeleft: '0:00:00',
                },
              ],
            },
          })
        );
      },
      async (port) => {
        const statuses = await new SabnzbdClient(settings(port)).getTorrents([
          NZO_A,
        ]);
        assert.deepEqual(
          statuses.map((status) => status.hash),
          [NZO_A]
        );
        assert.equal(statuses[0].downloadRate, 1024 * 1024);
      }
    );
    const url = new URL(seenUrl, 'http://localhost');
    assert.equal(url.pathname, '/api');
    assert.equal(url.searchParams.get('mode'), 'queue');
    assert.equal(url.searchParams.get('apikey'), 'api-key');
  });

  it('skips the request when no SABnzbd queue ID is subscribed', async () => {
    let requests = 0;
    await withServer(
      (_request, response) => {
        requests += 1;
        response.end();
      },
      async (port) => {
        assert.deepEqual(
          await new SabnzbdClient(settings(port)).getTorrents([HASH]),
          []
        );
      }
    );
    assert.equal(requests, 0);
  });

  it('reports an API key rejection as an auth error', async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({ status: false, error: 'API Key Incorrect' })
        );
      },
      async (port) => {
        await assert.rejects(
          new SabnzbdClient(settings(port)).getTorrents([NZO_A]),
          (error: unknown) =>
            error instanceof DownloadClientError &&
            error.kind === 'auth' &&
            !error.message.includes('api-key')
        );
      }
    );
  });

  it('reports the version from the version mode', async () => {
    await withServer(
      (request, response) => {
        const mode = new URL(request.url ?? '', 'http://x').searchParams.get(
          'mode'
        );
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify(
            mode === 'version' ? { version: '4.5.1' } : { queue: { slots: [] } }
          )
        );
      },
      async (port) => {
        const result = await new SabnzbdClient(settings(port)).testConnection();
        assert.equal(result.version, '4.5.1');
      }
    );
  });

  it('is constructed by the download client factory', () => {
    assert.ok(createDownloadClient(settings(8080)) instanceof SabnzbdClient);
  });
});
