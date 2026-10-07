import {
  baseRequestConfig,
  clampProgress,
  clientUrl,
  type DownloadClientAdapter,
  DownloadClientError,
  type DownloadClientTestResult,
  estimateEta,
  type LiveTorrentState,
  type LiveTorrentStatus,
  nonNegative,
  normalizeInfoHash,
  optionalCount,
} from '@server/api/downloadClients/types';
import type { DownloadClientSettings } from '@server/lib/settings';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';

/** rTorrent has no HTTP server of its own; this is the XML-RPC endpoint ruTorrent and SCGI bridges expose. */
export const RTORRENT_RPC_PATH = '/RPC2';

/**
 * Fields requested per torrent in one `d.multicall2` call, in row order.
 * `d.message` is read for display only: rTorrent reports tracker announce
 * notices through the same field, so it never marks a torrent as failed.
 */
const MULTICALL_FIELDS = [
  'd.hash=',
  'd.size_bytes=',
  'd.completed_bytes=',
  'd.left_bytes=',
  'd.down.rate=',
  'd.up.rate=',
  'd.is_active=',
  'd.complete=',
  'd.is_hash_checking=',
  'd.peers_connected=',
  'd.peers_complete=',
] as const;

export interface RTorrentRow {
  hash?: string;
  sizeBytes?: number;
  completedBytes?: number;
  leftBytes?: number;
  downRate?: number;
  upRate?: number;
  active?: boolean;
  complete?: boolean;
  checking?: boolean;
  peersConnected?: number;
  peersComplete?: number;
}

/**
 * xml2js wraps most child elements in arrays, but the document root is a bare
 * object. These helpers read one named child list whichever shape arrives.
 */
const children = (node: unknown, key: string): unknown[] => {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  const list = (node as Record<string, unknown>)[key];
  if (list === undefined) return [];
  return Array.isArray(list) ? list : [list];
};

const childText = (node: unknown, key: string): string | undefined => {
  const first = children(node, key)[0];
  return typeof first === 'string' ? first : undefined;
};

const NUMERIC_KEYS = ['i4', 'int', 'i8', 'double'] as const;

/**
 * Decodes one XML-RPC `<value>` (the content xml2js yields for it). Bare text
 * without a type element is a string, as the XML-RPC specification allows.
 */
export const decodeXmlRpcValue = (node: unknown): unknown => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return decodeXmlRpcValue(node[0]);
  if (!node || typeof node !== 'object') return undefined;

  if (children(node, 'boolean').length > 0) {
    return childText(node, 'boolean') === '1';
  }
  for (const key of NUMERIC_KEYS) {
    if (children(node, key).length > 0) {
      const value = Number(childText(node, key));
      return Number.isFinite(value) ? value : undefined;
    }
  }
  if (children(node, 'string').length > 0) {
    return childText(node, 'string') ?? '';
  }
  if (children(node, 'array').length > 0) {
    const data = children(children(node, 'array')[0], 'data')[0];
    return children(data, 'value').map((item) => decodeXmlRpcValue(item));
  }
  if (children(node, 'struct').length > 0) {
    const members = children(children(node, 'struct')[0], 'member');
    return Object.fromEntries(
      members.map((member) => [
        childText(member, 'name') ?? '',
        decodeXmlRpcValue(children(member, 'value')[0]),
      ])
    );
  }
  return undefined;
};

export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const xmlParam = (value: string): string =>
  `<param><value><string>${escapeXml(value)}</string></value></param>`;

export const buildMethodCall = (
  method: string,
  params: string[] = []
): string =>
  `<?xml version="1.0"?><methodCall><methodName>${escapeXml(method)}</methodName><params>${params
    .map(xmlParam)
    .join('')}</params></methodCall>`;

const readNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Maps one `d.multicall2` row, ordered as {@link MULTICALL_FIELDS}. */
export const rowFromMulticall = (values: unknown[]): RTorrentRow => ({
  hash: typeof values[0] === 'string' ? values[0] : undefined,
  sizeBytes: readNumber(values[1]),
  completedBytes: readNumber(values[2]),
  leftBytes: readNumber(values[3]),
  downRate: readNumber(values[4]),
  upRate: readNumber(values[5]),
  active: values[6] === 1 || values[6] === true,
  complete: values[7] === 1 || values[7] === true,
  checking: values[8] === 1 || values[8] === true,
  peersConnected: readNumber(values[9]),
  peersComplete: readNumber(values[10]),
});

