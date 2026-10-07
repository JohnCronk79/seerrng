import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import test from 'node:test';
// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths -- Native Node tests cannot resolve application aliases.
import {
  createDistributedTrustedReplayCache,
  DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  distributedTrustedCertificateSha256,
  MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS,
  MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  requestDistributedTrustedJson,
  sealDistributedTrustedEnvelope,
  startDistributedTrustedServer,
  verifyDistributedTrustedEnvelope,
} from '../tools/validation-engine/runtime/distributed-trusted-transport.mjs';

// Test-only self-signed identity for a loopback worker. It protects no real
// system and is intentionally embedded so this suite has no external tools.
const privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDR8guGMsBNjVAY
a9IiuQuz1hmImYv7CG5hrII7JlujH+GOjwAhMLz3MVDk9tVvM6rFovKDo9cDEUvm
E9dG7Jkd4+Zh0cm99OGTyRBWof6X8fTprhhXh1Idic7AnE0dATiWc5Ltu/mRf9Fy
eZPrr7juaPRNw8TeogpLCuKEk3kB5vZtvrM3RAQP5voa2KFe1zZqPxuZ6iA6jKMb
QLWUNLBzWntlNM5uW8izfVEQgcsnv0eaq06sz6cnTUwkVkzBP10w/T7FowQjjVSH
cknUJSu/wLVzC0faWpl6PRr9yH+vufIC18aLSEXJ04/zB83/qoSi8VWhqrl8qo7z
PK5gvKIzAgMBAAECggEAWoWcHXFNhEK9ecInmUwjNRfH66OU/Ri+C0RH5Lwdv+CT
rxWOb0EmAQlVAVxCW8+xvsSK/2KJ5ysyiBIe/NgwDvjAUYYUj+CB0OhdMJVpgldT
i9xCZ58Ts2PDbz4Va7+miAxuGi42JduwUcUFGBaszLMZP1x9SqcgfAnF8Hbrsnr8
7gmdvLew7xFzH8qaRb+sam3hkjM1Q8fm5VWIblJciQpR0EtOvb0ic6q/IXxO6z7L
0w2gUENDrQ1hAxHcmGUdvmyDUiy1MPX265w9jmWDvN7Q599UFIUwQmeBUKXKwkJb
fkoqwyUgVkMKa+tFBvvRKO2PfkN8QGAJ4CYdEbnrKQKBgQDrNuY/xGdmE/4OHeRw
rEVXRBDKlayecOZdR9AS1+S1p9Z2rymTYGD83qNWlp46fw+9uWyKJoqHH1x2SVHN
EMMqD8usTvm1u2y2KC1XcIiIikXvvYbrlozvkFwJVAMk19pOij3WV1aKJIDOhb1+
gSlTdH/lIIo9hRwFgV/0SPHW6wKBgQDkf4Crq07TKmwvDJatU5OT8ejB3tuqDGO/
N5W1nxxh4T8O+XtkW0ypOc3/vyZRD3pTpXK4h9mm/0ir7IWRjpiU/rhCE5YAaWBQ
FVwxLfcT5aV7I2TAiYhAYyAKNdbq6YLvPBYvVgXSm7QA6XoLtVft25UigNr053Np
DPmqaGUf2QKBgQCl0gw8hD/IzOtcFGLJtAkmXkvgJeiNwlYFCO19e0o3bl1ZSl9r
EJUPb/2Cu6hM4Oq9/Ayy0Dz0yX0rvsC2aszLyFrz3LFaFwmq2WQtsp3udFydiOWn
DHnLIeBgiyO0Q6AZooe5pdTSiq1r6wkOOAxkU0sewvPyLvb0QqLc2tfzhQKBgQCX
ihgDwjEcyt3EtkyX1v3g+GatbOex91WP04VuVn+0SnZPsBWtkP9em/+KxXLb/6/Z
GbjjuPUYU+YWX16WEkQPTH9XEzZAP6KoegISe7GJeJwu9mIzbwL18Mem/d3zHbrA
ftEXw61I6AqRMEbIzRPro91cbKjKE1XvLbPG2EV4wQKBgFa7zUihc3qoC+VUR0bc
vH6dbrOqtRL/9N5rC1OmqXzYt3/CdN8QWvQUsXqPY314P/B3rEUDTIBLHgGh8yDV
k2LLFonUPaL3Ghs+fA5GG+NC0AwjNCD7zFK3+TSOhT9yi/PEwXD9eEI27aYJRQ5l
9TLpKPGNplHNWfcgaDxkQKty
-----END PRIVATE KEY-----`;

const certificate = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUc+3C/4S0A+z/uhFMPCyHObrZMZkwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MTAwNjE4MzMwOFoXDTM2MTAw
MzE4MzMwOFowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA0fILhjLATY1QGGvSIrkLs9YZiJmL+whuYayCOyZbox/h
jo8AITC89zFQ5PbVbzOqxaLyg6PXAxFL5hPXRuyZHePmYdHJvfThk8kQVqH+l/H0
6a4YV4dSHYnOwJxNHQE4lnOS7bv5kX/RcnmT66+47mj0TcPE3qIKSwrihJN5Aeb2
bb6zN0QED+b6GtihXtc2aj8bmeogOoyjG0C1lDSwc1p7ZTTOblvIs31REIHLJ79H
mqtOrM+nJ01MJFZMwT9dMP0+xaMEI41Uh3JJ1CUrv8C1cwtH2lqZej0a/ch/r7ny
AtfGi0hFydOP8wfN/6qEovFVoaq5fKqO8zyuYLyiMwIDAQABo28wbTAdBgNVHQ4E
FgQU9uHC3u4s9lS0aMtUPPm8GQBsR/IwHwYDVR0jBBgwFoAU9uHC3u4s9lS0aMtU
PPm8GQBsR/IwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARhwR/AAABgglsb2Nh
bGhvc3QwDQYJKoZIhvcNAQELBQADggEBAIzWJwZsBK2uH0EI6jTZqxc21CR4gGi3
XHQ4/Df3OaCdCCNkBeEs4bVZJ1BY228BaSHXKtGUZfumU4kL2qBLW5dropYv/gSI
Amxjm3OMPhrwy6qnoSAlnRB+joW9LuYZzJTxG/lHsGaMBVCDJHsCPdPjZgtJm7q3
GnHSmprms40bqvh+RYdUmJ00JMs03TGZ6Sf5pXizMRHQ9jbWs7++lrAC1wgXEi0n
zoEhGUOGoT5P7Mr8HpccmhHGGFdbodBOlS1iJP6KRSAD5CCZLNRSvJj+ZIPsWx6V
tPd10ghYNUMdw5xOIFmIz6GGuODhfDT/KVHLJLTP929rc+e3DfYNjVc=
-----END CERTIFICATE-----`;

