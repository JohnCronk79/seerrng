import type { ExternalAPIRequestFailure } from '@server/api/externalapi';
import logger from '@server/logger';
import { getHttpErrorDetails } from '@server/utils/httpError';
import { getTmdbAuthSource } from './auth';

const TMDB_FAILURE_LOG_INTERVAL_MS = 60_000;

const tmdbFailureLogState = new Map<
  string,
  { lastLoggedAt: number; suppressedCount: number }
>();

export const logTmdbRequestFailure = ({
  method,
  hostname,
  path,
  error,
}: ExternalAPIRequestFailure): void => {
  const details = getHttpErrorDetails(error);
  const credentialSource = getTmdbAuthSource();
  const category = [
    details.status ?? 'no-status',
    details.errorCode ?? 'unknown',
    details.upstreamStatusCode ?? 'no-upstream-code',
    credentialSource,
  ].join(':');
  const now = Date.now();
  const previous = tmdbFailureLogState.get(category);

  if (previous && now - previous.lastLoggedAt < TMDB_FAILURE_LOG_INTERVAL_MS) {
    previous.suppressedCount += 1;
    return;
  }

  tmdbFailureLogState.set(category, { lastLoggedAt: now, suppressedCount: 0 });

  const rejectedCredentials = details.status === 401;
  const log = rejectedCredentials ? logger.error : logger.warn;
  log(
    rejectedCredentials
      ? 'TMDB rejected the configured authentication credentials'
      : 'TMDB API request failed',
    {
      label: 'TMDB API',
      method,
      hostname,
      path,
      credentialSource,
      ...(details.status !== undefined ? { status: details.status } : {}),
      ...(details.errorCode ? { errorCode: details.errorCode } : {}),
      ...(details.upstreamMethod
        ? { upstreamMethod: details.upstreamMethod }
        : {}),
      ...(details.upstreamHost ? { upstreamHost: details.upstreamHost } : {}),
      ...(details.upstreamPath ? { upstreamPath: details.upstreamPath } : {}),
      ...(details.upstreamStatusCode !== undefined
        ? { upstreamStatusCode: details.upstreamStatusCode }
        : {}),
      ...(details.upstreamMessage
        ? { upstreamMessage: details.upstreamMessage }
        : {}),
      errorMessage: details.errorMessage,
      ...(previous?.suppressedCount
        ? { suppressedFailuresSinceLastLog: previous.suppressedCount }
        : {}),
    }
  );
};
