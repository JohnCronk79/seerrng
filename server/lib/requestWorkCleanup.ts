import LidarrAPI from '@server/api/servarr/lidarr';
import RadarrAPI from '@server/api/servarr/radarr';
import ReadarrAPI, { type ReadarrMediaType } from '@server/api/servarr/readarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { BookRequestSearch } from '@server/entity/BookRequestSearch';
import Media from '@server/entity/Media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import requestDispatchManager from '@server/lib/requestDispatch';

type CleanupQueueItem = {
  id: number;
  movieId?: number;
  seriesId?: number;
  albumId?: number;
  bookId?: number;
  book?: { id?: number };
};

type CleanupQueueApi = {
  getQueue: () => Promise<CleanupQueueItem[]>;
  deleteQueueItem: (
    queueId: number,
    options: {
      removeFromClient: boolean;
      blocklist: boolean;
      skipRedownload: boolean;
    }
  ) => Promise<void>;
};

export class RequestWorkCleanupError extends Error {}

const removeMatchingQueueItems = async (
  api: CleanupQueueApi,
  matches: (item: CleanupQueueItem) => boolean
): Promise<void> => {
  const queue = await api.getQueue();
  for (const item of queue.filter(matches)) {
    await api.deleteQueueItem(item.id, {
      removeFromClient: true,
      blocklist: false,
      skipRedownload: true,
    });
  }
  if ((await api.getQueue()).some(matches)) {
    throw new RequestWorkCleanupError(
      'The download service did not confirm cancellation.'
    );
  }
};

class RequestWorkCleanupManager {
  private async cleanupBookOperation(
    operation: BookRequestSearch,
    mediaId: number
  ): Promise<void> {
    const server = getExternalRuntimeConfig().readarr.find(
      (candidate) => candidate.id === operation.serviceId
    );
    if (!server?.syncEnabled) {
      throw new RequestWorkCleanupError(
        'The selected Bookshelf service is unavailable for cleanup.'
      );
    }
    const api = new ReadarrAPI({
      apiKey: server.apiKey,
      url: ReadarrAPI.buildUrl(server, '/api/v1'),
      mediaType: operation.format,
    });
    const command = await api.getCommand(operation.commandId);
    if (
      !['completed', 'failed', 'aborted', 'cancelled', 'orphaned'].includes(
        String(command.status ?? '')
          .trim()
          .toLowerCase()
      )
    ) {
      throw new RequestWorkCleanupError(
        'Bookshelf has not finished its search command and cannot confirm cancellation yet.'
      );
    }
    await removeMatchingQueueItems(
      api,
      (item) => (item.bookId ?? item.book?.id) === operation.bookId
    );

    const book = await api.getBookIfExists(operation.bookId);
    let removedBook = !book;
    if (book && operation.createdBook) {
      if ((book.statistics?.bookFileCount ?? 0) === 0) {
        await api.removeBook(operation.bookId, { deleteFiles: false });
        removedBook = true;
      }
    }
    if (operation.createdAuthor && operation.authorId) {
      const remainingBooks = await api.getBooksByAuthor(operation.authorId, 0);
      if (remainingBooks.length === 0) {
        await api.removeAuthor(operation.authorId, { deleteFiles: false });
      }
    }
    if (removedBook) {
      await getRepository(Media).update(mediaId, {
        ...(operation.format === 'audiobook'
          ? {
              audiobookServiceId: null,
              audiobookExternalServiceId: null,
              audiobookExternalServiceSlug: null,
            }
          : {
              serviceId: null,
              externalServiceId: null,
              externalServiceSlug: null,
            }),
      });
    }
  }