export const mapRTorrentState = (
  torrent: Pick<
    RTorrentRow,
    'active' | 'complete' | 'checking' | 'downRate' | 'peersComplete'
  >
): LiveTorrentState => {
  if (torrent.checking) return 'checking';
  if (torrent.complete) return torrent.active ? 'seeding' : 'completed';
  if (!torrent.active) return 'paused';
  return (torrent.downRate ?? 0) === 0 && (torrent.peersComplete ?? 0) === 0
    ? 'stalled'
    : 'downloading';
};

export const mapRTorrentTorrent = (
  row: RTorrentRow
): LiveTorrentStatus | undefined => {
  const hash = normalizeInfoHash(row.hash);
  if (!hash) {
    return undefined;
  }
  const size = nonNegative(row.sizeBytes);
  const sizeLeft = Math.min(
    size,
    row.leftBytes !== undefined
      ? nonNegative(row.leftBytes)
      : Math.max(0, size - nonNegative(row.completedBytes))
  );
  const downloadRate = nonNegative(row.downRate);

  return {
    hash,
    state: mapRTorrentState({ ...row, downRate: downloadRate }),
    size,
    sizeLeft,
    progress: clampProgress(size > 0 ? (size - sizeLeft) / size : 0),
    downloadRate,
    uploadRate: nonNegative(row.upRate),
    etaSeconds: estimateEta(sizeLeft, downloadRate),
    seeds: optionalCount(row.peersComplete),
    peers: optionalCount(row.peersConnected),
  };
};

export default class RTorrentClient implements DownloadClientAdapter {
  constructor(private readonly settings: DownloadClientSettings) {}

  private async call(method: string, params: string[] = []): Promise<unknown> {
    const hasAuth = !!(this.settings.username || this.settings.password);
    const response = await axios.post<string>(
      clientUrl(this.settings, RTORRENT_RPC_PATH),
      buildMethodCall(method, params),
      {
        ...baseRequestConfig,
        responseType: 'text',
        headers: { 'Content-Type': 'text/xml' },
        auth: hasAuth
          ? {
              username: this.settings.username,
              password: this.settings.password,
            }
          : undefined,
      }
    );

    if (response.status === 401 || response.status === 403) {
      throw new DownloadClientError(
        'rTorrent rejected the username or password.',
        'auth'
      );
    }
    if (response.status !== 200 || typeof response.data !== 'string') {
      throw new DownloadClientError(
        `rTorrent returned HTTP ${response.status}.`,
        'protocol'
      );
    }

    const parsed = await parseStringPromise(response.data, {
      explicitArray: true,
    });
    const methodResponse = children(parsed, 'methodResponse')[0];
    if (children(methodResponse, 'fault').length > 0) {
      throw new DownloadClientError(
        'rTorrent returned an XML-RPC fault.',
        'protocol'
      );
    }
    const param = children(children(methodResponse, 'params')[0], 'param')[0];
    return decodeXmlRpcValue(children(param, 'value')[0]);
  }

  public async testConnection(): Promise<DownloadClientTestResult> {
    const version = await this.call('system.client_version');
    return {
      version: typeof version === 'string' ? version.slice(0, 64) : undefined,
    };
  }

  public async getTorrents(hashes: string[]): Promise<LiveTorrentStatus[]> {
    const wanted = new Set(
      hashes
        .map((hash) => normalizeInfoHash(hash))
        .filter((hash): hash is string => !!hash)
    );
    if (wanted.size === 0) {
      return [];
    }

    // One call covers every subscribed hash; per-hash lookups would multiply
    // XML-RPC round trips on every poll.
    const rows = await this.call('d.multicall2', [
      '',
      'main',
      ...MULTICALL_FIELDS,
    ]);
    if (!Array.isArray(rows)) {
      throw new DownloadClientError(
        'rTorrent returned an unexpected torrent list.',
        'protocol'
      );
    }

    return rows
      .filter((row): row is unknown[] => Array.isArray(row))
      .map((values) => mapRTorrentTorrent(rowFromMulticall(values)))
      .filter(
        (torrent): torrent is LiveTorrentStatus =>
          !!torrent && wanted.has(torrent.hash)
      );
  }
}
