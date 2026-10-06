// Copyright (c) snapetech and SeerrNG contributors.
// Minimal authenticated HTTPS transport for a trusted distributed test fleet.
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  X509Certificate,
} from 'node:crypto';
import { createServer, request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export const DISTRIBUTED_TRUSTED_TRANSPORT_SCHEMA =
  'seerrng-distributed-trusted-transport/v1';
export const DISTRIBUTED_TRUSTED_TRANSPORT_PATH = '/engine/v1';
export const MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS = 60_000;
export const DEFAULT_DISTRIBUTED_TRUSTED_AUTH_TTL_MS = 30_000;
export const MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS = 5_000;
export const DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS = 5_000;
export const DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES = 1024 * 1024;
export const MAX_DISTRIBUTED_TRUSTED_BODY_BYTES = 32 * 1024 * 1024;

const HASH64 = /^[a-f0-9]{64}$/;
const PROOF = /^[A-Za-z0-9_-]{43}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KIND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const ENVELOPE_KEYS = [
  'body',
  'bodySha256',
  'expiresAtMs',
  'kind',
  'nonce',
  'proof',
  'recipientId',
  'requestId',
  'schema',
  'senderId',
  'timestampMs',
];
const replayCaches = new WeakSet();

function transportError(message, code) {
  return Object.assign(new Error(message), { code });
}

function safeInteger(
  value,
  label,
  { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${label} must be a safe integer from ${minimum} through ${maximum}`
    );
  return value;
}

function boundedBytes(value, label) {
  return safeInteger(value, label, {
    minimum: 1,
    maximum: MAX_DISTRIBUTED_TRUSTED_BODY_BYTES,
  });
}

function exactToken(value, label, pattern = TOKEN) {
  if (
    typeof value !== 'string' ||
    !pattern.test(value) ||
    value.normalize('NFC') !== value
  )
    throw new Error(`Exact ${label} is required`);
  return value;
}

function exactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`${label} must be a plain object`);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string'))
    throw new Error(`${label} requires its exact field set`);
  const sorted = actual.toSorted();
  const wanted = [...expected].toSorted();
  if (
    sorted.length !== wanted.length ||
    sorted.some((key, index) => key !== wanted[index])
  )
    throw new Error(`${label} requires its exact field set`);
  return value;
}

function canonicalValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.normalize('NFC') !== value)
      throw new Error('Transport JSON strings must be canonical NFC text');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Transport JSON numbers must be finite');
    if (Number.isInteger(value) && !Number.isSafeInteger(value))
      throw new Error('Transport JSON integers must be safe integers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (!value || typeof value !== 'object')
    throw new Error('Transport bodies must contain JSON values only');
  if (seen.has(value)) throw new Error('Transport JSON must not be cyclic');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length)
        throw new Error('Transport JSON arrays must be dense');
      return value.map((entry) => canonicalValue(entry, seen));
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new Error('Transport JSON objects must be plain objects');
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string'))
      throw new Error('Transport JSON objects require string keys');
    const normalized = Object.create(null);
    for (const key of keys.toSorted()) {
      if (key.normalize('NFC') !== key)
        throw new Error('Transport JSON keys must be canonical NFC text');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor))
        throw new Error(
          'Transport JSON objects require enumerable data fields'
        );
      normalized[key] = canonicalValue(descriptor.value, seen);
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function secretBytes(value) {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < 32 ||
    value.byteLength > 1024
  )
    throw new Error('Distributed transport secret must be 32..1024 bytes');
  return Buffer.from(value);
}

function unsignedEnvelope(value) {
  const unsigned = { ...value };
  delete unsigned.proof;
  return unsigned;
}

function envelopeProof(secret, value) {
  const key = secretBytes(secret);
  try {
    return createHmac('sha256', key)
      .update(canonicalJson(unsignedEnvelope(value)))
      .digest('base64url');
  } finally {
    key.fill(0);
  }
}

function normalizedBody(value) {
  return deepFreeze(canonicalValue(value));
}

function normalizeEnvelope(value, maximumBytes) {
  exactKeys(value, ENVELOPE_KEYS, 'distributed transport envelope');
  if (value.schema !== DISTRIBUTED_TRUSTED_TRANSPORT_SCHEMA)
    throw new Error('Unsupported distributed transport schema');
  const body = normalizedBody(value.body);
  const bodySha256 = sha256(canonicalJson(body));
  if (value.bodySha256 !== bodySha256)
    throw transportError(
      'Distributed transport body hash does not match its contents',
      'ERR_DISTRIBUTED_TRANSPORT_AUTH'
    );
  const timestampMs = safeInteger(value.timestampMs, 'Transport timestamp');
  const expiresAtMs = safeInteger(value.expiresAtMs, 'Transport expiry');
  if (
    expiresAtMs <= timestampMs ||
    expiresAtMs - timestampMs > MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS
  )
    throw new Error('Distributed transport authentication window is invalid');
  if (typeof value.proof !== 'string' || !PROOF.test(value.proof))
    throw transportError(
      'Exact distributed transport proof is required',
      'ERR_DISTRIBUTED_TRANSPORT_AUTH'
    );
  const normalized = {
    schema: DISTRIBUTED_TRUSTED_TRANSPORT_SCHEMA,
    senderId: exactToken(value.senderId, 'transport sender ID'),
    recipientId: exactToken(value.recipientId, 'transport recipient ID'),
    kind: exactToken(value.kind, 'transport message kind', KIND),
    requestId: exactToken(value.requestId, 'transport request ID'),
    timestampMs,
    expiresAtMs,
    nonce: exactToken(value.nonce, 'transport nonce', NONCE),
    bodySha256,
    body,
    proof: value.proof,
  };
  if (Buffer.byteLength(canonicalJson(normalized), 'utf8') > maximumBytes)
    throw transportError(
      `Distributed transport envelope exceeds ${maximumBytes} bytes`,
      'ERR_DISTRIBUTED_TRANSPORT_SIZE'
    );
  return normalized;
}

function normalizeMaximum(value, label) {
  return boundedBytes(value ?? DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES, label);
}

function normalizeClockSkew(value) {
  return safeInteger(value, 'Transport clock-skew allowance', {
    maximum: MAX_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  });
}

export function createDistributedTrustedReplayCache({
  maxEntries = 16_384,
} = {}) {
  safeInteger(maxEntries, 'Replay-cache entry limit', {
    minimum: 2,
    maximum: 1_000_000,
  });
  const entries = new Map();
  const cache = Object.freeze({
    consume({ senderId, requestId, nonce, expiresAtMs, nowMs }) {
      safeInteger(nowMs, 'Replay-cache clock');
      for (const [key, expiry] of entries)
        if (expiry < nowMs) entries.delete(key);
      const keys = [
        `nonce:${senderId}:${nonce}`,
        `request:${senderId}:${requestId}`,
      ];
      if (keys.some((key) => entries.has(key)))
        throw transportError(
          'Distributed transport envelope was replayed',
          'ERR_DISTRIBUTED_TRANSPORT_REPLAY'
        );
      if (entries.size + keys.length > maxEntries)
        throw transportError(
          'Distributed transport replay cache is full',
          'ERR_DISTRIBUTED_TRANSPORT_REPLAY_CAPACITY'
        );
      for (const key of keys) entries.set(key, expiresAtMs);
    },
    size(nowMs = Date.now()) {
      safeInteger(nowMs, 'Replay-cache inspection clock');
      for (const [key, expiry] of entries)
        if (expiry < nowMs) entries.delete(key);
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  });
  replayCaches.add(cache);
  return cache;
}

export function sealDistributedTrustedEnvelope({
  secret,
  senderId,
  recipientId,
  kind,
  body,
  requestId = randomUUID(),
  nonce = randomBytes(24).toString('base64url'),
  timestampMs = Date.now(),
  ttlMs = DEFAULT_DISTRIBUTED_TRUSTED_AUTH_TTL_MS,
  maximumBytes = DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES,
}) {
  const limit = normalizeMaximum(maximumBytes, 'Transport envelope byte limit');
  const timestamp = safeInteger(timestampMs, 'Transport timestamp');
  const ttl = safeInteger(ttlMs, 'Transport authentication TTL', {
    minimum: 1,
    maximum: MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS,
  });
  const normalized = {
    schema: DISTRIBUTED_TRUSTED_TRANSPORT_SCHEMA,
    senderId: exactToken(senderId, 'transport sender ID'),
    recipientId: exactToken(recipientId, 'transport recipient ID'),
    kind: exactToken(kind, 'transport message kind', KIND),
    requestId: exactToken(requestId, 'transport request ID'),
    timestampMs: timestamp,
    expiresAtMs: timestamp + ttl,
    nonce: exactToken(nonce, 'transport nonce', NONCE),
    bodySha256: '',
    body: normalizedBody(body),
    proof: 'A'.repeat(43),
  };
  normalized.bodySha256 = sha256(canonicalJson(normalized.body));
  normalized.proof = envelopeProof(secret, normalized);
  return deepFreeze(normalizeEnvelope(normalized, limit));
}

export function verifyDistributedTrustedEnvelope(
  value,
  {
    secret,
    replayCache,
    nowMs = Date.now(),
    expectedSenderId,
    expectedRecipientId,
    expectedKind,
    expectedRequestId,
    maximumBytes = DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES,
    clockSkewMs = DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  }
) {
  if (!replayCaches.has(replayCache))
    throw new Error('A trusted distributed replay cache is required');
  const limit = normalizeMaximum(maximumBytes, 'Transport envelope byte limit');
  const clockSkew = normalizeClockSkew(clockSkewMs);
  const envelope = normalizeEnvelope(value, limit);
  const now = safeInteger(nowMs, 'Transport verification clock');
  if (
    envelope.timestampMs - now > clockSkew ||
    now - envelope.expiresAtMs > clockSkew
  )
    throw transportError(
      'Distributed transport envelope is outside its authentication window',
      'ERR_DISTRIBUTED_TRANSPORT_AUTH'
    );
  for (const [actual, expected, label, pattern] of [
    [envelope.senderId, expectedSenderId, 'sender ID', TOKEN],
    [envelope.recipientId, expectedRecipientId, 'recipient ID', TOKEN],
    [envelope.kind, expectedKind, 'message kind', KIND],
    [envelope.requestId, expectedRequestId, 'request ID', TOKEN],
  ]) {
    if (
      expected !== undefined &&
      actual !== exactToken(expected, `expected ${label}`, pattern)
    )
      throw transportError(
        `Distributed transport ${label} does not match`,
        'ERR_DISTRIBUTED_TRANSPORT_AUTH'
      );
  }
  const supplied = Buffer.from(envelope.proof, 'base64url');
  const expected = Buffer.from(envelopeProof(secret, envelope), 'base64url');
  const accepted =
    supplied.length === expected.length && timingSafeEqual(supplied, expected);
  supplied.fill(0);
  expected.fill(0);
  if (!accepted)
    throw transportError(
      'Distributed transport authentication proof was rejected',
      'ERR_DISTRIBUTED_TRANSPORT_AUTH'
    );
  replayCache.consume({
    senderId: envelope.senderId,
    requestId: envelope.requestId,
    nonce: envelope.nonce,
    expiresAtMs:
      envelope.expiresAtMs > Number.MAX_SAFE_INTEGER - clockSkew
        ? Number.MAX_SAFE_INTEGER
        : envelope.expiresAtMs + clockSkew,
    nowMs: now,
  });
  return deepFreeze(envelope);
}

export function distributedTrustedCertificateSha256(certificate) {
  let parsed;
  try {
    parsed = new X509Certificate(certificate);
  } catch {
    throw new Error('Exact worker TLS certificate is required');
  }
  return sha256(parsed.raw);
}

function normalizeIpAddress(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value)
    throw new Error(`Exact ${label} is required`);
  let address = value;
  const zone = address.indexOf('%');
  if (zone !== -1) address = address.slice(0, zone);
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4)
    address = address.slice(7);
  if (!isIP(address)) throw new Error(`${label} must be an IP address`);
  return address.toLowerCase();
}

function normalizeStringSet(values, label, normalizer) {
  if (!Array.isArray(values) || values.length === 0)
    throw new Error(`${label} must be a nonempty array`);
  const normalized = values.map((value) => normalizer(value, label));
  if (new Set(normalized).size !== normalized.length)
    throw new Error(`${label} must not contain duplicates`);
  return new Set(normalized);
}

function normalizePath(value) {
  if (
    typeof value !== 'string' ||
    !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,1023}$/.test(value) ||
    value.includes('//') ||
    value.includes('?') ||
    value.includes('#')
  )
    throw new Error('Exact distributed transport URL path is required');
  return value;
}

function requestOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Worker origin must be a canonical HTTPS origin');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.origin !== value ||
    !parsed.hostname
  )
    throw new Error('Worker origin must be a canonical HTTPS origin');
  return parsed;
}

function sendEmpty(response, statusCode) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    connection: 'close',
    'content-length': '0',
  });
  response.end();
}

async function readJsonRequest(request, maximumBytes) {
  const contentType = request.headers['content-type'];
  if (contentType !== 'application/json')
    throw transportError(
      'Distributed transport requires application/json',
      'ERR_DISTRIBUTED_TRANSPORT_CONTENT_TYPE'
    );
  const length = request.headers['content-length'];
  if (typeof length !== 'string' || !/^[1-9]\d*$/.test(length))
    throw transportError(
      'Distributed transport requires an exact content length',
      'ERR_DISTRIBUTED_TRANSPORT_LENGTH'
    );
  const expected = Number(length);
  if (!Number.isSafeInteger(expected) || expected > maximumBytes)
    throw transportError(
      'Distributed transport request is too large',
      'ERR_DISTRIBUTED_TRANSPORT_SIZE'
    );
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maximumBytes)
      throw transportError(
        'Distributed transport request is too large',
        'ERR_DISTRIBUTED_TRANSPORT_SIZE'
      );
    chunks.push(chunk);
  }
  if (received !== expected)
    throw transportError(
      'Distributed transport request length is incomplete',
      'ERR_DISTRIBUTED_TRANSPORT_LENGTH'
    );
  try {
    return JSON.parse(Buffer.concat(chunks, received).toString('utf8'));
  } catch {
    throw transportError(
      'Distributed transport request is not valid JSON',
      'ERR_DISTRIBUTED_TRANSPORT_JSON'
    );
  }
}

function responseKind(kind) {
  return exactToken(`${kind}.response`, 'transport response kind', KIND);
}

function formattedHost(host) {
  return isIP(host) === 6 ? `[${host}]` : host;
}

export async function startDistributedTrustedServer({
  key,
  certificate,
  secret,
  serverId,
  allowedClientIds,
  allowedSourceAddresses,
  allowedKinds,
  handler,
  host = '127.0.0.1',
  port = 0,
  path = DISTRIBUTED_TRUSTED_TRANSPORT_PATH,
  maxRequestBytes = DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES,
  maxResponseBytes = DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES,
  responseTtlMs = DEFAULT_DISTRIBUTED_TRUSTED_AUTH_TTL_MS,
  clockSkewMs = DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  replayCache = createDistributedTrustedReplayCache(),
  clock = Date.now,
  closeGraceMs = 1000,
}) {
  if (typeof handler !== 'function')
    throw new Error('Distributed transport server requires a handler');
  if (typeof clock !== 'function')
    throw new Error('Distributed transport server requires a clock');
  const id = exactToken(serverId, 'transport server ID');
  const clients = normalizeStringSet(
    allowedClientIds,
    'Allowed transport client IDs',
    (value) => exactToken(value, 'allowed transport client ID')
  );
  const sources = normalizeStringSet(
    allowedSourceAddresses,
    'Allowed transport source addresses',
    normalizeIpAddress
  );
  const kinds = normalizeStringSet(
    allowedKinds,
    'Allowed transport message kinds',
    (value) => exactToken(value, 'allowed transport message kind', KIND)
  );
  if (!replayCaches.has(replayCache))
    throw new Error('A trusted distributed replay cache is required');
  const bindHost = normalizeIpAddress(host, 'transport bind host');
  safeInteger(port, 'Transport listen port', { maximum: 65_535 });
  const route = normalizePath(path);
  const requestLimit = normalizeMaximum(maxRequestBytes, 'Request byte limit');
  const responseLimit = normalizeMaximum(
    maxResponseBytes,
    'Response byte limit'
  );
  const ttl = safeInteger(responseTtlMs, 'Response authentication TTL', {
    minimum: 1,
    maximum: MAX_DISTRIBUTED_TRUSTED_AUTH_WINDOW_MS,
  });
  const clockSkew = normalizeClockSkew(clockSkewMs);
  safeInteger(closeGraceMs, 'Transport close grace', {
    minimum: 1,
    maximum: 60_000,
  });
  const retainedSecret = secretBytes(secret);
  const certificateSha256 = distributedTrustedCertificateSha256(certificate);
  const sockets = new Set();
  const active = new Set();
  let closing = false;

  const server = createServer(
    { key, cert: certificate, minVersion: 'TLSv1.2' },
    async (request, response) => {
      let remoteAddress;
      try {
        remoteAddress = normalizeIpAddress(
          request.socket.remoteAddress ?? '',
          'remote source address'
        );
      } catch {
        sendEmpty(response, 403);
        request.resume();
        return;
      }
      if (!sources.has(remoteAddress)) {
        sendEmpty(response, 403);
        request.resume();
        return;
      }
      if (request.method !== 'POST') {
        sendEmpty(response, 405);
        request.resume();
        return;
      }
      if (request.url !== route) {
        sendEmpty(response, 404);
        request.resume();
        return;
      }
      const controller = new AbortController();
      active.add(controller);
      let authenticated = false;
      const abort = () => controller.abort();
      request.once('aborted', abort);
      response.once('close', () => {
        if (!response.writableEnded) abort();
      });
      try {
        const raw = await readJsonRequest(request, requestLimit);
        if (!clients.has(raw?.senderId) || !kinds.has(raw?.kind))
          throw transportError(
            'Distributed transport sender or kind is not allowed',
            'ERR_DISTRIBUTED_TRANSPORT_AUTH'
          );
        const envelope = verifyDistributedTrustedEnvelope(raw, {
          secret: retainedSecret,
          replayCache,
          nowMs: clock(),
          expectedSenderId: raw.senderId,
          expectedRecipientId: id,
          expectedKind: raw.kind,
          maximumBytes: requestLimit,
          clockSkewMs: clockSkew,
        });
        authenticated = true;
        if (closing || controller.signal.aborted)
          throw transportError(
            'Distributed transport server is closing',
            'ERR_DISTRIBUTED_TRANSPORT_ABORTED'
          );
        const body = await handler({
          kind: envelope.kind,
          body: envelope.body,
          envelope,
          remoteAddress,
          signal: controller.signal,
        });
        if (closing || controller.signal.aborted || response.destroyed) return;
        const sealed = sealDistributedTrustedEnvelope({
          secret: retainedSecret,
          senderId: id,
          recipientId: envelope.senderId,
          kind: responseKind(envelope.kind),
          requestId: envelope.requestId,
          timestampMs: clock(),
          ttlMs: ttl,
          body,
          maximumBytes: responseLimit,
        });
        const encoded = Buffer.from(JSON.stringify(sealed), 'utf8');
        if (encoded.length > responseLimit)
          throw transportError(
            'Distributed transport response is too large',
            'ERR_DISTRIBUTED_TRANSPORT_SIZE'
          );
        response.writeHead(200, {
          'cache-control': 'no-store',
          connection: 'close',
          'content-length': String(encoded.length),
          'content-type': 'application/json',
        });
        response.end(encoded);
      } catch (error) {
        if (closing || controller.signal.aborted) {
          response.destroy();
          return;
        }
        const status =
          error.code === 'ERR_DISTRIBUTED_TRANSPORT_REPLAY'
            ? 409
            : error.code === 'ERR_DISTRIBUTED_TRANSPORT_SIZE'
              ? 413
              : error.code === 'ERR_DISTRIBUTED_TRANSPORT_CONTENT_TYPE'
                ? 415
                : error.code === 'ERR_DISTRIBUTED_TRANSPORT_LENGTH'
                  ? 411
                  : error.code === 'ERR_DISTRIBUTED_TRANSPORT_JSON'
                    ? 400
                    : error.code === 'ERR_DISTRIBUTED_TRANSPORT_AUTH' ||
                        !authenticated
                      ? 401
                      : 500;
        sendEmpty(response, status);
      } finally {
        active.delete(controller);
        request.removeListener('aborted', abort);
      }
    }
  );
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('tlsClientError', (_error, socket) => socket.destroy());

  try {
    await new Promise((resolveListen, rejectListen) => {
      const fail = (error) => rejectListen(error);
      server.once('error', fail);
      server.listen(port, bindHost, () => {
        server.removeListener('error', fail);
        resolveListen();
      });
    });
  } catch (error) {
    retainedSecret.fill(0);
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    retainedSecret.fill(0);
    server.close();
    throw new Error('Distributed transport server address is unavailable');
  }
  let closePromise;
  const close = () => {
    if (closePromise) return closePromise;
    closing = true;
    for (const controller of active) controller.abort();
    closePromise = new Promise((resolveClose, rejectClose) => {
      const force = setTimeout(() => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections?.();
      }, closeGraceMs);
      force.unref?.();
      server.close((error) => {
        clearTimeout(force);
        retainedSecret.fill(0);
        replayCache.clear();
        if (error) rejectClose(error);
        else resolveClose();
      });
      server.closeIdleConnections?.();
    });
    return closePromise;
  };
  return Object.freeze({
    origin: `https://${formattedHost(bindHost)}:${address.port}`,
    path: route,
    certificateSha256,
    close,
  });
}

