import type { User } from '@server/entity/User';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import type { TautulliSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { proxyRequestInterceptor } from '@server/utils/customProxyAgent';
import {
  createSafeHttpRequestOptions,
  createSafeHttpUrl,
  stringifySafeHttpUrl,
} from '@server/utils/security';
import { buildServiceUrl } from '@server/utils/serviceUrl';
import { userAgentRequestInterceptor } from '@server/utils/userAgent';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import axios from 'axios';
import { uniqWith } from 'lodash';

export const isTautulliNoDataError = (error: unknown): boolean => {
  let current = error;

  while (current instanceof Error) {
    if (axios.isAxiosError(current) && current.response?.status === 400) {
      return true;
    }
    current = current.cause;
  }

  return false;
};

export const TAUTULLI_HTTP_LIMITS = {
  maxContentLength: 2 * 1024 * 1024,
  maxBodyLength: 1024,
} as const;
export const TAUTULLI_HISTORY_PAGE_SIZE = 100;
export const MAX_TAUTULLI_HISTORY_PAGES = 10;
export const MAX_TAUTULLI_HISTORY_RESULTS = 20;

export interface TautulliHistoryRecord {
  date: number;
  duration: number;
  friendly_name: string;
  full_title: string;
  grandparent_rating_key: number;
  grandparent_title: string;
  original_title: string;
  group_count: number;
  group_ids?: string;
  guid: string;
  ip_address: string;
  live: number;
  machine_id: string;
  media_index: number;
  media_type: string;
  originally_available_at: string;
  parent_media_index: number;
  parent_rating_key: number;
  parent_title: string;
  paused_counter: number;
  percent_complete: number;
  platform: string;
  product: string;
  player: string;
  rating_key: number;
  reference_id?: number;
  row_id?: number;
  session_key?: string;
  started: number;
  state?: string;
  stopped: number;
  thumb: string;
  title: string;
  transcode_decision: string;
  user: string;
  user_id: number;
  watched_status: number;
  year: number;
}

interface TautulliHistoryResponse {
  response: {
    result: string;
    message?: string;
    data: {
      draw: number;
      recordsTotal: number;
      recordsFiltered: number;
      total_duration: string;
      filter_duration: string;
      data: TautulliHistoryRecord[];
    };
  };
}

interface TautulliWatchStats {
  query_days: number;
  total_time: number;
  total_plays: number;
}

interface TautulliWatchStatsResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliWatchStats[];
  };
}

interface TautulliWatchUser {
  friendly_name: string;
  user_id: number;
  user_thumb: string;
  username: string;
  total_plays: number;
  total_time: number;
}

interface TautulliWatchUsersResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliWatchUser[];
  };
}

interface TautulliInfo {
  tautulli_install_type: string;
  tautulli_version: string;
  tautulli_branch: string;
  tautulli_commit: string;
  tautulli_platform: string;
  tautulli_platform_release: string;
  tautulli_platform_version: string;
  tautulli_platform_linux_distro: string;
  tautulli_platform_device_name: string;
  tautulli_python_version: string;
}

interface TautulliInfoResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliInfo;
  };
}

class TautulliAPI {
  private axios: AxiosInstance;
  private baseUrl: string;

  constructor(settings: TautulliSettings) {
    this.baseUrl = buildServiceUrl({
      useSsl: settings.useSsl,
      hostname: settings.hostname,
      port: settings.port,
      urlBase: settings.urlBase,
    });
    this.axios = axios.create({
      params: { apikey: settings.apiKey },
      ...createSafeHttpRequestOptions(true, false),
      timeout: getExternalRuntimeConfig().network.apiRequestTimeout,
      ...TAUTULLI_HTTP_LIMITS,
    });
    this.axios.interceptors.request.use(proxyRequestInterceptor);
    this.axios.interceptors.request.use(userAgentRequestInterceptor);
  }

