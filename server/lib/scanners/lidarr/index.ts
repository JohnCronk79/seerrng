import type { LidarrAlbum } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { normalizeMusicBrainzId } from '@server/lib/externalIds';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { runMediaEntityMutation } from '@server/lib/mediaMutation';
import { upsertMediaSearchMetadata } from '@server/lib/mediaSearchMetadata';
import type {
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import BaseScanner from '@server/lib/scanners/baseScanner';
import { forEachMediaCleanupBatch } from '@server/lib/scanners/mediaCleanupBatches';
import {
  ServarrServiceAuthorityChangedError,
  runWithServarrServiceSnapshot,
  runWithServarrServiceSnapshots,
} from '@server/lib/serviceAdmission';
import type { LidarrSettings } from '@server/lib/settings';
import { getHttpErrorDetails } from '@server/utils/httpError';
import { uniqWith } from 'lodash';

type SyncStatus = StatusBase & {
  currentServer: LidarrSettings;
  servers: LidarrSettings[];
};

class LidarrScanner
  extends BaseScanner<LidarrAlbum>
  implements RunnableScanner<SyncStatus>
{
  private servers: LidarrSettings[];
  private currentServer: LidarrSettings;
  private lidarrApi: LidarrAPI;
  private scannedMbIds: Set<string> = new Set();
  private scannedServiceAlbums: Set<string> = new Set();
  private scannedAvailableServiceMbIds: Set<string> = new Set();
  private didScan = false;

  constructor() {
    super('Lidarr Scan', { bundleSize: 50 });
  }

  public status(): SyncStatus {
    return {
      running: this.running,
      progress: this.progress,
      total: this.items.length,
      currentServer: this.currentServer,
      servers: this.servers,
    };
  }

  public async run(): Promise<void> {
    const settings = getExternalRuntimeConfig();
    const sessionId = this.startRun();
    if (!sessionId) {
      return;
    }
    this.scannedMbIds.clear();
    this.scannedServiceAlbums.clear();
    this.scannedAvailableServiceMbIds.clear();
    this.didScan = false;

    try {
      this.servers = uniqWith(
        structuredClone(settings.lidarr),
        (lidarrA, lidarrB) =>
          lidarrA.hostname === lidarrB.hostname &&
          lidarrA.port === lidarrB.port &&
          lidarrA.baseUrl === lidarrB.baseUrl
      );

      for (const server of this.servers) {
        this.currentServer = server;
        if (server.syncEnabled) {
          this.log(
            `Beginning to process Lidarr server: ${server.name}`,
            'info'
          );

          this.items = await runWithServarrServiceSnapshot(
            'lidarr',
            server,
            async (current) => {
              this.lidarrApi = new LidarrAPI({
                apiKey: current.apiKey,
                url: LidarrAPI.buildUrl(current, '/api/v1'),
              });
              return this.lidarrApi.getAlbums();
            }
          );
          this.didScan = true;
          await this.loop(this.processLidarrAlbum.bind(this), { sessionId });
        } else {
          this.log(`Sync not enabled. Skipping Lidarr server: ${server.name}`);
        }
      }

      if (!this.servers.every((server) => server.syncEnabled)) {
        this.didScan = false;
      }

      await this.cleanupOrphanedAlbums();
      this.log('Lidarr scan complete', 'info');
    } catch (e) {
      this.log('Scan interrupted', 'error', {
        ...getHttpErrorDetails(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      });
    } finally {
      this.endRun(sessionId);
    }
  }

  private async processLidarrAlbum(lidarrAlbum: LidarrAlbum): Promise<void> {
    try {
      const mbId = lidarrAlbum.foreignAlbumId
        ? normalizeMusicBrainzId(lidarrAlbum.foreignAlbumId)
        : undefined;
      if (!mbId) {
        this.log(
          'No MusicBrainz ID found for this title. Skipping item.',
          'debug',
          {
            title: lidarrAlbum.title,
          }
        );
        return;
      }

      this.scannedMbIds.add(mbId);
      this.scannedServiceAlbums.add(
        `${this.currentServer.id}:${lidarrAlbum.id}`
      );

      const hasFile = (lidarrAlbum.statistics?.trackFileCount ?? 0) > 0;
      const processing =
        lidarrAlbum.monitored &&
        (!lidarrAlbum.statistics ||
          lidarrAlbum.statistics.trackFileCount <
            lidarrAlbum.statistics.totalTrackCount);

      if (hasFile && !processing) {
        this.scannedAvailableServiceMbIds.add(
          `${this.currentServer.id}:${mbId}`
        );
      }

      await this.processMusic(mbId, {
        serviceId: this.currentServer.id,
        externalServiceId: lidarrAlbum.id,
        externalServiceSlug: mbId,
        title: lidarrAlbum.title,
        processing: lidarrAlbum.monitored ? processing : false,
        hasFile,
        mutationGuard: (callback) =>
          runWithServarrServiceSnapshot('lidarr', this.currentServer, callback),
      });

      const media = await getRepository(Media).findOne({
        where: [
          { mbId, mediaType: MediaType.MUSIC },
          {
            serviceId: this.currentServer.id,
            externalServiceId: lidarrAlbum.id,
            mediaType: MediaType.MUSIC,
          },
        ],
      });
      await upsertMediaSearchMetadata(media?.id, {
        title: lidarrAlbum.title,
        releaseDate: lidarrAlbum.releaseDate,
        genres: lidarrAlbum.genres?.join(', '),
        runtime:
          Number.isFinite(lidarrAlbum.duration) && lidarrAlbum.duration > 0
            ? String(Math.round(lidarrAlbum.duration / 60))
            : undefined,
        artist: lidarrAlbum.artistName ?? lidarrAlbum.artist?.artistName,
        albumType: lidarrAlbum.albumType,
        format: 'Music',
        provider: this.currentServer.name,
        externalIds: mbId,
      });
    } catch (e) {
      if (e instanceof ServarrServiceAuthorityChangedError) throw e;
      this.log('Failed to process Lidarr media', 'error', {
        errorMessage: e.message,
        title: lidarrAlbum.title,
      });
    }
  }

  private async cleanupOrphanedAlbums(): Promise<void> {
    const mediaRepository = getRepository(Media);

    if (!this.didScan) {
      this.log(
        'Skipping orphaned album cleanup: not all Lidarr servers were scanned.',
        'info'
      );
      return;
    }

    const scannedServiceIds = new Set(
      this.servers
        .filter((server) => server.syncEnabled)
        .map((server) => server.id)
    );

    await forEachMediaCleanupBatch(
      { mediaType: MediaType.MUSIC },
      async (media) => {
        const mbId = media.mbId
          ? normalizeMusicBrainzId(media.mbId)
          : undefined;

        const serviceAlbumKey =
          media.serviceId !== null &&
          media.serviceId !== undefined &&
          media.externalServiceId !== null &&
          media.externalServiceId !== undefined
            ? `${media.serviceId}:${media.externalServiceId}`
            : undefined;

        const currentAvailableServiceIds = media.availableMusicServiceIds ?? [];
        const nextAvailableServiceIds = currentAvailableServiceIds.filter(
          (serverId) =>
            !scannedServiceIds.has(serverId) ||
            (mbId !== undefined &&
              this.scannedAvailableServiceMbIds.has(`${serverId}:${mbId}`))
        );
        const availabilityChanged =
          nextAvailableServiceIds.length !==
            currentAvailableServiceIds.length ||
          nextAvailableServiceIds.some(
            (serverId, index) => serverId !== currentAvailableServiceIds[index]
          );
        const shouldResetProcessing =
          media.status === MediaStatus.PROCESSING &&
          mbId &&
          !this.scannedMbIds.has(mbId) &&
          (!serviceAlbumKey || !this.scannedServiceAlbums.has(serviceAlbumKey));

        if (availabilityChanged || shouldResetProcessing) {
          const changed = await runMediaEntityMutation(media, () =>
            runWithServarrServiceSnapshots(
              'lidarr',
              this.servers.filter((server) => server.syncEnabled),
              async () => {
                const current = await mediaRepository.findOneBy({
                  id: media.id,
                });
                if (!current) {
                  return false;
                }
                if (availabilityChanged) {
                  current.availableMusicServiceIds = nextAvailableServiceIds;
                }
                if (
                  shouldResetProcessing &&
                  current.status === MediaStatus.PROCESSING
                ) {
                  current.status = MediaStatus.UNKNOWN;
                }
                await mediaRepository.save(current);
                return true;
              },
              {
                requireExactAuthoritySet: true,
                includeCurrent: (server) => server.syncEnabled,
              }
            )
          );
          if (changed && shouldResetProcessing) {
            this.log(
              `Album ${mbId} not found in any Lidarr server. Status reset to UNKNOWN.`,
              'info'
            );
          }
        }
      }
    );
  }
}

export const lidarrScanner = new LidarrScanner();
