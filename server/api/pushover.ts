import ExternalAPI from './externalapi';

interface PushoverSoundsResponse {
  sounds: {
    [name: string]: string;
  };
  status: number;
  request: string;
}

export interface PushoverSound {
  name: string;
  description: string;
}

export const MAX_PUSHOVER_SOUNDS = 1_000;

export const mapSounds = (sounds: unknown): PushoverSound[] =>
  sounds && typeof sounds === 'object' && !Array.isArray(sounds)
    ? Object.entries(sounds)
        .slice(0, MAX_PUSHOVER_SOUNDS)
        .flatMap(([name, description]) =>
          typeof description === 'string'
            ? [
                {
                  name: name.slice(0, 256),
                  description: description.slice(0, 1000),
                },
              ]
            : []
        )
    : [];

class PushoverAPI extends ExternalAPI {
  constructor() {
    super(
      'https://api.pushover.net/1',
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );
  }

  public async getSounds(appToken: string): Promise<PushoverSound[]> {
    try {
      const data = await this.get<PushoverSoundsResponse>('/sounds.json', {
        params: {
          token: appToken,
        },
      });

      return mapSounds(data?.sounds);
    } catch (e) {
      throw new Error(`[Pushover] Failed to retrieve sounds: ${e.message}`, {
        cause: e,
      });
    }
  }
}

export default PushoverAPI;
