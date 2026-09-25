import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import type { KapowarrVolume } from '@server/api/comics/kapowarr';
import KapowarrAPI from '@server/api/comics/kapowarr';
import MylarAPI from '@server/api/comics/mylar';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import MediaIdentifier, {
  MediaIdentifierProvider,
} from '@server/entity/MediaIdentifier';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import notificationManager from '@server/lib/notifications';
import { getSettings } from '@server/lib/settings';
import { MediaRequestSubscriber } from '@server/subscriber/MediaRequestSubscriber';
import { resetTestDb, seedTestDb } from '@server/utils/seedTestDb';

async function getRequester() {
  return getRepository(User).findOneOrFail({
    where: { email: 'friend@seerr.dev' },
  });
}

async function createApprovedComicRequest(
  media: Media,
  requestedBy: User,
  serverId?: number
) {
  mock.method(MediaRequest, 'sendNotification', async () => undefined);

  const request = await getRepository(MediaRequest).save(
    new MediaRequest({
      type: MediaType.COMIC,
      status: MediaRequestStatus.PENDING,
      media,
      requestedBy,
      is4k: false,
      serverId,
    })
  );

  request.status = MediaRequestStatus.APPROVED;
  request.media = media;
  request.requestedBy = requestedBy;

  return request;
}

const saveComicMedia = (comicVineId: string) =>
  getRepository(Media).save(
    new Media({
      mediaType: MediaType.COMIC,
      tmdbId: 0,
      status: MediaStatus.PENDING,
      status4k: MediaStatus.UNKNOWN,
      identifiers: [
        new MediaIdentifier({
          provider: MediaIdentifierProvider.COMICVINE,
          value: comicVineId,
          canonical: true,
        }),
      ],
    })
  );

