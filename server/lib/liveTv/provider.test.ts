import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import TunerrAPI from '@server/api/tunerr';
import { createLiveTvProvider } from '@server/lib/liveTv/provider';
import { defaultTunerrSettings } from '@server/lib/settings';

describe('Live TV provider', () => {
  it('returns the configured Tunerr backend with every provider method', () => {
    const provider = createLiveTvProvider({
      ...defaultTunerrSettings(),
      hostname: 'tunerr',
      deckPort: 8409,
      tunerPort: 5004,
    });
    assert.ok(provider instanceof TunerrAPI);
    for (const method of [
      'openGuide',
      'getRules',
      'getRuleHistory',
      'getSportsReport',
      'missingFeatures',
      'upsertRule',
      'deleteRule',
    ] as const) {
      assert.equal(typeof provider[method], 'function', method);
    }
  });
});
