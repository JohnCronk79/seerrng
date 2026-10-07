import ROMarrNGAPI from '@server/api/software/romarrng';
import { getRepository } from '@server/datasource';
import SoftwareRequest from '@server/entity/SoftwareRequest';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import {
  refreshTrackedSoftwareRequests,
  sanitizeRomPlacement,
} from './softwareRequests';

setupTestDb();

describe('refreshTrackedSoftwareRequests', () => {
  afterEach(() => mock.restoreAll());

  it('refreshes active requests from the oldest effective check time', async () => {
    const settings = getSettings().softwareAcquisition.romarr;
    const originalSettings = { ...settings };
    const calls: string[] = [];

    try {
      Object.assign(settings, { hostname: '127.0.0.1', apiKey: 'test-key' });

      const repo = getRepository(SoftwareRequest);
      await repo.save([
        repo.create({
          requestedById: 1,
          category: 'game',
          provider: 'romarr',
          status: 'approved',
          externalRequestId: 'unchecked-old',
          title: 'Unchecked oldest',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          lastCheckedAt: null,
        }),
        repo.create({
          requestedById: 1,
          category: 'game',
          provider: 'romarr',
          status: 'approved',
          externalRequestId: 'checked-middle',
          title: 'Checked middle',
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          lastCheckedAt: new Date('2026-01-02T00:00:00.000Z'),
        }),
        repo.create({
          requestedById: 1,
          category: 'game',
          provider: 'romarr',
          status: 'approved',
          externalRequestId: 'checked-newest',
          title: 'Checked newest',
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          lastCheckedAt: new Date('2026-01-03T00:00:00.000Z'),
        }),
        repo.create({
          requestedById: 1,
          category: 'game',
          provider: 'romarr',
          status: 'pending',
          externalRequestId: 'pending',
          title: 'Pending request',
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
        }),
      ]);

      mock.method(
        ROMarrNGAPI.prototype,
        'getRequest',
        async (requestId: string) => {
          calls.push(requestId);
          return {
            externalRequestId: requestId,
            status: 'accepted',
            deliverable: false,
          };
        }
      );

      await refreshTrackedSoftwareRequests();
      assert.deepEqual(calls, [
        'unchecked-old',
        'checked-middle',
        'checked-newest',
      ]);
    } finally {
      Object.assign(settings, originalSettings);
    }
  });
});

describe('listSoftwareRequestAssets DAT verification', () => {
  afterEach(() => mock.restoreAll());

  it('keeps only boolean DAT verdicts from ROMarrNG', async () => {
    const { listSoftwareRequestAssets } = await import('./softwareRequests');
    const settings = getSettings().softwareAcquisition.romarr;
    const originalSettings = { ...settings };
    Object.assign(settings, { hostname: '127.0.0.1', apiKey: 'test-key' });
    try {
      mock.method(ROMarrNGAPI.prototype, 'getAssets', async () => ({
        assets: [
          { id: 'a', name: 'Good.sfc', size: 1, url: 'x', datVerified: true },
          { id: 'b', name: 'Hack.sfc', size: 1, datVerified: false },
          { id: 'c', name: 'Bundle.tar', size: 1, datVerified: null },
          { id: 'd', name: 'Odd.sfc', size: 1, datVerified: 'yes' },
        ],
        bundleSupported: false,
      }));
      const assets = await listSoftwareRequestAssets(
        Object.assign(new SoftwareRequest(), {
          id: 1,
          provider: 'romarr' as const,
          status: 'available' as const,
          externalRequestId: 'seerrng:software:1',
        })
      );
      assert.deepEqual(
        assets.map((asset) => [asset.name, asset.datVerified, asset.url]),
        [
          ['Good.sfc', true, ''],
          ['Hack.sfc', false, ''],
          ['Bundle.tar', undefined, ''],
          ['Odd.sfc', undefined, ''],
        ]
      );
    } finally {
      Object.assign(settings, originalSettings);
    }
  });
});

describe('sanitizeRomPlacement', () => {
  it('keeps placed, library, and layout from a valid provider value', () => {
    assert.deepEqual(
      sanitizeRomPlacement({
        placed: true,
        library: 'PS5 ROMs',
        layout: 'nested',
      }),
      { placed: true, library: 'PS5 ROMs', layout: 'nested' }
    );
  });

  it('drops unknown layouts and blank library names', () => {
    assert.deepEqual(
      sanitizeRomPlacement({ placed: false, library: '   ', layout: 'ftp' }),
      { placed: false, library: null, layout: null }
    );
  });

  it('treats a malformed or missing value as unknown', () => {
    assert.equal(sanitizeRomPlacement(undefined), null);
    assert.equal(sanitizeRomPlacement({ placed: 'yes' }), null);
    assert.equal(sanitizeRomPlacement('placed'), null);
  });

  it('strips control characters and bounds the library name', () => {
    const placement = sanitizeRomPlacement({
      placed: true,
      library: `Line\nBreak${'x'.repeat(200)}`,
      layout: 'flat',
    });
    assert.ok(placement);
    assert.ok(!/[\r\n\0]/.test(placement.library ?? ''));
    assert.equal((placement.library ?? '').length, 120);
  });
});
