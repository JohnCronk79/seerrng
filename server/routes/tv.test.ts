import assert from 'node:assert/strict';
import { afterEach, before, describe, it, mock } from 'node:test';

import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { getSettings, type SonarrSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import tvRoutes from './tv';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/tv', tvRoutes);
  return app;
}

before(() => {
  app = createApp();
});

afterEach(() => {
  mock.restoreAll();
});

setupTestDb();

describe('GET /tv/:id/cover', () => {
  it('serves linked Sonarr covers through the configured service', async () => {
    const settings = getSettings();
    const priorSonarr = settings.sonarr;
    settings.sonarr = [
      {
        id: 9,
        name: 'Sonarr',
        hostname: 'sonarr.test',
        port: 8989,
        apiKey: 'sonarr-key',
        useSsl: false,
        baseUrl: '',
        activeProfileId: 1,
        activeProfileName: 'Any',
        activeDirectory: '/tv',
        tags: [],
        is4k: false,
        isDefault: true,
        externalUrl: '',
        syncEnabled: true,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
        seriesType: 'standard',
        animeSeriesType: 'anime',
        enableSeasonFolders: true,
        monitorNewItems: 'all',
      },
    ];
    const getSeriesCoverMock = mock.method(
      SonarrAPI.prototype,
      'getSeriesCover',
      async () => ({
        imageBuffer: Buffer.from('series-cover'),
        contentType: 'image/jpeg',
      })
    );
    const originalBuildUrl = SonarrAPI.buildUrl;
    const buildUrlMock = mock.method(
      SonarrAPI,
      'buildUrl',
      (server: SonarrSettings, path?: string) => originalBuildUrl(server, path)
    );

    try {
      const media = await getRepository(Media).save(
        new Media({
          tmdbId: 100,
          mediaType: MediaType.TV,
          serviceId: 9,
          externalServiceId: 44,
          externalServiceSlug: 'test-series',
        })
      );

      const res = await request(app).get(
        `/tv/100/cover?mediaId=${media.id}&is4k=false`
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], 'image/jpeg');
      assert.deepStrictEqual(res.body, Buffer.from('series-cover'));
      assert.strictEqual(getSeriesCoverMock.mock.calls[0].arguments[0], 44);
      assert(
        buildUrlMock.mock.calls.some((call) => call.arguments[1] === '/api/v3')
      );
    } finally {
      settings.sonarr = priorSonarr;
    }
  });
});
