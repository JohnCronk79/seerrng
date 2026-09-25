import express from 'express';
import rateLimit from 'express-rate-limit';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import {
  METRICS_RATE_LIMIT,
  isMetricsAuthorizationValid,
  metricsAuthMiddleware,
  metricsHandler,
  metricsMiddleware,
} from './metrics';

describe('metrics authentication', () => {
  it('requires an exact bearer token', () => {
    assert.equal(
      isMetricsAuthorizationValid(undefined, 'metrics-secret'),
      false
    );
    assert.equal(
      isMetricsAuthorizationValid('Basic metrics-secret', 'metrics-secret'),
      false
    );
    assert.equal(
      isMetricsAuthorizationValid('Bearer wrong-secret', 'metrics-secret'),
      false
    );
    assert.equal(
      isMetricsAuthorizationValid('Bearer metrics-secret', 'metrics-secret'),
      true
    );
  });

  it('rejects empty or whitespace-only credentials', () => {
    assert.equal(
      isMetricsAuthorizationValid('Bearer ', 'metrics-secret'),
      false
    );
    assert.equal(
      isMetricsAuthorizationValid('Bearer metrics-secret', ''),
      false
    );
    assert.equal(
      isMetricsAuthorizationValid('Bearer metrics-secret ', 'metrics-secret'),
      false
    );
  });

  it('protects the metrics response with the configured bearer token', async () => {
    const previousToken = process.env.METRICS_AUTH_TOKEN;
    delete process.env.METRICS_AUTH_TOKEN;
    const app = express();
    app.use(metricsMiddleware);
    app.get(
      '/metrics',
      rateLimit(METRICS_RATE_LIMIT),
      metricsAuthMiddleware,
      metricsHandler
    );

    try {
      const unauthorized = await request(app).get('/metrics');
      assert.strictEqual(unauthorized.status, 401);
      assert.strictEqual(unauthorized.headers['www-authenticate'], 'Bearer');

      const authorized = await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer metrics-secret');
      assert.strictEqual(authorized.status, 401);

      process.env.METRICS_AUTH_TOKEN = 'metrics-secret';
      const authenticated = await request(app)
        .get('/metrics')
        .set('Authorization', 'Bearer metrics-secret');
      assert.strictEqual(authenticated.status, 200);
      assert.match(authenticated.text, /seerrng_active_requests/);
    } finally {
      if (previousToken === undefined) {
        delete process.env.METRICS_AUTH_TOKEN;
      } else {
        process.env.METRICS_AUTH_TOKEN = previousToken;
      }
    }
  });
});
