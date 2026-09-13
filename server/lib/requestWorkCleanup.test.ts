import ReadarrAPI from '@server/api/servarr/readarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { BookRequestSearch } from '@server/entity/BookRequestSearch';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import requestDispatchManager from '@server/lib/requestDispatch';
import { getSettings } from '@server/lib/settings';
import { resetTestDb, seedTestDb } from '@server/utils/seedTestDb';
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import requestWorkCleanupManager, {
  RequestWorkCleanupError,
} from './requestWorkCleanup';

const configureBookshelf = () => {
  getSettings().readarr = [
    {
      id: 20,
      name: 'Bookshelf',
      hostname: 'bookshelf.local',
      port: 8787,
      apiKey: 'test-key',
      useSsl: false,
      activeProfileId: 11,
      activeProfileName: 'Books',
      activeMetadataProfileId: 12,
      activeMetadataProfileName: 'Standard',
      activeDirectory: '/books',
      tags: [],
      is4k: false,
      isDefault: true,
      syncEnabled: true,
      preventSearch: false,
      tagRequests: false,
      overrideRule: [],
      serviceType: 'ebook',
    },
  ];
};

const createActiveBookRequest = async () => {
  const requestedBy = await getRepository(User).findOneByOrFail({
    email: 'friend@seerr.dev',
  });
  const media = await getRepository(Media).save(
    new Media({
      mediaType: MediaType.BOOK,
      tmdbId: 0,
      status: MediaStatus.PROCESSING,
      status4k: MediaStatus.UNKNOWN,
      serviceId: 20,
      externalServiceId: 55,
      externalServiceSlug: 'cleanup-book',
    })
  );
  const request = await getRepository(MediaRequest).save(
    new MediaRequest({
      type: MediaType.BOOK,
      status: MediaRequestStatus.COMPLETED,
      bookFormat: 'ebook',
      media,
      requestedBy,
      is4k: false,
    })
  );
  await getRepository(BookRequestSearch).save(
    new BookRequestSearch({
      requestId: request.id,
      serviceId: 20,
      format: 'ebook',
      bookId: 55,
      authorId: 77,
      commandId: 901,
      createdBook: true,
      createdAuthor: true,
      state: 'grabbed',
    })
  );
  return request;
};

describe('RequestWorkCleanupManager', () => {
  before(async () => {
    await seedTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    configureBookshelf();
    mock.method(requestDispatchManager, 'cancel', async () => undefined);
  });

  afterEach(() => {
    mock.restoreAll();
    getSettings().readarr = [];
  });

  it('cancels a book download and removes request-created empty records', async () => {
    const request = await createActiveBookRequest();
    mock.method(ReadarrAPI.prototype, 'getCommand', async () => ({
      id: 901,
      name: 'BookSearch',
      status: 'completed',
    }));
    let queueRead = 0;
    mock.method(ReadarrAPI.prototype, 'getQueue', async () =>
      queueRead++ === 0
        ? [
            {
              id: 12,
              bookId: 55,
              size: 100,
              sizeleft: 50,
              title: 'Cleanup Book',
              timeleft: '00:01:00',
              estimatedCompletionTime: '',
              status: 'downloading',
              trackedDownloadStatus: 'ok',
              trackedDownloadState: 'downloading',
              downloadId: 'download-1',
              protocol: 'usenet',
              downloadClient: 'sabnzbd',
              indexer: 'indexer',
            },
          ]
        : []
    );
    const deletedQueueIds: number[] = [];
    mock.method(
      ReadarrAPI.prototype,
      'deleteQueueItem',
      async (queueId: number) => {
        deletedQueueIds.push(queueId);
      }
    );
    mock.method(ReadarrAPI.prototype, 'getBookIfExists', async () => ({
      id: 55,
      title: 'Cleanup Book',
      statistics: { bookFileCount: 0 },
    }));
    const removedBooks: number[] = [];
    mock.method(ReadarrAPI.prototype, 'removeBook', async (bookId: number) => {
      removedBooks.push(bookId);
    });
    mock.method(ReadarrAPI.prototype, 'getBooksByAuthor', async () => []);
    const removedAuthors: number[] = [];
    mock.method(
      ReadarrAPI.prototype,
      'removeAuthor',
      async (authorId: number) => {
        removedAuthors.push(authorId);
      }
    );

    await requestWorkCleanupManager.cleanup(request, true);

    assert.deepEqual(deletedQueueIds, [12]);
    assert.deepEqual(removedBooks, [55]);
    assert.deepEqual(removedAuthors, [77]);
    assert.equal(
      await getRepository(BookRequestSearch).countBy({ requestId: request.id }),
      0
    );
    const media = await getRepository(Media).findOneByOrFail({
      id: request.media.id,
    });
    assert.equal(media.serviceId, null);
    assert.equal(media.externalServiceId, null);
  });

  it('keeps the request intact when Bookshelf cannot confirm cancellation', async () => {
    const request = await createActiveBookRequest();
    mock.method(ReadarrAPI.prototype, 'getCommand', async () => ({
      id: 901,
      name: 'BookSearch',
      status: 'started',
    }));

    await assert.rejects(
      () => requestWorkCleanupManager.cleanup(request, true),
      RequestWorkCleanupError
    );
    assert.equal(
      await getRepository(BookRequestSearch).countBy({ requestId: request.id }),
      1
    );
  });
});