const secret = Buffer.alloc(32, 0x5a);
const clientId = 'controller-test';
const serverId = 'worker-test';
const certificateSha256 = distributedTrustedCertificateSha256(certificate);

function envelope({
  body = { challenge: 'cold-start' },
  kind = 'fleet.probe',
  requestId,
  nonce,
  signingSecret = secret,
} = {}) {
  return sealDistributedTrustedEnvelope({
    secret: signingSecret,
    senderId: clientId,
    recipientId: serverId,
    kind,
    body,
    ...(requestId === undefined ? {} : { requestId }),
    ...(nonce === undefined ? {} : { nonce }),
  });
}

async function rawPost(origin, path, value) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8');
  const url = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        agent: false,
        rejectUnauthorized: false,
        headers: {
          connection: 'close',
          'content-length': String(encoded.length),
          'content-type': 'application/json',
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.once('error', reject);
        response.once('end', () =>
          resolve({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    request.once('error', reject);
    request.end(encoded);
  });
}

async function workerServer(overrides = {}) {
  return startDistributedTrustedServer({
    key: privateKey,
    certificate,
    secret,
    serverId,
    allowedClientIds: [clientId],
    allowedSourceAddresses: ['127.0.0.1'],
    allowedKinds: ['fleet.probe', 'slow.probe'],
    handler: ({ kind, body }) => ({
      challenge: body.challenge,
      kind,
      logicalCpuCapacity: 12,
      performanceScorePermille: 875,
    }),
    ...overrides,
  });
}

test('real HTTPS probe authenticates cold-start capacity without prior trust', async (t) => {
  const server = await workerServer();
  t.after(() => server.close());
  assert.equal(server.certificateSha256, certificateSha256);

  const result = await requestDistributedTrustedJson({
    origin: server.origin,
    path: server.path,
    secret,
    expectedCertificateSha256: certificateSha256,
    clientId,
    serverId,
    kind: 'fleet.probe',
    body: { challenge: 'probe-001' },
    replayCache: createDistributedTrustedReplayCache(),
  });

  assert.deepEqual(
    { ...result.body },
    {
      challenge: 'probe-001',
      kind: 'fleet.probe',
      logicalCpuCapacity: 12,
      performanceScorePermille: 875,
    }
  );
  assert.equal(result.envelope.requestId.length > 0, true);
  assert.equal(JSON.stringify(result).includes(secret.toString('hex')), false);
  assert.equal(Object.isFrozen(result.envelope), true);
  assert.equal(Object.isFrozen(result.body), true);
});

test('envelope rejects tampering, wrong auth, expiry, and replay', () => {
  const now = Date.now();
  const original = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-auth-001',
    nonce: 'nonce-auth-000001',
    timestampMs: now,
    body: { performanceScorePermille: 875 },
  });
  const verified = verifyDistributedTrustedEnvelope(original, {
    secret,
    replayCache: createDistributedTrustedReplayCache(),
    nowMs: now,
    expectedSenderId: clientId,
    expectedRecipientId: serverId,
    expectedKind: 'fleet.probe',
    expectedRequestId: 'request-auth-001',
  });
  assert.equal(verified.body.performanceScorePermille, 875);

  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(
        { ...original, body: { performanceScorePermille: 999_999 } },
        {
          secret,
          replayCache: createDistributedTrustedReplayCache(),
          nowMs: now,
        }
      ),
    /body hash/
  );
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(original, {
        secret: Buffer.alloc(32, 0x22),
        replayCache: createDistributedTrustedReplayCache(),
        nowMs: now,
      }),
    /proof was rejected/
  );
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(original, {
        secret,
        replayCache: createDistributedTrustedReplayCache(),
        nowMs:
          original.expiresAtMs + DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS + 1,
      }),
    /outside its authentication window/
  );
  const replayCache = createDistributedTrustedReplayCache();
  verifyDistributedTrustedEnvelope(original, {
    secret,
    replayCache,
    nowMs: now,
  });
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(original, {
        secret,
        replayCache,
        nowMs: now,
      }),
    /replayed/
  );
});

