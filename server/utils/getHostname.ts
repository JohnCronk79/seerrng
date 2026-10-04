import { getSettings } from '@server/lib/settings';
import { buildServiceUrl } from '@server/utils/serviceUrl';

interface HostnameParams {
  useSsl?: boolean;
  ip?: string;
  port?: number;
  urlBase?: string;
}

export const getHostname = (params?: HostnameParams): string => {
  const settings = params ? params : getSettings().jellyfin;

  return buildServiceUrl({
    useSsl: settings.useSsl,
    hostname: settings.ip,
    port: settings.port,
    urlBase: settings.urlBase,
  });
};