  private async cleanupUntrackedBookLinks(
    request: MediaRequest
  ): Promise<void> {
    const media = await getRepository(Media).findOneByOrFail({
      id: request.media.id,
    });
    const formats: ReadarrMediaType[] =
      request.bookFormat === 'both'
        ? ['ebook', 'audiobook']
        : [request.bookFormat === 'audiobook' ? 'audiobook' : 'ebook'];

    for (const format of formats) {
      const serviceId =
        format === 'audiobook' ? media.audiobookServiceId : media.serviceId;
      const bookId =
        format === 'audiobook'
          ? media.audiobookExternalServiceId
          : media.externalServiceId;
      if (serviceId == null || bookId == null) continue;
      const server = getExternalRuntimeConfig().readarr.find(
        (candidate) =>
          candidate.id === serviceId &&
          (candidate.serviceType ?? 'ebook') === format
      );
      if (!server?.syncEnabled) {
        throw new RequestWorkCleanupError(
          'The selected Bookshelf service is unavailable for cleanup.'
        );
      }
      const api = new ReadarrAPI({
        apiKey: server.apiKey,
        url: ReadarrAPI.buildUrl(server, '/api/v1'),
        mediaType: format,
      });
      await removeMatchingQueueItems(
        api,
        (item) => (item.bookId ?? item.book?.id) === bookId
      );
      const book = await api.getBookIfExists(bookId);
      if (book && (book.statistics?.bookFileCount ?? 0) === 0) {
        throw new RequestWorkCleanupError(
          'Seerr cannot safely remove an untracked empty Bookshelf entry.'
        );
      }
      if (!book) {
        await getRepository(Media).update(media.id, {
          ...(format === 'audiobook'
            ? {
                audiobookServiceId: null,
                audiobookExternalServiceId: null,
                audiobookExternalServiceSlug: null,
              }
            : {
                serviceId: null,
                externalServiceId: null,
                externalServiceSlug: null,
              }),
        });
      }
    }
  }

  public async cleanup(request: MediaRequest, active: boolean): Promise<void> {
    await requestDispatchManager.cancel(request.id);
    if (!active) return;

    if (request.type === MediaType.BOOK) {
      const operations = await getRepository(BookRequestSearch).find({
        where: { requestId: request.id },
        order: { id: 'ASC' },
      });
      for (const operation of operations) {
        await this.cleanupBookOperation(operation, request.media.id);
      }
      if (operations.length === 0) {
        await this.cleanupUntrackedBookLinks(request);
      }
      await getRepository(BookRequestSearch).delete({ requestId: request.id });
      return;
    }

    const media = await getRepository(Media).findOneByOrFail({
      id: request.media.id,
    });
    const serviceId =
      request.serverId ?? (request.is4k ? media.serviceId4k : media.serviceId);
    const externalId = request.is4k
      ? media.externalServiceId4k
      : media.externalServiceId;
    if (serviceId == null || externalId == null) return;

    const settings = getExternalRuntimeConfig();
    let api: CleanupQueueApi | undefined;
    let matches: ((item: CleanupQueueItem) => boolean) | undefined;
    if (request.type === MediaType.MOVIE) {
      const server = settings.radarr.find((item) => item.id === serviceId);
      if (server) {
        api = new RadarrAPI({
          apiKey: server.apiKey,
          url: RadarrAPI.buildUrl(server, '/api/v3'),
        });
        matches = (item) => item.movieId === externalId;
      }
    } else if (request.type === MediaType.TV) {
      const server = settings.sonarr.find((item) => item.id === serviceId);
      if (server) {
        api = new SonarrAPI({
          apiKey: server.apiKey,
          url: SonarrAPI.buildUrl(server, '/api/v3'),
        });
        matches = (item) => item.seriesId === externalId;
      }
    } else if (request.type === MediaType.MUSIC) {
      const server = settings.lidarr.find((item) => item.id === serviceId);
      if (server) {
        api = new LidarrAPI({
          apiKey: server.apiKey,
          url: LidarrAPI.buildUrl(server, '/api/v1'),
        });
        matches = (item) => item.albumId === externalId;
      }
    }
    if (!api || !matches) {
      throw new RequestWorkCleanupError(
        'The selected download service is unavailable for cleanup.'
      );
    }
    await removeMatchingQueueItems(api, matches);
  }
}

const requestWorkCleanupManager = new RequestWorkCleanupManager();

export default requestWorkCleanupManager;