test('clock-skew allowance enforces exact boundaries and retains replay state', () => {
  const now = 2_000_000;
  const futureBoundary = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-skew-future-boundary',
    nonce: 'nonce-skew-future-boundary',
    timestampMs: now + DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
    ttlMs: 1_000,
    body: { boundary: 'future' },
  });
  assert.equal(
    verifyDistributedTrustedEnvelope(futureBoundary, {
      secret,
      replayCache: createDistributedTrustedReplayCache(),
      nowMs: now,
    }).body.boundary,
    'future'
  );

  const futureOutside = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-skew-future-outside',
    nonce: 'nonce-skew-future-outside',
    timestampMs: now + DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS + 1,
    ttlMs: 1_000,
    body: { boundary: 'future-outside' },
  });
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(futureOutside, {
        secret,
        replayCache: createDistributedTrustedReplayCache(),
        nowMs: now,
      }),
    /outside its authentication window/
  );

  const expiryBoundary = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-skew-expiry-boundary',
    nonce: 'nonce-skew-expiry-boundary',
    timestampMs: now - DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS - 1_000,
    ttlMs: 1_000,
    body: { boundary: 'expiry' },
  });
  const replayCache = createDistributedTrustedReplayCache();
  assert.equal(
    verifyDistributedTrustedEnvelope(expiryBoundary, {
      secret,
      replayCache,
      nowMs: now,
    }).body.boundary,
    'expiry'
  );
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(expiryBoundary, {
        secret,
        replayCache,
        nowMs: now,
      }),
    /replayed/
  );

  const expiryOutside = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-skew-expiry-outside',
    nonce: 'nonce-skew-expiry-outside',
    timestampMs: now - DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS - 1_000 - 1,
    ttlMs: 1_000,
    body: { boundary: 'expiry-outside' },
  });
  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(expiryOutside, {
        secret,
        replayCache: createDistributedTrustedReplayCache(),
        nowMs: now,
      }),
    /outside its authentication window/
  );

  assert.throws(
    () =>
      verifyDistributedTrustedEnvelope(futureBoundary, {
        secret,
        replayCache: createDistributedTrustedReplayCache(),
        nowMs: now,
        clockSkewMs: 0,
      }),
    /outside its authentication window/
  );
  for (const clockSkewMs of [
    -1,
    0.5,
    MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS + 1,
  ]) {
    assert.throws(
      () =>
        verifyDistributedTrustedEnvelope(futureBoundary, {
          secret,
          replayCache: createDistributedTrustedReplayCache(),
          nowMs: now,
          clockSkewMs,
        }),
      /clock-skew allowance/
    );
  }
});

