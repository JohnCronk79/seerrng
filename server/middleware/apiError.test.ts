import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiErrorCode } from '@server/constants/error';
import {
  formatApiErrorResponse,
  getRequestLogPath,
  normalizeApiErrorStatus,
} from './apiError';

describe('normalizeApiErrorStatus', () => {
  it('accepts valid HTTP response statuses and rejects malformed values', () => {
    assert.strictEqual(normalizeApiErrorStatus(202), 202);
    assert.strictEqual(normalizeApiErrorStatus(404), 404);
    assert.strictEqual(normalizeApiErrorStatus('404'), 500);
    assert.strictEqual(normalizeApiErrorStatus(Number.NaN), 500);
    assert.strictEqual(normalizeApiErrorStatus(199), 500);
    assert.strictEqual(normalizeApiErrorStatus(600), 500);
  });
});

describe('API error response formatting', () => {
  it('hides internal details from server error responses', () => {
    assert.deepStrictEqual(
      formatApiErrorResponse(
        {
          message: 'SQLITE_ERROR: no such column at /private/config',
          errors: [{ path: '/private/config/db.sqlite3' }],
          error: ApiErrorCode.Unknown,
        },
        500
      ),
      {
        message: 'Internal server error.',
        error: ApiErrorCode.Unknown,
      }
    );
  });

  it('does not forward arbitrary error strings as public error codes', () => {
    assert.deepStrictEqual(
      formatApiErrorResponse(
        {
          message: 'Failed.',
          error: 'SQLITE private_schema at 10.0.0.5',
        },
        500
      ),
      { message: 'Internal server error.' }
    );
  });

  it('preserves client-error validation details', () => {
    assert.deepStrictEqual(
      formatApiErrorResponse(
        { message: 'Invalid request.', errors: [{ path: '.body.name' }] },
        400
      ),
      {
        message: 'Invalid request.',
        errors: [{ path: '.body.name' }],
      }
    );
  });
});

describe('getRequestLogPath', () => {
  it('removes query strings so credentials cannot enter logs', () => {
    assert.strictEqual(
      getRequestLogPath('/api/v1/example?token=secret&other=value'),
      '/api/v1/example'
    );
    assert.strictEqual(getRequestLogPath('/api/v1/example'), '/api/v1/example');
  });
});
