import type { AddressFamily, LookupAddress as AxiosLookupAddress } from 'axios';
import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import net from 'net';
import { timingSafeEqual } from 'node:crypto';
import {
  lookup as dnsLookup,
  type LookupAddress,
  type LookupOptions,
} from 'node:dns';
import dns from 'node:dns/promises';

const SECRET_KEY_PATTERN =
  /(api[-_]?key|private[-_]?key|vapidPrivate|credential|token|secret|password|(?<!by)pass|authorization|(?:^|[-_])auth(?:$|[-_])|cookie|authHeader|webhookUrl|accessToken|userToken|botAPI|smtpHost|authUser|authPass|pgpPrivateKey|pgpPassword)/i;

export const isSecretFieldName = (value: string): boolean =>
  SECRET_KEY_PATTERN.test(value);

export const REDACTED_SECRET = '[REDACTED]';
const REDACTION_MAX_DEPTH = 32;
const REDACTION_MAX_NODES = 5_000;
const REDACTION_TRUNCATED = '[TRUNCATED]';
const REDACTION_CIRCULAR = '[CIRCULAR]';

const CROSS_ORIGIN_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-encoding',
  'user-agent',
]);

export const redactSecrets = <T>(value: T): T => {
  const ancestors = new WeakSet<object>();
  const nodes = { count: 0 };

  const redact = (item: unknown, depth: number): unknown => {
    if (!item || typeof item !== 'object') {
      return item;
    }
    if (Buffer.isBuffer(item)) {
      return `[Buffer ${item.length} bytes]`;
    }
    if (depth > REDACTION_MAX_DEPTH || nodes.count >= REDACTION_MAX_NODES) {
      return REDACTION_TRUNCATED;
    }
    if (ancestors.has(item)) {
      return REDACTION_CIRCULAR;
    }

    ancestors.add(item);
    nodes.count += 1;

    try {
      if (Array.isArray(item)) {
        return item.map((entry) => redact(entry, depth + 1));
      }

      const record = item as Record<string, unknown>;
      const dynamicKey =
        typeof record.key === 'string'
          ? record.key
          : typeof record.name === 'string'
            ? record.name
            : undefined;
      const redactDynamicValue =
        dynamicKey !== undefined && SECRET_KEY_PATTERN.test(dynamicKey);

      return Object.fromEntries(
        Object.entries(record).map(([key, entry]) => [
          key,
          ((key === 'value' && redactDynamicValue) ||
            SECRET_KEY_PATTERN.test(key)) &&
          entry
            ? REDACTED_SECRET
            : redact(entry, depth + 1),
        ])
      );
    } finally {
      ancestors.delete(item);
    }
  };

  return redact(value, 0) as T;
};

export const preserveRedactedSecrets = <T>(
  incoming: T,
  current: unknown
): T => {
  const ancestors = new WeakSet<object>();
  const nodes = { count: 0 };

  const preserve = (
    item: unknown,
    existing: unknown,
    depth: number
  ): unknown => {
    if (item === REDACTED_SECRET) {
      return existing;
    }
    if (!item || typeof item !== 'object') {
      return item;
    }
    if (depth > REDACTION_MAX_DEPTH || nodes.count >= REDACTION_MAX_NODES) {
      throw new Error('Settings structure exceeds safe nesting limits.');
    }
    if (ancestors.has(item)) {
      throw new Error('Settings structure must not contain circular values.');
    }

    ancestors.add(item);
    nodes.count += 1;

    try {
      if (Array.isArray(item)) {
        const currentArray = Array.isArray(existing) ? existing : [];
        return item.map((entry, index) => {
          const currentItem =
            entry && typeof entry === 'object'
              ? currentArray.find((candidate) => {
                  if (!candidate || typeof candidate !== 'object') {
                    return false;
                  }
                  if ('id' in entry && 'id' in candidate) {
                    return candidate.id === entry.id;
                  }
                  if ('key' in entry && 'key' in candidate) {
                    return candidate.key === entry.key;
                  }
                  return false;
                })
              : undefined;

          return preserve(entry, currentItem ?? currentArray[index], depth + 1);
        });
      }

      const currentRecord =
        existing && typeof existing === 'object'
          ? (existing as Record<string, unknown>)
          : {};

      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([key, entry]) => [
          key,
          preserve(entry, currentRecord[key], depth + 1),
        ])
      );
    } finally {
      ancestors.delete(item);
    }
  };

  return preserve(incoming, current, 0) as T;
};

