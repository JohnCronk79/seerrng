import type { LidarrAlbum } from '@server/api/servarr/lidarr';
import LidarrAPI from '@server/api/servarr/lidarr';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { normalizeMusicBrainzId } from '@server/lib/externalIds';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import { runMediaEntityMutation } from '@server/lib/mediaMutation';
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
      this.log('Scan interrupted', 'error', { errorMessage: e.message });
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

      if (!lidarrAlbum.monitored) {
        await this.processMusic(mbId, {
          serviceId: this.currentServer.id,
          externalServiceId: lidarrAlbum.id,
          externalServiceSlug: mbId,
          title: lidarrAlbum.title,
          processing: false,
          hasFile,
          mutationGuard: (callback) =>
            runWithServarrServiceSnapshot(
              'lidarr',
              this.currentServer,
              callback
            ),
        });
        return;
      }

      await this.processMusic(mbId, {
        serviceId: this.currentServer.id,
        externalServiceId: lidarrAlbum.id,
        externalServiceSlug: mbId,
        title: lidarrAlbum.title,
        processing:
          lidarrAlbum.monitored &&
          (!lidarrAlbum.statistics ||
            lidarrAlbum.statistics.trackFileCount <
              lidarrAlbum.statistics.totalTrackCount),
        hasFile,
        mutationGuard: (callback) =>
          runWithServarrServiceSnapshot('lidarr', this.currentServer, callback),
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

    await forEachMediaCleanupBatch(
      { mediaType: MediaType.MUSIC, status: MediaStatus.PROCESSING },
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

        if (
          mbId &&
          !this.scannedMbIds.has(mbId) &&
          (!serviceAlbumKey || !this.scannedServiceAlbums.has(serviceAlbumKey))
        ) {
          const changed = await runMediaEntityMutation(media, () =>
            runWithServarrServiceSnapshots(
              'lidarr',
              this.servers.filter((server) => server.syncEnabled),
              async () => {
                const current = await mediaRepository.findOneBy({
                  id: media.id,
                });
                if (!current || current.status !== MediaStatus.PROCESSING) {
                  return false;
                }
                current.status = MediaStatus.UNKNOWN;
                await mediaRepository.save(current);
                return true;
              },
              {
                requireExactAuthoritySet: true,
                includeCurrent: (server) => server.syncEnabled,
              }
            )
          );
          if (changed) {
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
