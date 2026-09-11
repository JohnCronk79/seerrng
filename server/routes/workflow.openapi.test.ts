import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import request from 'supertest';

describe('workflow list filters behind the OpenAPI validator', () => {
  function createValidatedApp(): Express {
    const app = express();
    app.use(
      OpenApiValidator.middleware({
        apiSpec: path.join(process.cwd(), 'seerr-api.yml'),
        validateRequests: true,
        validateSecurity: false,
      })
    );
    app.get('/api/v1/blocklist', (_req, res) =>
      res.status(200).json({ pageInfo: {}, results: [] })
    );
    app.get('/api/v1/issue', (_req, res) =>
      res.status(200).json({
        pageInfo: {},
        results: [],
        counts: { all: 0, open: 0, resolved: 0 },
      })
    );
    app.use(
      (
        error: { status?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _next: express.NextFunction
      ) =>
        res.status(error.status ?? 500).json({
          status: error.status ?? 500,
          message: error.message,
        })
    );
    return app;
  }

  it('admits Blocklist search and sorting controls', async () => {
    const response = await request(createValidatedApp())
      .get('/api/v1/blocklist')
      .query({
        take: 10,
        skip: 0,
        filter: 'all',
        search: 'director',
        sort: 'mediaType',
        sortDirection: 'asc',
      });

    assert.strictEqual(response.status, 200);
  });

  it('admits Issues search, time, status sorting, and direction controls', async () => {
    const response = await request(createValidatedApp())
      .get('/api/v1/issue')
      .query({
        take: 10,
        skip: 0,
        filter: 'open',
        search: 'playback',
        sort: 'status',
        sortDirection: 'desc',
        timeFrame: '30d',
      });

    assert.strictEqual(response.status, 200);
  });
});