function abortError(message = 'Distributed transport request was aborted') {
  return Object.assign(new Error(message), {
    name: 'AbortError',
    code: 'ERR_DISTRIBUTED_TRANSPORT_ABORTED',
  });
}

function timeoutError() {
  return transportError(
    'Distributed transport request timed out',
    'ERR_DISTRIBUTED_TRANSPORT_TIMEOUT'
  );
}

function collectHttpsResponse(response, maximumBytes) {
  return new Promise((resolveResponse, rejectResponse) => {
    const contentLength = response.headers['content-length'];
    if (
      typeof contentLength !== 'string' ||
      !/^\d+$/.test(contentLength) ||
      Number(contentLength) > maximumBytes
    ) {
      response.destroy();
      rejectResponse(
        transportError(
          'Distributed transport response has an invalid length',
          'ERR_DISTRIBUTED_TRANSPORT_SIZE'
        )
      );
      return;
    }
    const chunks = [];
    let received = 0;
    response.on('data', (chunk) => {
      received += chunk.length;
      if (received > maximumBytes) {
        response.destroy(
          transportError(
            'Distributed transport response is too large',
            'ERR_DISTRIBUTED_TRANSPORT_SIZE'
          )
        );
        return;
      }
      chunks.push(chunk);
    });
    response.once('error', rejectResponse);
    response.once('end', () => {
      if (received !== Number(contentLength)) {
        rejectResponse(
          transportError(
            'Distributed transport response length is incomplete',
            'ERR_DISTRIBUTED_TRANSPORT_SIZE'
          )
        );
        return;
      }
      resolveResponse(Buffer.concat(chunks, received));
    });
  });
}

