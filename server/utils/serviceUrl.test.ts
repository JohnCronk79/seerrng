import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildServiceUrl,
  normalizeServiceHostname,
  normalizeUrlBase,
  trimTrailingSlashes,
} from './serviceUrl';

describe('trimTrailingSlashes', () => {
  it('removes only trailing slashes', () => {
    assert.equal(trimTrailingSlashes('/sonarr///'), '/sonarr');
    assert.equal(trimTrailingSlashes('/sonarr/api'), '/sonarr/api');
  });
});

describe('normalizeUrlBase', () => {
  it('normalizes relative url bases', () => {
    assert.equal(normalizeUrlBase('sonarr'), '/sonarr');
    assert.equal(normalizeUrlBase('/sonarr/'), '/sonarr');
    assert.equal(normalizeUrlBase(''), '');
  });

  it('rejects absolute, protocol-relative, and query-like url bases', () => {
    assert.equal(normalizeUrlBase('https://example.com'), '');
    assert.equal(normalizeUrlBase('//example.com'), '');
    assert.equal(normalizeUrlBase('/sonarr?x=1'), '');
    assert.equal(normalizeUrlBase('/sonarr#fragment'), '');
    assert.equal(normalizeUrlBase('/sonarr\r\nx-header: injected'), '');
  });
});

describe('normalizeServiceHostname', () => {
  it('accepts hostnames and IP literals without URL components', () => {
    assert.equal(normalizeServiceHostname('media.local'), 'media.local');
    assert.equal(normalizeServiceHostname('127.0.0.1'), '127.0.0.1');
    assert.equal(normalizeServiceHostname('[::1]'), '[::1]');
  });

  it('rejects hostnames with schemes, credentials, paths, or query strings', () => {
    assert.equal(normalizeServiceHostname('https://media.local'), '');
    assert.equal(normalizeServiceHostname('user@media.local'), '');
    assert.equal(normalizeServiceHostname('media.local/sonarr'), '');
    assert.equal(normalizeServiceHostname('media.local?redirect=1'), '');
    assert.equal(
      normalizeServiceHostname('media.local\r\nx-header: injected'),
      ''
    );
  });
});

describe('buildServiceUrl', () => {
  it('builds normalized service URLs', () => {
    assert.equal(
      buildServiceUrl({
        useSsl: true,
        hostname: 'media.local',
        port: 8989,
        urlBase: 'sonarr/',
        path: '/api/v3',
      }),
      'https://media.local:8989/sonarr/api/v3'
    );
  });
});
