import ReadarrAPI from '@server/api/servarr/readarr';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { BookRequestSearch } from '@server/entity/BookRequestSearch';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import {
  RequestStatusStage,
  recordRequestStatusOverride,
} from '@server/lib/requestStatus';
import logger from '@server/logger';

const terminalCommandStates = new Set([
  'completed',
  'failed',
  'aborted',
  'cancelled',
  'orphaned',
]);
const COMPLETED_COMMAND_SETTLE_MS = 15_000;
const terminalOperationStates = new Set<BookRequestSearch['state']>([
  'available',
  'unavailable',
  'failed',
]);

const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : String(value ?? '');

const isGrabbedHistory = (eventType: unknown): boolean =>
  normalize(eventType) === 'grabbed' || Number(eventType) === 1;

const isImportedHistory = (eventType: unknown): boolean =>
  ['bookfileimported', 'downloadimported'].includes(normalize(eventType)) ||
  [3, 8].includes(Number(eventType));

const isFailedHistory = (eventType: unknown): boolean =>
  ['downloadfailed', 'importfailed'].includes(normalize(eventType)) ||
  Number(eventType) === 4;

const isFailedQueueItem = (item: {
  status?: unknown;
  trackedDownloadState?: unknown;
  trackedDownloadStatus?: unknown;
}): boolean =>
  [item.status, item.trackedDownloadState, item.trackedDownloadStatus]
    .map(normalize)
    .some(
      (state) =>
        state.includes('failed') ||
        state.includes('error') ||
        state === 'warning'
    );

const isImportingQueueItem = (item: {
  status?: unknown;
  trackedDownloadState?: unknown;
  trackedDownloadStatus?: unknown;
}): boolean =>
  [item.status, item.trackedDownloadState, item.trackedDownloadStatus]
    .map(normalize)
    .some((state) =>
      ['importing', 'importpending', 'imported'].includes(state)
    );

class BookRequestSearchManager {
  private activeRun?: Promise<void>;

  public run(): Promise<void> {
    if (this.activeRun) return this.activeRun;
    const run = this.reconcile().finally(() => {
      if (this.activeRun === run) this.activeRun = undefined;
    });
    this.activeRun = run;
    return run;
  }

