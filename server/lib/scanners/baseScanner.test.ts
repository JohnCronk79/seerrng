import { MediaType } from '@server/constants/media';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaIdentifierProvider } from '@server/entity/MediaIdentifier';
import { runWithRequestAdmission } from '@server/entity/MediaRequest';
import BaseScanner from '@server/lib/scanners/baseScanner';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

class TestScanner extends BaseScanner<never> {
  public constructor() {
    super('Test Scan');
  }

  public begin(): string | undefined {
    return this.startRun();
  }

  public finish(sessionId: string): void {
    this.endRun(sessionId);
  }

  public isRunning(): boolean {
    return this.running;
  }

  public scanMusic(mbId: string): Promise<void> {
    return this.processMusic(mbId, { processing: true });
  }

  public scanBook(value: string): Promise<void> {
    return this.processBook(MediaIdentifierProvider.ISBN, value, {
      processing: true,
    });
  }
}

setupTestDb();

describe('BaseScanner run admission', () => {
  it('rejects an overlapping invocation without replacing the active run', () => {
    const scanner = new TestScanner();
    const firstSessionId = scanner.begin();

    assert.ok(firstSessionId);
    assert.strictEqual(scanner.isRunning(), true);
    assert.strictEqual(scanner.begin(), undefined);

    scanner.finish(firstSessionId);
    assert.strictEqual(scanner.isRunning(), false);
    assert.ok(scanner.begin());
  });

  it('shares canonical music admission with request creation', async () => {
    const scanner = new TestScanner();
    const mbId = 'scanner-request-admission';
    const key = `request-canonical:music:${mbId}`;
    let releaseBlocker: () => void = () => undefined;
    let markEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const blocker = runWithRequestAdmission([key], async () => {
      markEntered();
      await new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
    });
    await entered;

    const scan = scanner.scanMusic(mbId);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(
      await getRepository(Media).countBy({
        mediaType: MediaType.MUSIC,
        mbId,
      }),
      0
    );

    releaseBlocker();
    await Promise.all([blocker, scan]);
    assert.strictEqual(
      await getRepository(Media).countBy({
        mediaType: MediaType.MUSIC,
        mbId,
      }),
      1
    );
  });

  it('rolls back new book media when identifier persistence fails', async () => {
    const scanner = new TestScanner();
    await dataSource.query(`
      CREATE TRIGGER fail_scanner_identifier_insert
      BEFORE INSERT ON media_identifier
      BEGIN
        SELECT RAISE(FAIL, 'forced identifier failure');
      END
    `);

    try {
      await assert.rejects(
        scanner.scanBook('9780547928227'),
        /forced identifier failure/i
      );
    } finally {
      await dataSource.query('DROP TRIGGER fail_scanner_identifier_insert');
    }

    assert.strictEqual(
      await getRepository(Media).countBy({ mediaType: MediaType.BOOK }),
      0
    );
  });
});