test('authentication freshness accepts the bounded worker-admission window only', () => {
  const now = 2_000_000;
  const bounded = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind: 'fleet.probe',
    requestId: 'request-auth-window-boundary',
    nonce: 'nonce-auth-window-boundary',
    timestampMs: now,
    ttlMs: MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS,
    body: { boundary: 'maximum' },
  });
  assert.equal(
    verifyDistributedTrustedEnvelope(bounded, {
      secret,
      replayCache: createDistributedTrustedReplayCache(),
      nowMs: now,
    }).body.boundary,
    'maximum'
  );
  assert.throws(
    () =>
      sealDistributedTrustedEnvelope({
        secret,
        senderId: clientId,
        recipientId: serverId,
        kind: 'fleet.probe',
        requestId: 'request-auth-window-outside',
        nonce: 'nonce-auth-window-outside',
        timestampMs: now,
        ttlMs: MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS + 1,
        body: { boundary: 'outside' },
      }),
    /authentication TTL/
  );
});

test('real HTTPS transport tolerates bounded clock skew in both directions', async () => {
  const controllerNow = 2_000_000;
  for (const serverOffsetMs of [-4_000, 4_000]) {
    const server = await workerServer({
      clock: () => controllerNow + serverOffsetMs,
      responseTtlMs: 1_000,
    });
    try {
      const result = await requestDistributedTrustedJson({
        origin: server.origin,
        path: server.path,
        secret,
        expectedCertificateSha256: certificateSha256,
        clientId,
        serverId,
        kind: 'fleet.probe',
        body: { challenge: `offset-${serverOffsetMs}` },
        ttlMs: 1_000,
        replayCache: createDistributedTrustedReplayCache(),
        clock: () => controllerNow,
      });
      assert.equal(result.body.challenge, `offset-${serverOffsetMs}`);
    } finally {
      await server.close();
    }
  }
});

test('clock-skew configuration rejects values above its security bound', async () => {
  await assert.rejects(
    workerServer({
      clockSkewMs: MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS + 1,
    }),
    /clock-skew allowance/
  );

  await assert.rejects(
    requestDistributedTrustedJson({
      origin: 'https://127.0.0.1:1',
      secret,
      expectedCertificateSha256: certificateSha256,
      clientId,
      serverId,
      kind: 'fleet.probe',
      body: { challenge: 'invalid-skew' },
      clockSkewMs: MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS + 1,
      replayCache: createDistributedTrustedReplayCache(),
    }),
    /clock-skew allowance/
  );
});

test('real HTTPS server rejects tampered authentication and replayed requests', async (t) => {
  const server = await workerServer();
  t.after(() => server.close());

  const accepted = envelope({
    requestId: 'request-network-001',
    nonce: 'nonce-network-000001',
  });
  assert.equal(
    (await rawPost(server.origin, server.path, accepted)).statusCode,
    200
  );
  assert.equal(
    (await rawPost(server.origin, server.path, accepted)).statusCode,
    409
  );

  const tampered = envelope({
    requestId: 'request-network-002',
    nonce: 'nonce-network-000002',
  });
  assert.equal(
    (
      await rawPost(server.origin, server.path, {
        ...tampered,
        body: { challenge: 'changed-after-signing' },
      })
    ).statusCode,
    401
  );

  const unauthenticated = envelope({
    requestId: 'request-network-003',
    nonce: 'nonce-network-000003',
    signingSecret: Buffer.alloc(32, 0x22),
  });
  assert.equal(
    (await rawPost(server.origin, server.path, unauthenticated)).statusCode,
    401
  );
});

test('client pins the worker certificate before sending its authenticated body', async (t) => {
  let handled = 0;
  const server = await workerServer({
    handler: () => {
      handled += 1;
      return { ok: true };
    },
  });
  t.after(() => server.close());

  await assert.rejects(
    requestDistributedTrustedJson({
      origin: server.origin,
      secret,
      expectedCertificateSha256: '0'.repeat(64),
      clientId,
      serverId,
      kind: 'fleet.probe',
      body: { challenge: 'must-not-send' },
      replayCache: createDistributedTrustedReplayCache(),
    }),
    (error) => error.code === 'ERR_DISTRIBUTED_TRANSPORT_PIN'
  );
  assert.equal(handled, 0);
});