export const getRateLimitKey = (req: Request): string => {
  const requestIp = req.ip?.trim().toLowerCase();
  if (requestIp && net.isIP(requestIp)) {
    return ipKeyGenerator(requestIp);
  }

  const socketIp = req.socket.remoteAddress?.trim().toLowerCase();
  if (socketIp && net.isIP(socketIp)) {
    return ipKeyGenerator(socketIp);
  }

  // Never let an arbitrary proxy-derived string become a distinct limiter
  // bucket. A malformed value must collapse to one bounded fallback key.
  return 'unknown';
};

export const safeStringEqual = (left: unknown, right: unknown): boolean => {
  if (
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    left.length === 0 ||
    right.length === 0
  ) {
    return false;
  }

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

const isPrivateIPv4 = (ip: string): boolean => {
  const parts = ip.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b, c] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
};

const parseIPv6Words = (ip: string): number[] | undefined => {
  const normalized = ip.split('%', 1)[0];
  const halves = normalized.split('::');
  if (halves.length > 2) {
    return undefined;
  }

  const parseHalf = (half: string): number[] | undefined => {
    if (!half) {
      return [];
    }

    const words: number[] = [];
    for (const part of half.split(':')) {
      if (part.includes('.')) {
        if (!net.isIPv4(part)) {
          return undefined;
        }
        const bytes = part.split('.').map(Number);
        words.push(bytes[0] * 256 + bytes[1], bytes[2] * 256 + bytes[3]);
      } else if (!/^[a-f0-9]{1,4}$/i.test(part)) {
        return undefined;
      } else {
        words.push(Number.parseInt(part, 16));
      }
    }
    return words;
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? '');
  if (!left || !right) {
    return undefined;
  }

  if (halves.length === 1) {
    return left.length === 8 ? left : undefined;
  }

  const omittedWords = 8 - left.length - right.length;
  if (omittedWords < 1) {
    return undefined;
  }

  return [...left, ...Array<number>(omittedWords).fill(0), ...right];
};

const isPrivateIPv6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase().split('%', 1)[0];
  const words = parseIPv6Words(normalized);
  if (!words) {
    return true;
  }

  const isIPv4Mapped =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const isIPv4Translated =
    words.slice(0, 4).every((word) => word === 0) &&
    words[4] === 0xffff &&
    words[5] === 0;
  const isIPv4Compatible = words.slice(0, 6).every((word) => word === 0);
  const isWellKnownNat64 =
    words[0] === 0x64 &&
    words[1] === 0xff9b &&
    words.slice(2, 6).every((word) => word === 0);
  const embeddedIPv4 =
    isIPv4Mapped || isIPv4Translated || isWellKnownNat64
      ? `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`
      : undefined;

  const isDiscardOnly =
    words[0] === 0x100 && words.slice(1, 4).every((word) => word === 0);
  const isLocalNat64 =
    words[0] === 0x64 && words[1] === 0xff9b && words[2] === 1;
  const isIetfProtocolAssignment = words[0] === 0x2001 && words[1] <= 0x1ff;
  const isDocumentation =
    (words[0] === 0x2001 && words[1] === 0x0db8) ||
    (words[0] === 0x3fff && (words[1] & 0xf000) === 0);
  const isSixToFour = words[0] === 0x2002;
  const isSegmentRoutingLocal = words[0] === 0x5f00;

  return (
    normalized === '::1' ||
    normalized === '::' ||
    isIPv4Compatible ||
    (embeddedIPv4 !== undefined && isPrivateIPv4(embeddedIPv4)) ||
    isDiscardOnly ||
    isLocalNat64 ||
    isIetfProtocolAssignment ||
    isDocumentation ||
    isSixToFour ||
    isSegmentRoutingLocal ||
    (words[0] & 0xfe00) === 0xfc00 ||
    (words[0] & 0xffc0) === 0xfe80 ||
    (words[0] & 0xffc0) === 0xfec0 ||
    (words[0] & 0xff00) === 0xff00
  );
};

