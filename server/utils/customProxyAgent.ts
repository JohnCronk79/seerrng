import type { ProxySettings } from '@server/lib/settings';
import logger from '@server/logger';
import {
  isLocalOrPrivateAddress,
  requiresDirectSafeHttpConnection,
} from '@server/utils/security';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import http from 'http';
import { HttpProxyAgent } from 'http-proxy-agent';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Dispatcher } from 'undici';
import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';

interface ProxyState {
  httpAgent: HttpProxyAgent<string>;
  httpsAgent: HttpsProxyAgent<string>;
  skipUrl: (url: string | URL) => boolean;
}

let proxyState: ProxyState | null = null;
let ipv4Agents: { httpAgent: http.Agent; httpsAgent: https.Agent } | null =
  null;

export function setForceIpv4First(enabled: boolean) {
  ipv4Agents = enabled
    ? {
        httpAgent: new http.Agent({ family: 4 }),
        httpsAgent: new https.Agent({ family: 4 }),
      }
    : null;
}

export function proxyRequestInterceptor(
  config: InternalAxiosRequestConfig
): InternalAxiosRequestConfig {
  let url: URL | undefined;
  try {
    if (config.baseURL) {
      url = new URL(config.url ?? '', config.baseURL);
    } else if (config.url) {
      url = new URL(config.url);
    }
  } catch {
    url = undefined;
  }

  const lookup = (config as InternalAxiosRequestConfig & { lookup?: unknown })
    .lookup;

  if (
    requiresDirectSafeHttpConnection(lookup) ||
    (url && proxyState?.skipUrl(url))
  ) {
    // Already-validated safe URLs (and anything the proxy config says to
    // bypass) must connect directly using the resolved-safe address, not
    // through a proxy that could re-resolve DNS and bypass the SSRF check.
    config.httpAgent = ipv4Agents?.httpAgent ?? false;
    config.httpsAgent = ipv4Agents?.httpsAgent ?? false;
    // Axios can independently honor HTTP_PROXY/HTTPS_PROXY after custom
    // agents are cleared. Disable that fallback as well.
    config.proxy = false;
    return config;
  }

  if (proxyState) {
    config.httpAgent = proxyState.httpAgent;
    config.httpsAgent = proxyState.httpsAgent;
    config.proxy = false;
  } else if (ipv4Agents) {
    config.httpAgent = ipv4Agents.httpAgent;
    config.httpsAgent = ipv4Agents.httpsAgent;
  }

  return config;
}

// default instance only, axios.create() clients register this themselves
axios.interceptors.request.use(proxyRequestInterceptor);

const createDefaultAgent = (forceIpv4First?: boolean) =>
  new Agent({
    keepAliveTimeout: 5000,
    connections: 50,
    connect: forceIpv4First ? { family: 4 } : undefined,
  });

const clearAxiosProxyConfiguration = () => {
  proxyState = null;
};

export const resetCustomProxyAgent = (forceIpv4First?: boolean): void => {
  clearAxiosProxyConfiguration();
  setGlobalDispatcher(createDefaultAgent(forceIpv4First));
};

export const PROXY_CONNECTIVITY_CHECK_OPTIONS = {
  timeout: 5_000,
  maxContentLength: 1024,
  maxBodyLength: 1024,
} as const;

const normalizeProxyHostname = (value: string): string =>
  value.trim().toLowerCase().replace(/\.+$/, '');

export const matchesProxyBypassFilter = (
  hostname: string,
  bypassFilter: string
): boolean => {
  const normalizedHostname = normalizeProxyHostname(hostname);
  if (!normalizedHostname) {
    return false;
  }

  return bypassFilter.split(',').some((address) => {
    const normalizedAddress = normalizeProxyHostname(address);
    if (!normalizedAddress) {
      return false;
    }

    if (normalizedAddress.startsWith('*')) {
      const suffix = normalizedAddress.slice(1).replace(/^\.+/, '');
      return Boolean(
        suffix &&
        (normalizedHostname === suffix ||
          normalizedHostname.endsWith(`.${suffix}`))
      );
    }

    return normalizedHostname === normalizedAddress;
  });
};

export default async function createCustomProxyAgent(
  proxySettings: ProxySettings,
  forceIpv4First?: boolean
) {
  clearAxiosProxyConfiguration();

  const defaultAgent = createDefaultAgent(forceIpv4First);

  const skipUrl = (url: string | URL) => {
    let hostname: string;
    try {
      hostname = typeof url === 'string' ? new URL(url).hostname : url.hostname;
    } catch {
      return false;
    }

    if (
      proxySettings.bypassLocalAddresses &&
      isLocalOrPrivateAddress(hostname)
    ) {
      return true;
    }

    if (matchesProxyBypassFilter(hostname, proxySettings.bypassFilter)) {
      return true;
    }

    return false;
  };

  const noProxyInterceptor = (
    dispatch: Dispatcher['dispatch']
  ): Dispatcher['dispatch'] => {
    return (opts, handler) => {
      return opts.origin && skipUrl(opts.origin)
        ? defaultAgent.dispatch(opts, handler)
        : dispatch(opts, handler);
    };
  };

  const token =
    proxySettings.user && proxySettings.password
      ? `Basic ${Buffer.from(
          `${proxySettings.user}:${proxySettings.password}`
        ).toString('base64')}`
      : undefined;

  try {
    const proxyUrl = `${proxySettings.useSsl ? 'https' : 'http'}://${
      proxySettings.hostname
    }:${proxySettings.port}`;
    const proxyAgent = new ProxyAgent({
      uri: proxyUrl,
      token,
      keepAliveTimeout: 5000,
      connections: 50,
      connect: forceIpv4First ? { family: 4 } : undefined,
    });

    setGlobalDispatcher(proxyAgent.compose(noProxyInterceptor));

    const agentOptions = {
      headers: token ? { 'proxy-authorization': token } : undefined,
      keepAlive: true,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 5000,
      scheduling: 'lifo' as const,
      family: forceIpv4First ? 4 : undefined,
    };

    proxyState = {
      httpAgent: new HttpProxyAgent(proxyUrl, agentOptions),
      httpsAgent: new HttpsProxyAgent(proxyUrl, agentOptions),
      skipUrl,
    };
  } catch (e) {
    logger.error('Failed to connect to the proxy: ' + e.message, {
      label: 'Proxy',
    });
    clearAxiosProxyConfiguration();
    setGlobalDispatcher(defaultAgent);
    proxyState = null;
    return;
  }

  try {
    await axios.head(
      'https://www.google.com',
      PROXY_CONNECTIVITY_CHECK_OPTIONS
    );
    logger.debug('HTTP(S) proxy connected successfully', { label: 'Proxy' });
  } catch (e) {
    logger.error(
      'Failed to connect to the proxy: ' + e.message + ': ' + e.cause,
      { label: 'Proxy' }
    );
    clearAxiosProxyConfiguration();
    setGlobalDispatcher(defaultAgent);
  }
}
