import type { MylarComic } from '@server/api/comics/mylar';
import MylarAPI from '@server/api/comics/mylar';
import { getExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import type {
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import BaseScanner from '@server/lib/scanners/baseScanner';
import { runWithServarrServiceSnapshot } from '@server/lib/serviceAdmission';
import type { MylarSettings } from '@server/lib/settings';
import { getHttpErrorDetails } from '@server/utils/httpError';

type SyncStatus = StatusBase & {
  currentServer: MylarSettings;
  servers: MylarSettings[];
};

class MylarScanner
  extends BaseScanner<MylarComic>
  implements RunnableScanner<SyncStatus>
{
  private servers: MylarSettings[] = [];
  private currentServer: MylarSettings;
  private mylarApi: MylarAPI;

  constructor() {
    super('Mylar Comics Scan', { bundleSize: 10 });
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
      this.servers = structuredClone(settings.mylar);

      for (const server of this.servers) {
        this.currentServer = server;
        if (server.syncEnabled) {
          this.log(`Beginning to process Mylar server: ${server.name}`, 'info');

          this.items = await runWithServarrServiceSnapshot(
            'mylar',
            server,
            async (current) => {
              this.mylarApi = new MylarAPI({
                url: MylarAPI.buildUrl(current),
                apiKey: current.apiKey,
              });
              return this.mylarApi.getIndex();
            }
          );
          await this.loop(this.processMylarComic.bind(this), { sessionId });
        } else {
          this.log(`Sync not enabled. Skipping Mylar server: ${server.name}`);
        }
      }

      this.log('Mylar comics scan complete', 'info');
    } catch (e) {
      this.log('Scan interrupted', 'error', {
        ...getHttpErrorDetails(e),
        errorStack: e instanceof Error ? e.stack : undefined,
      });
    } finally {
      this.endRun(sessionId);
    }
  }

  private async processMylarComic(comic: MylarComic): Promise<void> {
    try {
      const detail = await runWithServarrServiceSnapshot(
        'mylar',
        this.currentServer,
        () => this.mylarApi.getComic(comic.id)
      );
      const totalIssues = comic.totalIssues ?? detail.issues.length;
      const downloadedCount = detail.issues.filter(
        (issue) => issue.status === 'Downloaded'
      ).length;
      const hasFile = downloadedCount > 0;
      const processing = totalIssues > 0 && downloadedCount < totalIssues;

      await this.processComic(comic.id, {
        serviceId: this.currentServer.id,
        externalServiceId: Number(comic.id),
        externalServiceSlug: comic.id,
        title: comic.name,
        hasFile,
        processing,
        comicServiceType: 'mylar',
        mutationGuard: (callback) =>
          runWithServarrServiceSnapshot('mylar', this.currentServer, callback),
      });
    } catch (e) {
      this.log('Failed to process Mylar comic', 'error', {
        errorMessage: e.message,
        title: comic.name,
      });
    }
  }
}

export const mylarScanner = new MylarScanner();