export const isLocalOrPrivateAddress = (hostname: string): boolean => {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');

  if (!normalized) {
    return true;
  }

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true;
  }

  if (net.isIPv4(normalized)) {
    return isPrivateIPv4(normalized);
  }

  if (net.isIPv6(normalized)) {
    return isPrivateIPv6(normalized);
  }

  return false;
};

/**
 * Narrower than isLocalOrPrivateAddress: true only for loopback and
 * link-local addresses (which includes the 169.254.169.254 cloud metadata
 * address), not general RFC1918/CGNAT ranges. Callers that must allow
 * private-address targets (e.g. LAN player discovery) but still want to
 * refuse the handful of addresses that are never a legitimate third-party
 * device — the host itself, or a cloud metadata endpoint — should use this
 * instead of disabling private-address protection outright.
 */
export const isLoopbackOrLinkLocalAddress = (hostname: string): boolean => {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');

  if (!normalized || normalized === 'localhost') {
    return true;
  }

  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number);
    const [a, b] = parts;
    return a === 127 || (a === 169 && b === 254);
  }

  if (net.isIPv6(normalized)) {
    const words = parseIPv6Words(normalized.split('%', 1)[0]);
    if (!words) {
      return true;
    }
    return normalized === '::1' || (words[0] & 0xffc0) === 0xfe80;
  }

  return false;
};

export const resolvesToLocalOrPrivateAddress = async (
  hostname: string
): Promise<boolean> => {
  if (isLocalOrPrivateAddress(hostname)) {
    return true;
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.some((record) => isLocalOrPrivateAddress(record.address));
  } catch {
    return true;
  }
};

type PrivateAddressPolicy = boolean | (() => boolean);

const isPrivateAddressAllowed = (policy: PrivateAddressPolicy): boolean =>
  typeof policy === 'function' ? policy() : policy;

const directConnectionLookups = new WeakSet<object>();

/**
 * Returns whether a safe lookup needs to run on the target socket.
 * HTTP proxies resolve target hostnames themselves, so proxying such a request
 * would bypass both private-address filtering and the DNS-rebinding check.
 */
export const requiresDirectSafeHttpConnection = (lookup: unknown): boolean => {
  if (
    (typeof lookup !== 'function' &&
      (typeof lookup !== 'object' || lookup === null)) ||
    !directConnectionLookups.has(lookup)
  ) {
    return false;
  }

  return true;
};

const createPrivateAddressError = (hostname: string): NodeJS.ErrnoException => {
  const error = new Error(
    `Refusing to connect to private address for ${hostname}`
  ) as NodeJS.ErrnoException;
  error.code = 'EACCES';
  return error;
};

const createCrossOriginRedirectError = (): NodeJS.ErrnoException => {
  const error = new Error(
    'Refusing to follow a cross-origin redirect'
  ) as NodeJS.ErrnoException;
  error.code = 'EACCES';
  return error;
};

/**
 * Rechecks every address during the DNS lookup used by the actual socket.
 * This closes the gap between URL validation and connection establishment,
 * including DNS rebinding between those two operations.
 */
export const createSafeHttpLookup = (
  allowPrivateAddresses: PrivateAddressPolicy = false,
  requireDirectConnection = false
) => {
  const lookup = (
    hostname: string,
    options: object,
    callback: (
      error: Error | null,
      address: AxiosLookupAddress | AxiosLookupAddress[],
      family?: AddressFamily
    ) => void
  ): void => {
    const lookupOptions = options as LookupOptions;
    dnsLookup(
      hostname,
      { ...lookupOptions, all: true },
      (error, addresses: LookupAddress[]) => {
        if (error) {
          callback(error, []);
          return;
        }

        if (
          !isPrivateAddressAllowed(allowPrivateAddresses) &&
          addresses.some((address) => isLocalOrPrivateAddress(address.address))
        ) {
          callback(createPrivateAddressError(hostname), []);
          return;
        }

        const axiosAddresses = addresses.map((address) => ({
          address: address.address,
          family: address.family === 4 ? (4 as const) : (6 as const),
        }));

        if (lookupOptions.all) {
          callback(null, axiosAddresses);
          return;
        }

        const firstAddress = addresses[0];
        if (!firstAddress) {
          const notFound = new Error(
            `No addresses found for ${hostname}`
          ) as NodeJS.ErrnoException;
          notFound.code = 'ENOTFOUND';
          callback(notFound, []);
          return;
        }

        callback(null, firstAddress.address, firstAddress.family === 4 ? 4 : 6);
      }
    );
  };

  if (requireDirectConnection) {
    directConnectionLookups.add(lookup);
  }

  return lookup;
};

