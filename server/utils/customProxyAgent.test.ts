import ExternalAPI from '@server/api/externalapi';
import type { ProxySettings } from '@server/lib/settings';
import { createSafeHttpRequestOptions } from '@server/utils/security';
import axios, {
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import createCustomProxyAgent, {
  PROXY_CONNECTIVITY_CHECK_OPTIONS,
  matchesProxyBypassFilter,
  proxyRequestInterceptor,
  resetCustomProxyAgent,
} from './customProxyAgent';

const proxySettings: ProxySettings = {
  enabled: true,
  hostname: 'proxy.example.com',
  port: 8080,
  useSsl: false,
  user: '',
  password: '',
  bypassFilter: '',
  bypassLocalAddresses: true,
};

afterEach(() => {
  mock.restoreAll();
  resetCustomProxyAgent();
});

describe('proxyRequestInterceptor', () => {
  it('matches wildcard proxy bypasses on DNS label boundaries', () => {
    const filter = '*.Internal.Example., exact.example';

    assert.equal(
      matchesProxyBypassFilter('service.internal.example', filter),
      true
    );
    assert.equal(matchesProxyBypassFilter('INTERNAL.EXAMPLE.', filter), true);
    assert.equal(matchesProxyBypassFilter('exact.example', filter), true);
    assert.equal(
      matchesProxyBypassFilter('evil-internal.example', filter),
      false
    );
    assert.equal(matchesProxyBypassFilter('notexact.example', filter), false);
    assert.equal(matchesProxyBypassFilter('example.com', '*'), false);
  });

  it('bounds the proxy connectivity probe', () => {
    assert.equal(PROXY_CONNECTIVITY_CHECK_OPTIONS.timeout, 5_000);
    assert.equal(PROXY_CONNECTIVITY_CHECK_OPTIONS.maxContentLength, 1024);
    assert.equal(PROXY_CONNECTIVITY_CHECK_OPTIONS.maxBodyLength, 1024);
  });

  it('is a no-op before proxy initialization', () => {
    const config = { url: 'https://example.com' } as InternalAxiosRequestConfig;

    assert.equal(proxyRequestInterceptor(config), config);
    assert.equal(config.httpAgent, undefined);
    assert.equal(config.httpsAgent, undefined);
  });

  it('bypasses the proxy for absolute local URLs even with a base URL', async () => {
    const head = mock.method(axios, 'head', async () => ({ status: 200 }));
    await createCustomProxyAgent(proxySettings);

    assert.equal(head.mock.callCount(), 1);
    assert.deepEqual(head.mock.calls[0].arguments, [
      'https://www.google.com',
      PROXY_CONNECTIVITY_CHECK_OPTIONS,
    ]);

    const config = proxyRequestInterceptor({
      baseURL: 'https://api.example.com/v1',
      url: 'http://127.0.0.1/status',
    } as unknown as InternalAxiosRequestConfig);

    assert.equal(config.httpAgent, false);
    assert.equal(config.httpsAgent, false);
    assert.equal(config.proxy, false);
  });

  it('applies a new bypass policy when proxy settings change', async () => {
    mock.method(axios, 'head', async () => ({ status: 200 }));

    await createCustomProxyAgent({
      ...proxySettings,
      bypassFilter: '*.old-policy.example',
    });
    const oldPolicyConfig = proxyRequestInterceptor({
      url: 'https://service.old-policy.example/status',
    } as unknown as InternalAxiosRequestConfig);
    assert.equal(oldPolicyConfig.httpAgent, false);
    assert.equal(oldPolicyConfig.httpsAgent, false);

    await createCustomProxyAgent({
      ...proxySettings,
      bypassLocalAddresses: false,
      bypassFilter: '',
    });

    const config = proxyRequestInterceptor({
      url: 'https://service.old-policy.example/status',
    } as unknown as InternalAxiosRequestConfig);
    assert.notEqual(config.httpAgent, false);
    assert.notEqual(config.httpsAgent, false);
  });

  it('bypasses the proxy for wildcard-filtered service hosts', async () => {
    mock.method(axios, 'head', async () => ({ status: 200 }));
    await createCustomProxyAgent({
      ...proxySettings,
      bypassLocalAddresses: false,
      bypassFilter: '*.internal.example',
    });

    const config = proxyRequestInterceptor({
      url: 'https://books.internal.example/api/v1/status',
    } as InternalAxiosRequestConfig);
    assert.equal(config.httpAgent, false);
    assert.equal(config.httpsAgent, false);
    assert.equal(config.proxy, false);
  });

  it('keeps private-address-safe lookups direct', async () => {
    mock.method(axios, 'head', async () => ({ status: 200 }));
    await createCustomProxyAgent({
      ...proxySettings,
      bypassLocalAddresses: false,
    });

    const config = proxyRequestInterceptor({
      url: 'https://webhook.example.com/notify',
      ...createSafeHttpRequestOptions(false, false, true),
    } as unknown as InternalAxiosRequestConfig);

    assert.equal(config.httpAgent, false);
    assert.equal(config.httpsAgent, false);
    assert.equal(config.proxy, false);
  });

  it('keeps explicitly direct lookups off the proxy when private addresses are allowed', async () => {
    mock.method(axios, 'head', async () => ({ status: 200 }));
    await createCustomProxyAgent({
      ...proxySettings,
      bypassLocalAddresses: false,
    });
    let allowPrivateAddresses = true;

    const config = proxyRequestInterceptor({
      url: 'https://webhook.example.com/notify',
      ...createSafeHttpRequestOptions(() => allowPrivateAddresses, false, true),
    } as unknown as InternalAxiosRequestConfig);

    assert.equal(config.httpAgent, false);
    assert.equal(config.httpsAgent, false);
    assert.equal(config.proxy, false);

    allowPrivateAddresses = false;
    assert.equal(proxyRequestInterceptor(config), config);
  });

  it('restores direct routing when the proxy probe fails', async () => {
    mock.method(axios, 'head', async () => {
      throw new Error('proxy unavailable');
    });

    await createCustomProxyAgent(proxySettings);

    const config = proxyRequestInterceptor({
      url: 'https://example.com',
    } as InternalAxiosRequestConfig);
    assert.notEqual(config.httpAgent, false);
    assert.equal(config.proxy, undefined);
  });
});

class TestExternalAPI extends ExternalAPI {
  public constructor() {
    super('https://api.themoviedb.org/3', {}, {});
  }

  public async resolvedHttpsAgent(path = '/movie/123'): Promise<unknown> {
    let captured: InternalAxiosRequestConfig | undefined;
    this.axios.defaults.adapter = (config) => {
      captured = config;
      return Promise.resolve({
        data: {},
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        request: {},
      } as AxiosResponse);
    };
    await this.axios.get(path);
    return captured?.httpsAgent;
  }
}

// constructed before any test configures the proxy, like BaseScanner.tmdb
const preProxyClient = new TestExternalAPI();

describe('proxy routing (construction-order independence)', () => {
  beforeEach(() => {
    mock.method(axios, 'head', async () => ({ status: 200 }));
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('routes a client constructed BEFORE the proxy was configured', async () => {
    await createCustomProxyAgent({
      ...proxySettings,
      hostname: 'proxy.test',
      port: 3128,
      bypassFilter: '*.bypass.test',
    });
    const agent = await preProxyClient.resolvedHttpsAgent();
    assert.ok(
      agent instanceof HttpsProxyAgent,
      'client created before proxy setup must still route through the proxy'
    );
  });

  it('routes a client constructed AFTER the proxy was configured', async () => {
    await createCustomProxyAgent({
      ...proxySettings,
      hostname: 'proxy.test',
      port: 3128,
      bypassFilter: '*.bypass.test',
    });
    const agent = await new TestExternalAPI().resolvedHttpsAgent();
    assert.ok(agent instanceof HttpsProxyAgent);
  });
});
