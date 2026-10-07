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
  SABNZBD_NZO_PATTERN,
  safeMessage,
} from '@server/api/downloadClients/types';
import type { DownloadClientSettings } from '@server/lib/settings';
import axios from 'axios';

const MEBI = 1024 * 1024;
const KIBI = 1024;

/** SABnzbd queue slot. Numbers arrive as strings, as SABnzbd formats them. */
export interface SabnzbdSlot {
  nzo_id?: unknown;
  filename?: unknown;
  mb?: unknown;
  mbleft?: unknown;
  percentage?: unknown;
  status?: unknown;
  timeleft?: unknown;
}

export interface SabnzbdQueue {
  status?: unknown;
  /** Aggregate speed in KiB/s. SABnzbd does not report speed per item. */
  kbpersec?: unknown;
  slots?: unknown;
}

const numeric = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Parses SABnzbd's `H:MM:SS` estimate; returns null when it is not a time. */
export const parseSabnzbdTimeleft = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const parts = value
    .trim()
    .split(':')
    .map((part) => Number(part));
  if (
    parts.length !== 3 ||
    parts.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    return null;
  }
  const [hours, minutes, seconds] = parts;
  return hours * 3600 + minutes * 60 + seconds;
};

/**
 * Maps a SABnzbd slot status to the live state shown in the UI. Post-processing
 * states (repair, unpack, move) are reported as checking, not as downloads.
 */
export const mapSabnzbdState = (
  status: unknown,
  downloadRate: number
): LiveTorrentState => {
  switch (typeof status === 'string' ? status : '') {
    case 'Downloading':
      return downloadRate > 0 ? 'downloading' : 'stalled';
    case 'Paused':
      return 'paused';
    case 'Queued':
    case 'Propagating':
      return 'queued';
    case 'Fetching':
    case 'Grabbing':
      return 'metadata';
    case 'Checking':
    case 'Verifying':
    case 'Repairing':
    case 'Extracting':
    case 'Moving':
    case 'Running':
      return 'checking';
    default:
      return 'unknown';
  }
};

/**
 * Maps one queue slot. The queue reports one aggregate speed, so `rate` is
 * attributed to the slot that is downloading; other slots report zero.
 */
export const mapSabnzbdSlot = (
  slot: SabnzbdSlot,
  rate: number
): LiveTorrentStatus | undefined => {
  const key = typeof slot.nzo_id === 'string' ? slot.nzo_id.trim() : '';
  if (!SABNZBD_NZO_PATTERN.test(key)) {
    return undefined;
  }

  const size = Math.round(numeric(slot.mb) * MEBI);
  const sizeLeft = Math.min(size, Math.round(numeric(slot.mbleft) * MEBI));
  const downloading = slot.status === 'Downloading';
  const downloadRate = downloading ? nonNegative(rate) : 0;
  const reportedPercent = numeric(slot.percentage);
  const progress =
    size > 0
      ? clampProgress((size - sizeLeft) / size)
      : clampProgress(reportedPercent / 100);
  const state = mapSabnzbdState(slot.status, downloadRate);

  return {
    hash: key,
    state,
    size,
    sizeLeft,
    progress,
    downloadRate,
    uploadRate: 0,
    etaSeconds: downloading
      ? (parseSabnzbdTimeleft(slot.timeleft) ??
        estimateEta(sizeLeft, downloadRate))
      : null,
    seeds: null,
    peers: null,
    message: state === 'unknown' ? safeMessage(slot.status) : undefined,
  };
};

export default class SabnzbdClient implements DownloadClientAdapter {
  constructor(private readonly settings: DownloadClientSettings) {}

  /**
   * Calls the SABnzbd API. The key travels as a query parameter by design of
   * that API, so callers must never log the request URL.
   */
  private async call(mode: string): Promise<Record<string, unknown>> {
    const response = await axios.get<Record<string, unknown>>(
      clientUrl(this.settings, '/api'),
      {
        ...baseRequestConfig,
        params: { mode, output: 'json', apikey: this.settings.password },
      }
    );

    if (
      response.status !== 200 ||
      !response.data ||
      typeof response.data !== 'object'
    ) {
      throw new DownloadClientError(
        `SABnzbd returned HTTP ${response.status}.`,
        'protocol'
      );
    }
    if (typeof response.data.error === 'string') {
      const kind = /api key/i.test(response.data.error) ? 'auth' : 'protocol';
      throw new DownloadClientError(
        kind === 'auth'
          ? 'SABnzbd rejected the API key.'
          : 'SABnzbd returned an error.',
        kind
      );
    }
    return response.data;
  }

  public async testConnection(): Promise<DownloadClientTestResult> {
    const version = await this.call('version');
    const reported = version.version;
    await this.call('queue');
    return {
      version: typeof reported === 'string' ? reported.slice(0, 64) : undefined,
    };
  }

  public async getTorrents(keys: string[]): Promise<LiveTorrentStatus[]> {
    const wanted = new Set(keys.filter((key) => SABNZBD_NZO_PATTERN.test(key)));
    if (wanted.size === 0) {
      return [];
    }

    const body = await this.call('queue');
    const queue = (body.queue ?? {}) as SabnzbdQueue;
    const rate = numeric(queue.kbpersec) * KIBI;
    const slots = Array.isArray(queue.slots)
      ? (queue.slots as SabnzbdSlot[])
      : [];

    // Only the first downloading slot receives the aggregate speed.
    let rateAssigned = false;
    const statuses: LiveTorrentStatus[] = [];
    for (const slot of slots) {
      const assignRate = !rateAssigned && slot.status === 'Downloading';
      const status = mapSabnzbdSlot(slot, assignRate ? rate : 0);
      if (!status) continue;
      if (assignRate) rateAssigned = true;
      if (wanted.has(status.hash)) statuses.push(status);
    }
    return statuses;
  }
}