export const createSafeHttpRequestOptions = (
  allowPrivateAddresses: PrivateAddressPolicy = false,
  allowCrossOriginRedirects = true,
  requireDirectConnection = false
) => ({
  lookup: createSafeHttpLookup(allowPrivateAddresses, requireDirectConnection),
  ...(requireDirectConnection ? { proxy: false as const } : {}),
  beforeRedirect: (
    options: Record<string, unknown>,
    _response?: unknown,
    request?: { url?: unknown }
  ) => {
    const targetUrl =
      typeof options.href === 'string' ? options.href : undefined;
    const sourceUrl =
      typeof request?.url === 'string' ? request.url : undefined;

    let isSameOrigin = false;
    if (sourceUrl && targetUrl) {
      try {
        isSameOrigin = new URL(sourceUrl).origin === new URL(targetUrl).origin;
      } catch {
        // If either redirect URL cannot be parsed, do not forward custom headers.
      }
    }

    if (
      !isSameOrigin &&
      options.headers &&
      typeof options.headers === 'object'
    ) {
      for (const header of Object.keys(options.headers)) {
        if (!CROSS_ORIGIN_HEADER_ALLOWLIST.has(header.toLowerCase())) {
          delete (options.headers as Record<string, unknown>)[header];
        }
      }
    }

    if (!isSameOrigin && !allowCrossOriginRedirects) {
      throw createCrossOriginRedirectError();
    }

    const protocol =
      typeof options.protocol === 'string' ? options.protocol : '';
    const hostname =
      typeof options.hostname === 'string' ? options.hostname : '';

    if (
      !isPrivateAddressAllowed(allowPrivateAddresses) &&
      (!['http:', 'https:'].includes(protocol) ||
        !hostname ||
        isLocalOrPrivateAddress(hostname))
    ) {
      throw createPrivateAddressError(hostname || 'redirect target');
    }
  },
});

export const hasAsciiControlCharacters = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
};

export const isValidHttpUrl = (
  value: unknown,
  options: { allowTemplates?: boolean } = {}
): value is string => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    hasAsciiControlCharacters(value)
  ) {
    return false;
  }

  const hasTemplate = /\{\{[A-Za-z0-9_]+\}\}/.test(value);
  if (hasTemplate && !options.allowTemplates) {
    return false;
  }

  const candidate = options.allowTemplates
    ? value.replace(/\{\{[A-Za-z0-9_]+\}\}/g, 'template')
    : value;

  try {
    const url = new URL(candidate);
    return (
      Boolean(url.hostname) &&
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};

export const isValidApplicationUrl = (value: unknown): value is string => {
  if (!isValidHttpUrl(value)) {
    return false;
  }

  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash;
};

export const isSafeHttpUrl = async (
  value: unknown,
  options: { allowTemplates?: boolean; allowPrivateAddresses?: boolean } = {}
): Promise<boolean> => {
  if (!isValidHttpUrl(value, options)) {
    return false;
  }

  if (options.allowPrivateAddresses) {
    return true;
  }

  const candidate = options.allowTemplates
    ? value.replace(/\{\{[A-Za-z0-9_]+\}\}/g, 'template')
    : value;

  try {
    const url = new URL(candidate);
    return !(await resolvesToLocalOrPrivateAddress(url.hostname));
  } catch {
    return false;
  }
};

export const createSafeHttpUrl = async (
  value: unknown,
  options: { allowTemplates?: boolean; allowPrivateAddresses?: boolean } = {}
): Promise<URL | undefined> => {
  if (!(await isSafeHttpUrl(value, options))) {
    return undefined;
  }

  const candidate =
    typeof value === 'string' && options.allowTemplates
      ? value.replace(/\{\{[A-Za-z0-9_]+\}\}/g, 'template')
      : value;

  return typeof candidate === 'string' ? new URL(candidate) : undefined;
};

export const stringifySafeHttpUrl = (value: URL): string => value.toString();
