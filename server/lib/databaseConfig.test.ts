import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  MAX_DATABASE_TLS_FILE_BYTES,
  parseBooleanConfig,
  parseIntegerConfig,
  readDatabaseTlsFile,
} from './databaseConfig';

const posixIt = process.platform === 'win32' ? it.skip : it;

describe('database configuration parsing', () => {
  it('rejects misspelled booleans instead of silently disabling verification', () => {
    assert.equal(parseBooleanConfig('TLS', 'TRUE'), true);
    assert.equal(parseBooleanConfig('TLS', 'false', true), false);
    assert.throws(
      () => parseBooleanConfig('TLS', 'treu', true),
      /true.*false/i
    );
  });

  it('accepts only bounded decimal integers', () => {
    assert.equal(
      parseIntegerConfig('PORT', undefined, 5432, { min: 1, max: 65535 }),
      5432
    );
    assert.equal(
      parseIntegerConfig('PORT', '5433', 5432, { min: 1, max: 65535 }),
      5433
    );
    assert.throws(
      () =>
        parseIntegerConfig('PORT', '5432junk', 5432, { min: 1, max: 65535 }),
      /decimal integer/i
    );
    assert.throws(
      () => parseIntegerConfig('PORT', '65536', 5432, { min: 1, max: 65535 }),
      /between 1 and 65535/i
    );
  });
});

describe('database TLS file reads', () => {
  posixIt(
    'supports symlinked secret mounts while reading regular files',
    () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-db-tls-'));
      try {
        const target = path.join(directory, 'certificate.pem');
        const link = path.join(directory, 'current.pem');
        fs.writeFileSync(target, 'certificate');
        fs.symlinkSync(target, link);

        assert.equal(readDatabaseTlsFile(link).toString(), 'certificate');
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it('rejects oversized TLS material before buffering it', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-db-tls-'));
    try {
      const filePath = path.join(directory, 'oversized.pem');
      fs.writeFileSync(filePath, Buffer.alloc(MAX_DATABASE_TLS_FILE_BYTES + 1));

      assert.throws(() => readDatabaseTlsFile(filePath), /exceeds/i);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects non-regular TLS paths', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-db-tls-'));
    try {
      assert.throws(() => readDatabaseTlsFile(directory), /regular file/i);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