  private async reconcile(): Promise<void> {
    const operations = await getRepository(BookRequestSearch).find({
      relations: { request: { media: true } },
      order: { id: 'ASC' },
      take: 500,
    });

    for (const operation of operations) {
      await this.reconcileOperation(operation).catch((error) => {
        logger.warn('Unable to reconcile Bookshelf book search.', {
          label: 'Book Request Search',
          requestId: operation.requestId,
          serviceId: operation.serviceId,
          commandId: operation.commandId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private async reconcileOperation(
    operation: BookRequestSearch
  ): Promise<void> {
    if (terminalOperationStates.has(operation.state)) {
      await this.finalizeRequest(operation.requestId);
      return;
    }

    const server = getExternalRuntimeConfig().readarr.find(
      (candidate) => candidate.id === operation.serviceId
    );
    if (!server?.syncEnabled) return;

    const readarr = new ReadarrAPI({
      apiKey: server.apiKey,
      url: ReadarrAPI.buildUrl(server, '/api/v1'),
      mediaType: operation.format,
    });
    const command = await readarr.getCommand(operation.commandId);
    const commandStatus = normalize(command.status);

    if (!terminalCommandStates.has(commandStatus)) {
      await this.setState(operation, 'searching');
      return;
    }
    if (commandStatus !== 'completed') {
      await this.finishWithoutRelease(
        operation,
        readarr,
        RequestStatusStage.FAILED,
        command.exception || command.message || 'Bookshelf search failed.'
      );
      return;
    }

    const [book, queue, history] = await Promise.all([
      // Active lifecycle telemetry must not reuse the normal five-minute
      // metadata cache or a completed import can remain hidden until expiry.
      readarr.getBook(operation.bookId, 0),
      readarr.getQueue(),
      readarr.getBookHistory(operation.bookId),
    ]);
    const currentHistory = history.filter((item) => {
      const eventTime = item.date ? new Date(item.date).getTime() : Number.NaN;
      return (
        Number.isFinite(eventTime) && eventTime >= operation.createdAt.getTime()
      );
    });
    if ((book.statistics?.bookFileCount ?? 0) > 0) {
      await this.setState(operation, 'available');
      await this.finalizeRequest(operation.requestId);
      return;
    }

    const currentQueue = queue.filter(
      (item) => (item.bookId ?? item.book?.id) === operation.bookId
    );
    if (
      currentQueue.some((item) => isFailedQueueItem(item)) ||
      currentHistory.some((item) => isFailedHistory(item.eventType))
    ) {
      await this.finishWithoutRelease(
        operation,
        readarr,
        RequestStatusStage.FAILED,
        'Bookshelf download or import failed.'
      );
      return;
    }
    if (currentQueue.some((item) => isImportingQueueItem(item))) {
      await this.setState(operation, 'importing');
      return;
    }
    if (currentHistory.some((item) => isImportedHistory(item.eventType))) {
      await this.setState(operation, 'importing');
      return;
    }
    if (currentQueue.length > 0) {
      await this.setState(operation, 'grabbed');
      return;
    }
    if (currentHistory.some((item) => isGrabbedHistory(item.eventType))) {
      // The release was handed to the downloader and has since disappeared
      // from Bookshelf's live queue. It is now waiting on import or manual
      // matching, not still downloading.
      await this.setState(operation, 'importing');
      return;
    }

    // Bookshelf can finish BookSearch just before its queue and history
    // projections become visible. Give those projections one reconciliation
    // window before concluding that the search produced no release.
    if (operation.state !== 'settling') {
      await this.setState(operation, 'settling');
      return;
    }
    if (
      Date.now() - operation.updatedAt.getTime() <
      COMPLETED_COMMAND_SETTLE_MS
    ) {
      return;
    }

    await this.finishWithoutRelease(
      operation,
      readarr,
      RequestStatusStage.UNAVAILABLE,
      'No release found.'
    );
  }

  private async setState(
    operation: BookRequestSearch,
    state: BookRequestSearch['state']
  ): Promise<void> {
    if (operation.state === state) return;
    await getRepository(BookRequestSearch).update(operation.id, {
      state,
      updatedAt: new Date(),
    });
  }

  private async finishWithoutRelease(
    operation: BookRequestSearch,
    readarr: ReadarrAPI,
    stage: RequestStatusStage.UNAVAILABLE | RequestStatusStage.FAILED,
    message: string
  ): Promise<void> {
    if (operation.createdBook) {
      await readarr.removeBook(operation.bookId, { deleteFiles: false });
    }

    if (operation.createdAuthor && operation.authorId) {
      const remainingBooks = await readarr.getBooksByAuthor(operation.authorId);
      if (remainingBooks.length === 0) {
        await readarr.removeAuthor(operation.authorId, { deleteFiles: true });
      }
    }

    const media = operation.request.media;
    const mediaPatch: Partial<Media> = {};
    if (operation.format === 'audiobook') {
      mediaPatch.audiobookServiceId = null;
      mediaPatch.audiobookExternalServiceId = null;
      mediaPatch.audiobookExternalServiceSlug = null;
    } else {
      mediaPatch.serviceId = null;
      mediaPatch.externalServiceId = null;
      mediaPatch.externalServiceSlug = null;
    }
    await getRepository(Media).update(media.id, mediaPatch);
    await this.setState(
      operation,
      stage === RequestStatusStage.FAILED ? 'failed' : 'unavailable'
    );
    await this.finalizeRequest(operation.requestId, { stage, message });
  }

  private async finalizeRequest(
    requestId: number,
    detail?: {
      stage: RequestStatusStage.UNAVAILABLE | RequestStatusStage.FAILED;
      message: string;
    }
  ): Promise<void> {
    const operations = await getRepository(BookRequestSearch).find({
      where: { requestId },
    });
    if (
      operations.length === 0 ||
      operations.some((item) => !terminalOperationStates.has(item.state))
    ) {
      return;
    }

    const request = await getRepository(MediaRequest).findOne({
      where: { id: requestId },
      relations: { media: true },
    });
    if (!request) {
      await getRepository(BookRequestSearch).delete({ requestId });
      return;
    }

    const failed = operations.find((item) => item.state === 'failed');
    const unavailable = operations.find((item) => item.state === 'unavailable');
    const terminalFailure = failed ?? unavailable;
    if (!terminalFailure) {
      // Publish availability before removing the operation. Otherwise the
      // status projection loses its authoritative tracking state and falls
      // back to "Adding to library" until the next availability scan.
      await getRepository(Media).update(request.media.id, {
        status: MediaStatus.AVAILABLE,
      });
      await getRepository(BookRequestSearch).delete({ requestId });
      return;
    }

    await getRepository(BookRequestSearch).delete({ requestId });

    const stage = failed
      ? RequestStatusStage.FAILED
      : RequestStatusStage.UNAVAILABLE;
    await getRepository(MediaRequest).update(requestId, {
      status: failed ? MediaRequestStatus.FAILED : MediaRequestStatus.APPROVED,
    });
    if (
      !operations.some((item) => item.state === 'available') &&
      request.media.status !== MediaStatus.AVAILABLE
    ) {
      await getRepository(Media).update(request.media.id, {
        status: MediaStatus.UNKNOWN,
      });
    }
    await recordRequestStatusOverride(
      requestId,
      stage,
      detail?.stage === stage
        ? detail.message
        : failed
          ? 'Bookshelf search failed.'
          : 'No release found.'
    );
  }
}

const bookRequestSearchManager = new BookRequestSearchManager();

export default bookRequestSearchManager;
