import type { Request } from 'express';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSafeHttpLookup,
  createSafeHttpRequestOptions,
  getRateLimitKey,
  isLocalOrPrivateAddress,
  isLoopbackOrLinkLocalAddress,
  isSafeHttpUrl,
  isValidApplicationUrl,
  isValidHttpUrl,
  preserveRedactedSecrets,
  redactSecrets,
  requiresDirectSafeHttpConnection,
  safeStringEqual,
} from './security';

const runLookup = (
  lookup: ReturnType<typeof createSafeHttpLookup>,
  hostname: string
) =>
  new Promise<void>((resolve, reject) => {
    lookup(hostname, { all: true }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

describe('redactSecrets', () => {
  it('redacts credentials without corrupting proxy bypass settings', () => {
    assert.deepEqual(
      redactSecrets({
        password: 'secret',
        auth: 'push-secret',
        cookie: 'session=secret',
        bypassFilter: 'localhost',
        bypassLocalAddresses: true,
      }),
      {
        password: '[REDACTED]',
        auth: '[REDACTED]',
        cookie: '[REDACTED]',
        bypassFilter: 'localhost',
        bypassLocalAddresses: true,
      }
    );
  });

  it('bounds deep, circular, and binary values while redacting secrets', () => {
    const value: Record<string, unknown> = {
      authorization: 'Bearer secret',
      binary: Buffer.alloc(1024),
    };
    value.circular = value;
    let nested = value;
    for (let depth = 0; depth < 100; depth += 1) {
      const child: Record<string, unknown> = {};
      nested.child = child;
      nested = child;
    }

    const redacted = redactSecrets(value) as Record<string, unknown>;

    assert.equal(redacted.authorization, '[REDACTED]');
    assert.equal(redacted.binary, '[Buffer 1024 bytes]');
    assert.equal(redacted.circular, '[CIRCULAR]');
    let bounded: unknown = redacted;
    for (let depth = 0; depth < 40; depth += 1) {
      if (bounded === '[TRUNCATED]') {
        break;
      }
      bounded = (bounded as Record<string, unknown>).child;
    }
    assert.equal(bounded, '[TRUNCATED]');
  });

  it('redacts every occurrence of a shared value without calling it circular', () => {
    const shared = { accessToken: 'shared-secret', enabled: true };

    assert.deepStrictEqual(redactSecrets({ first: shared, second: shared }), {
      first: { accessToken: '[REDACTED]', enabled: true },
      second: { accessToken: '[REDACTED]', enabled: true },
    });
  });

  it('redacts dynamic header records and private-key fields', () => {
    assert.deepStrictEqual(
      redactSecrets({
        headers: [
          { key: 'Authorization', value: 'Bearer secret' },
          { name: 'Set-Cookie', value: 'session=secret' },
          { key: 'X-Request-Id', value: 'visible-id' },
        ],
        privateKey: 'pem-secret',
        vapidPrivate: 'vapid-secret',
      }),
      {
        headers: [
          { key: 'Authorization', value: '[REDACTED]' },
          { name: 'Set-Cookie', value: '[REDACTED]' },
          { key: 'X-Request-Id', value: 'visible-id' },
        ],
        privateKey: '[REDACTED]',
        vapidPrivate: '[REDACTED]',
      }
    );
  });
});

describe('preserveRedactedSecrets', () => {
  it('preserves redacted values without mutating unrelated fields', () => {
    assert.deepStrictEqual(
      preserveRedactedSecrets(
        { accessToken: '[REDACTED]', enabled: false },
        { accessToken: 'stored-secret', enabled: true }
      ),
      { accessToken: 'stored-secret', enabled: false }
    );
  });

  it('matches redacted array entries by stable header key', () => {
    assert.deepStrictEqual(
      preserveRedactedSecrets(
        [
          { key: 'X-Second', value: '[REDACTED]' },
          { key: 'X-First', value: '[REDACTED]' },
        ],
        [
          { key: 'X-First', value: 'first-secret' },
          { key: 'X-Second', value: 'second-secret' },
        ]
      ),
      [
        { key: 'X-Second', value: 'second-secret' },
        { key: 'X-First', value: 'first-secret' },
      ]
    );
  });

  it('rejects deeply nested and circular settings structures', () => {
    const deep: Record<string, unknown> = {};
    let nested = deep;
    for (let depth = 0; depth < 100; depth += 1) {
      const child: Record<string, unknown> = {};
      nested.child = child;
      nested = child;
    }
    assert.throws(
      () => preserveRedactedSecrets(deep, {}),
      /safe nesting limits/
    );

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.throws(
      () => preserveRedactedSecrets(circular, {}),
      /circular values/
    );
  });

  it('preserves repeated non-circular settings values independently', () => {
    const shared = { accessToken: '[REDACTED]', enabled: false };

    assert.deepStrictEqual(
      preserveRedactedSecrets(
        { first: shared, second: shared },
        {
          first: { accessToken: 'first-secret', enabled: true },
          second: { accessToken: 'second-secret', enabled: true },
        }
      ),
      {
        first: { accessToken: 'first-secret', enabled: false },
        second: { accessToken: 'second-secret', enabled: false },
      }
    );
  });
});

describe('isValidHttpUrl', () => {
  it('accepts http and https URLs', () => {
    assert.equal(isValidHttpUrl('http://example.com/webhook'), true);
    assert.equal(isValidHttpUrl('https://example.com/webhook'), true);
  });

  it('rejects non-http URLs and invalid values', () => {
    assert.equal(isValidHttpUrl('file:///etc/passwd'), false);
    assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
    assert.equal(isValidHttpUrl('/relative/path'), false);
    assert.equal(isValidHttpUrl(''), false);
    assert.equal(isValidHttpUrl(undefined), false);
    assert.equal(
      isValidHttpUrl('https://trusted.example@attacker.example/webhook'),
      false
    );
    assert.equal(
      isValidHttpUrl('https://example.com/webhook\nnext-line'),
      false
    );
  });

  it('allows notification template variables only when requested', () => {
    const templatedUrl = 'https://example.com/hooks/{{media_tmdbid}}';

    assert.equal(isValidHttpUrl(templatedUrl), false);
    assert.equal(isValidHttpUrl(templatedUrl, { allowTemplates: true }), true);
  });
});

describe('isValidApplicationUrl', () => {
  it('rejects authority credentials, query strings, and fragments', () => {
    assert.equal(isValidApplicationUrl('https://seerr.example.com'), true);
    assert.equal(
      isValidApplicationUrl('https://user:secret@seerr.example.com'),
      false
    );
    assert.equal(
      isValidApplicationUrl('https://seerr.example.com?redirect=evil'),
      false
    );
    assert.equal(
      isValidApplicationUrl('https://seerr.example.com#fragment'),
      false
    );
  });
});

describe('isSafeHttpUrl', () => {
  it('rejects local and private network destinations by default', async () => {
    assert.equal(await isSafeHttpUrl('http://127.0.0.1/webhook'), false);
    assert.equal(await isSafeHttpUrl('http://localhost/webhook'), false);
    assert.equal(await isSafeHttpUrl('http://192.168.1.10/webhook'), false);
    assert.equal(await isSafeHttpUrl('http://169.254.169.254/latest'), false);
    assert.equal(
      await isSafeHttpUrl('http://[::ffff:127.0.0.1]/webhook'),
      false
    );
    assert.equal(await isSafeHttpUrl('http://[fe90::1]/webhook'), false);
  });

  it('allows private destinations only when explicitly enabled', async () => {
    assert.equal(
      await isSafeHttpUrl('http://127.0.0.1/webhook', {
        allowPrivateAddresses: true,
      }),
      true
    );
  });
});

describe('safe HTTP connection options', () => {
  it('rejects private addresses in the DNS lookup used by the socket', async () => {
    await assert.rejects(
      runLookup(createSafeHttpLookup(), 'localhost'),
      (error: NodeJS.ErrnoException) => error.code === 'EACCES'
    );
  });

  it('honors an explicit dynamic private-address policy', async () => {
    let allowPrivateAddresses = false;
    const lookup = createSafeHttpLookup(() => allowPrivateAddresses);

    await assert.rejects(runLookup(lookup, 'localhost'));
    allowPrivateAddresses = true;
    await assert.doesNotReject(runLookup(lookup, 'localhost'));
  });

  it('rejects loopback DNS results while preserving direct LAN connections', async () => {
    const lookup = createSafeHttpLookup(true, false, true);

    assert.equal(requiresDirectSafeHttpConnection(lookup), true);
    await assert.rejects(
      runLookup(lookup, 'localhost'),
      (error) =>
        error instanceof Error && 'code' in error && error.code === 'EACCES'
    );
    await assert.doesNotReject(runLookup(lookup, '192.168.1.50'));
  });

  it('rejects redirects to literal private addresses and unsafe protocols', () => {
    const { beforeRedirect } = createSafeHttpRequestOptions();

    assert.throws(
      () => beforeRedirect({ hostname: '127.0.0.1', protocol: 'http:' }),
      /Refusing to connect/
    );
    assert.throws(
      () => beforeRedirect({ hostname: 'example.com', protocol: 'file:' }),
      /Refusing to connect/
    );
    assert.doesNotThrow(() =>
      beforeRedirect({ hostname: 'example.com', protocol: 'https:' })
    );
  });

  it('rejects loopback redirects while allowing LAN playback targets', () => {
    const { beforeRedirect } = createSafeHttpRequestOptions(
      true,
      false,
      true,
      true
    );

    assert.throws(
      () =>
        beforeRedirect(
          {
            href: 'http://127.0.0.1/redirected',
            hostname: '127.0.0.1',
            protocol: 'http:',
          },
          undefined,
          { url: 'http://127.0.0.1/start' }
        ),
      /Refusing to connect/
    );
    assert.doesNotThrow(() =>
      beforeRedirect(
        {
          href: 'http://192.168.1.50/redirected',
          hostname: '192.168.1.50',
          protocol: 'http:',
        },
        undefined,
        { url: 'http://192.168.1.50/start' }
      )
    );
  });

  it('does not forward custom headers across origins', () => {
    const { beforeRedirect } = createSafeHttpRequestOptions(true);
    const crossOriginHeaders = {
      Accept: 'application/json',
      Authorization: 'Bearer secret',
      'X-Api-Key': 'api-secret',
      'X-Custom-Webhook-Auth': 'custom-secret',
    };

    beforeRedirect(
      {
        href: 'https://other.example/final',
        hostname: 'other.example',
        protocol: 'https:',
        headers: crossOriginHeaders,
      },
      undefined,
      { url: 'https://service.example/start' }
    );

    assert.deepEqual(crossOriginHeaders, { Accept: 'application/json' });
  });

  it('preserves headers on same-origin redirects', () => {
    const { beforeRedirect } = createSafeHttpRequestOptions(true);
    const headers = {
      Authorization: 'Bearer secret',
      'X-Api-Key': 'api-secret',
    };

    beforeRedirect(
      {
        href: 'https://service.example/final',
        hostname: 'service.example',
        protocol: 'https:',
        headers,
      },
      undefined,
      { url: 'https://service.example/start' }
    );

    assert.deepEqual(headers, {
      Authorization: 'Bearer secret',
      'X-Api-Key': 'api-secret',
    });
  });

  it('can reject cross-origin redirects before a request body is resent', () => {
    const { beforeRedirect } = createSafeHttpRequestOptions(true, false);

    assert.throws(
      () =>
        beforeRedirect(
          {
            href: 'https://other.example/final',
            hostname: 'other.example',
            protocol: 'https:',
            headers: { 'Content-Type': 'application/json' },
          },
          undefined,
          { url: 'https://service.example/start' }
        ),
      /cross-origin redirect/
    );
  });
});

describe('isLocalOrPrivateAddress', () => {
  it('rejects non-public IPv4 ranges used to reach internal networks', () => {
    assert.equal(isLocalOrPrivateAddress('100.64.0.1'), true);
    assert.equal(isLocalOrPrivateAddress('198.19.255.255'), true);
    assert.equal(isLocalOrPrivateAddress('224.0.0.1'), true);
    assert.equal(isLocalOrPrivateAddress('192.0.8.1'), false);
    assert.equal(isLocalOrPrivateAddress('8.8.8.8'), false);
  });

  it('recognizes IPv4 embedded in normalized IPv6 addresses', () => {
    assert.equal(isLocalOrPrivateAddress('::ffff:7f00:1'), true);
    assert.equal(isLocalOrPrivateAddress('::ffff:c0a8:101'), true);
    assert.equal(isLocalOrPrivateAddress('::ffff:808:808'), false);
    assert.equal(isLocalOrPrivateAddress('::ffff:0:7f00:1'), true);
    assert.equal(isLocalOrPrivateAddress('64:ff9b::7f00:1'), true);
    assert.equal(isLocalOrPrivateAddress('64:ff9b::808:808'), false);
  });

  it('rejects the complete IPv6 link-local and site-local ranges', () => {
    assert.equal(isLocalOrPrivateAddress('fe80::1'), true);
    assert.equal(isLocalOrPrivateAddress('fe90::1'), true);
    assert.equal(isLocalOrPrivateAddress('febf::1'), true);
    assert.equal(isLocalOrPrivateAddress('fec0::1'), true);
    assert.equal(isLocalOrPrivateAddress('2001:4860:4860::8888'), false);
  });

  it('rejects IPv6 transition, documentation, and discard ranges', () => {
    assert.equal(isLocalOrPrivateAddress('100::1'), true);
    assert.equal(isLocalOrPrivateAddress('64:ff9b:1::1'), true);
    assert.equal(isLocalOrPrivateAddress('2001::1'), true);
    assert.equal(isLocalOrPrivateAddress('2001:db8::1'), true);
    assert.equal(isLocalOrPrivateAddress('2002:7f00:1::1'), true);
    assert.equal(isLocalOrPrivateAddress('3fff::1'), true);
    assert.equal(isLocalOrPrivateAddress('5f00::1'), true);
  });
});

describe('isLoopbackOrLinkLocalAddress', () => {
  it('rejects loopback addresses', () => {
    assert.equal(isLoopbackOrLinkLocalAddress('127.0.0.1'), true);
    assert.equal(isLoopbackOrLinkLocalAddress('127.255.255.255'), true);
    assert.equal(isLoopbackOrLinkLocalAddress('localhost'), true);
    assert.equal(isLoopbackOrLinkLocalAddress('::1'), true);
  });

  it('rejects link-local addresses, including the cloud metadata address', () => {
    assert.equal(isLoopbackOrLinkLocalAddress('169.254.169.254'), true);
    assert.equal(isLoopbackOrLinkLocalAddress('169.254.0.1'), true);
    assert.equal(isLoopbackOrLinkLocalAddress('fe80::1'), true);
  });

  it('allows ordinary LAN addresses used by real player devices', () => {
    assert.equal(isLoopbackOrLinkLocalAddress('192.168.1.50'), false);
    assert.equal(isLoopbackOrLinkLocalAddress('10.0.0.5'), false);
    assert.equal(isLoopbackOrLinkLocalAddress('172.16.4.4'), false);
    assert.equal(isLoopbackOrLinkLocalAddress('8.8.8.8'), false);
    assert.equal(isLoopbackOrLinkLocalAddress('fc00::1'), false);
  });
});

describe('safeStringEqual', () => {
  it('compares equal strings and rejects mismatches without throwing', () => {
    assert.equal(safeStringEqual('secret', 'secret'), true);
    assert.equal(safeStringEqual('secret', 'other'), false);
    assert.equal(safeStringEqual('secret', 'secret1'), false);
    assert.equal(safeStringEqual(undefined, 'secret'), false);
    assert.equal(safeStringEqual('', ''), false);
    assert.equal(safeStringEqual('', 'secret'), false);
  });
});

describe('getRateLimitKey', () => {
  it('does not trust client-supplied forwarded headers directly', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.10' },
      ip: '198.51.100.5',
      socket: { remoteAddress: '198.51.100.6' },
    } as unknown as Request;

    assert.equal(getRateLimitKey(req), '198.51.100.5');
  });

  it('falls back to the socket remote address when Express has no ip', () => {
    const req = {
      headers: {},
      ip: undefined,
      socket: { remoteAddress: '198.51.100.6' },
    } as unknown as Request;

    assert.equal(getRateLimitKey(req), '198.51.100.6');
  });

  it('rejects malformed proxy-derived identifiers as rate-limit keys', () => {
    const req = {
      headers: {},
      ip: 'attacker-controlled-bucket',
      socket: { remoteAddress: '198.51.100.6' },
    } as unknown as Request;

    assert.equal(getRateLimitKey(req), '198.51.100.6');

    const malformedSocket = {
      headers: {},
      ip: 'attacker-controlled-bucket',
      socket: { remoteAddress: 'also-not-an-ip' },
    } as unknown as Request;

    assert.equal(getRateLimitKey(malformedSocket), 'unknown');
  });
});
