import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from '@prometheus-io/client';
import { safeStringEqual } from '@server/utils/security';
import type { NextFunction, Request, Response } from 'express';

export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });

const apiRequests = new Counter({
  name: 'seerrng_api_requests_total',
  help: 'Total HTTP requests handled by the Seerr server.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metricsRegistry],
});

const apiRequestDuration = new Histogram({
  name: 'seerrng_api_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

const cacheHits = new Counter({
  name: 'seerrng_cache_hits_total',
  help: 'Total external API cache hits.',
  labelNames: ['cache'] as const,
  registers: [metricsRegistry],
});

const externalApiCalls = new Counter({
  name: 'seerrng_external_api_calls_total',
  help: 'Total external API requests started.',
  labelNames: ['method'] as const,
  registers: [metricsRegistry],
});

const activeRequests = new Gauge({
  name: 'seerrng_active_requests',
  help: 'Number of HTTP requests currently in progress.',
  registers: [metricsRegistry],
});

const getRouteLabel = (request: Request): string => {
  const route = request.route?.path;
  if (route) {
    return `${request.baseUrl}${Array.isArray(route) ? route[0] : route}`;
  }
  if (request.path === '/metrics') {
    return '/metrics';
  }
  return request.path.startsWith('/api/') ? '/api/unknown' : '/other';
};

export const isMetricsAuthorizationValid = (
  authorization: string | undefined,
  configuredToken = process.env.METRICS_AUTH_TOKEN
): boolean => {
  if (!configuredToken || !authorization?.startsWith('Bearer ')) {
    return false;
  }

  return safeStringEqual(
    authorization.slice('Bearer '.length),
    configuredToken
  );
};

export const metricsAuthMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction
): void => {
  if (!isMetricsAuthorizationValid(request.get('authorization'))) {
    response.set('WWW-Authenticate', 'Bearer');
    response.status(401).end();
    return;
  }

  next();
};

export const metricsMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction
): void => {
  const startedAt = process.hrtime.bigint();
  activeRequests.inc();
  let settled = false;
  const recordCompletedRequest = () => {
    if (settled) {
      return;
    }
    settled = true;

    const method = request.method;
    const route = getRouteLabel(request);
    const status = String(response.statusCode);
    const labels = { method, route, status };
    apiRequests.inc(labels);
    apiRequestDuration.observe(
      labels,
      Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
    );
    activeRequests.dec();
  };
  response.once('finish', recordCompletedRequest);
  response.once('close', recordCompletedRequest);
  next();
};

export const recordCacheHit = (cache: string): void => {
  cacheHits.inc({ cache });
};

export const recordExternalApiCall = (method: string): void => {
  externalApiCalls.inc({ method });
};

export const metricsHandler = async (
  _request: Request,
  response: Response
): Promise<void> => {
  response.set('Content-Type', metricsRegistry.contentType);
  response.send(await metricsRegistry.metrics());
};