export async function requestDistributedTrustedJson({
  origin,
  path = DISTRIBUTED_TRUSTED_TRANSPORT_PATH,
  secret,
  expectedCertificateSha256,
  clientId,
  serverId,
  kind,
  body,
  timeoutMs = 30_000,
  signal,
  requestId,
  nonce,
  timestampMs,
  ttlMs = DEFAULT_DISTRIBUTED_TRUSTED_AUTH_TTL_MS,
  maxRequestBytes = DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES,
  maxResponseBytes = DEFAULT_DISTRIBUTED_TRUSTED_BODY_BYTES,
  clockSkewMs = DEFAULT_DISTRIBUTED_TRUSTED_CLOCK_SKEW_MS,
  replayCache,
  clock = Date.now,
}) {
  if (!replayCaches.has(replayCache))
    throw new Error('A trusted distributed replay cache is required');
  if (typeof clock !== 'function')
    throw new Error('Distributed transport client requires a clock');
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new Error('Distributed transport signal must be an AbortSignal');
  if (signal?.aborted) throw abortError();
  const parsed = requestOrigin(origin);
  const hostname =
    parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
  const route = normalizePath(path);
  const requestLimit = normalizeMaximum(maxRequestBytes, 'Request byte limit');
  const responseLimit = normalizeMaximum(
    maxResponseBytes,
    'Response byte limit'
  );
  const clockSkew = normalizeClockSkew(clockSkewMs);
  safeInteger(timeoutMs, 'Transport request timeout', {
    minimum: 1,
    maximum: 24 * 60 * 60 * 1000,
  });
  if (
    typeof expectedCertificateSha256 !== 'string' ||
    !HASH64.test(expectedCertificateSha256)
  )
    throw new Error('Exact worker certificate SHA-256 fingerprint is required');
  const envelope = sealDistributedTrustedEnvelope({
    secret,
    senderId: clientId,
    recipientId: serverId,
    kind,
    body,
    ...(requestId === undefined ? {} : { requestId }),
    ...(nonce === undefined ? {} : { nonce }),
    timestampMs: timestampMs === undefined ? clock() : timestampMs,
    ttlMs,
    maximumBytes: requestLimit,
  });
  const encoded = Buffer.from(JSON.stringify(envelope), 'utf8');
  if (encoded.length > requestLimit)
    throw transportError(
      'Distributed transport request is too large',
      'ERR_DISTRIBUTED_TRANSPORT_SIZE'
    );

  return new Promise((resolveRequest, rejectRequest) => {
    let settled = false;
    let pinned = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (error) rejectRequest(error);
      else resolveRequest(result);
    };
    const abort = () => request.destroy(abortError());
    const request = httpsRequest(
      {
        protocol: 'https:',
        hostname,
        port: parsed.port || 443,
        path: route,
        method: 'POST',
        agent: false,
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2',
        headers: {
          accept: 'application/json',
          'cache-control': 'no-store',
          connection: 'close',
          'content-length': String(encoded.length),
          'content-type': 'application/json',
        },
      },
      async (response) => {
        try {
          if (!pinned)
            throw transportError(
              'Worker certificate was not pinned before its response',
              'ERR_DISTRIBUTED_TRANSPORT_PIN'
            );
          const payload = await collectHttpsResponse(response, responseLimit);
          if (response.statusCode !== 200)
            throw transportError(
              `Distributed transport request failed with HTTP ${response.statusCode}`,
              'ERR_DISTRIBUTED_TRANSPORT_HTTP'
            );
          if (response.headers['content-type'] !== 'application/json')
            throw transportError(
              'Distributed transport response is not application/json',
              'ERR_DISTRIBUTED_TRANSPORT_CONTENT_TYPE'
            );
          let decoded;
          try {
            decoded = JSON.parse(payload.toString('utf8'));
          } catch {
            throw transportError(
              'Distributed transport response is not valid JSON',
              'ERR_DISTRIBUTED_TRANSPORT_JSON'
            );
          }
          const verified = verifyDistributedTrustedEnvelope(decoded, {
            secret,
            replayCache,
            nowMs: clock(),
            expectedSenderId: serverId,
            expectedRecipientId: clientId,
            expectedKind: responseKind(kind),
            expectedRequestId: envelope.requestId,
            maximumBytes: responseLimit,
            clockSkewMs: clockSkew,
          });
          finish(
            null,
            Object.freeze({
              body: verified.body,
              envelope: verified,
              statusCode: response.statusCode,
            })
          );
        } catch (error) {
          finish(error);
        }
      }
    );
    const timeout = setTimeout(
      () => request.destroy(timeoutError()),
      timeoutMs
    );
    timeout.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    request.once('error', (error) => finish(error));
    request.once('socket', (socket) => {
      const verifyPin = () => {
        try {
          const peer = socket.getPeerCertificate(true);
          if (!peer?.raw)
            throw transportError(
              'Worker did not provide a TLS certificate',
              'ERR_DISTRIBUTED_TRANSPORT_PIN'
            );
          const actual = sha256(peer.raw);
          const supplied = Buffer.from(actual, 'hex');
          const expected = Buffer.from(expectedCertificateSha256, 'hex');
          const matches =
            supplied.length === expected.length &&
            timingSafeEqual(supplied, expected);
          supplied.fill(0);
          expected.fill(0);
          if (!matches)
            throw transportError(
              'Worker TLS certificate fingerprint does not match configuration',
              'ERR_DISTRIBUTED_TRANSPORT_PIN'
            );
          pinned = true;
          request.end(encoded);
        } catch (error) {
          request.destroy(error);
        }
      };
      if (socket.encrypted && !socket.connecting) verifyPin();
      else socket.once('secureConnect', verifyPin);
    });
  });
}