test('request and response byte limits fail closed', async (t) => {
  const server = await workerServer({
    maxRequestBytes: 2048,
    handler: ({ body }) =>
      body.challenge === 'large-response'
        ? { result: 'x'.repeat(4096) }
        : { ok: true },
  });
  t.after(() => server.close());

  await assert.rejects(
    requestDistributedTrustedJson({
      origin: server.origin,
      secret,
      expectedCertificateSha256: certificateSha256,
      clientId,
      serverId,
      kind: 'fleet.probe',
      body: { oversized: 'x'.repeat(4096) },
      maxRequestBytes: 2048,
      replayCache: createDistributedTrustedReplayCache(),
    }),
    /exceeds 2048 bytes/
  );

  const oversized = envelope({
    requestId: 'request-size-0001',
    nonce: 'nonce-size-00000001',
    body: { oversized: 'x'.repeat(4096) },
  });
  assert.equal(
    (await rawPost(server.origin, server.path, oversized)).statusCode,
    413
  );

  await assert.rejects(
    requestDistributedTrustedJson({
      origin: server.origin,
      secret,
      expectedCertificateSha256: certificateSha256,
      clientId,
      serverId,
      kind: 'fleet.probe',
      body: { challenge: 'large-response' },
      maxResponseBytes: 1024,
      replayCache: createDistributedTrustedReplayCache(),
    }),
    /response has an invalid length/
  );
});

test('timeout and abort reach the live server handler signal', async (t) => {
  let serverAborts = 0;
  const server = await workerServer({
    handler: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            serverAborts += 1;
            reject(new Error('request disconnected'));
          },
          { once: true }
        );
      }),
  });
  t.after(() => server.close());

  await assert.rejects(
    requestDistributedTrustedJson({
      origin: server.origin,
      secret,
      expectedCertificateSha256: certificateSha256,
      clientId,
      serverId,
      kind: 'slow.probe',
      body: { challenge: 'timeout' },
      timeoutMs: 40,
      replayCache: createDistributedTrustedReplayCache(),
    }),
    (error) => error.code === 'ERR_DISTRIBUTED_TRANSPORT_TIMEOUT'
  );

  const controller = new AbortController();
  const pending = requestDistributedTrustedJson({
    origin: server.origin,
    secret,
    expectedCertificateSha256: certificateSha256,
    clientId,
    serverId,
    kind: 'slow.probe',
    body: { challenge: 'abort' },
    timeoutMs: 1000,
    signal: controller.signal,
    replayCache: createDistributedTrustedReplayCache(),
  });
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(
    pending,
    (error) =>
      error.name === 'AbortError' &&
      error.code === 'ERR_DISTRIBUTED_TRANSPORT_ABORTED'
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(serverAborts, 2);
});

test('server source-IP allowlist is enforced before authentication', async (t) => {
  let handled = 0;
  const server = await workerServer({
    allowedSourceAddresses: ['192.0.2.1'],
    handler: () => {
      handled += 1;
      return { ok: true };
    },
  });
  t.after(() => server.close());
  const result = await rawPost(
    server.origin,
    server.path,
    envelope({
      requestId: 'request-allowlist-001',
      nonce: 'nonce-allowlist-0001',
    })
  );
  assert.equal(result.statusCode, 403);
  assert.equal(handled, 0);
});

test('server close is idempotent and aborts an active handler cleanly', async () => {
  let aborted = false;
  const server = await workerServer({
    closeGraceMs: 100,
    handler: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('server closing'));
          },
          { once: true }
        );
      }),
  });
  const pending = requestDistributedTrustedJson({
    origin: server.origin,
    secret,
    expectedCertificateSha256: certificateSha256,
    clientId,
    serverId,
    kind: 'slow.probe',
    body: { challenge: 'close' },
    timeoutMs: 1000,
    replayCache: createDistributedTrustedReplayCache(),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const rejected = assert.rejects(pending);
  const firstClose = server.close();
  assert.equal(server.close(), firstClose);
  await firstClose;
  await rejected;
  assert.equal(aborted, true);
});