  private async get<T>(
    path: string,
    config?: AxiosRequestConfig
  ): Promise<{ data: T }> {
    let requestUrl: string;
    try {
      requestUrl = new URL(path, this.baseUrl).href;
    } catch (error) {
      throw new Error('Invalid Tautulli request URL.', { cause: error });
    }

    const safeUrl = await createSafeHttpUrl(requestUrl, {
      allowPrivateAddresses: true,
    });
    if (!safeUrl) {
      throw new Error('Tautulli request URL is not safe.');
    }

    return this.axios.get<T>(stringifySafeHttpUrl(safeUrl), config);
  }

  public async getInfo(): Promise<TautulliInfo> {
    try {
      return (
        await this.get<TautulliInfoResponse>('/api/v2', {
          params: { cmd: 'get_tautulli_info' },
        })
      ).data.response.data;
    } catch (e) {
      logger.error('Something went wrong fetching Tautulli server info', {
        label: 'Tautulli API',
        errorMessage: e.message,
      });
      throw new Error(
        `[Tautulli] Failed to fetch Tautulli server info: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getMediaWatchStats(
    ratingKey: string
  ): Promise<TautulliWatchStats[]> {
    try {
      return (
        await this.get<TautulliWatchStatsResponse>('/api/v2', {
          params: {
            cmd: 'get_item_watch_time_stats',
            rating_key: ratingKey,
            grouping: 1,
          },
        })
      ).data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching media watch stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          ratingKey,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch media watch stats: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getMediaWatchUsers(
    ratingKey: string
  ): Promise<TautulliWatchUser[]> {
    try {
      return (
        await this.get<TautulliWatchUsersResponse>('/api/v2', {
          params: {
            cmd: 'get_item_user_stats',
            rating_key: ratingKey,
            grouping: 1,
          },
        })
      ).data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching media watch users from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          ratingKey,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch media watch users: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getUserWatchStats(user: User): Promise<TautulliWatchStats> {
    try {
      if (!user.plexId) {
        throw new Error('User does not have an associated Plex ID');
      }

      return (
        await this.get<TautulliWatchStatsResponse>('/api/v2', {
          params: {
            cmd: 'get_user_watch_time_stats',
            user_id: user.plexId,
            query_days: 0,
            grouping: 1,
          },
        })
      ).data.response.data[0];
    } catch (e) {
      logger.error(
        'Something went wrong fetching user watch stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          user: user.displayName,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch user watch stats: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getUserWatchHistory(
    user: User
  ): Promise<TautulliHistoryRecord[]> {
    let results: TautulliHistoryRecord[] = [];

    try {
      if (!user.plexId) {
        throw new Error('User does not have an associated Plex ID');
      }

      const take = TAUTULLI_HISTORY_PAGE_SIZE;
      let start = 0;

      for (
        let page = 0;
        page < MAX_TAUTULLI_HISTORY_PAGES &&
        results.length < MAX_TAUTULLI_HISTORY_RESULTS;
        page += 1
      ) {
        const rawTautulliData = (
          await this.get<TautulliHistoryResponse>('/api/v2', {
            params: {
              cmd: 'get_history',
              grouping: 1,
              order_column: 'date',
              order_dir: 'desc',
              user_id: user.plexId,
              media_type: 'movie,episode',
              length: take,
              start,
            },
          })
        ).data.response.data.data;
        const tautulliData = Array.isArray(rawTautulliData)
          ? rawTautulliData.slice(0, take)
          : [];

        if (!tautulliData.length) {
          return results;
        }

        results = uniqWith(results.concat(tautulliData), (recordA, recordB) =>
          recordA.grandparent_rating_key && recordB.grandparent_rating_key
            ? recordA.grandparent_rating_key === recordB.grandparent_rating_key
            : recordA.parent_rating_key && recordB.parent_rating_key
              ? recordA.parent_rating_key === recordB.parent_rating_key
              : recordA.rating_key === recordB.rating_key
        );

        start += take;
      }

      return results.slice(0, MAX_TAUTULLI_HISTORY_RESULTS);
    } catch (e) {
      logger.error(
        'Something went wrong fetching user watch history from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          user: user.displayName,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch user watch history: ${e.message}`,
        { cause: e }
      );
    }
  }
}

export default TautulliAPI;
