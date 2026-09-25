import ExternalAPI from '@server/api/externalapi';
import type { PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { buildServiceUrl } from '@server/utils/serviceUrl';

const boundedText = (value: string, maximum = 2_048) =>
  value.trim().slice(0, maximum);

class PlexCompanionAPI extends ExternalAPI {
  private clientIdentifier: string;
  private plexToken: string;

  constructor({
    clientUrl,
    clientIdentifier,
    plexToken,
  }: {
    clientUrl: string;
    clientIdentifier: string;
    plexToken: string;
  }) {
    const settings = getSettings();
    super(
      clientUrl,
      {},
      {
        allowPrivateAddresses: true,
        headers: {
          'X-Plex-Token': plexToken,
          'X-Plex-Client-Identifier': settings.clientId,
          'X-Plex-Target-Client-Identifier': clientIdentifier,
          'X-Plex-Product': 'SeerrNG',
        },
        timeout: 10_000,
        maxContentLength: 1024 * 1024,
        maxBodyLength: 1024,
      }
    );
    this.clientIdentifier = boundedText(clientIdentifier, 512);
    this.plexToken = boundedText(plexToken, 4_096);
  }

  public async playMedia({
    server,
    machineIdentifier,
    ratingKey,
    playQueueId,
    mediaType,
  }: {
    server: PlexSettings;
    machineIdentifier: string;
    ratingKey: string;
    playQueueId: number;
    mediaType: 'audio' | 'video';
  }): Promise<void> {
    const safeMachineIdentifier = boundedText(machineIdentifier, 128);
    const safeRatingKey = boundedText(ratingKey, 128);
    if (
      !this.clientIdentifier ||
      !this.plexToken ||
      !safeMachineIdentifier ||
      !safeRatingKey ||
      !Number.isSafeInteger(playQueueId) ||
      playQueueId < 1
    ) {
      throw new Error('Plex playback command is incomplete.');
    }

    const serverUrl = buildServiceUrl({
      useSsl: server.useSsl,
      hostname: server.ip,
      port: server.port,
    });
    const metadataPath = `/library/metadata/${safeRatingKey}`;
    const companionMediaType = mediaType === 'audio' ? 'music' : 'video';

    await this.get('/player/playback/playMedia', {
      params: {
        machineIdentifier: safeMachineIdentifier,
        address: server.ip,
        port: server.port,
        protocol: server.useSsl ? 'https' : 'http',
        key: metadataPath,
        path: `${serverUrl}${metadataPath}`,
        offset: 0,
        commandID: 1,
        playQueueID: playQueueId,
        containerKey: `/playQueues/${playQueueId}?window=200&own=1`,
        providerIdentifier: 'com.plexapp.plugins.library',
        type: companionMediaType,
        token: this.plexToken,
      },
    });
  }
}

export default PlexCompanionAPI;
