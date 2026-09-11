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
import MediaRequestStatusEvent from '@server/entity/MediaRequestStatusEvent';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { resetTestDb, seedTestDb } from '@server/utils/seedTestDb';
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import bookRequestSearchManager from './bookRequestSearch';
import { RequestStatusStage } from './requestStatus';

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

const createTrackedRequest = async (options: {
  createdBook: boolean;
  createdAuthor: boolean;
}) => {
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
      externalServiceSlug: 'tracked-book',
    })
  );
  const request = await getRepository(MediaRequest).save(
    new MediaRequest({
      type: MediaType.BOOK,
      status: MediaRequestStatus.COMPLETED,
      is4k: false,
      bookFormat: 'ebook',
      media,
      requestedBy,
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
      createdBook: options.createdBook,
      createdAuthor: options.createdAuthor,
      state: 'searching',
    })
  );
  return { media, request };
};

describe('BookRequestSearchManager', () => {
  before(async () => {
    await seedTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    configureBookshelf();
  });

  afterEach(() => {
    mock.restoreAll();
    getSettings().readarr = [];
  });

  it('keeps an active Bookshelf command in the searching state', async () => {
    const { request } = await createTrackedRequest({
      createdBook: true,
      createdAuthor: true,
    });
    mock.method(ReadarrAPI.prototype, 'getCommand', async () => ({
      id: 901,
      name: 'BookSearch',
      status: 'started',
    }));

    await bookRequestSearchManager.run();

    const operation = await getRepository(BookRequestSearch).findOneByOrFail({
      requestId: request.id,
    });
    assert.equal(operation.state, 'searching');
  });

  it('reports no release and removes only records it created', async () => {
    const { media, request } = await createTrackedRequest({
      createdBook: true,
      createdAuthor: true,
    });
    mock.method(ReadarrAPI.prototype, 'getCommand', async () => ({
      id: 901,
      name: 'BookSearch',
      status: 'completed',
    }));
    mock.method(ReadarrAPI.prototype, 'getBook', async () => ({
      id: 55,
      title: 'Tracked Book',
      statistics: { bookFileCount: 0 },
    }));
    mock.method(ReadarrAPI.prototype, 'getQueue', async () => []);
    mock.method(ReadarrAPI.prototype, 'getBookHistory', async () => []);
    const removedBooks: number[] = [];
    const removedAuthors: number[] = [];
    mock.method(ReadarrAPI.prototype, 'removeBook', async (bookId: number) => {
      removedBooks.push(bookId);
    });
    mock.method(ReadarrAPI.prototype, 'getBooksByAuthor', async () => []);
    mock.method(
      ReadarrAPI.prototype,
      'removeAuthor',
      async (authorId: number) => {
        removedAuthors.push(authorId);
      }
    );

    await bookRequestSearchManager.run();
    assert.deepEqual(removedBooks, []);
    assert.deepEqual(removedAuthors, []);
    const settling = await getRepository(BookRequestSearch).findOneByOrFail({
      requestId: request.id,
    });
    assert.equal(settling.state, 'settling');
    await getRepository(BookRequestSearch).update(settling.id, {
      updatedAt: new Date(Date.now() - 60_000),
    });
    await bookRequestSearchManager.run();

    assert.deepEqual(removedBooks, [55]);
    assert.deepEqual(removedAuthors, [77]);
    assert.equal(
      await getRepository(BookRequestSearch).countBy({ requestId: request.id }),
      0
    );
    const updatedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(updatedMedia.serviceId, null);
    assert.equal(updatedMedia.externalServiceId, null);
    assert.equal(updatedMedia.status, MediaStatus.UNKNOWN);
    const updatedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(updatedRequest.status, MediaRequestStatus.APPROVED);
    const event = await getRepository(MediaRequestStatusEvent).findOneByOrFail({
      requestId: request.id,
      stage: RequestStatusStage.UNAVAILABLE,
    });
    assert.equal(event.message, 'No release found.');
  });

  it('preserves pre-existing Bookshelf records after no result', async () => {
    const { request } = await createTrackedRequest({
      createdBook: false,
      createdAuthor: false,
    });
    mock.method(ReadarrAPI.prototype, 'getCommand', async () => ({
      id: 901,
      name: 'BookSearch',
      status: 'completed',
    }));
    mock.method(ReadarrAPI.prototype, 'getBook', async () => ({
      id: 55,
      title: 'Tracked Book',
      statistics: { bookFileCount: 0 },
    }));
    mock.method(ReadarrAPI.prototype, 'getQueue', async () => []);
    mock.method(ReadarrAPI.prototype, 'getBookHistory', async () => []);
    let removalAttempted = false;
    mock.method(ReadarrAPI.prototype, 'removeBook', async () => {
      removalAttempted = true;
    });
    mock.method(ReadarrAPI.prototype, 'removeAuthor', async () => {
      removalAttempted = true;
    });

    await bookRequestSearchManager.run();
    const settling = await getRepository(BookRequestSearch).findOneByOrFail({
      requestId: request.id,
    });
    await getRepository(BookRequestSearch).update(settling.id, {
      updatedAt: new Date(Date.now() - 60_000),
    });
    await bookRequestSearchManager.run();

    assert.equal(removalAttempted, false);
    assert.equal(
      await getRepository(BookRequestSearch).countBy({ requestId: request.id }),
      0
    );
  });

  it('reports a confirmed Bookshelf download failure', async () => {
    const { request } = await createTrackedRequest({
      createdBook: true,
      createdAuthor: false,
    });
    mock.method(ReadarrAPI.prototype, 'getCommand', async () => ({
      id: 901,
      name: 'BookSearch',
      status: 'completed',
    }));
    mock.method(ReadarrAPI.prototype, 'getBook', async () => ({
      id: 55,
      title: 'Tracked Book',
      statistics: { bookFileCount: 0 },
    }));
    mock.method(ReadarrAPI.prototype, 'getQueue', async () => []);
    mock.method(ReadarrAPI.prototype, 'getBookHistory', async () => [
      {
        id: 1,
        bookId: 55,
        eventType: 'downloadFailed',
        date: new Date(Date.now() + 1_000).toISOString(),
      },
    ]);
    mock.method(ReadarrAPI.prototype, 'removeBook', async () => undefined);

    await bookRequestSearchManager.run();

    const updatedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(updatedRequest.status, MediaRequestStatus.FAILED);
    const event = await getRepository(MediaRequestStatusEvent).findOneByOrFail({
      requestId: request.id,
      stage: RequestStatusStage.FAILED,
    });
    assert.equal(event.message, 'Bookshelf download or import failed.');
  });

  it('reports importing when a grabbed book has left the live queue', async () => {
    const { request } = await createTrackedRequest({
      createdBook: true,
      createdAuthor: false,
    });
    mock.method(ReadarrAPI.prototype, 'getCommand', async () => ({
      id: 901,
      name: 'BookSearch',
      status: 'completed',
    }));
    mock.method(ReadarrAPI.prototype, 'getBook', async () => ({
      id: 55,
      title: 'Tracked Book',
      statistics: { bookFileCount: 0 },
    }));
    mock.method(ReadarrAPI.prototype, 'getQueue', async () => []);
    mock.method(ReadarrAPI.prototype, 'getBookHistory', async () => [
      {
        id: 1,
        bookId: 55,
        eventType: 'grabbed',
        date: new Date(Date.now() + 1_000).toISOString(),
      },
    ]);

    await bookRequestSearchManager.run();

    const operation = await getRepository(BookRequestSearch).findOneByOrFail({
      requestId: request.id,
    });
    assert.equal(operation.state, 'importing');
  });

  it('finishes tracking after Bookshelf confirms an imported file', async () => {
    const { media, request } = await createTrackedRequest({
      createdBook: true,
      createdAuthor: true,
    });
    mock.method(ReadarrAPI.prototype, 'getCommand', async () => ({
      id: 901,
      name: 'BookSearch',
      status: 'completed',
    }));
    let cacheTtl: number | undefined;
    mock.method(
      ReadarrAPI.prototype,
      'getBook',
      async (_bookId: number, requestedCacheTtl?: number) => {
        cacheTtl = requestedCacheTtl;
        return {
          id: 55,
          title: 'Tracked Book',
          statistics: { bookFileCount: 1 },
        };
      }
    );
    mock.method(ReadarrAPI.prototype, 'getQueue', async () => []);
    mock.method(ReadarrAPI.prototype, 'getBookHistory', async () => []);

    await bookRequestSearchManager.run();

    assert.equal(
      await getRepository(BookRequestSearch).countBy({ requestId: request.id }),
      0
    );
    assert.equal(cacheTtl, 0);
    const updatedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(updatedMedia.serviceId, 20);
    assert.equal(updatedMedia.externalServiceId, 55);
    assert.equal(updatedMedia.status, MediaStatus.AVAILABLE);
  });

  it('finishes a both-format request after both searches settle', async () => {
    getSettings().readarr.push({
      ...getSettings().readarr[0],
      id: 21,
      name: 'Audiobook Bookshelf',
      hostname: 'audiobooks.local',
      serviceType: 'audiobook',
    });
    const { media, request } = await createTrackedRequest({
      createdBook: true,
      createdAuthor: true,
    });
    await getRepository(MediaRequest).update(request.id, {
      bookFormat: 'both',
    });
    await getRepository(Media).update(media.id, {
      audiobookServiceId: 21,
      audiobookExternalServiceId: 66,
      audiobookExternalServiceSlug: 'tracked-audiobook',
    });
    await getRepository(BookRequestSearch).save(
      new BookRequestSearch({
        requestId: request.id,
        serviceId: 21,
        format: 'audiobook',
        bookId: 66,
        authorId: 88,
        commandId: 902,
        createdBook: true,
        createdAuthor: true,
        state: 'searching',
      })
    );

    mock.method(
      ReadarrAPI.prototype,
      'getCommand',
      async (commandId: number) => ({
        id: commandId,
        name: 'BookSearch',
        status: 'completed',
      })
    );
    mock.method(ReadarrAPI.prototype, 'getBook', async (bookId: number) => ({
      id: bookId,
      title: 'Tracked Book',
      statistics: { bookFileCount: bookId === 66 ? 1 : 0 },
    }));
    mock.method(ReadarrAPI.prototype, 'getQueue', async () => []);
    mock.method(ReadarrAPI.prototype, 'getBookHistory', async () => []);
    const removedBooks: number[] = [];
    mock.method(ReadarrAPI.prototype, 'removeBook', async (bookId: number) => {
      removedBooks.push(bookId);
    });
    mock.method(ReadarrAPI.prototype, 'getBooksByAuthor', async () => []);
    mock.method(ReadarrAPI.prototype, 'removeAuthor', async () => undefined);

    await bookRequestSearchManager.run();
    const ebookSearch = await getRepository(BookRequestSearch).findOneByOrFail({
      requestId: request.id,
      format: 'ebook',
    });
    assert.equal(ebookSearch.state, 'settling');
    const audiobookSearch = await getRepository(
      BookRequestSearch
    ).findOneByOrFail({ requestId: request.id, format: 'audiobook' });
    assert.equal(audiobookSearch.state, 'available');

    await getRepository(BookRequestSearch).update(ebookSearch.id, {
      updatedAt: new Date(Date.now() - 60_000),
    });
    await bookRequestSearchManager.run();

    assert.deepEqual(removedBooks, [55]);
    assert.equal(
      await getRepository(BookRequestSearch).countBy({ requestId: request.id }),
      0
    );
    const updatedMedia = await getRepository(Media).findOneByOrFail({
      id: media.id,
    });
    assert.equal(updatedMedia.externalServiceId, null);
    assert.equal(updatedMedia.audiobookExternalServiceId, 66);
    assert.equal(updatedMedia.status, MediaStatus.PROCESSING);
    const updatedRequest = await getRepository(MediaRequest).findOneByOrFail({
      id: request.id,
    });
    assert.equal(updatedRequest.status, MediaRequestStatus.APPROVED);
  });
});
