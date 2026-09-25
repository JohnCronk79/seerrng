import type { KapowarrVolume } from '@server/api/comics/kapowarr';
import KapowarrAPI from '@server/api/comics/kapowarr';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import type {
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import BaseScanner from '@server/lib/scanners/baseScanner';
import { runWithServarrServiceSnapshot } from '@server/lib/serviceAdmission';
import type { KapowarrSettings } from '@server/lib/settings';

type SyncStatus = StatusBase & {
  currentServer: KapowarrSettings;
  servers: KapowarrSettings[];
};

class KapowarrScanner
  extends BaseScanner<KapowarrVolume>
  implements RunnableScanner<SyncStatus>
{
  private servers: KapowarrSettings[] = [];
  private currentServer: KapowarrSettings;

  constructor() {
    super('Kapowarr Comics Scan', { bundleSize: 10 });
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

    try {
      this.servers = structuredClone(settings.kapowarr);

      for (const server of this.servers) {
        this.currentServer = server;
        if (server.syncEnabled) {
          this.log(
            `Beginning to process Kapowarr server: ${server.name}`,
            'info'
          );

          this.items = await runWithServarrServiceSnapshot(
            'kapowarr',
            server,
            async (current) => {
              const kapowarr = new KapowarrAPI({
                url: KapowarrAPI.buildUrl(current),
                apiKey: current.apiKey,
              });
              return kapowarr.getVolumes();
            }
          );
          await this.loop(this.processKapowarrVolume.bind(this), {
            sessionId,
          });
        } else {
          this.log(
            `Sync not enabled. Skipping Kapowarr server: ${server.name}`
          );
        }
      }

      this.log('Kapowarr comics scan complete', 'info');
    } catch (e) {
      this.log('Scan interrupted', 'error', { errorMessage: e.message });
    } finally {
      this.endRun(sessionId);
    }
  }

  private async processKapowarrVolume(volume: KapowarrVolume): Promise<void> {
    try {
      const hasFile = volume.issues_downloaded > 0;
      const processing =
        volume.issue_count > 0 && volume.issues_downloaded < volume.issue_count;

      await this.processComic(String(volume.comicvine_id), {
        serviceId: this.currentServer.id,
        externalServiceId: volume.id,
        externalServiceSlug: String(volume.id),
        title: volume.title,
        hasFile,
        processing,
        comicServiceType: 'kapowarr',
        mutationGuard: (callback) =>
          runWithServarrServiceSnapshot(
            'kapowarr',
            this.currentServer,
            callback
          ),
      });
    } catch (e) {
      this.log('Failed to process Kapowarr volume', 'error', {
        errorMessage: e.message,
        title: volume.title,
      });
    }
  }
}

export const kapowarrScanner = new KapowarrScanner();
