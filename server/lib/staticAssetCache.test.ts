import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import express from 'express';
import request from 'supertest';

import {
  getStaticAssetCacheControl,
  setStaticAssetCacheControl,
} from './staticAssetCache';

describe('getStaticAssetCacheControl', () => {
  it('keeps service worker updates revalidatable', () => {
    assert.equal(getStaticAssetCacheControl('/sw.js'), 'no-cache');
  });

  it('allows browser caching for public image assets', () => {
    assert.equal(
      getStaticAssetCacheControl('/images/seerr_poster_not_found.png'),
      'public, max-age=2592000, stale-while-revalidate=2592000, stale-if-error=86400'
    );
  });

  it('allows browser caching for public media and document assets', () => {
    assert.equal(
      getStaticAssetCacheControl('/trailers/example.webm'),
      'public, max-age=2592000, stale-while-revalidate=2592000, stale-if-error=86400'
    );
    assert.equal(
      getStaticAssetCacheControl('/captions/example.vtt'),
      'public, max-age=2592000, stale-while-revalidate=2592000, stale-if-error=86400'
    );
  });

  it('allows browser caching for public runtime assets', () => {
    assert.equal(
      getStaticAssetCacheControl('/workers/image-decoder.wasm'),
      'public, max-age=2592000, stale-while-revalidate=2592000, stale-if-error=86400'
    );
    assert.equal(
      getStaticAssetCacheControl('/scripts/embed.mjs'),
      'public, max-age=2592000, stale-while-revalidate=2592000, stale-if-error=86400'
    );
  });

  it('uses immutable caching for Next static build assets', () => {
    assert.equal(
      getStaticAssetCacheControl('/_next/static/chunks/app.js'),
      'public, max-age=31536000, immutable'
    );
  });

  it('leaves pages and API routes untouched', () => {
    assert.equal(getStaticAssetCacheControl('/movie/123'), undefined);
    assert.equal(getStaticAssetCacheControl('/api/v1/settings'), undefined);
  });
});

describe('setStaticAssetCacheControl', () => {
  it('sets browser cache headers before the app handler responds', async () => {
    const app = express();
    app.get('*path', (req, res) => {
      setStaticAssetCacheControl(req, res);
      res.status(200).send('asset');
    });

    const res = await request(app).get('/images/seerr_poster_not_found.png');

    assert.equal(
      res.headers['cache-control'],
      'public, max-age=2592000, stale-while-revalidate=2592000, stale-if-error=86400'
    );
  });

  it('does not add browser cache headers to app pages', async () => {
    const app = express();
    app.get('*path', (req, res) => {
      setStaticAssetCacheControl(req, res);
      res.status(200).send('page');
    });

    const res = await request(app).get('/movie/123');

    assert.equal(res.headers['cache-control'], undefined);
  });
});
