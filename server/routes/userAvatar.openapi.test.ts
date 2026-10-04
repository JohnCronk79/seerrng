import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import request from 'supertest';

import {
  LOCAL_AVATAR_CONTENT_TYPES,
  LOCAL_AVATAR_MAX_BYTES,
} from '@server/lib/localAvatar';

describe('local profile picture OpenAPI contract', () => {
  function createValidatedApp() {
    const app = express();
    app.use(express.json({ limit: '100kb' }));
    app.use(
      OpenApiValidator.middleware({
        apiSpec: path.join(process.cwd(), 'seerr-api.yml'),
        validateRequests: true,
        validateSecurity: false,
      })
    );
    app.put(
      '/api/v1/user/:userId/avatar',
      express.raw({
        type: [...LOCAL_AVATAR_CONTENT_TYPES],
        limit: LOCAL_AVATAR_MAX_BYTES,
      }),
      (req, res) => res.status(Buffer.isBuffer(req.body) ? 200 : 400).json({})
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

  it('admits a supported binary profile picture', async () => {
    const response = await request(createValidatedApp())
      .put('/api/v1/user/7/avatar')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('image-bytes'));

    assert.equal(response.status, 200);
  });

  it('rejects an unsupported profile picture content type', async () => {
    const response = await request(createValidatedApp())
      .put('/api/v1/user/7/avatar')
      .set('Content-Type', 'text/plain')
      .send('not-an-image');

    assert.equal(response.status, 415);
  });
});
