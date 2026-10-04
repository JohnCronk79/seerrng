import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completeSetupRequests } from './setupCompletion';

describe('completeSetupRequests', () => {
  it('does not save locale before initialization succeeds', async () => {
    let localeSaves = 0;
    const result = await completeSetupRequests({
      initialize: async () => false,
      saveLocale: async () => {
        localeSaves += 1;
      },
      isCancellation: () => false,
    });

    assert.deepStrictEqual(result, {
      initialized: false,
      localeSaved: false,
    });
    assert.strictEqual(localeSaves, 0);
  });

  it('keeps initialization successful when the locale save fails', async () => {
    const result = await completeSetupRequests({
      initialize: async () => true,
      saveLocale: async () => {
        throw new Error('locale persistence failed');
      },
      isCancellation: () => false,
    });

    assert.deepStrictEqual(result, {
      initialized: true,
      localeSaved: false,
    });
  });

  it('propagates cancellation instead of treating it as a locale failure', async () => {
    const cancellation = new Error('cancelled');
    await assert.rejects(
      completeSetupRequests({
        initialize: async () => true,
        saveLocale: async () => {
          throw cancellation;
        },
        isCancellation: (error) => error === cancellation,
      }),
      cancellation
    );
  });
});