describe('MediaRequestSubscriber comic dispatch', () => {
  before(async () => {
    await seedTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    mock.method(notificationManager, 'sendNotification', () => undefined);
  });

  afterEach(() => {
    mock.restoreAll();
    const settings = getSettings();
    settings.mylar = [];
    settings.kapowarr = [];
  });

  it('dispatches to the default Mylar instance and records the ComicVine id as the external id', async () => {
    const settings = getSettings();
    settings.mylar = [
      {
        id: 30,
        name: 'Mylar',
        hostname: 'mylar.local',
        port: 8090,
        apiKey: 'mylar-key',
        useSsl: false,
        tags: [],
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
      },
    ];

    let addedComicId: string | undefined;
    mock.method(MylarAPI.prototype, 'addComic', async (comicId: string) => {
      addedComicId = comicId;
    });

    const requestedBy = await getRequester();
    const media = await saveComicMedia('1234');
    const request = await createApprovedComicRequest(media, requestedBy);

    const retryAfterMs = await new MediaRequestSubscriber().sendToComicBackend(
      request
    );

    assert.strictEqual(retryAfterMs, undefined);
    assert.strictEqual(addedComicId, '1234');

    const updatedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.strictEqual(updatedRequest.status, MediaRequestStatus.COMPLETED);

    const updatedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.strictEqual(updatedMedia.serviceId, 30);
    assert.strictEqual(updatedMedia.externalServiceId, 1234);
    assert.strictEqual(updatedMedia.externalServiceSlug, '1234');
    assert.strictEqual(updatedMedia.comicServiceType, 'mylar');
  });

  it('dispatches to a specific Kapowarr instance, resolving the root folder and using its internal volume id', async () => {
    const settings = getSettings();
    settings.kapowarr = [
      {
        id: 40,
        name: 'Kapowarr',
        hostname: 'kapowarr.local',
        port: 5656,
        apiKey: 'kapowarr-key',
        useSsl: false,
        tags: [],
        isDefault: false,
        syncEnabled: true,
        preventSearch: false,
        rootFolder: '/comics',
      },
    ];

    mock.method(
      KapowarrAPI.prototype,
      'resolveRootFolderId',
      async (path: string) => {
        assert.strictEqual(path, '/comics');
        return 7;
      }
    );
    let addVolumeArgs:
      { comicVineId: number; rootFolderId: number } | undefined;
    mock.method(
      KapowarrAPI.prototype,
      'addVolume',
      async (args: { comicVineId: number; rootFolderId: number }) => {
        addVolumeArgs = args;
        return {
          id: 99,
          comicvine_id: args.comicVineId,
          title: 'Saga',
          monitored: true,
          issue_count: 10,
          issues_downloaded: 0,
        } satisfies KapowarrVolume;
      }
    );

    const requestedBy = await getRequester();
    const media = await saveComicMedia('5678');
    const request = await createApprovedComicRequest(media, requestedBy, 40);

    const retryAfterMs = await new MediaRequestSubscriber().sendToComicBackend(
      request
    );

    assert.strictEqual(retryAfterMs, undefined);
    assert.deepStrictEqual(addVolumeArgs, {
      comicVineId: 5678,
      rootFolderId: 7,
    });

    const updatedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.strictEqual(updatedMedia.serviceId, 40);
    assert.strictEqual(updatedMedia.externalServiceId, 99);
    assert.strictEqual(updatedMedia.externalServiceSlug, '99');
    assert.strictEqual(updatedMedia.comicServiceType, 'kapowarr');
  });

  it('marks the request COMPLETED without dispatching when the comic is already available', async () => {
    const settings = getSettings();
    settings.mylar = [
      {
        id: 30,
        name: 'Mylar',
        hostname: 'mylar.local',
        port: 8090,
        apiKey: 'mylar-key',
        useSsl: false,
        tags: [],
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
      },
    ];
    const addComicMock = mock.method(
      MylarAPI.prototype,
      'addComic',
      async () => undefined
    );

    const requestedBy = await getRequester();
    const media = await saveComicMedia('1234');
    media.status = MediaStatus.AVAILABLE;
    media.serviceId = 30;
    media.externalServiceId = 1234;
    await getRepository(Media).save(media);
    const request = await createApprovedComicRequest(media, requestedBy);

    await new MediaRequestSubscriber().sendToComicBackend(request);

    assert.strictEqual(addComicMock.mock.calls.length, 0);
    const updatedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.strictEqual(updatedRequest.status, MediaRequestStatus.COMPLETED);
  });

  it('marks the request FAILED when no ComicVine identifier is present', async () => {
    const settings = getSettings();
    settings.mylar = [
      {
        id: 30,
        name: 'Mylar',
        hostname: 'mylar.local',
        port: 8090,
        apiKey: 'mylar-key',
        useSsl: false,
        tags: [],
        isDefault: true,
        syncEnabled: true,
        preventSearch: false,
      },
    ];

    const requestedBy = await getRequester();
    const media = await getRepository(Media).save(
      new Media({
        mediaType: MediaType.COMIC,
        tmdbId: 0,
        status: MediaStatus.PENDING,
        status4k: MediaStatus.UNKNOWN,
      })
    );
    const request = await createApprovedComicRequest(media, requestedBy);

    const retryAfterMs = await new MediaRequestSubscriber().sendToComicBackend(
      request
    );

    assert.ok(typeof retryAfterMs === 'number');
    const updatedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.strictEqual(updatedRequest.status, MediaRequestStatus.FAILED);
  });

  it('marks the request FAILED when no comics backend is configured', async () => {
    const requestedBy = await getRequester();
    const media = await saveComicMedia('1234');
    const request = await createApprovedComicRequest(media, requestedBy);

    const retryAfterMs = await new MediaRequestSubscriber().sendToComicBackend(
      request
    );

    assert.ok(typeof retryAfterMs === 'number');
    const updatedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.strictEqual(updatedRequest.status, MediaRequestStatus.FAILED);
  });
});
