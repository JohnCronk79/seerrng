import { createSafeHttpLookup, isSafeHttpUrl } from '@server/utils/security';
import type { LookupFunction } from 'node:net';
import type { CustomFetch } from 'openid-client';
import { Agent, fetch as undiciFetch } from 'undici';

type UndiciFetchInit = NonNullable<Parameters<typeof undiciFetch>[1]>;

export const OIDC_HTTP_MAX_RESPONSE_BYTES = 1024 * 1024;
export const OIDC_HTTP_MAX_REQUEST_BYTES = 256 * 1024;
export const OIDC_HTTP_TIMEOUT_MS = 10_000;

const isPrivateOidcDestinationAllowed = (): boolean =>
  process.env.OIDC_ALLOW_PRIVATE_ADDRESSES === 'true';

const oidcDispatcher = new Agent({
  connections: 10,
  connect: {
    lookup: createSafeHttpLookup(
      isPrivateOidcDestinationAllowed
    ) as LookupFunction,
  },
});

const getRequestBodySize = (body: Parameters<CustomFetch>[1]['body']) => {
  if (body === undefined || body === null) {
    return 0;
  }
  if (typeof body === 'string') {
    return Buffer.byteLength(body, 'utf8');
  }
  if (body instanceof URLSearchParams) {
    return Buffer.byteLength(body.toString(), 'utf8');
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  return Number.POSITIVE_INFINITY;
};

const composeAbortSignals = (
  callerSignal: AbortSignal | null | undefined,
  timeoutSignal: AbortSignal
): { signal: AbortSignal; cleanup: () => void } => {
  if (!callerSignal) {
    return { signal: timeoutSignal, cleanup: () => undefined };
  }

  const controller = new AbortController();
  const abortFrom = (source: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(source.reason);
    }
  };
  const abortFromCaller = () => abortFrom(callerSignal);
  const abortFromTimeout = () => abortFrom(timeoutSignal);

  if (callerSignal.aborted) {
    abortFrom(callerSignal);
  } else if (timeoutSignal.aborted) {
    abortFrom(timeoutSignal);
  } else {
    callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    timeoutSignal.addEventListener('abort', abortFromTimeout, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      callerSignal.removeEventListener('abort', abortFromCaller);
      timeoutSignal.removeEventListener('abort', abortFromTimeout);
    },
  };
};

const readBoundedResponse = async (response: Response): Promise<Response> => {
  if (!response.body) {
    return response;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > OIDC_HTTP_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('OIDC response exceeds the safe size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return new Response(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }
  );
};

/**
 * Fetch-compatible transport for openid-client. Every OIDC endpoint, including
 * endpoints learned from provider metadata, is revalidated immediately before
 * the socket connection and cannot redirect credentials elsewhere.
 */
export const createOidcSafeFetch =
  (fetchImplementation: typeof undiciFetch = undiciFetch): CustomFetch =>
  async (url, options) => {
    const allowPrivateAddresses = isPrivateOidcDestinationAllowed();
    if (!(await isSafeHttpUrl(url, { allowPrivateAddresses }))) {
      throw new Error('OIDC request destination is not allowed.');
    }
    if (getRequestBodySize(options.body) > OIDC_HTTP_MAX_REQUEST_BYTES) {
      throw new Error('OIDC request exceeds the safe size limit.');
    }

    const timeoutSignal = AbortSignal.timeout(OIDC_HTTP_TIMEOUT_MS);
    const { signal, cleanup } = composeAbortSignals(
      options.signal,
      timeoutSignal
    );
    try {
      // The dispatcher and fetch implementation must come from the same Undici
      // package. Node's global fetch can use a different bundled Undici version,
      // whose dispatcher callback interface is not compatible with this Agent.
      const response = await fetchImplementation(url, {
        method: options.method,
        headers: options.headers,
        body: options.body as UndiciFetchInit['body'],
        redirect: 'manual',
        signal,
        // Undici-specific extension: use a direct dispatcher whose DNS lookup
        // rechecks every resolved address immediately before socket connection.
        dispatcher: oidcDispatcher,
      });

      return await readBoundedResponse(response as unknown as Response);
    } finally {
      cleanup();
    }
  };

const oidcFetchImplementation: typeof undiciFetch =
  process.env.NODE_ENV === 'test'
    ? (url, options) =>
        globalThis.fetch(
          url as Parameters<typeof globalThis.fetch>[0],
          options as RequestInit
        ) as unknown as ReturnType<typeof undiciFetch>
    : undiciFetch;

export const oidcSafeFetch = createOidcSafeFetch(oidcFetchImplementation);
