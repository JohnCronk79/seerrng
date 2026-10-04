import PlexTvAPI from '@server/api/plextv';
import * as datasource from '@server/datasource';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import { Permission } from '@server/lib/permissions';
import { runUserSecurityMutation } from '@server/lib/userSecurityMutation';
import watchlistSync, {
  fetchPlexWatchlistForSync,
  MAX_PLEX_WATCHLIST_SYNC_ITEMS,
} from '@server/lib/watchlistsync';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

setupTestDb();

afterEach(() => {
  mock.restoreAll();
});

describe('Plex watchlist credential admission', () => {
  it('does not use a token removed after user enumeration', async () => {
    let queryCount = 0;
    const createQueryBuilder = () => {
      queryCount += 1;
      return {
        select() {
          return this;
        },
        addSelect() {
          return this;
        },
        leftJoinAndSelect() {
          return this;
        },
        where() {
          return this;
        },
        andWhere() {
          return this;
        },
        orderBy() {
          return this;
        },
        take() {
          return this;
        },
        async getMany() {
          return [
            {
              id: 9,
              plexToken: 'retired-token',
              permissions: Permission.AUTO_REQUEST,
              settings: { watchlistSyncMovies: true },
            },
          ];
        },
        async getOne() {
          return { id: 9, plexToken: null };
        },
      };
    };
    mock.method(datasource, 'getRepository', () => ({ createQueryBuilder }));
    const getWatchlist = mock.method(
      PlexTvAPI.prototype,
      'getWatchlist',
      async () => ({ items: [], totalSize: 0 }) as never
    );

    await watchlistSync.syncWatchlist();

    assert.strictEqual(queryCount, 2);
    assert.strictEqual(getWatchlist.mock.callCount(), 0);
  });

  it('does not create requests from a token retired after the watchlist fetch', async () => {
    const userRepository = getRepository(User);
    const settingsRepository = getRepository(UserSettings);
    const requestRepository = getRepository(MediaRequest);
    const user = await userRepository.findOneByOrFail({ id: 1 });
    const friend = await userRepository.findOneByOrFail({ id: 2 });

    user.permissions = Permission.AUTO_REQUEST_MOVIE;
    user.plexToken = 'active-watchlist-token';
    user.settings = await settingsRepository.save(
      new UserSettings({ user, watchlistSyncMovies: true })
    );
    friend.plexToken = null;
    await userRepository.save([user, friend]);

    mock.method(PlexTvAPI.prototype, 'getWatchlist', async () => ({
      items: [
        {
          ratingKey: 'plex-movie-1',
          tmdbId: 101,
          type: 'movie',
          title: 'Retired Token Movie',
        },
      ],
      totalSize: 1,
    }));
    mock.method(Media, 'getRelatedMedia', async () => {
      await runUserSecurityMutation(user.id, () =>
        userRepository
          .update(user.id, { plexToken: null })
          .then(() => undefined)
      );
      return [];
    });

    await watchlistSync.syncWatchlist();

    assert.strictEqual(await requestRepository.count(), 0);
  });
});

describe('Plex watchlist sync pagination', () => {
  it('fetches subsequent pages and deduplicates items across them', async () => {
    const offsets: number[] = [];
    const item = (ratingKey: string, tmdbId: number) => ({
      ratingKey,
      tmdbId,
      type: 'movie' as const,
      title: `Movie ${tmdbId}`,
    });
    const response = await fetchPlexWatchlistForSync({
      getWatchlist: async ({ offset = 0, size = 20 } = {}) => {
        offsets.push(offset);
        return {
          offset,
          size,
          totalSize: 150,
          items:
            offset === 0
              ? [item('first', 1), item('duplicate', 2)]
              : [item('duplicate-again', 2), item('second-page', 3)],
        };
      },
    });

    assert.deepStrictEqual(offsets, [0, 100]);
    assert.deepStrictEqual(
      response.items.map(({ tmdbId }) => tmdbId),
      [1, 2, 3]
    );
    assert.strictEqual(response.truncated, false);
  });

  it('caps provider pagination at the scheduled sync item limit', async () => {
    const offsets: number[] = [];
    const response = await fetchPlexWatchlistForSync({
      getWatchlist: async ({ offset = 0, size = 20 } = {}) => {
        offsets.push(offset);
        return {
          offset,
          size,
          totalSize: 1_000_000,
          items: Array.from({ length: size }, (_, index) => ({
            ratingKey: `${offset + index}`,
            tmdbId: offset + index + 1,
            type: 'movie' as const,
            title: `Movie ${offset + index + 1}`,
          })),
        };
      },
    });

    assert.deepStrictEqual(offsets, [0, 100]);
    assert.strictEqual(response.items.length, MAX_PLEX_WATCHLIST_SYNC_ITEMS);
    assert.strictEqual(response.truncated, true);
  });
});
